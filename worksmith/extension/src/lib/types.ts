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

export type CaptureKind = "stable" | "snap" | "full";

export interface SavedCapture {
  id: string;
  kind: CaptureKind;
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  capturedAt: string;
  reason: string;
  /** Optional user-supplied context (popup input). */
  context?: string;
  scrollSignature?: string;
  scrollState?: ScrollState;
  /** Canonical: one entry for stable/snap, up to 15 for full. */
  screenshots: string[];
  /** Kept for backwards-compatibility with pre-schema entries. */
  screenshotDataUrl?: string;
  accessibilitySnapshot: AccessibilitySnapshot;
  nodeCount: number;
  /** Viewport size at capture time. */
  viewport?: { width: number; height: number };
  /** Document total height for full-capture context. */
  documentHeight?: number;
  /**
   * True once this capture has been ack'd by an open galexy/memux tab. Only
   * meaningful on user captures — auto (stable) captures stay local.
   */
  delivered?: boolean;
}

export interface WorksmithState {
  sessionId: string;
  activeTabId: number | null;
  targetTabId: number | null;
  activeWindowId: number | null;
  tabs: Record<string, TabState>;
  events: ActivityEvent[];
  eventTypes: string[];
  /**
   * Combined list (user + auto) for the legacy UI; ordered the same as before
   * (newest first). New code should prefer userCaptures / autoCaptures.
   */
  savedCaptures: SavedCapture[];
  /** User-triggered captures (kind = "snap" | "full"). High cap, shipped to memux. */
  userCaptures: SavedCapture[];
  /** Auto-triggered captures (kind = "stable"). Small cap, experimental, local only. */
  autoCaptures: SavedCapture[];
  nextEventNumber: number;
}

// --- Port messages -------------------------------------------------------

export type ConsoleMessage =
  | { type: "get-state" }
  | { type: "clear-log" }
  | { type: "capture-accessibility"; tabId?: number | null }
  | { type: "select-view" }
  | { type: "delete-capture"; id: string }
  | { type: "clear-captures" }
  | { type: "open-console" }
  | { type: "user-capture"; mode: "snap" | "full"; context?: string };

export type BackgroundMessage =
  | { type: "state"; state: WorksmithState }
  | { type: "event"; event: ActivityEvent }
  | { type: "accessibility-snapshot"; snapshot: AccessibilitySnapshot }
  | { type: "capture-error"; tabId?: number; error: string };
