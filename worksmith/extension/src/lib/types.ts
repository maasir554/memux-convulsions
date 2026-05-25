// Shared data shapes for Worksmith, exchanged between the background service
// worker, content scripts, and the React console.

export interface TreeNodeState {
  [key: string]: string | boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TreeNode {
  role: string;
  name?: string;
  tag?: string;
  text?: string;
  selector?: string;
  state?: TreeNodeState;
  rect?: Rect | null;
  children?: TreeNode[];
}

export interface AccessibilitySnapshot {
  tabId: number;
  url: string;
  title: string;
  capturedAt: string;
  tree: TreeNode;
  /** Set by the console when showing a locally-pruned copy. */
  pruned?: boolean;
}

export interface ScrollPage {
  scrollX: number;
  scrollY: number;
  scrollPercent: number;
  scrollXPercent: number;
  viewportWidth: number;
  viewportHeight: number;
  documentWidth: number;
  documentHeight: number;
}

export interface ScrollBox {
  selector: string;
  tag: string;
  role: string | null;
  name: string;
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
  rect: Rect;
}

export interface ScrollState {
  page: ScrollPage;
  boxes: ScrollBox[];
}

export interface LastScroll extends Partial<ScrollPage> {
  timestamp: string;
  url: string | null;
  scrollState?: ScrollState;
  scrollSignature?: string;
}

export interface DwellState {
  signature: string;
  elapsedMs: number;
  deadline: number | null;
  captureRetries: number;
  capturedSignature: string | null;
  lastChangedAt: string;
  scrollState: ScrollState | null;
  lastCaptureError?: string;
}

export interface ActivityEvent {
  id: string;
  type: string;
  timestamp: string;
  tabId: number | null;
  windowId: number | null;
  url: string | null;
  title: string | null;
  payload: Record<string, unknown>;
}

export interface TabState {
  tabId: number;
  windowId: number | null;
  url: string | null;
  title: string | null;
  favIconUrl?: string | null;
  status?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastScroll: LastScroll | null;
  latestAccessibilitySnapshot: AccessibilitySnapshot | null;
  dwell?: DwellState | null;
  events: ActivityEvent[];
}

export interface SavedCapture {
  id: string;
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  capturedAt: string;
  reason: string;
  scrollSignature: string;
  scrollState: ScrollState;
  screenshotDataUrl: string;
  accessibilitySnapshot: AccessibilitySnapshot;
  nodeCount: number;
}

export interface WorksmithState {
  sessionId: string;
  activeTabId: number | null;
  targetTabId: number | null;
  activeWindowId: number | null;
  tabs: Record<string, TabState>;
  events: ActivityEvent[];
  eventTypes: string[];
  savedCaptures: SavedCapture[];
  nextEventNumber: number;
}

// --- Port messages -------------------------------------------------------

export type ConsoleMessage =
  | { type: "get-state" }
  | { type: "clear-log" }
  | { type: "capture-accessibility"; tabId?: number | null }
  | { type: "select-view" };

export type BackgroundMessage =
  | { type: "state"; state: WorksmithState }
  | { type: "event"; event: ActivityEvent }
  | { type: "accessibility-snapshot"; snapshot: AccessibilitySnapshot }
  | { type: "capture-error"; tabId?: number; error: string };
