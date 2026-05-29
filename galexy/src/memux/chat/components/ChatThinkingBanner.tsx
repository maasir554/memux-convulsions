"use client";

/**
 * Main-panel "thinking" banner. Shown while the agent loop is running and
 * the final-answer stream hasn't started yet. Renders a shimmered verb
 * tied to the latest tool the agent invoked, followed by a blinking
 * cursor — so the user always knows what the agent is doing right now
 * without having to read the right panel.
 *
 * Visual treatment: deliberately minimal. No pill, no border, no icon.
 * Left-aligned, sits in the message column flow at the same font size
 * as a chat message. Reads as "the assistant is typing" rather than as
 * a separate status chrome element.
 *
 * Disappears the moment synth-tokens start arriving (the answer takes
 * over the screen real-estate). Also disappears on done / error / idle.
 */

import { useEffect, useState } from "react";

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
  search_documents: "Searching",
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
      className="my-2 flex items-baseline gap-0.5"
      role="status"
      aria-live="polite"
    >
      <span
        key={verb /* re-mount on verb change so the shimmer restarts */}
        className={cn(
          // Match the chat-message font: 16.5px, weight 300, same prose
          // rhythm. No pill, no icon, no border — just the word.
          "ai-text-shimmer text-[16.5px] font-[300] leading-[1.5] tracking-tight",
        )}
      >
        {verb}
      </span>
      <span className="ws-cursor-blink text-[16.5px] font-[300] leading-[1.5] text-foreground/70">
        ▍
      </span>
    </div>
  );
}
