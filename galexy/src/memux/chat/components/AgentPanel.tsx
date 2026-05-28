"use client";

/**
 * Right-side activity panel for the agentic chat.
 *
 * Three regions:
 *   1. Header — status pill + reasoning teaser.
 *   2. Activity timeline — every tool step this turn, click to focus.
 *   3. Focused step view — the ToolView for whichever step is selected.
 *      Defaults to the most recent step; the user can lock onto an
 *      earlier one to read it in detail.
 *
 * Plus a collapsible scratchpad footer showing the top candidates by
 * RRF score so the user can see what the agent is converging on.
 */

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleAlert,
  Loader2,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAgentStore, type ActivityStep } from "@/memux/chat/lib/agent-store";
import { ToolView } from "@/memux/chat/components/tool-views/ToolView";
import type { ToolName } from "@/lib/chat/types";

const TOOL_LABEL: Record<ToolName, string> = {
  search_keyword: "Keyword search",
  search_semantic: "Semantic search",
  search_combined: "Combined search",
  search_concept: "Concept search",
  find_by_date_range: "Date range",
  dates_in_content: "Dates in content",
  get_backlinks: "Backlinks",
  get_outlinks: "Outlinks",
  get_folder_contents: "Folder contents",
  expand_neighborhood: "Neighborhood",
  get_item: "Read item",
  get_annotations: "Annotations",
  read_section: "Read section",
  read_pdf_page: "Read PDF page",
  read_image: "Read image",
  read_csv: "Read CSV",
  list_concepts: "List concepts",
  get_concept: "Concept detail",
  find_evidence: "Find evidence",
  find_image_region: "Find image region",
};

export function AgentPanel({ onClose }: { onClose?: () => void }) {
  const status = useAgentStore((s) => s.status);
  const steps = useAgentStore((s) => s.steps);
  const focusedStepId = useAgentStore((s) => s.focusedStepId);
  const reasoningStream = useAgentStore((s) => s.reasoningStream);
  const shortlist = useAgentStore((s) => s.shortlist);
  const focusStep = useAgentStore((s) => s.focusStep);

  const focused = steps.find((s) => s.stepId === focusedStepId) ?? steps[steps.length - 1];
  const focusedPayload = focused?.result?.ok ? focused.result.ui : null;

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-gradient-to-b from-background to-card/50">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <Sparkles className="size-3.5 text-primary" />
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Agent
        </div>
        <StatusPill status={status} />
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            type="button"
          >
            Close
          </button>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto]">
        {/* Reasoning teaser */}
        {reasoningStream && (
          <div className="border-b border-border/60 bg-muted/20 px-3 py-2 text-[11px] italic text-muted-foreground">
            {reasoningStream.slice(-240)}
          </div>
        )}

        {/* Main: timeline on the left, focused view on the right */}
        <div className="grid min-h-0 grid-cols-[180px_minmax(0,1fr)]">
          <ActivityTimeline
            steps={steps}
            focusedStepId={focused?.stepId ?? null}
            onSelect={focusStep}
          />
          <div className="min-h-0 overflow-hidden">
            <ToolView payload={focusedPayload} />
          </div>
        </div>

        {/* Shortlist footer */}
        <ShortlistStrip shortlist={shortlist} />
      </div>
    </aside>
  );
}

function StatusPill({ status }: { status: "idle" | "running" | "done" | "error" }) {
  if (status === "idle") return null;
  const cfg =
    status === "running"
      ? { label: "Running", cls: "bg-primary/15 text-primary", icon: <Loader2 className="size-3 animate-spin" /> }
      : status === "done"
        ? { label: "Done", cls: "bg-emerald-500/15 text-emerald-300", icon: <CircleCheck className="size-3" /> }
        : { label: "Error", cls: "bg-destructive/15 text-destructive", icon: <CircleAlert className="size-3" /> };
  return (
    <span className={cn("ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", cfg.cls)}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function ActivityTimeline({
  steps,
  focusedStepId,
  onSelect,
}: {
  steps: ActivityStep[];
  focusedStepId: string | null;
  onSelect: (id: string) => void;
}) {
  if (steps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center border-r border-border/60 px-2 text-center text-[11px] text-muted-foreground/70">
        No steps yet.
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-col gap-1 overflow-y-auto border-r border-border/60 p-1.5">
      {steps.map((s, i) => (
        <button
          key={s.stepId}
          type="button"
          onClick={() => onSelect(s.stepId)}
          className={cn(
            "group/step flex items-start gap-1.5 rounded-md border border-transparent px-2 py-1.5 text-left text-[11px] transition-colors",
            s.stepId === focusedStepId
              ? "border-border bg-muted/60 text-foreground"
              : "text-muted-foreground hover:bg-muted/30",
          )}
        >
          <StepStatusDot status={s.status} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="font-mono text-[9px] text-muted-foreground/60">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="truncate font-medium">{TOOL_LABEL[s.tool] ?? s.tool}</span>
            </div>
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground/70">
              {summariseArgs(s.args)}
            </div>
            {s.result?.ok && (
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground/50">
                {s.result.refs.length} ref{s.result.refs.length === 1 ? "" : "s"}
              </div>
            )}
            {s.result && !s.result.ok && (
              <div className="mt-0.5 truncate text-[10px] text-destructive/80">
                error
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function StepStatusDot({ status }: { status: ActivityStep["status"] }) {
  const cls =
    status === "running"
      ? "border-primary bg-primary/40 animate-pulse"
      : status === "ok"
        ? "border-emerald-400/80 bg-emerald-400/40"
        : "border-destructive/60 bg-destructive/30";
  return (
    <span className={cn("mt-1 size-2 shrink-0 rounded-full border", cls)} aria-hidden />
  );
}

function summariseArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const obj = args as Record<string, unknown>;
  if (typeof obj.query === "string") return `"${obj.query}"`;
  if (typeof obj.itemId === "string") return obj.itemId;
  if (typeof obj.folderPath === "string") return obj.folderPath;
  if (typeof obj.name === "string") return obj.name;
  return Object.keys(obj).slice(0, 2).join(", ") || "";
}

function ShortlistStrip({ shortlist }: { shortlist: { itemId: string; title: string; score: number }[] }) {
  const [open, setOpen] = useState(true);
  if (shortlist.length === 0) return null;
  return (
    <div className="shrink-0 border-t border-border/60 bg-muted/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        Shortlist
        <span className="ml-auto font-mono text-muted-foreground/70">{shortlist.length}</span>
      </button>
      {open && (
        <div className="flex max-h-32 flex-col gap-0.5 overflow-y-auto px-3 pb-2">
          {shortlist.map((c, i) => (
            <div
              key={c.itemId}
              className="flex items-center gap-2 rounded px-1 py-0.5 text-[11px] text-foreground/85"
            >
              <span className="font-mono text-[9px] text-muted-foreground/60">
                #{i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              <span className="shrink-0 rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                {c.score.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
