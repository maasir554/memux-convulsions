"use client";

/**
 * Main-panel "thinking" banner. Shown while the agent loop is running and
 * the final-answer stream hasn't started yet. Renders a shimmered verb
 * tied to the latest tool the agent invoked, followed by a blinking
 * cursor — so the user always knows what the agent is doing right now
 * without having to read the right panel.
 *
 * Disappears the moment synth-tokens start arriving (the answer takes
 * over the screen real-estate). Also disappears on done / error / idle.
 */

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAgentStore } from "@/memux/chat/lib/agent-store";
import type { ToolName } from "@/lib/chat/types";

const TOOL_VERB: Record<ToolName, string> = {
  search_keyword: "Searching",
  search_semantic: "Searching",
  search_combined: "Searching",
  search_concept: "Searching",
  find_by_date_range: "Recalling",
  dates_in_content: "Recalling",
  get_backlinks: "Mapping",
  get_outlinks: "Mapping",
  get_folder_contents: "Browsing",
  expand_neighborhood: "Mapping",
  get_item: "Reading",
  get_annotations: "Reading",
  read_section: "Studying",
  read_pdf_page: "Reading",
  read_image: "Looking",
  read_csv: "Reading",
  list_concepts: "Connecting",
  get_concept: "Connecting",
  find_evidence: "Investigating",
  find_image_region: "Locating",
  get_section_links: "Linking",
  query_section_tree: "Inspecting",
};

const IDLE_VERBS = ["Thinking", "Considering", "Reflecting", "Pondering"];

export function ChatThinkingBanner() {
  const status = useAgentStore((s) => s.status);
  const steps = useAgentStore((s) => s.steps);
  const finalText = useAgentStore((s) => s.finalText);

  // Cycle a fallback verb while there's no active tool (between turns, or
  // first model thinking before the first tool call). Refreshes every
  // 2.6s, matched to the shimmer cycle for visual coherence.
  const [idleIndex, setIdleIndex] = useState(0);
  useEffect(() => {
    if (status !== "running") return;
    if (steps.some((s) => s.status === "running")) return;
    const id = setInterval(() => {
      setIdleIndex((i) => (i + 1) % IDLE_VERBS.length);
    }, 2600);
    return () => clearInterval(id);
  }, [status, steps]);

  // Only show while the agent is actively working AND the user hasn't
  // started receiving the final answer text yet. Once tokens flow, the
  // assistant message renders its own content; the banner steps aside.
  if (status !== "running") return null;
  if (finalText.length > 0) return null;

  // Active verb: latest running step's tool → its verb; else fallback.
  const activeStep = [...steps].reverse().find((s) => s.status === "running");
  const verb = activeStep ? TOOL_VERB[activeStep.tool] : IDLE_VERBS[idleIndex];

  return (
    <div
      className="mx-auto my-6 flex w-full max-w-3xl items-center justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 rounded-full border border-border/40 bg-card/40 px-5 py-2.5 backdrop-blur">
        <Sparkles
          className="size-3.5 text-primary"
          aria-hidden
          style={{ animation: "ws-soft-pulse 1.8s ease-out infinite" }}
        />
        <span
          key={verb /* re-mount on verb change so the shimmer restarts */}
          className={cn(
            "ai-text-shimmer text-sm font-medium tracking-tight",
            "tabular-nums",
          )}
        >
          {verb}
        </span>
        <span className="ws-cursor-blink text-sm font-medium text-foreground/80">
          ▍
        </span>
      </div>
    </div>
  );
}
