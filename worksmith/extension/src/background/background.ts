import type {
  AccessibilitySnapshot,
  ActivityEvent,
  DwellState,
  LastScroll,
  SavedCapture,
  ScrollState,
  TabState,
  WorksmithState,
} from "../lib/types";

const STORAGE_KEY = "worksmith.state.v1";
const MAX_EVENTS = 2000;
const MAX_EVENTS_PER_TAB = 300;
const MAX_SAVED_CAPTURES = 40;
const DWELL_CAPTURE_MS = 30000;
const DWELL_ALARM_NAME = "worksmith.stable-scroll";
const DWELL_RETRY_MS = 5000;
const MAX_DWELL_RETRIES = 6;

interface ActiveDwell {
  tabId: number;
  windowId: number | null;
  signature: string;
  deadline: number;
}

interface InternalState {
  sessionId: string;
  activeTabId: number | null;
  targetTabId: number | null;
  activeWindowId: number | null;
  tabs: Record<string, TabState>;
  events: ActivityEvent[];
  eventTypes: Set<string>;
  savedCaptures: SavedCapture[];
  activeDwell: ActiveDwell | null;
  nextEventNumber: number;
}

const state: InternalState = {
  sessionId: createSessionId(),
  activeTabId: null,
  targetTabId: null,
  activeWindowId: null,
  tabs: {},
  events: [],
  eventTypes: new Set(),
  savedCaptures: [],
  activeDwell: null,
  nextEventNumber: 1,
};

const consolePorts = new Set<chrome.runtime.Port>();
const hydratePromise = hydrateState();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let dwellTimeout: ReturnType<typeof setTimeout> | null = null;

chrome.runtime.onInstalled.addListener(() => {
  recordEvent("extension.installed", null, null, { version: chrome.runtime.getManifest().version });
});

chrome.runtime.onStartup.addListener(() => {
  recordEvent("extension.started", null, null, { version: chrome.runtime.getManifest().version });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "worksmith-console") {
    return;
  }

  consolePorts.add(port);
  port.postMessage({ type: "state", state: serializeState() });

  port.onMessage.addListener((message) => {
    void handleConsoleMessage(message, port);
  });

  port.onDisconnect.addListener(() => {
    consolePorts.delete(port);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));

  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DWELL_ALARM_NAME) {
    void handleDwellAlarm();
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.active && isInspectableTab(tab)) {
    state.targetTabId = tab.id ?? null;
  }

  upsertTab(tab, { createdAt: now() });
  recordEvent("tab.created", tab.id ?? null, tab.windowId ?? null, tabPayload(tab));
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  await hydratePromise;
  pauseActiveDwell();
  state.activeTabId = tabId;
  state.activeWindowId = windowId;

  try {
    const tab = await chrome.tabs.get(tabId);
    if (isInspectableTab(tab)) {
      state.targetTabId = tabId;
    }

    upsertTab(tab, { active: true });
    recordEvent("tab.activated", tabId, windowId, tabPayload(tab));
    resumeDwellForTab(tabId, windowId);
    void refreshScrollState(tabId);
  } catch (error) {
    recordEvent("tab.activated", tabId, windowId, { error: normalizeError(error) });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && isInspectableTab(tab)) {
    state.targetTabId = tabId;
  }

  upsertTab(tab);

  if (changeInfo.url || changeInfo.status === "loading") {
    resetTabDwell(tabId);
  }

  recordEvent("tab.updated", tabId, tab.windowId ?? null, {
    ...tabPayload(tab),
    changeInfo,
  });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  const knownTab = state.tabs[String(tabId)];
  recordEvent("tab.removed", tabId, removeInfo.windowId ?? null, {
    url: knownTab?.url || null,
    title: knownTab?.title || null,
    isWindowClosing: removeInfo.isWindowClosing,
  });

  delete state.tabs[String(tabId)];

  if (state.activeTabId === tabId) {
    pauseActiveDwell();
    state.activeTabId = null;
  }

  if (state.targetTabId === tabId) {
    state.targetTabId = null;
  }

  broadcastState();
  schedulePersist();
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  await hydratePromise;

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    pauseActiveDwell();
  }

  state.activeWindowId = windowId === chrome.windows.WINDOW_ID_NONE ? null : windowId;
  recordEvent("window.focus.changed", null, state.activeWindowId, { windowId });

  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    void syncActiveTab();
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  resetTabDwell(details.tabId);
  recordEvent("navigation.committed", details.tabId, null, {
    url: details.url,
    transitionType: details.transitionType,
    transitionQualifiers: details.transitionQualifiers,
  });
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  recordEvent("navigation.completed", details.tabId, null, { url: details.url });
});

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});

async function hydrateState(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const persisted = stored[STORAGE_KEY] as WorksmithState | undefined;

  if (persisted) {
    state.sessionId = persisted.sessionId || state.sessionId;
    state.activeTabId = persisted.activeTabId ?? null;
    state.targetTabId = persisted.targetTabId ?? null;
    state.activeWindowId = persisted.activeWindowId ?? null;
    state.tabs = persisted.tabs || {};
    state.events = Array.isArray(persisted.events) ? persisted.events.slice(-MAX_EVENTS) : [];
    state.savedCaptures = Array.isArray(persisted.savedCaptures)
      ? persisted.savedCaptures.slice(-MAX_SAVED_CAPTURES)
      : [];
    state.nextEventNumber = persisted.nextEventNumber || state.events.length + 1;
    state.eventTypes = new Set(state.events.map((event) => event.type));
  }

  await syncOpenTabs();
  await syncActiveTab();
  broadcastState();
}

async function syncOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const openTabIds = new Set<string>();

  tabs.forEach((tab) => {
    if (tab.id != null) {
      openTabIds.add(String(tab.id));
    }
    upsertTab(tab);
  });

  Object.keys(state.tabs).forEach((tabId) => {
    if (!openTabIds.has(tabId)) {
      delete state.tabs[tabId];
    }
  });
}

async function syncActiveTab(): Promise<void> {
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = activeTabs[0];

  if (!activeTab) {
    broadcastState();
    return;
  }

  if (state.activeDwell && state.activeDwell.tabId !== activeTab.id) {
    pauseActiveDwell();
  }

  state.activeTabId = activeTab.id ?? null;
  state.activeWindowId = activeTab.windowId ?? null;

  if (isInspectableTab(activeTab)) {
    state.targetTabId = activeTab.id ?? null;
  }

  upsertTab(activeTab, { active: true });
  if (activeTab.id != null) {
    resumeDwellForTab(activeTab.id, activeTab.windowId ?? null);
    void refreshScrollState(activeTab.id);
  }
  broadcastState();
}

function upsertTab(tab: chrome.tabs.Tab, extra: Partial<TabState> = {}): void {
  if (tab?.id == null) {
    return;
  }

  const id = String(tab.id);
  const previous = state.tabs[id] || ({} as Partial<TabState>);
  const timestamp = now();

  state.tabs[id] = {
    tabId: tab.id,
    windowId: tab.windowId ?? previous.windowId ?? null,
    url: tab.url ?? previous.url ?? null,
    title: tab.title ?? previous.title ?? null,
    favIconUrl: tab.favIconUrl ?? previous.favIconUrl ?? null,
    status: tab.status ?? previous.status ?? null,
    active: tab.active ?? previous.active ?? false,
    createdAt: previous.createdAt || extra.createdAt || timestamp,
    updatedAt: timestamp,
    lastScroll: previous.lastScroll || null,
    latestAccessibilitySnapshot: previous.latestAccessibilitySnapshot || null,
    dwell: previous.dwell || null,
    events: previous.events || [],
    ...extra,
  };
}

interface RuntimeResponse {
  ok: boolean;
  error?: string;
}

async function handleRuntimeMessage(
  message: { type?: string; payload?: Record<string, unknown> },
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  await hydratePromise;

  if (!message || typeof message.type !== "string") {
    return { ok: false, error: "Invalid message" };
  }

  const tab = sender.tab;

  if (message.type === "worksmith.scroll") {
    if (!tab || tab.id == null) {
      return { ok: false, error: "Missing sender tab" };
    }
    const tabId = tab.id;

    const tabKey = String(tabId);
    const currentTab = state.tabs[tabKey] || ({} as Partial<TabState>);
    const payload = (message.payload || {}) as Record<string, unknown> & {
      url?: string;
      scrollState?: ScrollState;
    };
    const lastScroll: LastScroll = {
      ...payload,
      timestamp: now(),
      url: payload.url || currentTab.url || null,
    };

    state.tabs[tabKey] = {
      ...(currentTab as TabState),
      tabId,
      windowId: tab.windowId ?? currentTab.windowId ?? null,
      url: tab.url ?? lastScroll.url,
      title: tab.title ?? currentTab.title ?? null,
      updatedAt: now(),
      lastScroll,
      events: currentTab.events || [],
    };

    recordEvent("page.scroll", tabId, tab.windowId ?? null, lastScroll as unknown as Record<string, unknown>);
    updateDwellFromScroll(tabId, tab.windowId ?? null, lastScroll);
    return { ok: true };
  }

  if (message.type === "worksmith.route.changed") {
    const tabId = tab?.id;
    if (tabId == null) {
      return { ok: false, error: "Missing sender tab" };
    }

    upsertTab(tab!);
    resetTabDwell(tabId);
    recordEvent("page.route.changed", tabId, tab!.windowId ?? null, message.payload || {});
    return { ok: true };
  }

  return { ok: false, error: `Unknown message type: ${message.type}` };
}

async function handleConsoleMessage(
  message: { type?: string; tabId?: number | null },
  port: chrome.runtime.Port,
): Promise<void> {
  await hydratePromise;

  if (!message || typeof message.type !== "string") {
    return;
  }

  if (message.type === "get-state") {
    port.postMessage({ type: "state", state: serializeState() });
    return;
  }

  if (message.type === "clear-log") {
    state.events = [];
    state.eventTypes = new Set();
    Object.values(state.tabs).forEach((tab) => {
      tab.events = [];
      tab.latestAccessibilitySnapshot = null;
    });
    recordEvent("log.cleared", null, null, {});
    return;
  }

  if (message.type === "capture-accessibility") {
    await captureAccessibility(port, message.tabId ?? null);
    return;
  }

  if (message.type === "select-view") {
    port.postMessage({ type: "state", state: serializeState() });
  }
}

async function captureAccessibility(
  port: chrome.runtime.Port,
  requestedTabId: number | null,
): Promise<void> {
  const tabId = requestedTabId || state.targetTabId || state.activeTabId;

  if (!tabId) {
    port.postMessage({ type: "capture-error", error: "No target tab available" });
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "worksmith.captureAccessibility",
    });

    if (!response?.ok) {
      throw new Error(response?.error || "No accessibility snapshot returned");
    }

    const snapshot: AccessibilitySnapshot = {
      tabId,
      url: response.url,
      title: response.title,
      capturedAt: now(),
      tree: response.tree,
    };

    const tabKey = String(tabId);
    const currentTab = state.tabs[tabKey];
    if (currentTab) {
      currentTab.latestAccessibilitySnapshot = snapshot;
      currentTab.updatedAt = now();
    }

    recordEvent("accessibility.snapshot", tabId, currentTab?.windowId ?? null, {
      url: snapshot.url,
      title: snapshot.title,
      nodeCount: response.nodeCount,
    });

    port.postMessage({ type: "accessibility-snapshot", snapshot });
  } catch (error) {
    const normalized = normalizeError(error);
    recordEvent("accessibility.snapshot.failed", tabId, null, { error: normalized });
    port.postMessage({ type: "capture-error", tabId, error: normalized });
  }
}

async function refreshScrollState(tabId: number): Promise<void> {
  const tab = state.tabs[String(tabId)];
  if (!tab || !isInspectableTab(tab)) {
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "worksmith.getScrollState" });
    if (!response?.ok) {
      return;
    }

    const lastScroll: LastScroll = {
      ...response.scrollState.page,
      scrollState: response.scrollState,
      scrollSignature: response.scrollSignature,
      timestamp: now(),
      url: response.url || tab.url || null,
    };

    state.tabs[String(tabId)] = {
      ...tab,
      title: response.title || tab.title || null,
      url: response.url || tab.url || null,
      lastScroll,
      updatedAt: now(),
    };

    updateDwellFromScroll(tabId, tab.windowId ?? null, lastScroll);
    broadcastState();
    schedulePersist();
  } catch (error) {
    recordEvent("page.scroll.state.failed", tabId, tab.windowId ?? null, {
      error: normalizeError(error),
    });
  }
}

function updateDwellFromScroll(
  tabId: number,
  windowId: number | null,
  lastScroll: LastScroll,
): void {
  const tabKey = String(tabId);
  const tab = state.tabs[tabKey];
  if (!tab) {
    return;
  }

  const signature = createDwellSignature(lastScroll);
  const previousDwell = (tab.dwell || {}) as Partial<DwellState>;
  const signatureChanged = previousDwell.signature !== signature;

  tab.dwell = {
    signature,
    elapsedMs: signatureChanged ? 0 : previousDwell.elapsedMs || 0,
    deadline: signatureChanged ? null : previousDwell.deadline ?? null,
    captureRetries: signatureChanged ? 0 : previousDwell.captureRetries || 0,
    capturedSignature: signatureChanged ? null : previousDwell.capturedSignature || null,
    lastChangedAt: signatureChanged ? now() : previousDwell.lastChangedAt || now(),
    scrollState: lastScroll.scrollState || null,
  };

  if (tabId !== state.activeTabId || !isInspectableTab(tab)) {
    return;
  }

  if (state.activeDwell?.tabId === tabId && state.activeDwell.signature === signature) {
    return;
  }

  startActiveDwell(tabId, windowId, signature);
}

function resumeDwellForTab(tabId: number, windowId: number | null): void {
  const tab = state.tabs[String(tabId)];
  const signature = tab?.dwell?.signature;

  if (!tab || !signature || !isInspectableTab(tab)) {
    clearDwellAlarm();
    state.activeDwell = null;
    return;
  }

  startActiveDwell(tabId, windowId, signature);
}

function startActiveDwell(tabId: number, windowId: number | null, signature: string): void {
  const tab = state.tabs[String(tabId)];
  if (!tab?.dwell || tab.dwell.capturedSignature === signature) {
    clearDwellAlarm();
    state.activeDwell = null;
    return;
  }

  const nowMs = Date.now();
  // Reuse a deadline that was persisted while this signature was already counting
  // down (so a service-worker restart resumes the same countdown instead of
  // starting over); otherwise derive a fresh one from the accumulated elapsed
  // time saved when the tab was last paused.
  let deadline = tab.dwell.deadline;
  if (typeof deadline !== "number") {
    deadline = nowMs + Math.max(DWELL_CAPTURE_MS - (tab.dwell.elapsedMs || 0), 0);
  }

  tab.dwell.deadline = deadline;
  tab.dwell.captureRetries = 0;
  state.activeDwell = { tabId, windowId, signature, deadline };

  scheduleDwellAlarm(Math.max(deadline - nowMs, 0));
  schedulePersist();
  broadcastState();
}

function pauseActiveDwell(): void {
  if (!state.activeDwell) {
    clearDwellAlarm();
    return;
  }

  const dwell = state.activeDwell;
  const tab = state.tabs[String(dwell.tabId)];

  if (tab?.dwell?.signature === dwell.signature) {
    // Convert the remaining wall-clock time back into accumulated elapsed time and
    // drop the absolute deadline, since the countdown is paused while another tab
    // is active. resumeDwellForTab will rebuild the deadline from this on return.
    const deadline = tab.dwell.deadline ?? dwell.deadline ?? Date.now() + DWELL_CAPTURE_MS;
    const remaining = Math.max(deadline - Date.now(), 0);
    tab.dwell.elapsedMs = Math.min(DWELL_CAPTURE_MS, DWELL_CAPTURE_MS - remaining);
    tab.dwell.deadline = null;
  }

  state.activeDwell = null;
  clearDwellAlarm();
  schedulePersist();
}

function resetTabDwell(tabId: number): void {
  const tab = state.tabs[String(tabId)];
  if (tab) {
    tab.dwell = null;
  }

  if (state.activeDwell?.tabId === tabId) {
    state.activeDwell = null;
    clearDwellAlarm();
  }
}

function scheduleDwellAlarm(delayMs: number): void {
  if (dwellTimeout) {
    clearTimeout(dwellTimeout);
  }

  // In-process timer: fires precisely while the service worker is alive (which it
  // is whenever the console is open and holding a port).
  dwellTimeout = setTimeout(() => {
    dwellTimeout = null;
    void handleDwellAlarm();
  }, Math.max(delayMs, 250));

  // Backup that survives service-worker suspension. Chrome clamps very short
  // alarms to a ~30-60s minimum, so this only carries the load once the worker
  // has been suspended; the persisted deadline (checked in handleDwellAlarm)
  // keeps the actual capture time correct even if the alarm fires late.
  chrome.alarms.create(DWELL_ALARM_NAME, { when: Date.now() + Math.max(delayMs, 1000) });
}

function clearDwellAlarm(): void {
  if (dwellTimeout) {
    clearTimeout(dwellTimeout);
    dwellTimeout = null;
  }

  void chrome.alarms.clear(DWELL_ALARM_NAME);
}

async function handleDwellAlarm(): Promise<void> {
  await hydratePromise;

  const dwell = state.activeDwell;
  if (!dwell) {
    return;
  }

  const tab = state.tabs[String(dwell.tabId)];
  if (
    !tab?.dwell ||
    tab.dwell.signature !== dwell.signature ||
    tab.dwell.capturedSignature === dwell.signature
  ) {
    state.activeDwell = null;
    clearDwellAlarm();
    return;
  }

  const deadline = typeof tab.dwell.deadline === "number" ? tab.dwell.deadline : dwell.deadline;
  const remaining = (deadline ?? Date.now()) - Date.now();
  if (remaining > 0) {
    scheduleDwellAlarm(remaining);
    return;
  }

  try {
    await captureStableMoment(dwell.tabId, dwell.windowId, dwell.signature);
  } catch (error) {
    recordEvent("stable.capture.failed", dwell.tabId, dwell.windowId, {
      error: normalizeError(error),
    });
    // Don't leave a dwell wedged on a hard failure; a later scroll or activation
    // starts a fresh countdown.
    state.activeDwell = null;
    clearDwellAlarm();
  }
}

async function captureStableMoment(
  tabId: number,
  windowId: number | null,
  expectedSignature: string,
): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active || !isInspectableTab(tab)) {
    pauseActiveDwell();
    return;
  }

  const moment = await chrome.tabs.sendMessage(tabId, { type: "worksmith.captureMoment" });
  if (!moment?.ok) {
    throw new Error(moment?.error || "No capture moment returned");
  }

  const actualSignature = createDwellSignature({
    url: moment.url,
    scrollSignature: moment.scrollSignature,
    scrollState: moment.scrollState,
  } as LastScroll);

  if (actualSignature !== expectedSignature) {
    updateDwellFromScroll(tabId, windowId, {
      ...moment.scrollState.page,
      url: moment.url,
      scrollState: moment.scrollState,
      scrollSignature: moment.scrollSignature,
      timestamp: now(),
    });
    return;
  }

  const screenshotDataUrl = await captureVisibleTabSafely(windowId, tabId);
  if (!screenshotDataUrl) {
    // Window isn't capturable yet (unfocused/minimized/occluded). The dwell stays
    // due and a retry is scheduled; bail without consuming this capture.
    return;
  }

  const capturedAt = now();
  const capture: SavedCapture = {
    id: `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    tabId,
    windowId: windowId ?? -1,
    url: moment.url,
    title: moment.title,
    capturedAt,
    reason: "stable-scroll-30s",
    scrollSignature: moment.scrollSignature,
    scrollState: moment.scrollState,
    screenshotDataUrl,
    accessibilitySnapshot: {
      tabId,
      url: moment.url,
      title: moment.title,
      capturedAt,
      tree: moment.tree,
    },
    nodeCount: moment.nodeCount,
  };

  state.savedCaptures = [capture, ...state.savedCaptures].slice(0, MAX_SAVED_CAPTURES);

  const tabState = state.tabs[String(tabId)];
  if (tabState) {
    tabState.latestAccessibilitySnapshot = capture.accessibilitySnapshot;
    tabState.dwell = {
      ...(tabState.dwell as DwellState),
      signature: expectedSignature,
      elapsedMs: DWELL_CAPTURE_MS,
      deadline: null,
      captureRetries: 0,
      capturedSignature: expectedSignature,
      scrollState: moment.scrollState,
    };
  }

  state.activeDwell = null;
  clearDwellAlarm();
  recordEvent("stable.capture.saved", tabId, windowId, {
    captureId: capture.id,
    url: capture.url,
    title: capture.title,
    nodeCount: capture.nodeCount,
    scrollBoxCount: capture.scrollState?.boxes?.length || 0,
  });
  broadcastState();
  schedulePersist();
}

async function captureVisibleTabSafely(
  windowId: number | null,
  tabId: number,
): Promise<string | null> {
  const tab = state.tabs[String(tabId)];
  const win = windowId == null ? null : await chrome.windows.get(windowId).catch(() => null);
  const capturable = win && win.focused && win.state !== "minimized";

  if (capturable) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId!, { format: "jpeg", quality: 72 });
    } catch (error) {
      // captureVisibleTab can still fail on an occluded window; fall through to retry.
      if (tab?.dwell) {
        tab.dwell.lastCaptureError = normalizeError(error);
      }
    }
  }

  // Defer instead of dropping the capture. The deadline stays in the past so the
  // dwell remains due; a focus/activation change re-triggers it, and this short
  // backup retry covers windows that never emit a focus event. Cap the retries so
  // we don't poll forever on a window the user has abandoned.
  if (tab?.dwell) {
    const retries = (tab.dwell.captureRetries || 0) + 1;
    tab.dwell.captureRetries = retries;

    if (retries <= MAX_DWELL_RETRIES) {
      scheduleDwellAlarm(DWELL_RETRY_MS);
    } else {
      clearDwellAlarm();
      state.activeDwell = null;
    }
  }

  return null;
}

function createDwellSignature(scrollPayload: Partial<LastScroll> = {}): string {
  return [
    scrollPayload.url || "",
    scrollPayload.scrollSignature ||
      JSON.stringify(scrollPayload.scrollState || scrollPayload),
  ].join("|");
}

function recordEvent(
  type: string,
  tabId: number | null,
  windowId: number | null,
  payload: Record<string, unknown> = {},
): void {
  const timestamp = now();
  const event: ActivityEvent = {
    id: `evt_${String(state.nextEventNumber).padStart(6, "0")}`,
    type,
    timestamp,
    tabId: tabId ?? null,
    windowId: windowId ?? null,
    url:
      (payload.url as string | undefined) ??
      (tabId ? state.tabs[String(tabId)]?.url : null) ??
      null,
    title:
      (payload.title as string | undefined) ??
      (tabId ? state.tabs[String(tabId)]?.title : null) ??
      null,
    payload,
  };

  state.nextEventNumber += 1;
  state.eventTypes.add(type);
  state.events.push(event);
  state.events = state.events.slice(-MAX_EVENTS);

  if (tabId) {
    const tabKey = String(tabId);
    const currentTab =
      state.tabs[tabKey] ||
      ({
        tabId,
        windowId,
        createdAt: timestamp,
        updatedAt: timestamp,
        events: [],
      } as unknown as TabState);

    currentTab.events = [...(currentTab.events || []), event].slice(-MAX_EVENTS_PER_TAB);
    currentTab.updatedAt = timestamp;
    currentTab.url = event.url ?? currentTab.url ?? null;
    currentTab.title = event.title ?? currentTab.title ?? null;
    state.tabs[tabKey] = currentTab;
  }

  broadcastEvent(event);
  broadcastState();
  schedulePersist();
}

function broadcastEvent(event: ActivityEvent): void {
  consolePorts.forEach((port) => {
    try {
      port.postMessage({ type: "event", event });
    } catch {
      consolePorts.delete(port);
    }
  });
}

function broadcastState(): void {
  const serialized = serializeState();
  consolePorts.forEach((port) => {
    try {
      port.postMessage({ type: "state", state: serialized });
    } catch {
      consolePorts.delete(port);
    }
  });
}

function serializeState(): WorksmithState {
  return {
    sessionId: state.sessionId,
    activeTabId: state.activeTabId,
    targetTabId: state.targetTabId,
    activeWindowId: state.activeWindowId,
    tabs: state.tabs,
    events: state.events,
    eventTypes: [...state.eventTypes].sort(),
    savedCaptures: state.savedCaptures,
    nextEventNumber: state.nextEventNumber,
  };
}

function schedulePersist(): void {
  if (persistTimer) {
    return;
  }

  persistTimer = setTimeout(() => {
    persistTimer = null;
    void chrome.storage.local.set({ [STORAGE_KEY]: serializeState() });
  }, 500);
}

function tabPayload(tab: chrome.tabs.Tab): Record<string, unknown> {
  return {
    url: tab?.url ?? null,
    title: tab?.title ?? null,
    status: tab?.status ?? null,
    active: tab?.active ?? null,
    favIconUrl: tab?.favIconUrl ?? null,
  };
}

function isInspectableTab(tab: { url?: string | null } | undefined): boolean {
  const url = tab?.url || "";
  return /^(https?|file):/.test(url);
}

function createSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

function normalizeError(error: unknown): string {
  if (!error) {
    return "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
