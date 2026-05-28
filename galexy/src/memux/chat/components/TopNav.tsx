"use client";

/**
 * Top strip that sits INSIDE the right-of-sidebar column. Two cells:
 *
 *   ┌─────────────────────────────────┬─────────────────────┐
 *   │ MEMUX · <chat title>            │ ✨ AGENT · ●   [X]  │
 *   ├─────────────────────────────────┼─────────────────────┤
 *   │ Chat body                       │ Agent panel         │
 *   └─────────────────────────────────┴─────────────────────┘
 *
 * Because the topnav and the chat row share the same parent (the
 * right-of-sidebar column), `w-[40%]` on the topnav's agent cell
 * resolves to the same absolute width as `w-[40%]` on the agent panel
 * below. The two `border-l`s compose into one continuous vertical seam.
 */

import { useMemo } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  PanelRight,
  Sparkles,
  X,
} from "lucide-react";

import { cn } from "@/memux/chat/lib/utils";
import { useClient } from "@/memux/chat/lib/clientSettings";
import { useActiveChat } from "@/memux/chat/lib/store";
import { countMessagesTokens } from "@/memux/chat/lib/tokens";
import { useAgentStore } from "@/memux/chat/lib/agent-store";
import { MemuxMark } from "@/memux/chat/components/MemuxMark";
import { ContextMeter } from "@/memux/chat/components/ContextMeter";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/memux/chat/components/ui/tooltip";

export function TopNav() {
  const active = useActiveChat();

  const agentPanelOpen = useClient((s) => s.agentPanelOpen);
  const setAgentPanelOpen = useClient((s) => s.setAgentPanelOpen);
  const showTokenCounter = useClient((s) => s.showTokenCounter);

  const tokensUsed = useMemo(
    () => (active ? countMessagesTokens(active.messages) : 0),
    [active],
  );

  return (
    <header className="flex h-12 shrink-0 items-stretch border-b border-border bg-background">
      {/* CELL 1 — main: brand + chat title + optional token meter +
          (when agent panel is closed) the show-agent toggle. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <div className="flex items-center gap-2">
          <MemuxMark size={20} />
          <span className="text-sm font-bold uppercase tracking-[0.18em] text-foreground">
            MEMUX
          </span>
        </div>

        {active && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <div
              className="min-w-0 max-w-[36ch] truncate text-sm text-foreground/80"
              title={active.title}
            >
              {active.title}
            </div>
          </>
        )}

        <div className="flex-1" />

        {showTokenCounter && active && (
          <ContextMeter used={tokensUsed} total={active.contextSize} />
        )}

        {!agentPanelOpen && (
          <AgentClosedToggle onOpen={() => setAgentPanelOpen(true)} />
        )}
      </div>

      {/* CELL 2 — agent area. Border-l + width spec exactly match the
          AgentPanel wrapper below, so both left borders compose into one
          continuous vertical seam. */}
      {agentPanelOpen && <AgentHeaderInline />}
    </header>
  );
}

/* -------------------------------------------------- agent: header */

function AgentHeaderInline() {
  const status = useAgentStore((s) => s.status);
  const setAgentPanelOpen = useClient((s) => s.setAgentPanelOpen);

  return (
    <div
      className={cn(
        "hidden shrink-0 items-center gap-2 border-l border-border px-3.5 md:flex",
        // Must mirror the AgentPanel wrapper width below. Drift here =
        // misaligned vertical divider between the two rows.
        "w-[40%] min-w-[360px] max-w-[640px]",
      )}
    >
      <Sparkles className="size-3.5 text-primary" aria-hidden />
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Agent
      </div>
      <StatusPill status={status} />
      <div className="flex-1" />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setAgentPanelOpen(false)}
            aria-label="Hide agent panel"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Hide agent</TooltipContent>
      </Tooltip>
    </div>
  );
}

function StatusPill({ status }: { status: "idle" | "running" | "done" | "error" }) {
  if (status === "idle") return null;
  const cfg =
    status === "running"
      ? {
          label: "Working",
          cls: "border-primary/30 bg-primary/10 text-primary",
          icon: <Loader2 className="size-3 animate-spin" />,
        }
      : status === "done"
        ? {
            label: "Done",
            cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
            icon: <CheckCircle2 className="size-3" />,
          }
        : {
            label: "Error",
            cls: "border-destructive/30 bg-destructive/10 text-destructive",
            icon: <CircleAlert className="size-3" />,
          };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        cfg.cls,
      )}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

/* -------------------------------------------------- agent: closed */

function AgentClosedToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          aria-label="Show agent panel"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <PanelRight className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Show agent</TooltipContent>
    </Tooltip>
  );
}
