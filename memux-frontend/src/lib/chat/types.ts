/**
 * Shared types for the agentic chat. One source of truth so the harness,
 * the tool implementations, the SSE wire, and the UI all agree on shapes.
 *
 * Design notes:
 *  - Every tool returns `{ summary, refs, ui }`. `summary` is the compact
 *    structured block fed back into the LLM's context window. `refs` are
 *    pointer-only candidates the harness aggregates into the scratchpad.
 *    `ui` is the rich payload the right-pane preview renders — never seen
 *    by the LLM, so it can be as large as we like without burning tokens.
 *  - Tool inputs / outputs are kept narrow on purpose. The model picks
 *    tools via native function-calling; if it wants depth it composes
 *    multiple calls instead of one tool with 12 options.
 */

import type { ItemType } from "@/lib/mock-notes";

/* ============================================================ candidates */

/**
 * A scored knowledge-base item the harness is tracking as potentially
 * relevant to the user's question. Candidates accumulate across tool
 * waves; their score is RRF-fused over every tool that surfaced them.
 */
export type Candidate = {
  itemId: string;
  title: string;
  type: ItemType;
  folder: string;
  /** RRF-aggregated score across all tools that surfaced this item. */
  score: number;
  /** Every (tool, rank, snippet) tuple that contributed to the score. */
  evidence: CandidateEvidence[];
  /** Match spans for highlight rendering. */
  highlights: Highlight[];
  /** Last time this candidate's score moved — for "recent activity" UI. */
  updatedAt: number;
};

export type CandidateEvidence = {
  tool: ToolName;
  /** 1-based rank inside that tool's result list. */
  rank: number;
  /** Per-tool raw score (cosine, ts_rank, etc.) — informational. */
  rawScore?: number;
  /** Short excerpt from the matching content for the UI. */
  snippet: string;
};

export type Highlight = {
  /** Char offset in the item's content. */
  start: number;
  end: number;
  text: string;
};

/* ================================================================ tools */

/** Canonical tool names. Add here when adding a tool — the registry checks. */
export type ToolName =
  | "search_keyword"
  | "search_semantic"
  | "search_combined"
  | "search_concept"
  | "search_documents"
  | "find_by_date_range"
  | "dates_in_content"
  | "get_backlinks"
  | "get_outlinks"
  | "get_folder_contents"
  | "expand_neighborhood"
  | "get_item"
  | "get_annotations"
  | "read_section"
  | "read_pdf_page"
  | "read_image"
  | "read_csv"
  | "list_concepts"
  | "get_concept"
  | "find_evidence"
  | "find_image_region"
  | "get_section_links"
  | "query_section_tree";

/**
 * Minimal handle on an item the LLM can pass around without us shipping the
 * whole note body. Most tools return arrays of these.
 */
export type ItemRef = {
  itemId: string;
  title: string;
  type: ItemType;
  folder: string;
  /** Short reason this ref was surfaced. */
  snippet?: string;
  /** Optional raw per-tool score (cosine sim, ts_rank, etc.). */
  score?: number;
};

/**
 * Every tool resolves to this shape. The harness uses `summary` + `refs` to
 * keep the LLM's context window tight; the UI uses `ui` (which can be
 * arbitrary) to render the live preview pane.
 */
export type ToolResult = {
  ok: true;
  /** One-line factual statement for the LLM to ingest ("Found 7 results"). */
  summary: string;
  /** Pointer-only candidates so the LLM can request depth via more calls. */
  refs: ItemRef[];
  /**
   * Full body content for read-tools (read_section, get_item, …). Search
   * tools omit it. Sent to the LLM as the substantive payload — without
   * this, "Studying section X" returns metadata only and the model can't
   * extract specific facts from the body.
   */
  body?: string;
  /** Payload for the AgentPanel's tool-view renderer. */
  ui: ToolUIPayload;
} | {
  ok: false;
  /** Compact, model-readable error message. */
  error: string;
};

/**
 * Discriminated union of the UI payloads the right-pane renderer expects.
 * Each tool returns exactly one of these. Adding a new tool view kind is
 * O(1): add a member here, branch in the renderer.
 */
export type ToolUIPayload =
  | { kind: "search-results"; query: string; results: ItemRef[]; tool: ToolName }
  | { kind: "item-detail"; itemId: string; title: string; bodyMd?: string; metaPairs?: Array<[string, string]> }
  | { kind: "section-read"; noteItemId: string; sectionTitle: string; markdown: string }
  | { kind: "pdf-page"; itemId: string; pageNumber: number; thumbDataUrl: string; extractedText: string }
  | { kind: "image-read"; itemId: string; alt: string; description: string; src?: string; blobKey?: string }
  | { kind: "graph-fan"; centerItemId: string; outgoing: ItemRef[]; incoming: ItemRef[] }
  | { kind: "folder-list"; folderPath: string; entries: ItemRef[] }
  | { kind: "concept-detail"; name: string; mentions: ItemRef[] }
  | { kind: "date-results"; range: { from: string; to: string }; entries: ItemRef[] }
  | { kind: "scratchpad-merge"; before: number; after: number; delta: number }
  | {
      kind: "section-links";
      sectionId: string;
      sectionTitle: string;
      links: Array<{ href: string; anchor: string; source: "tree" | "transcribed" | "bare-url" }>;
    }
  | {
      kind: "tree-query";
      sectionId: string;
      query: string;
      answer: string;
      relevantNodes: string[];
    };

/* ============================================================== events */

/**
 * Wire format streamed from /v1/chat/agentic to the browser. The UI builds
 * its activity timeline + scratchpad incrementally from these.
 *
 * Each event carries a `turnId` (one user message round-trip) and a `stepId`
 * (one harness phase: plan, search-wave, consolidate, explore, synth).
 */
export type ChatEvent =
  | { kind: "turn-start"; turnId: string; question: string }
  | { kind: "plan"; turnId: string; subQueries: string[]; intent: string }
  | { kind: "tool-start"; turnId: string; stepId: string; tool: ToolName; args: unknown }
  | { kind: "tool-result"; turnId: string; stepId: string; tool: ToolName; result: ToolResult }
  | { kind: "scratchpad"; turnId: string; candidates: Candidate[] }
  | { kind: "shortlist"; turnId: string; shortlist: Candidate[] }
  | { kind: "reasoning"; turnId: string; text: string }
  | { kind: "synth-token"; turnId: string; token: string }
  | { kind: "synth-done"; turnId: string; finalText: string }
  | { kind: "turn-error"; turnId: string; error: string }
  | { kind: "turn-done"; turnId: string };

/* ============================================================ scratchpad */

/**
 * Per-session scratchpad. Persists to IndexedDB so the user can navigate
 * away and come back mid-task. Resumable: if the page reloads while a
 * synth is in flight, we can replay the SSE from the server's offset.
 */
export type Scratchpad = {
  sessionId: string;
  question: string;
  /**
   * Free-form running notes the harness writes during consolidation.
   * Stays under ~300 tokens so it fits in every subsequent LLM call.
   */
  workingNotes: string;
  candidates: Record<string, Candidate>;
  /** Ordered list of itemIds making up the current shortlist. */
  shortlist: string[];
  /** Every tool call ever made this session. For UI inspection + audit. */
  history: ScratchpadHistoryEntry[];
  /** Plan(s) generated this session, indexed by turnId. */
  plans: Record<string, { subQueries: string[]; intent: string }>;
  updatedAt: number;
};

export type ScratchpadHistoryEntry = {
  turnId: string;
  stepId: string;
  tool: ToolName;
  args: unknown;
  /** Trimmed to keep IDB rows small; full payload lives in the SSE replay. */
  summary: string;
  refCount: number;
  startedAt: number;
  endedAt: number;
};

/* ====================================================== chat transcript */

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** For assistant turns: the structured reasoning block (short, optional). */
  reasoning?: string;
  /** turnId this message belongs to. Lets the UI link msgs to activity. */
  turnId?: string;
  createdAt: number;
};
