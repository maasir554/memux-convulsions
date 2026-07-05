"use client";

/**
 * Horizontal-scroll wrapper for the activity stream's preview rails.
 *
 * Design intent:
 *   - The agent stream is narrow (right panel ~360px); a row of thumbs is
 *     almost always going to overflow. The user needs to know that, and
 *     have a one-handed way to navigate.
 *   - Arrows appear only when there's somewhere to scroll TO, not as
 *     permanent chrome. Disabled state would just add noise.
 *   - Edge fade-out (mask-image gradient) on whichever side has more
 *     content — softer, gives the eye somewhere to track to.
 *   - Smooth-scroll on click, 80% of the visible width per press, so
 *     the rail never advances past more than a screenful of content.
 *
 * The scroll container is the direct ref; children render however they
 * like (each thumb is its own component with its own width).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

const SCROLL_RATIO = 0.8;
// "Close enough to the edge" threshold — without this the can-scroll
// booleans flicker on sub-pixel scrollWidth differences after a resize.
const EDGE_EPSILON = 2;

export function HorizontalScroller({
  children,
  className,
  style,
  ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > EDGE_EPSILON);
    setCanRight(el.scrollLeft < maxScroll - EDGE_EPSILON);
  }, []);

  // Re-measure on scroll, on resize, and whenever the children change
  // (ResizeObserver catches all three cleanly).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure]);

  const scrollBy = useCallback((dir: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    const delta = el.clientWidth * SCROLL_RATIO * dir;
    el.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  // Mask the side with more content, so the eye is pulled in that
  // direction. Both fade when both ends have overflow; neither when the
  // content fits.
  const maskImage =
    canLeft && canRight
      ? "linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%)"
      : canLeft
        ? "linear-gradient(to right, transparent 0, black 24px, black 100%)"
        : canRight
          ? "linear-gradient(to right, black 0, black calc(100% - 24px), transparent 100%)"
          : undefined;

  return (
    <div className={cn("relative", className)} style={style}>
      <div
        ref={scrollRef}
        // hide-scrollbar via tailwind utility if present, else inline
        // styles below + the WebKit::-webkit-scrollbar override in CSS.
        // scroll-snap so a release naturally settles on the next thumb.
        className={cn(
          "flex gap-2 overflow-x-auto overflow-y-hidden",
          "[scroll-snap-type:x_proximity]",
          "[scrollbar-width:none] [-ms-overflow-style:none]",
          "[&::-webkit-scrollbar]:hidden",
        )}
        style={{
          maskImage,
          WebkitMaskImage: maskImage,
        }}
        aria-label={ariaLabel}
      >
        {children}
      </div>

      {canLeft && (
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollBy(-1)}
          className="absolute left-0 top-1/2 z-10 flex size-6 -translate-x-0 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-card/95 text-foreground/80 shadow-sm backdrop-blur-sm transition-colors hover:bg-card hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
        </button>
      )}
      {canRight && (
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollBy(1)}
          className="absolute right-0 top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-card/95 text-foreground/80 shadow-sm backdrop-blur-sm transition-colors hover:bg-card hover:text-foreground"
        >
          <ChevronRight className="size-3.5" />
        </button>
      )}
    </div>
  );
}
