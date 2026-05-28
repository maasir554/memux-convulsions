"use client";

/**
 * One card in the AgentPanel's vertical activity stream. Self-contained:
 * header (icon + verb + status), compact body (per-tool CardPreview),
 * subtle hover lift, soft fade-in-up entrance via ws-card-enter.
 *
 * The visual hierarchy is deliberately quiet — the user's attention is
 * on the chat answer below. The right pane is glanceable progress, not
 * a wall of data. Less text, more icons, more visuals.
 */

import {
  BookOpen,
  Brain,
  Calendar,
  Compass,
  Eye,
  Folder,
  Link2,
  Loader2,
  Network,
  Scan,
  Search,
  Sparkles,
  Telescope,
  Target,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { ToolName } from "@/lib/chat/types";
import type { ActivityStep } from "@/memux/chat/lib/agent-store";
import { CardPreview } from "@/memux/chat/components/activity/CardPreview";

/* ----------------------------------------------- per-tool visual config */

type Tone = {
  /** Tailwind class for the icon's text color. */
  iconTint: string;
  /** Tailwind class for the left-edge accent strip. */
  accent: string;
  /** Single-word verb shown in the header. */
  verb: string;
  /** Lucide icon class to render. */
  Icon: typeof Search;
};

const TONE_BY_TOOL: Record<ToolName, Tone> = {
  search_keyword: { iconTint: "text-sky-300", accent: "bg-sky-400/70", verb: "Searching", Icon: Search },
  search_semantic: { iconTint: "text-violet-300", accent: "bg-violet-400/70", verb: "Searching", Icon: Sparkles },
  search_combined: { iconTint: "text-violet-300", accent: "bg-violet-400/70", verb: "Searching", Icon: Sparkles },
  search_concept: { iconTint: "text-amber-300", accent: "bg-amber-400/70", verb: "Searching", Icon: Search },
  find_by_date_range: { iconTint: "text-amber-300", accent: "bg-amber-400/70", verb: "Recalling", Icon: Calendar },
  dates_in_content: { iconTint: "text-amber-300", accent: "bg-amber-400/70", verb: "Recalling", Icon: Calendar },
  get_backlinks: { iconTint: "text-fuchsia-300", accent: "bg-fuchsia-400/70", verb: "Mapping", Icon: Network },
  get_outlinks: { iconTint: "text-fuchsia-300", accent: "bg-fuchsia-400/70", verb: "Mapping", Icon: Network },
  get_folder_contents: { iconTint: "text-amber-300", accent: "bg-amber-400/70", verb: "Browsing", Icon: Folder },
  expand_neighborhood: { iconTint: "text-fuchsia-300", accent: "bg-fuchsia-400/70", verb: "Mapping", Icon: Compass },
  get_item: { iconTint: "text-sky-300", accent: "bg-sky-400/70", verb: "Reading", Icon: BookOpen },
  get_annotations: { iconTint: "text-sky-300", accent: "bg-sky-400/70", verb: "Reading", Icon: BookOpen },
  read_section: { iconTint: "text-sky-300", accent: "bg-sky-400/70", verb: "Studying", Icon: BookOpen },
  read_pdf_page: { iconTint: "text-rose-300", accent: "bg-rose-400/70", verb: "Reading", Icon: BookOpen },
  read_image: { iconTint: "text-violet-300", accent: "bg-violet-400/70", verb: "Looking", Icon: Eye },
  read_csv: { iconTint: "text-emerald-300", accent: "bg-emerald-400/70", verb: "Reading", Icon: BookOpen },
  list_concepts: { iconTint: "text-amber-300", accent: "bg-amber-400/70", verb: "Connecting", Icon: Brain },
  get_concept: { iconTint: "text-amber-300", accent: "bg-amber-400/70", verb: "Connecting", Icon: Brain },
  find_evidence: { iconTint: "text-primary", accent: "bg-primary/70", verb: "Investigating", Icon: Telescope },
  find_image_region: { iconTint: "text-violet-300", accent: "bg-violet-400/70", verb: "Locating", Icon: Target },
  get_section_links: { iconTint: "text-emerald-300", accent: "bg-emerald-400/70", verb: "Linking", Icon: Link2 },
  query_section_tree: { iconTint: "text-fuchsia-300", accent: "bg-fuchsia-400/70", verb: "Inspecting", Icon: Scan },
};

/* ------------------------------------------------------------- card */

export function ActivityCard({
  step,
  index,
}: {
  step: ActivityStep;
  /** Position in the stream — drives the stagger delay. */
  index: number;
}) {
  const tone = TONE_BY_TOOL[step.tool] ?? TONE_BY_TOOL.search_combined;
  const Icon = tone.Icon;
  const running = step.status === "running";
  const errored = step.status === "error";

  // Capped stagger: first ~6 cards stagger softly, later cards land
  // immediately (don't make the user wait if 12 things happened at once).
  const delayMs = Math.min(index, 5) * 80;

  return (
    <div
      className={cn(
        "ws-card-enter group relative overflow-hidden rounded-xl border bg-card/50 backdrop-blur",
        "border-border/50 transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-card/70 hover:shadow-lg",
        errored && "border-destructive/40 bg-destructive/[0.04]",
      )}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {/* Left-edge accent strip — colour-codes the tool family at a glance. */}
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          running ? tone.accent : "bg-border/40",
          running && "opacity-90",
        )}
        aria-hidden
      />

      <div className="flex flex-col gap-2 px-3.5 py-3 pl-4">
        {/* Header: icon + verb + dots + status */}
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/40",
              tone.iconTint,
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1 text-[13px] font-medium">
              {running ? (
                <>
                  <span className="ai-text-shimmer tracking-tight">{tone.verb}</span>
                  <span className="ws-indexing-dots text-foreground/60">...</span>
                </>
              ) : (
                <span className="tracking-tight text-foreground/85">{tone.verb}</span>
              )}
            </div>
          </div>
          {running ? (
            <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : errored ? (
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-destructive/80">
              error
            </span>
          ) : null}
        </div>

        {/* Body: tool-specific compact preview */}
        <div className="min-w-0">
          <CardPreview step={step} />
        </div>
      </div>
    </div>
  );
}
