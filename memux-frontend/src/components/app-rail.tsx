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

  // Item geometry. The traveling disc translates by `activeIdx * PITCH`
  // pixels along Y to land on the active item. Kept in sync with the
  // Tailwind sizes used below: size-9 = 36px, gap-2 = 8px ⇒ pitch 44px.
  const ICON_SIZE = 36;
  const ICON_GAP = 8;
  const PITCH = ICON_SIZE + ICON_GAP;
  const activeIdx = ITEMS.findIndex((item) => item.match(pathname));

  return (
    <>
      {/* Edge restore-handle. Always mounted so we can fade it in/out
          rather than teleport, and pointer-events go away when the
          rail itself is shown so it can't intercept clicks. */}
      <button
        type="button"
        onClick={toggle}
        title="Show navigation"
        aria-label="Show navigation"
        className={cn(
          "fixed left-0 top-1/2 z-50 -translate-y-1/2 rounded-r-md border border-l-0 border-border/60 bg-card/80 px-1 py-3",
          "text-muted-foreground backdrop-blur transition-opacity duration-200 hover:bg-muted/60 hover:text-foreground",
          hidden ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <PanelLeftOpen className="size-4" />
      </button>

      {/* Rail: width animates 52 ↔ 0, content is clipped by overflow-
          hidden so icons fade with the strip instead of squishing. The
          inner container is kept at a constant 52px wide so the icons
          never reflow during the collapse. */}
      <nav
        aria-label="App navigation"
        style={{ width: hidden ? 0 : 52 }}
        className={cn(
          "relative flex h-full shrink-0 flex-col items-center overflow-hidden border-r border-border/40 bg-card/30",
          "transition-[width] duration-300 ease-out",
        )}
      >
        <div
          aria-hidden={hidden}
          className={cn(
            "flex h-full w-[52px] shrink-0 flex-col items-center py-2 transition-opacity duration-200",
            hidden ? "opacity-0" : "opacity-100",
          )}
        >
          {/* Top spacer pairs with the bottom one to vertically centre
              the items group while keeping the toggle pinned. */}
          <div className="flex-1" />

          {/* Capsule: a rounded-full pill wrapping the icon group. The
              interior stays transparent — .app-rail-gradient-border
              paints a 2px pink → orange → yellow ring via a ::before
              pseudo + mask-composite:exclude, so the rail chrome shows
              through inside. Padding gives the icons + traveling disc
              breathing room; flex items and the absolute-positioned
              disc both anchor to the padding box and stay aligned. */}
          <div className="app-rail-gradient-border relative flex flex-col items-center gap-2 rounded-full p-1.5">
            {/* Traveling indicator — single white disc that slides
                between item positions when pathname changes. Anchored
                at the padding-box top-left, same column as each icon
                box, so only Y needs to animate. Hidden entirely when
                no item matches the current route. */}
            {activeIdx >= 0 && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-1.5 top-1.5 size-9 rounded-full bg-white shadow-sm",
                  "transition-transform duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)]",
                )}
                style={{
                  transform: `translateY(${activeIdx * PITCH}px)`,
                }}
              />
            )}

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
                        // z-10 keeps the icon above the traveling
                        // disc; when the disc lands here the icon
                        // flips to text-black for legibility.
                        "relative z-10 flex size-9 items-center justify-center rounded-full transition-colors duration-200",
                        active
                          ? "text-black"
                          : "text-muted-foreground hover:bg-white/10 hover:text-foreground",
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

          {/* Collapse toggle — its OWN small circle below the capsule
              with the same gradient ring treatment, so the satellite
              clearly belongs to the same control family. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggle}
                aria-label="Hide navigation"
                className="app-rail-gradient-border relative mt-3 flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:text-foreground"
              >
                <PanelLeftClose className="size-4" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Hide rail</TooltipContent>
          </Tooltip>

          <div className="flex-1" />
        </div>
      </nav>
    </>
  );
}
