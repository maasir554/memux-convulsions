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
import { History, Sparkles, ListChecks, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAgentStore } from "@/memux/chat/lib/agent-store";
import { ActivityCard } from "@/memux/chat/components/activity/ActivityCard";
import { HorizontalScroller } from "@/memux/chat/components/activity/HorizontalScroller";
import { VaultItemThumb } from "@/memux/chat/components/activity/VaultItemThumb";
import type { Candidate } from "@/lib/chat/types";

export function AgentPanel() {
  const liveSteps = useAgentStore((s) => s.steps);
  const liveReasoning = useAgentStore((s) => s.reasoningStream);
  const liveShortlist = useAgentStore((s) => s.shortlist);
  const viewingSnapshot = useAgentStore((s) => s.viewingSnapshot);
  const exitViewMode = useAgentStore((s) => s.exitViewMode);

  // Snapshot precedence: when the user has opened a past turn via the
  // eye button, render its frozen state instead of the live store. The
  // snapshot is plain data (zustand persist serialises it cleanly).
  const steps = viewingSnapshot?.steps ?? liveSteps;
  const reasoningStream = viewingSnapshot?.reasoningStream ?? liveReasoning;
  const shortlist = viewingSnapshot?.shortlist ?? liveShortlist;

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-border bg-gradient-to-b from-background to-card/40">
      {viewingSnapshot && (
        <ViewingPastBanner
          capturedAt={viewingSnapshot.capturedAt}
          onClose={exitViewMode}
        />
      )}
      {reasoningStream && (
        <div className="shrink-0 border-b border-border/40 bg-muted/10 px-4 py-2 text-[11px] italic leading-snug text-muted-foreground">
          {reasoningStream.slice(-220)}
        </div>
      )}
      <ActivityStream steps={steps} shortlist={shortlist} />
    </aside>
  );
}

function ViewingPastBanner({
  capturedAt,
  onClose,
}: {
  capturedAt: number;
  onClose: () => void;
}) {
  const when = new Date(capturedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-muted/20 px-3.5 py-2 text-[11px] text-muted-foreground">
      <History className="size-3.5 text-foreground/60" aria-hidden />
      <span className="flex-1 italic">Viewing past turn · {when}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Return to live agent"
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
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

/**
 * Sticky at the top of the stream, so the user can always glance at the
 * model's current best picks while history scrolls below. The header
 * shows total + best score; the rail itself is a horizontal scroller of
 * VaultItemThumb tiles, each carrying its rank as a small numbered badge.
 */
function ShortlistCard({ shortlist }: { shortlist: Candidate[] }) {
  const topScore = shortlist[0]?.score ?? 0;
  return (
    <div
      className="ws-card-enter sticky top-0 z-10 rounded-xl border border-border/40 bg-card/80 px-3 py-2.5 backdrop-blur"
      style={{ animationDelay: "0ms" }}
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        <ListChecks className="size-3.5 text-primary" aria-hidden />
        <span>Shortlist</span>
        <span className="ml-auto flex items-center gap-1.5 normal-case tracking-normal">
          <span className="rounded bg-muted/40 px-1 py-px font-mono text-[9px] text-muted-foreground">
            top {topScore.toFixed(2)}
          </span>
          <span className="font-mono text-foreground/80">{shortlist.length}</span>
        </span>
      </div>
      <HorizontalScroller className="mt-2 -mx-1 px-1" ariaLabel="Shortlisted items">
        {shortlist.map((c, i) => (
          <div key={c.itemId} className="relative">
            <VaultItemThumb
              itemId={c.itemId}
              title={c.title}
              type={c.type}
              caption={`#${i + 1} · score ${c.score.toFixed(2)}`}
            />
            {/* Rank badge on the corner — quietly communicates ordering
                without robbing the thumb of its preview. */}
            <span className="absolute left-1 top-1 rounded-sm bg-black/60 px-1 py-px font-mono text-[8.5px] leading-none text-white shadow-sm backdrop-blur-sm">
              {i + 1}
            </span>
          </div>
        ))}
      </HorizontalScroller>
    </div>
  );
}
