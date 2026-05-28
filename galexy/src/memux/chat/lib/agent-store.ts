"use client";

/**
 * Live agentic-chat state. Subscribes to ChatEvents emitted by the
 * harness; the AgentPanel reads from this. Kept separate from the
 * existing chat session store so the two flows don't tangle.
 */

import { create } from "zustand";

import type {
  Candidate,
  ChatEvent,
  ToolName,
  ToolResult,
  ToolUIPayload,
} from "@/lib/chat/types";

export type ActivityStep = {
  stepId: string;
  tool: ToolName;
  args: unknown;
  startedAt: number;
  endedAt?: number;
  result?: ToolResult;
  status: "running" | "ok" | "error";
};

type State = {
  turnId: string | null;
  plan: { subQueries: string[]; intent: string } | null;
  reasoningStream: string;
  /** Every tool step this turn, oldest first. */
  steps: ActivityStep[];
  /** Step whose UI is currently focused (defaults to most recent). */
  focusedStepId: string | null;
  candidates: Candidate[];
  shortlist: Candidate[];
  finalText: string;
  status: "idle" | "running" | "done" | "error";
  errorText: string | null;
};

type Actions = {
  apply: (event: ChatEvent) => void;
  focusStep: (stepId: string | null) => void;
  reset: () => void;
};

const initial: State = {
  turnId: null,
  plan: null,
  reasoningStream: "",
  steps: [],
  focusedStepId: null,
  candidates: [],
  shortlist: [],
  finalText: "",
  status: "idle",
  errorText: null,
};

export const useAgentStore = create<State & Actions>((set) => ({
  ...initial,
  apply(event) {
    switch (event.kind) {
      case "turn-start":
        set({
          ...initial,
          turnId: event.turnId,
          status: "running",
        });
        return;
      case "plan":
        set({ plan: { subQueries: event.subQueries, intent: event.intent } });
        return;
      case "reasoning":
        set((s) => ({ reasoningStream: s.reasoningStream + event.text }));
        return;
      case "tool-start":
        set((s) => ({
          steps: [
            ...s.steps,
            {
              stepId: event.stepId,
              tool: event.tool,
              args: event.args,
              startedAt: Date.now(),
              status: "running",
            },
          ],
          focusedStepId: event.stepId,
        }));
        return;
      case "tool-result":
        set((s) => ({
          steps: s.steps.map((st) =>
            st.stepId === event.stepId
              ? {
                  ...st,
                  endedAt: Date.now(),
                  result: event.result,
                  status: event.result.ok ? "ok" : "error",
                }
              : st,
          ),
        }));
        return;
      case "scratchpad":
        set({ candidates: event.candidates });
        return;
      case "shortlist":
        set({ shortlist: event.shortlist });
        return;
      case "synth-token":
        set((s) => ({ finalText: s.finalText + event.token }));
        return;
      case "synth-done":
        set({ finalText: event.finalText });
        return;
      case "turn-error":
        set({ status: "error", errorText: event.error });
        return;
      case "turn-done":
        set((s) => ({ status: s.status === "error" ? "error" : "done" }));
        return;
    }
  },
  focusStep(stepId) {
    set({ focusedStepId: stepId });
  },
  reset() {
    set({ ...initial });
  },
}));

/** Convenience selector for the focused step's UI payload, if any. */
export function selectFocusedPayload(): ToolUIPayload | null {
  const { steps, focusedStepId } = useAgentStore.getState();
  const step = steps.find((s) => s.stepId === focusedStepId);
  if (!step?.result?.ok) return null;
  return step.result.ui;
}
