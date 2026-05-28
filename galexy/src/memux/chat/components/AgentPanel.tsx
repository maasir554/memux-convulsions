"use client";

/**
 * Right-side activity stream for the agentic chat.
 *
 * Design intent (design-engineer notes):
 *   - SINGLE column. No timeline + detail split. Less visual noise.
 *   - Each ActivityCard fades-in-up with a small stagger so the stream
 *     reads as a calm, considered build-up rather than a strobing wall.
 *   - Cards are visual-first: thumbnails, icons, link chips. Text is
 *     used sparingly — the chat answer below is where prose lives.
 *   - Auto-scrolls to the newest card unless the user has scrolled up
 *     to inspect history (the agent shouldn't fight your reading).
 *   - NO internal header — the AGENT label + status pill + close button
 *     live in the global TopNav above this panel. The panel itself is
 *     pure content (reasoning teaser + activity stream + shortlist).
 */

import { useEffect, useRef, useState } from "react";
import { Sparkles, ListChecks } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAgentStore } from "@/memux/chat/lib/agent-store";
import { ActivityCard } from "@/memux/chat/components/activity/ActivityCard";
import type { Candidate } from "@/lib/chat/types";

export function AgentPanel() {
  const steps = useAgentStore((s) => s.steps);
  const reasoningStream = useAgentStore((s) => s.reasoningStream);
  const shortlist = useAgentStore((s) => s.shortlist);

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-gradient-to-b from-background to-card/40">
      {reasoningStream && (
        <div className="border-b border-border/40 bg-muted/10 px-4 py-2 text-[11px] italic leading-snug text-muted-foreground">
          {reasoningStream.slice(-220)}
        </div>
      )}
      <ActivityStream steps={steps} shortlist={shortlist} />
    </aside>
  );
}

/* -------------------------------------------------- activity stream */

function ActivityStream({
  steps,
  shortlist,
}: {
  steps: ReturnType<typeof useAgentStore.getState>["steps"];
  shortlist: Candidate[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoFollow, setAutoFollow] = useState(true);

  // Detect user-driven scroll — once they scroll away from the bottom
  // we stop auto-following so we don't yank them back when a new card
  // lands. Re-snap when they scroll back to within 40px of the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - (el.scrollTop + el.clientHeight);
      setAutoFollow(dist < 40);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!autoFollow) return;
    const el = scrollRef.current;
    if (!el) return;
    // Use rAF so the new card's fade-in-up animation has its initial
    // frame committed before we scroll — otherwise we'd snap past the
    // entrance and the user would never see the lift.
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, [steps.length, autoFollow]);

  return (
    <div
      ref={scrollRef}
      className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 py-3.5"
    >
      {shortlist.length > 0 && <ShortlistCard shortlist={shortlist} />}
      {steps.length === 0 ? (
        <EmptyState />
      ) : (
        steps.map((s, i) => <ActivityCard key={s.stepId} step={s} index={i} />)
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="ws-card-enter flex flex-col items-center justify-center gap-2 py-12 text-center">
      <Sparkles className="size-5 text-muted-foreground/40" aria-hidden />
      <div className="text-[11px] text-muted-foreground/70">
        Ask the assistant a question — the search will appear here.
      </div>
    </div>
  );
}

/* ----------------------------------------------- shortlist card */

function ShortlistCard({ shortlist }: { shortlist: Candidate[] }) {
  const top = shortlist.slice(0, 6);
  return (
    <div
      className="ws-card-enter sticky top-0 z-10 rounded-xl border border-border/40 bg-card/80 px-3.5 py-2.5 backdrop-blur"
      style={{ animationDelay: "0ms" }}
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        <ListChecks className="size-3.5 text-primary" aria-hidden />
        <span>Shortlist</span>
        <span className="ml-auto font-mono text-foreground/80">{shortlist.length}</span>
      </div>
      <div className="mt-2 flex flex-col gap-0.5">
        {top.map((c, i) => (
          <div
            key={c.itemId}
            className="flex items-center gap-1.5 text-[11px] leading-relaxed text-foreground/85"
          >
            <span className="w-4 shrink-0 text-right font-mono text-[9px] text-muted-foreground/60">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            <span className="shrink-0 rounded bg-muted/40 px-1 py-px font-mono text-[9px] text-muted-foreground">
              {c.score.toFixed(2)}
            </span>
          </div>
        ))}
        {shortlist.length > top.length && (
          <div className="mt-0.5 text-[10px] text-muted-foreground/60">
            +{shortlist.length - top.length} more
          </div>
        )}
      </div>
    </div>
  );
}
