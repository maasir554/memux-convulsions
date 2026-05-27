import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  Accessibility,
  Activity,
  Bookmark,
  Camera,
  Download,
  Info,
  List,
  Monitor,
  Moon,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Sun,
  Trash2,
} from "lucide-react";
import { useWorksmith } from "./hooks/useWorksmith";
import { MemuxMark } from "./lib/memux-mark";
import { pruneAccessibilityTree } from "./lib/prune";
import { formatTime } from "./lib/format";
import type { AccessibilitySnapshot, ActivityEvent, SavedCapture, TabState, WorksmithState } from "./lib/types";
import { SavedView } from "./components/SavedView";
import { AccessibilityPanel, type AxView } from "./components/AccessibilityPanel";
import { ImageModal } from "./components/ImageModal";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type MainView = "activity" | "saved";
type Theme = "dark" | "light" | "auto";

const RAIL = 48;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const readNum = (key: string, fallback: number) => Number(localStorage.getItem(key)) || fallback;
const readBool = (key: string) => localStorage.getItem(key) === "true";

export function App() {
  const {
    state,
    connected,
    captureError,
    clearLog,
    captureAccessibility,
    deleteCapture,
    clearCaptures,
  } = useWorksmith();

  const [mainView, setMainView] = useState<MainView>("activity");
  const [selectedTabId, setSelectedTabId] = useState<string>("active");
  const [leftCollapsed, setLeftCollapsed] = useState(() => readBool("worksmith.leftCollapsed"));
  const [rightCollapsed, setRightCollapsed] = useState(() => readBool("worksmith.rightCollapsed"));
  const [leftWidth, setLeftWidth] = useState(() => readNum("worksmith.leftWidth", 280));
  const [rightWidth, setRightWidth] = useState(() => readNum("worksmith.rightWidth", 500));
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("worksmith.theme") as Theme) || "dark");
  const [eventType, setEventType] = useState("all");
  const [pinnedSnapshot, setPinnedSnapshot] = useState<AccessibilitySnapshot | null>(null);
  const [axView, setAxView] = useState<AxView>("tree");
  const [imageCapture, setImageCapture] = useState<SavedCapture | null>(null);

  const resolvedTabId =
    selectedTabId === "active" ? state.targetTabId ?? state.activeTabId : Number(selectedTabId);
  const selectedTab = resolvedTabId != null ? state.tabs[String(resolvedTabId)] : undefined;
  const displayedSnapshot = pinnedSnapshot ?? selectedTab?.latestAccessibilitySnapshot ?? null;

  const tabs = useMemo(
    () =>
      Object.values(state.tabs).sort((a, b) => {
        if (a.tabId === state.activeTabId) return -1;
        if (b.tabId === state.activeTabId) return 1;
        return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      }),
    [state.tabs, state.activeTabId],
  );

  // theme -> .dark class
  useEffect(() => {
    localStorage.setItem("worksmith.theme", theme);
    const root = document.documentElement;
    const apply = () => {
      const dark =
        theme === "dark" ||
        (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", dark);
    };
    apply();
    if (theme === "auto") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("worksmith.leftCollapsed", String(leftCollapsed));
  }, [leftCollapsed]);
  useEffect(() => {
    localStorage.setItem("worksmith.rightCollapsed", String(rightCollapsed));
  }, [rightCollapsed]);
  useEffect(() => {
    localStorage.setItem("worksmith.leftWidth", String(leftWidth));
  }, [leftWidth]);

  const rightCol = rightCollapsed ? RAIL : rightWidth;
  useEffect(() => {
    localStorage.setItem("worksmith.rightWidth", String(rightWidth));
    document.documentElement.style.setProperty("--right-width", `${rightCol}px`);
  }, [rightWidth, rightCol]);

  const leftCol = leftCollapsed ? RAIL : leftWidth;

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

  const onDeleteCapture = (id: string) => {
    // Drop the pin in case the deleted capture is currently shown in the right panel.
    setPinnedSnapshot(null);
    deleteCapture(id);
  };

  const onClearCaptures = () => {
    if (!window.confirm(`Delete all ${state.savedCaptures.length} saved captures?`)) return;
    setPinnedSnapshot(null);
    clearCaptures();
  };

  const startResize = (event: ReactPointerEvent, side: "left" | "right") => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftWidth : rightWidth;
    const min = side === "left" ? 220 : 360;
    const max = side === "left" ? 520 : 820;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (moveEvent: PointerEvent) => {
      const delta = side === "left" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const width = clamp(startWidth + delta, min, max);
      if (side === "left") setLeftWidth(width);
      else setRightWidth(width);
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="app-ambient flex h-full w-full flex-col overflow-hidden">
      <TopBar
        connected={connected}
        theme={theme}
        onCycleTheme={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "auto" : "dark")}
        onExport={() => exportState(state)}
        onClear={clearLog}
        onToggleLeft={() => setLeftCollapsed((v) => !v)}
        onToggleRight={() => setRightCollapsed((v) => !v)}
      />

      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: `${leftCol}px minmax(0,1fr) ${rightCol}px` }}
      >
        {/* left */}
        <aside className="relative flex min-h-0 min-w-0 border-r border-border/70 bg-card/40">
          {leftCollapsed ? (
            <div className="flex flex-1 flex-col items-center gap-1.5 py-2.5">
              <IconButton title="Expand tabs" onClick={() => setLeftCollapsed(false)}>
                <PanelLeftOpen className="size-4" />
              </IconButton>
              <IconButton title="Saved" onClick={() => setMainView("saved")}>
                <Bookmark className="size-4" />
              </IconButton>
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-1 px-2.5 py-2.5">
                <button
                  type="button"
                  onClick={() => setMainView("activity")}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold transition-colors",
                    mainView === "activity"
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <List className="size-3.5" />
                  Live Tabs
                  <CountChip>{tabs.length}</CountChip>
                </button>
                <IconButton small title="Collapse" onClick={() => setLeftCollapsed(true)}>
                  <PanelLeftClose className="size-3.5" />
                </IconButton>
              </div>
              <div className="min-h-0 flex-1 space-y-1 overflow-auto px-2 pb-2">
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
              <button
                type="button"
                onClick={() => setMainView("saved")}
                className={cn(
                  "flex shrink-0 items-center justify-between gap-2 border-t border-border/70 px-4 py-3 text-xs font-semibold transition-colors",
                  mainView === "saved"
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-2">
                  <Bookmark className="size-3.5" />
                  Saved
                </span>
                <CountChip>{state.savedCaptures.length}</CountChip>
              </button>
            </div>
          )}
          {!leftCollapsed && <ResizeHandle side="left" onResize={startResize} />}
        </aside>

        {/* center */}
        <main className="min-h-0 min-w-0 overflow-hidden p-2.5">
          {mainView === "saved" ? (
            <SavedView
              captures={state.savedCaptures}
              onViewTree={onViewTree}
              onViewPruned={onViewPruned}
              onViewAi={onViewAi}
              onOpenImage={setImageCapture}
              onDelete={onDeleteCapture}
              onClearAll={onClearCaptures}
            />
          ) : (
            <ActivityView
              state={state}
              selectedTab={selectedTab}
              selectedTabId={resolvedTabId}
              eventType={eventType}
              onEventTypeChange={setEventType}
              onCapture={onCapture}
              captureError={captureError}
            />
          )}
        </main>

        {/* right */}
        <aside className="relative flex min-h-0 min-w-0 border-l border-border/70 bg-card/40">
          {rightCollapsed ? (
            <div className="flex flex-1 flex-col items-center gap-1.5 py-2.5">
              <IconButton title="Expand accessibility" onClick={() => setRightCollapsed(false)}>
                <Accessibility className="size-4" />
              </IconButton>
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <AccessibilityPanel
                snapshot={displayedSnapshot}
                captureError={captureError}
                view={axView}
                onViewChange={setAxView}
              />
            </div>
          )}
          {!rightCollapsed && <ResizeHandle side="right" onResize={startResize} />}
        </aside>
      </div>

      <ImageModal capture={imageCapture} onClose={() => setImageCapture(null)} />
    </div>
  );
}

function TopBar({
  connected,
  theme,
  onCycleTheme,
  onExport,
  onClear,
  onToggleLeft,
  onToggleRight,
}: {
  connected: boolean;
  theme: Theme;
  onCycleTheme: () => void;
  onExport: () => void;
  onClear: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}) {
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/70 bg-card/70 px-3 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <IconButton title="Toggle tabs panel" onClick={onToggleLeft}>
          <PanelLeft className="size-4" />
        </IconButton>
        <MemuxMark size={28} />
        <div className="leading-none">
          <div className="text-[13px] font-semibold tracking-tight">MEMUX Capture</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                connected ? "bg-primary shadow-[0_0_6px] shadow-primary/60" : "bg-amber-500",
              )}
            />
            {connected ? "Connected" : "Connecting"}
          </div>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onExport}>
          <Download className="size-3.5" />
          Export
        </Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-muted-foreground" onClick={onClear}>
          <Trash2 className="size-3.5" />
          Clear
        </Button>
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton title="Theme" onClick={onCycleTheme}>
              <ThemeIcon className="size-4" />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>Theme: {theme}</TooltipContent>
        </Tooltip>
        <Popover>
          <PopoverTrigger asChild>
            <IconButton title="About Worksmith">
              <Info className="size-4" />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-72 text-xs">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-md bg-canary/15 text-canary ring-1 ring-canary/30">
                  <Activity className="size-3.5" />
                </span>
                <strong className="text-[13px]">Worksmith Debug Console</strong>
              </div>
              <p className="text-muted-foreground">
                Tracks tab activity, navigation, scroll telemetry, and accessibility snapshots for
                Chromium automation debugging.
              </p>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 pt-1">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Storage</dt>
                <dd>Local extension storage with capped event history.</dd>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Target</dt>
                <dd>Latest inspectable http, https, or file tab.</dd>
              </dl>
            </div>
          </PopoverContent>
        </Popover>
        <IconButton title="Toggle accessibility panel" onClick={onToggleRight}>
          <PanelRight className="size-4" />
        </IconButton>
      </div>
    </header>
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
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-primary/40 bg-primary/10"
          : "border-transparent hover:border-border/60 hover:bg-muted/40",
      )}
    >
      <span className="flex items-center gap-1.5">
        {active && <span className="size-1.5 shrink-0 rounded-full bg-canary shadow-[0_0_6px] shadow-canary/60" />}
        <span className="truncate text-[12.5px] font-medium">{tab.title || "Untitled"}</span>
      </span>
      <span className="truncate text-[11px] text-muted-foreground">{tab.url || "No URL"}</span>
      <span className="text-[10px] text-muted-foreground/70">
        #{tab.tabId}
        {active ? " · active" : ""}
      </span>
    </button>
  );
}

function ActivityView({
  state,
  selectedTab,
  selectedTabId,
  eventType,
  onEventTypeChange,
  onCapture,
  captureError,
}: {
  state: WorksmithState;
  selectedTab: TabState | undefined;
  selectedTabId: number | null;
  eventType: string;
  onEventTypeChange: (value: string) => void;
  onCapture: () => void;
  captureError: string | null;
}) {
  const events = useMemo(
    () =>
      state.events
        .filter((event) => {
          const tabMatches = selectedTabId == null || event.tabId === selectedTabId;
          const typeMatches = eventType === "all" || event.type === eventType;
          return tabMatches && typeMatches;
        })
        .slice(-250)
        .reverse(),
    [state.events, selectedTabId, eventType],
  );
  const filterValue = state.eventTypes.includes(eventType) ? eventType : "all";

  return (
    <section className="flex h-full min-h-0 flex-col gap-2.5">
      <TabHeader tab={selectedTab} onCapture={onCapture} captureError={captureError} />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card/60">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
          <div>
            <h2 className="text-[13px] font-semibold leading-tight">Activity</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {selectedTab
                ? <>Events filtered to <span className="font-mono text-foreground/80">tab #{selectedTab.tabId}</span></>
                : "Live event stream"}
              <span className="text-muted-foreground/40"> · </span>
              <span className="tabular-nums">{state.events.length}</span> total
            </p>
          </div>
          <Select value={filterValue} onValueChange={onEventTypeChange}>
            <SelectTrigger className="h-7 w-[180px] text-xs">
              <SelectValue placeholder="All events" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {state.eventTypes.map((type) => (
                <SelectItem key={type} value={type} className="font-mono text-xs">
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </header>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
          {events.length ? (
            events.map((event) => <EventRow key={event.id} event={event} />)
          ) : (
            <p className="empty">No matching events</p>
          )}
        </div>
      </div>
    </section>
  );
}

function TabHeader({
  tab,
  onCapture,
  captureError,
}: {
  tab: TabState | undefined;
  onCapture: () => void;
  captureError: string | null;
}) {
  if (!tab) {
    return (
      <div className="shrink-0 rounded-xl border border-dashed border-border bg-card/40 px-4 py-3 text-[12px] text-muted-foreground">
        Select a tab on the left to inspect.
      </div>
    );
  }

  const inspectable = /^(https?|file):/.test(tab.url || "");
  const lastScroll = tab.lastScroll;

  return (
    <div className="flex shrink-0 items-start justify-between gap-4 rounded-xl border border-border bg-card/60 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Tab #{tab.tabId}
          </span>
          {tab.active && (
            <span className="inline-flex items-center gap-1 rounded-full border border-canary/40 bg-canary/10 px-1.5 py-px text-[10px] font-semibold text-canary">
              <span className="size-1 rounded-full bg-canary shadow-[0_0_6px] shadow-canary/60" />
              active
            </span>
          )}
          {!inspectable && (
            <span className="rounded-full border border-border bg-background/40 px-1.5 py-px text-[10px] text-muted-foreground">
              not inspectable
            </span>
          )}
          {lastScroll && (
            <span className="ml-1 text-[10.5px] tabular-nums text-muted-foreground">
              scroll {lastScroll.scrollY ?? 0}px · {lastScroll.scrollPercent ?? 0}%
            </span>
          )}
        </div>
        <div className="mt-1 truncate text-[14px] font-semibold">{tab.title || "Untitled"}</div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
          {tab.url || "No URL"}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={inspectable ? -1 : 0}>
              <Button
                size="sm"
                className="h-8 gap-1.5"
                onClick={onCapture}
                disabled={!inspectable}
              >
                <Camera className="size-3.5" />
                Capture tree
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-[11px]">
            {inspectable
              ? "Capture this tab's accessibility tree"
              : "This tab isn't inspectable (only http/https/file)"}
          </TooltipContent>
        </Tooltip>
        {captureError && (
          <span className="max-w-[220px] truncate text-[10.5px] text-destructive">
            {captureError}
          </span>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: ActivityEvent }) {
  const payload = compactPayload(event.payload);
  return (
    <article className="overflow-hidden rounded-lg border border-border/70 bg-background/40">
      <header className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <span className="truncate font-mono text-[11.5px] font-medium text-accent-foreground">
          {event.type}
        </span>
        <time className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
          {formatTime(event.timestamp)}
        </time>
      </header>
      <div className="flex flex-col gap-0.5 px-3 pt-2 text-[11px] text-muted-foreground">
        <span>Tab {event.tabId ?? "n/a"}</span>
        <span className="truncate">{event.title || event.url || ""}</span>
      </div>
      <pre className="mt-1 max-h-44 overflow-auto px-3 pb-2.5 font-mono text-[11px] leading-relaxed text-foreground/75">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </article>
  );
}

// Forward all props + ref so Radix `asChild` (Tooltip / Popover) can attach its
// event handlers, ref, and aria attributes. Without forwardRef the trigger
// breaks (clicks don't open the popover, hover doesn't show the tooltip).
const IconButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button> & { small?: boolean }
>(({ small, className, children, ...props }, ref) => (
  <Button
    ref={ref}
    type="button"
    variant="ghost"
    size="icon"
    {...props}
    className={cn(
      "text-muted-foreground hover:text-foreground",
      small ? "size-6" : "size-8",
      className,
    )}
  >
    {children}
  </Button>
));
IconButton.displayName = "IconButton";

function CountChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold tabular-nums text-muted-foreground">
      {children}
    </span>
  );
}

function ResizeHandle({
  side,
  onResize,
}: {
  side: "left" | "right";
  onResize: (event: ReactPointerEvent, side: "left" | "right") => void;
}) {
  return (
    <div
      role="separator"
      aria-label={`Resize ${side} panel`}
      onPointerDown={(event) => onResize(event, side)}
      className={cn(
        "absolute top-0 z-20 h-full w-2 cursor-col-resize transition-colors hover:bg-primary/30",
        side === "left" ? "right-[-4px]" : "left-[-4px]",
      )}
    />
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
