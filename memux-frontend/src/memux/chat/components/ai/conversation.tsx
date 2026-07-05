"use client";

/**
 * Scroll container that sticks to the bottom while content streams in
 * (text tokens, widgets, images, anything) and shows a "jump to latest"
 * affordance when the user scrolls away.
 *
 * Why it's wired this way:
 *
 *   - "Stuck to bottom" is a ref, not state. We don't want every scroll
 *     event to cause a React re-render — that breaks streaming smoothness.
 *   - The button-visibility derives from the ref via the scroll listener;
 *     a tiny piece of state for the button is fine.
 *   - The actual sticking is driven by a ResizeObserver on the content
 *     wrapper, NOT by React renders. That's the critical fix: widgets like
 *     the timeline, PDF thumbnails, knowledge graph and images all change
 *     height AFTER React has finished committing (lazy chunks land,
 *     <img> onload fires, react-pdf renders, IntersectionObservers trigger
 *     content). A naive "scroll on render" misses all of those — the
 *     scroll lags behind the bottom and never catches up. ResizeObserver
 *     catches every height change regardless of source.
 *   - We don't try to distinguish user vs programmatic scrolls — the
 *     scroll listener simply syncs the ref to "am I currently at the
 *     bottom?". Programmatic snaps land exactly at the bottom, so they
 *     keep the ref true; user-driven scroll-ups land below 80px and
 *     flip it false. The thresholded distance (80px) gives the user some
 *     read-room before unstick.
 *   - scroll-smooth is intentionally OFF on the container: smooth scrolls
 *     stack/cancel when content streams at token-pace and make the view
 *     stutter. The jump-to-latest button uses a one-shot smooth scroll
 *     because it's a discrete user gesture, not a continuous follow.
 */

import * as React from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/memux/chat/components/ui/button";
import { cn } from "@/memux/chat/lib/utils";

// Distance-from-bottom (px) under which we consider the user "stuck".
// 80px gives room to read the latest paragraph without being yanked away
// when a new token lands.
const STUCK_THRESHOLD = 80;

export function Conversation({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const stuckRef = React.useRef(true);
  const [showJump, setShowJump] = React.useState(false);

  const syncStuck = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = dist < STUCK_THRESHOLD;
    if (stuckRef.current !== atBottom) {
      stuckRef.current = atBottom;
      setShowJump(!atBottom);
    }
  }, []);

  // Snap to bottom whenever the content's box changes — covers React
  // renders (tokens, message appends), image loads, lazy chunks landing,
  // widget expansion, font swap, all of it. ResizeObserver also fires
  // once on observe(), which gives us the initial pin for free.
  React.useLayoutEffect(() => {
    const content = contentRef.current;
    const scroll = scrollRef.current;
    if (!content || !scroll) return;

    const snap = () => {
      if (!stuckRef.current) return;
      scroll.scrollTop = scroll.scrollHeight;
    };

    const ro = new ResizeObserver(snap);
    ro.observe(content);

    return () => ro.disconnect();
  }, []);

  return (
    <div className={cn("relative flex-1 min-h-0", className)} {...props}>
      <div
        ref={scrollRef}
        onScroll={syncStuck}
        className="h-full overflow-y-auto"
      >
        <div ref={contentRef} className="mx-auto w-full max-w-3xl px-4 py-6">
          {children}
        </div>
      </div>
      {showJump && (
        <Button
          size="icon"
          variant="secondary"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow"
          onClick={() => {
            const el = scrollRef.current;
            if (!el) return;
            // Manually mark stuck before the smooth-scroll lands, so any
            // content arriving during the animation pins immediately
            // rather than waiting for the smooth-scroll to finish.
            stuckRef.current = true;
            setShowJump(false);
            el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          }}
          aria-label="Jump to latest"
        >
          <ArrowDown />
        </Button>
      )}
    </div>
  );
}

export function ConversationContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-6", className)} {...props} />;
}

export function ConversationEmptyState({
  title = "Start a conversation",
  description,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-24 text-muted-foreground",
        className,
      )}
    >
      <div className="text-base font-medium text-foreground/80">{title}</div>
      {description && (
        <div className="mt-1 text-sm max-w-md">{description}</div>
      )}
    </div>
  );
}
