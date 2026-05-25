import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useWorksmith } from "./hooks/useWorksmith";
import { pruneAccessibilityTree } from "./lib/prune";
import { formatTime } from "./lib/format";
import type {
  AccessibilitySnapshot,
  ActivityEvent,
  SavedCapture,
  TabState,
  WorksmithState,
} from "./lib/types";
import { IconSprite, Icon } from "./components/IconSprite";
import { SavedView } from "./components/SavedView";
import { AccessibilityPanel, type AxView } from "./components/AccessibilityPanel";
import { ImageModal } from "./components/ImageModal";

type MainView = "activity" | "saved";
type Theme = "auto" | "light" | "dark";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const readNum = (key: string, fallback: number) => Number(localStorage.getItem(key)) || fallback;
const readBool = (key: string) => localStorage.getItem(key) === "true";

export function App() {
  const { state, connected, captureError, clearLog, captureAccessibility } = useWorksmith();

  const [mainView, setMainView] = useState<MainView>("activity");
  const [selectedTabId, setSelectedTabId] = useState<string>("active");
  const [leftCollapsed, setLeftCollapsed] = useState(() => readBool("worksmith.leftCollapsed"));
  const [rightCollapsed, setRightCollapsed] = useState(() => readBool("worksmith.rightCollapsed"));
  const [liveTabsCollapsed, setLiveTabsCollapsed] = useState(false);
  const [leftWidth, setLeftWidth] = useState(() => readNum("worksmith.leftWidth", 284));
  const [rightWidth, setRightWidth] = useState(() => readNum("worksmith.rightWidth", 500));
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("worksmith.theme") as Theme) || "auto",
  );
  const [eventType, setEventType] = useState("all");
  const [pinnedSnapshot, setPinnedSnapshot] = useState<AccessibilitySnapshot | null>(null);
  const [axView, setAxView] = useState<AxView>("tree");
  const [imageCapture, setImageCapture] = useState<SavedCapture | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoWrapRef = useRef<HTMLDivElement>(null);

  // --- derived state ---
  const resolvedTabId =
    selectedTabId === "active"
      ? state.targetTabId ?? state.activeTabId
      : Number(selectedTabId);
  const selectedTab = resolvedTabId != null ? state.tabs[String(resolvedTabId)] : undefined;
  const summaryTabId = state.targetTabId ?? state.activeTabId;
  const summaryTab = summaryTabId != null ? state.tabs[String(summaryTabId)] : undefined;
  const liveSnapshot = selectedTab?.latestAccessibilitySnapshot ?? null;
  const displayedSnapshot = pinnedSnapshot ?? liveSnapshot;

  const tabs = useMemo(() => {
    return Object.values(state.tabs).sort((a, b) => {
      if (a.tabId === state.activeTabId) return -1;
      if (b.tabId === state.activeTabId) return 1;
      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
    });
  }, [state.tabs, state.activeTabId]);

  // --- side effects: body classes, theme, panel widths ---
  useEffect(() => {
    document.body.classList.toggle("left-collapsed", leftCollapsed);
    localStorage.setItem("worksmith.leftCollapsed", String(leftCollapsed));
  }, [leftCollapsed]);

  useEffect(() => {
    document.body.classList.toggle("right-collapsed", rightCollapsed);
    localStorage.setItem("worksmith.rightCollapsed", String(rightCollapsed));
  }, [rightCollapsed]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("worksmith.theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--left-expanded-width",
      `${clamp(leftWidth, 220, 520)}px`,
    );
    localStorage.setItem("worksmith.leftWidth", String(leftWidth));
  }, [leftWidth]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--right-expanded-width",
      `${clamp(rightWidth, 340, 780)}px`,
    );
    localStorage.setItem("worksmith.rightWidth", String(rightWidth));
  }, [rightWidth]);

  useEffect(() => {
    if (!infoOpen) {
      return;
    }
    const onClick = (event: MouseEvent) => {
      if (infoWrapRef.current && !infoWrapRef.current.contains(event.target as Node)) {
        setInfoOpen(false);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [infoOpen]);

  // --- handlers ---
  const onCapture = () => {
    setPinnedSnapshot(null);
    captureAccessibility(resolvedTabId);
  };

  const onSelectTab = (tabId: number) => {
    setSelectedTabId(String(tabId));
    setMainView("activity");
    setPinnedSnapshot(null);
  };

  const onViewTree = (capture: SavedCapture) => {
    if (!capture.accessibilitySnapshot) return;
    setPinnedSnapshot(capture.accessibilitySnapshot);
    setAxView("tree");
    setRightCollapsed(false);
  };

  const onViewPruned = (capture: SavedCapture) => {
    const snap = capture.accessibilitySnapshot;
    if (!snap) return;
    setPinnedSnapshot({ ...snap, tree: pruneAccessibilityTree(snap.tree), pruned: true });
    setAxView("tree");
    setRightCollapsed(false);
  };

  const onViewAi = (capture: SavedCapture) => {
    const snap = capture.accessibilitySnapshot;
    if (!snap) return;
    setPinnedSnapshot(snap);
    setAxView("ai");
    setRightCollapsed(false);
  };

  const startResize = (event: ReactPointerEvent, side: "left" | "right") => {
    event.preventDefault();
    if (side === "left" && leftCollapsed) setLeftCollapsed(false);
    if (side === "right" && rightCollapsed) setRightCollapsed(false);

    const startX = event.clientX;
    const startWidth = side === "left" ? leftWidth : rightWidth;
    const min = side === "left" ? 220 : 340;
    const max = side === "left" ? 520 : 780;

    document.body.classList.add("is-resizing");

    const onMove = (moveEvent: PointerEvent) => {
      const delta = side === "left" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const width = clamp(startWidth + delta, min, max);
      if (side === "left") setLeftWidth(width);
      else setRightWidth(width);
    };
    const onUp = () => {
      document.body.classList.remove("is-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const cycleTheme = () => {
    const order: Theme[] = ["auto", "light", "dark"];
    setTheme(order[(order.indexOf(theme) + 1) % order.length]);
  };

  const themeIcon = theme === "light" ? "icon-sun" : theme === "dark" ? "icon-moon" : "icon-monitor";

  return (
    <>
      <IconSprite />
      <main className="app-shell">
        <header className="topbar">
          <div className="brand-block">
            <button
              className="icon-button"
              type="button"
              title="Toggle tab sidebar"
              aria-label="Toggle tab sidebar"
              onClick={() => setLeftCollapsed((value) => !value)}
            >
              <Icon id="icon-panel-left" />
            </button>
            <div>
              <h1>Worksmith</h1>
              <p>{connected ? "Connected" : "Connecting"}</p>
            </div>
          </div>

          <div className="topbar-center" aria-label="Target tab summary">
            <span>Target</span>
            <strong>
              {summaryTab
                ? `#${summaryTab.tabId} ${summaryTab.title || summaryTab.url || "Untitled"}`
                : "None"}
            </strong>
          </div>

          <div className="topbar-actions">
            <div className="info-wrap" ref={infoWrapRef}>
              <button
                className="icon-button"
                type="button"
                title="Console info"
                aria-label="Console info"
                onClick={(event) => {
                  event.stopPropagation();
                  setInfoOpen((value) => !value);
                }}
              >
                <Icon id="icon-info" />
              </button>
              {infoOpen && (
                <div className="info-popover" role="dialog" aria-label="Worksmith info">
                  <strong>Worksmith Debug Console</strong>
                  <p>
                    Tracks tab activity, navigation, scroll telemetry, and accessibility snapshots
                    for Chromium automation debugging.
                  </p>
                  <dl>
                    <dt>Storage</dt>
                    <dd>Local extension storage with capped event history.</dd>
                    <dt>Target</dt>
                    <dd>Latest inspectable http, https, or file tab.</dd>
                  </dl>
                </div>
              )}
            </div>
            <select
              className="theme-select"
              aria-label="Theme"
              value={theme}
              onChange={(event) => setTheme(event.target.value as Theme)}
            >
              <option value="auto">Auto</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <button type="button" onClick={onCapture}>
              Capture
            </button>
            <button type="button" className="secondary" onClick={() => exportState(state)}>
              Export
            </button>
            <button type="button" className="ghost" onClick={clearLog}>
              Clear
            </button>
            <button
              className="icon-button"
              type="button"
              title="Toggle accessibility sidebar"
              aria-label="Toggle accessibility sidebar"
              onClick={() => setRightCollapsed((value) => !value)}
            >
              <Icon id="icon-panel-right" />
            </button>
          </div>
        </header>

        <section className="app-grid">
          <aside className="sidebar left-sidebar" aria-label="Live tabs sidebar">
            <div className="sidebar-strip">
              <button
                className="icon-button"
                type="button"
                title="Expand live tabs"
                aria-label="Expand live tabs"
                onClick={() => setLeftCollapsed((value) => !value)}
              >
                <Icon id="icon-list" />
              </button>
              <div className="strip-spacer" />
              <button
                className="icon-button"
                type="button"
                title="Console settings"
                aria-label="Console settings"
                onClick={(event) => {
                  event.stopPropagation();
                  setInfoOpen((value) => !value);
                }}
              >
                <Icon id="icon-settings" />
              </button>
              <button
                className="icon-button"
                type="button"
                title={`Theme: ${theme}`}
                aria-label="Cycle theme"
                onClick={cycleTheme}
              >
                <Icon id={themeIcon} />
              </button>
            </div>

            <div className="sidebar-content">
              <div className="sidebar-section">
                <button
                  className={`section-toggle${mainView === "activity" ? " selected" : ""}`}
                  type="button"
                  aria-expanded={!liveTabsCollapsed}
                  onClick={() => {
                    if (mainView === "activity") {
                      setLiveTabsCollapsed((value) => !value);
                    } else {
                      setMainView("activity");
                      setLiveTabsCollapsed(false);
                    }
                  }}
                >
                  <span>Live Tabs</span>
                  <strong>{tabs.length}</strong>
                </button>
                <div className={`section-body${liveTabsCollapsed ? " hidden" : ""}`}>
                  <div className="tabs-list">
                    {tabs.length ? (
                      tabs.map((tab) => (
                        <TabRow
                          key={tab.tabId}
                          tab={tab}
                          active={tab.tabId === state.activeTabId}
                          selected={String(tab.tabId) === String(resolvedTabId)}
                          onSelect={() => onSelectTab(tab.tabId)}
                        />
                      ))
                    ) : (
                      <p className="empty">No tabs recorded</p>
                    )}
                  </div>
                </div>
              </div>

              <button
                className={`section-toggle saved-nav${mainView === "saved" ? " selected" : ""}`}
                type="button"
                onClick={() => setMainView("saved")}
              >
                <span>Saved</span>
                <strong>{state.savedCaptures.length}</strong>
              </button>
            </div>

            <div
              className="resize-handle left-resize-handle"
              role="separator"
              aria-label="Resize tabs sidebar"
              onPointerDown={(event) => startResize(event, "left")}
            />
          </aside>

          <section className="mid-plane" aria-label="Main display">
            {mainView === "saved" ? (
              <SavedView
                captures={state.savedCaptures}
                onViewTree={onViewTree}
                onViewPruned={onViewPruned}
                onViewAi={onViewAi}
                onOpenImage={setImageCapture}
              />
            ) : (
              <ActivityView
                state={state}
                selectedTabId={resolvedTabId}
                eventType={eventType}
                onEventTypeChange={setEventType}
                summaryTab={summaryTab}
                tabCount={tabs.length}
              />
            )}
          </section>

          <aside className="sidebar right-sidebar" aria-label="Accessibility sidebar">
            <div
              className="resize-handle right-resize-handle"
              role="separator"
              aria-label="Resize accessibility sidebar"
              onPointerDown={(event) => startResize(event, "right")}
            />
            <div className="sidebar-strip">
              <button
                className="icon-button"
                type="button"
                title="Expand accessibility"
                aria-label="Expand accessibility"
                onClick={() => setRightCollapsed((value) => !value)}
              >
                <Icon id="icon-accessibility" />
              </button>
            </div>
            <div className="sidebar-content">
              <AccessibilityPanel
                snapshot={displayedSnapshot}
                captureError={captureError}
                view={axView}
                onViewChange={setAxView}
              />
            </div>
          </aside>
        </section>
      </main>

      <ImageModal capture={imageCapture} onClose={() => setImageCapture(null)} />
    </>
  );
}

function TabRow({
  tab,
  active,
  selected,
  onSelect,
}: {
  tab: TabState;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`tab-row${active ? " active" : ""}${selected ? " selected" : ""}`}
      onClick={onSelect}
    >
      <span className="tab-title">{tab.title || "Untitled"}</span>
      <span className="tab-url">{tab.url || "No URL"}</span>
      <span className="tab-meta">
        #{tab.tabId}
        {active ? " Active" : ""}
      </span>
    </button>
  );
}

function ActivityView({
  state,
  selectedTabId,
  eventType,
  onEventTypeChange,
  summaryTab,
  tabCount,
}: {
  state: WorksmithState;
  selectedTabId: number | null;
  eventType: string;
  onEventTypeChange: (value: string) => void;
  summaryTab: TabState | undefined;
  tabCount: number;
}) {
  const lastScroll = summaryTab?.lastScroll;
  const events = useMemo(() => {
    return state.events
      .filter((event) => {
        const tabMatches = selectedTabId == null || event.tabId === selectedTabId;
        const typeMatches = eventType === "all" || event.type === eventType;
        return tabMatches && typeMatches;
      })
      .slice(-250)
      .reverse();
  }, [state.events, selectedTabId, eventType]);

  return (
    <section id="activityView" className="plane-view">
      <section className="summary-grid" aria-label="Current browser state">
        <article className="metric-card">
          <span>Known Tabs</span>
          <strong>{tabCount}</strong>
        </article>
        <article className="metric-card">
          <span>Events</span>
          <strong>{state.events.length}</strong>
        </article>
        <article className="metric-card">
          <span>Last Scroll</span>
          <strong>
            {lastScroll ? `${lastScroll.scrollY ?? 0}px / ${lastScroll.scrollPercent ?? 0}%` : "None"}
          </strong>
        </article>
      </section>

      <section className="panel events-panel">
        <div className="panel-header">
          <div>
            <h2>Activity</h2>
            <span>Live event stream</span>
          </div>
          <select
            aria-label="Event type filter"
            value={state.eventTypes.includes(eventType) ? eventType : "all"}
            onChange={(event) => onEventTypeChange(event.target.value)}
          >
            <option value="all">All events</option>
            {state.eventTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div className="events-list">
          {events.length ? (
            events.map((event) => <EventRow key={event.id} event={event} />)
          ) : (
            <p className="empty">No matching events</p>
          )}
        </div>
      </section>
    </section>
  );
}

function EventRow({ event }: { event: ActivityEvent }) {
  const payload = compactPayload(event.payload);
  return (
    <article className="event-row">
      <header>
        <strong>{event.type}</strong>
        <time>{formatTime(event.timestamp)}</time>
      </header>
      <div className="event-context">
        <span>Tab {event.tabId ?? "n/a"}</span>
        <span>{event.title || event.url || ""}</span>
      </div>
      <pre>{JSON.stringify(payload, null, 2)}</pre>
    </article>
  );
}

function compactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const compacted = { ...payload };
  const changeInfo = compacted.changeInfo;
  if (changeInfo && typeof changeInfo === "object" && Object.keys(changeInfo).length === 0) {
    delete compacted.changeInfo;
  }
  return compacted;
}

function exportState(state: WorksmithState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `worksmith-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
