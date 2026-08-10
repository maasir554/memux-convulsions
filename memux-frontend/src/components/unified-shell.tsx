"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Files,
  FlaskConical,
  FolderSearch,
  Home,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { AccountChip } from "@/components/auth/account-chip";
import { ThemeToggle } from "@/components/galexy/theme-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SettingsDialog } from "@/memux/chat/components/SettingsDialog";
import { MemuxMark } from "@/memux/chat/components/MemuxMark";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "memux.shell.collapsed";
const WIDTH_STORAGE_KEY = "memux.shell.width";
const DEFAULT_SIDEBAR_WIDTH = 284;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 460;

type Mode = {
  href: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  match: (pathname: string) => boolean;
};

const MODES: Mode[] = [
  { href: "/", label: "Home", description: "Your MEMUX overview", Icon: Home, match: (p) => p === "/" },
  { href: "/indexer", label: "Index", description: "Build searchable knowledge", Icon: Files, match: (p) => p.startsWith("/indexer") },
  { href: "/chat", label: "Chat", description: "Ask and create with AI", Icon: Sparkles, match: (p) => p.startsWith("/chat") },
  { href: "/vault", label: "Explore", description: "Browse your connected work", Icon: FolderSearch, match: (p) => p.startsWith("/vault") },
  { href: "/teams", label: "Teams", description: "Work together in real time", Icon: Users, match: (p) => p.startsWith("/teams") },
  { href: "/evals", label: "Labs", description: "Evaluate memory systems", Icon: FlaskConical, match: (p) => p.startsWith("/evals") },
];

type ShellContextValue = {
  sidebarTarget: HTMLElement | null;
  compactTarget: HTMLElement | null;
  collapsed: boolean;
  backendAvailable: boolean | null;
  expandSidebar: () => void;
  openSettings: () => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function useUnifiedShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useUnifiedShell must be used inside UnifiedShell");
  return value;
}

export function ShellSidebar({
  children,
  compact,
}: {
  children: ReactNode;
  compact?: ReactNode;
}) {
  const { sidebarTarget, compactTarget } = useUnifiedShell();
  return (
    <>
      {sidebarTarget ? createPortal(children, sidebarTarget) : null}
      {compact && compactTarget ? createPortal(compact, compactTarget) : null}
    </>
  );
}

export function UnifiedShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarTarget, setSidebarTarget] = useState<HTMLElement | null>(null);
  const [compactTarget, setCompactTarget] = useState<HTMLElement | null>(null);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const resizeStart = useRef<{
    x: number;
    width: number;
    current: number;
  } | null>(null);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
      const savedWidth = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
      if (Number.isFinite(savedWidth) && savedWidth > 0) {
        setSidebarWidth(
          Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, savedWidth)),
        );
      }
    } catch {
      // Persisting chrome is optional; the shell still works without storage.
    }
  }, []);

  useEffect(() => {
    // Route changes can originate from contextual content rendered into the
    // mobile drawer, so close it after navigation completes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    let active = true;
    fetch("/api/backend-status", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ available?: boolean }>)
      .then((result) => {
        if (active) setBackendAvailable(result.available === true);
      })
      .catch(() => {
        if (active) setBackendAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const setSidebarRef = useCallback((node: HTMLDivElement | null) => {
    setSidebarTarget(node);
  }, []);
  const setCompactRef = useCallback((node: HTMLDivElement | null) => {
    setCompactTarget(node);
  }, []);

  const activeMode = MODES.find((mode) => mode.match(pathname)) ?? MODES[0];
  const orderedModes = useMemo(
    () => [activeMode, ...MODES.filter((mode) => mode !== activeMode)],
    [activeMode],
  );

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage restrictions.
      }
      return next;
    });
  }

  function persistSidebarWidth(width: number) {
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
    } catch {
      // Ignore storage restrictions.
    }
  }

  function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    resizeStart.current = {
      x: event.clientX,
      width: sidebarWidth,
      current: sidebarWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeStart.current) return;
    const next = Math.min(
      MAX_SIDEBAR_WIDTH,
      Math.max(
        MIN_SIDEBAR_WIDTH,
        resizeStart.current.width + event.clientX - resizeStart.current.x,
      ),
    );
    const rounded = Math.round(next);
    resizeStart.current.current = rounded;
    setSidebarWidth(rounded);
  }

  function handleResizeEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeStart.current) return;
    const finalWidth = resizeStart.current.current;
    resizeStart.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    persistSidebarWidth(finalWidth);
  }

  function handleResizeKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    setSidebarWidth((current) => {
      const next = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, current + direction * 16),
      );
      persistSidebarWidth(next);
      return next;
    });
  }

  const contextValue: ShellContextValue = {
    sidebarTarget,
    compactTarget,
    collapsed,
    backendAvailable,
    expandSidebar: () => setCollapsed(false),
    openSettings: () => setSettingsOpen(true),
  };

  return (
    <ShellContext.Provider value={contextValue}>
      <div className="flex h-full min-h-0 overflow-hidden bg-background text-foreground">
        {mobileOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          />
        )}

        <aside
          aria-label="MEMUX navigation"
          style={
            { "--shell-sidebar-width": `${sidebarWidth}px` } as CSSProperties
          }
          className={cn(
            "group/shell fixed inset-y-0 left-0 z-50 flex w-[284px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-200 md:relative md:z-20 md:translate-x-0 md:shadow-none",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
            collapsed ? "md:w-[68px]" : "md:w-[var(--shell-sidebar-width)]",
          )}
        >
          <div className={cn("relative flex h-16 shrink-0 items-center border-b border-sidebar-border", collapsed ? "md:justify-center md:px-2" : "px-4")}>
            <Link
              href="/"
              className={cn(
                "flex min-w-0 items-center gap-2.5",
                collapsed && "md:transition-opacity md:group-hover/shell:opacity-0",
              )}
              aria-label="MEMUX home"
            >
              <MemuxMark size={25} />
              <span className={cn("text-sm font-bold tracking-[0.2em]", collapsed && "md:hidden")}>MEMUX</span>
            </Link>
            {collapsed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleCollapsed}
                    className="pointer-events-none absolute hidden size-9 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-sidebar-accent hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 md:flex md:group-hover/shell:pointer-events-auto md:group-hover/shell:opacity-100"
                    aria-label="Expand sidebar"
                  >
                    <PanelLeftOpen className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Expand sidebar</TooltipContent>
              </Tooltip>
            )}
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground md:hidden"
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
            {!collapsed && (
              <button
                type="button"
                onClick={toggleCollapsed}
                className="ml-auto hidden size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground md:flex"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="size-4" />
              </button>
            )}
          </div>

          <ModeNavigation modes={orderedModes} active={activeMode} collapsed={collapsed} />

          <div className="mx-3 border-t border-sidebar-border md:mx-2" />

          <div className={cn("min-h-0 flex-1", collapsed && "md:hidden")}>
            <div ref={setSidebarRef} className="h-full min-h-0" />
            {!sidebarTarget && <DefaultContext mode={activeMode} />}
          </div>

          <div className={cn("hidden min-h-0 flex-1 flex-col items-center gap-2 py-3", collapsed && "md:flex")}>
            <div ref={setCompactRef} className="flex flex-col items-center gap-2" />
            <div className="mt-auto" />
          </div>

          <div className={cn("shrink-0 border-t border-sidebar-border p-2", collapsed && "md:flex md:flex-col md:items-center")}>
            <div className={cn("flex items-center gap-1", collapsed && "md:flex-col-reverse")}>
              <div className={cn("min-w-0 flex-1", collapsed && "md:flex-none")}>
                <AccountChip backendAvailable={backendAvailable} compact={collapsed} />
              </div>
              <ThemeToggle />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                    aria-label="Settings"
                  >
                    <Settings className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Settings</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {!collapsed && (
            <div
              role="separator"
              aria-label="Resize sidebar"
              aria-orientation="vertical"
              aria-valuemin={MIN_SIDEBAR_WIDTH}
              aria-valuemax={MAX_SIDEBAR_WIDTH}
              aria-valuenow={sidebarWidth}
              tabIndex={0}
              onPointerDown={handleResizeStart}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
              onPointerCancel={handleResizeEnd}
              onKeyDown={handleResizeKey}
              onDoubleClick={() => {
                setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
                persistSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
              }}
              className="group/resize absolute inset-y-0 -right-1 z-30 hidden w-2 cursor-col-resize touch-none outline-none md:block"
            >
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/resize:bg-primary/60 group-focus/resize:bg-primary/60" />
            </div>
          )}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-3 border-b bg-sidebar/60 px-3 md:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex size-8 items-center justify-center rounded-lg hover:bg-sidebar-accent"
              aria-label="Open navigation"
            >
              <Menu className="size-4" />
            </button>
            <MemuxMark size={20} />
            <span className="text-xs font-bold tracking-[0.18em]">MEMUX</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-sm text-muted-foreground">{activeMode.label}</span>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </ShellContext.Provider>
  );
}

function ModeNavigation({ modes, active, collapsed }: { modes: Mode[]; active: Mode; collapsed: boolean }) {
  if (collapsed) {
    return (
      <>
        <div className="md:hidden">
          <ExpandedModeNavigation modes={modes} active={active} />
        </div>
        <nav className="hidden shrink-0 flex-col items-center gap-1 py-3 md:flex" aria-label="Spaces">
          {modes.map((mode, index) => (
            <Tooltip key={mode.href}>
              <TooltipTrigger asChild>
                <Link
                  href={mode.href}
                  aria-current={mode === active ? "page" : undefined}
                  className={cn(
                    "relative flex size-10 items-center justify-center rounded-xl transition-colors",
                    mode === active ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                    index === 1 && "mt-2",
                  )}
                >
                  <mode.Icon className="size-[18px]" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{mode.label}</TooltipContent>
            </Tooltip>
          ))}
        </nav>
      </>
    );
  }

  return <ExpandedModeNavigation modes={modes} active={active} />;
}

function ExpandedModeNavigation({ modes, active }: { modes: Mode[]; active: Mode }) {
  return (
    <div className="shrink-0 p-3">
      <Link
        href={active.href}
        aria-current="page"
        className="flex items-center gap-3 rounded-xl bg-foreground px-3 py-2.5 text-background shadow-sm"
      >
        <active.Icon className="size-[18px] shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{active.label}</div>
          <div className="truncate text-[10px] opacity-65">{active.description}</div>
        </div>
      </Link>
      <nav className="mt-2 grid grid-cols-5 gap-1" aria-label="Switch space">
        {modes.slice(1).map((mode) => (
          <Tooltip key={mode.href}>
            <TooltipTrigger asChild>
              <Link
                href={mode.href}
                className="flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-2 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <mode.Icon className="size-4" />
                <span className="w-full truncate text-center text-[9px]">{mode.label}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="bottom">{mode.description}</TooltipContent>
          </Tooltip>
        ))}
      </nav>
    </div>
  );
}

function DefaultContext({ mode }: { mode: Mode }) {
  return (
    <div className="p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Current space</div>
      <div className="mt-3 text-sm font-medium">{mode.label}</div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{mode.description}</p>
    </div>
  );
}
