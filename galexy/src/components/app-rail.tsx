"use client";

/**
 * Top-level icon rail for cross-app navigation. Renders as a thin
 * vertical strip on the left edge of every authenticated page inside
 * the `(app)` route group, with one icon per service (Home, Vault,
 * Chat, Teams, Indexer).
 *
 * Design intent:
 *   - Each app keeps its own internal sidebar / layout untouched. The
 *     rail is purely chrome wrapped around them, so individual apps
 *     don't have to be refactored to know about it.
 *   - Always icon-only (label-on-hover via tooltip). A label-bearing
 *     rail would compete with each app's own sidebar headings.
 *   - Collapsible from day one. When the user hits a focused mode
 *     (knowledge graph immersion, full-bleed chat read, indexer
 *     monitor), they can hide the rail entirely; a small edge handle
 *     restores it.
 *   - State is persisted in localStorage so the choice survives
 *     reloads and route changes.
 *
 * Not rendered on `/login` (no point showing nav when not signed in).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FilePlus,
  FolderOpen,
  Home,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const STORAGE_KEY = "memux.app-rail.hidden";

type RailItem = {
  href: string;
  label: string;
  Icon: typeof Home;
  /** Decide active state from the current pathname. Home matches only
   *  the exact "/" (otherwise it'd light up everywhere). */
  match: (pathname: string) => boolean;
};

const ITEMS: RailItem[] = [
  { href: "/", label: "Home", Icon: Home, match: (p) => p === "/" },
  { href: "/vault", label: "Vault", Icon: FolderOpen, match: (p) => p.startsWith("/vault") },
  { href: "/chat", label: "AI chat", Icon: Sparkles, match: (p) => p.startsWith("/chat") },
  { href: "/teams", label: "Teams", Icon: Users, match: (p) => p.startsWith("/teams") },
  { href: "/indexer", label: "Indexer", Icon: FilePlus, match: (p) => p.startsWith("/indexer") },
];

export function AppRail() {
  const pathname = usePathname() ?? "";

  // Hidden state — initialised as visible on first render so SSR + first
  // client paint agree; the effect below pulls the persisted value once
  // hydration is done.
  // Hidden state. Read localStorage in a layout effect on mount; we
  // can't read it in the initial useState because window doesn't
  // exist during SSR. The setState-in-effect lint is suppressed
  // because this IS the canonical Next.js hydration-recovery pattern
  // and there's no synthesised loop — the read fires once on mount.
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHidden(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // localStorage can throw in private modes / sandboxed contexts.
    }
  }, []);

  function toggle() {
    setHidden((cur) => {
      const next = !cur;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore — UI state still flips for the session.
      }
      return next;
    });
  }

  // The login route shouldn't carry app chrome — it's a pre-auth surface.
  if (pathname.startsWith("/login")) return null;

  if (hidden) {
    // Edge handle: tiny rounded tab on the left edge that pokes back
    // out so the user can re-summon the rail without remembering a
    // keyboard shortcut. backdrop-blur lets it sit cleanly over any
    // app's left sidebar.
    return (
      <button
        type="button"
        onClick={toggle}
        title="Show navigation"
        aria-label="Show navigation"
        className={cn(
          "fixed left-0 top-1/2 z-50 -translate-y-1/2 rounded-r-md border border-l-0 border-border/60 bg-card/80 px-1 py-3",
          "text-muted-foreground backdrop-blur transition-colors hover:bg-muted/60 hover:text-foreground",
        )}
      >
        <PanelLeftOpen className="size-4" />
      </button>
    );
  }

  return (
    <nav
      aria-label="App navigation"
      className="flex h-full w-[52px] shrink-0 flex-col items-center border-r border-border/40 bg-card/30 py-2"
    >
      {/* Top spacer pairs with the bottom one to vertically centre the
          items group while keeping the toggle pinned to the bottom. */}
      <div className="flex-1" />

      <div className="flex flex-col items-center gap-2">
        {ITEMS.map((item) => {
          const Icon = item.Icon;
          const active = item.match(pathname);
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    // size-9 + rounded-full = 36px circle.
                    "flex size-9 items-center justify-center rounded-full transition-colors",
                    active
                      ? "bg-white text-black shadow-sm"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex-1" />

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={toggle}
            aria-label="Hide navigation"
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <PanelLeftClose className="size-4" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Hide rail</TooltipContent>
      </Tooltip>
    </nav>
  );
}
