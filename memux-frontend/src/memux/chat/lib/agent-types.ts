/**
 * Shared types between the chat-session store (`store.ts`) and the
 * live agent store (`agent-store.ts`). Splitting these out prevents a
 * circular import (`store.ts` needs `AgentSnapshot` to type a field on
 * `ChatMessage`; `agent-store.ts` needs it to type its own state).
 *
 * No runtime code lives here — types only.
 */

import type { Candidate, ToolName, ToolResult } from "@/lib/chat/types";

export type ActivityStep = {
  stepId: string;
  tool: ToolName;
  args: unknown;
  startedAt: number;
  endedAt?: number;
  result?: ToolResult;
  status: "running" | "ok" | "error";
};

/**
 * Frozen-in-time snapshot of a completed agentic turn. Attached to the
 * assistant ChatMessage at turn-done so the user can re-open the
 * activity stream later via the eye button. Carries only what the
 * AgentPanel needs to render — no live subscriptions, no actions.
 */
export type AgentSnapshot = {
  steps: ActivityStep[];
  shortlist: Candidate[];
  reasoningStream: string;
  finalText: string;
  capturedAt: number;
  status: "done" | "error";
};
