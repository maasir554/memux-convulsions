import "server-only";

import { jsonCall } from "@/lib/indexer/llm";

/**
 * The three agents the orchestrator dispatches.
 *
 *  - Visioner  — reads one page (image), carries session state across pages.
 *  - Summariser — turns a finished section's markdown into {summary, questions, concepts}.
 *  - Namer     — invents a group title from the section summaries.
 *
 * All agents emit JSON. Schemas are described in TS-notation in the prompt
 * because Gemma 4 31B doesn't accept a native response-schema (Gemini 2.x
 * does; Gemma doesn't).
 *
 * Bounding boxes follow the Gemini convention: [ymin, xmin, ymax, xmax]
 * normalised to [0, 1000]. Gemma 4 uses the same convention natively.
 */

/* -------------------------------------------------------------- visioner */

export type VisionerInput = {
  imageBase64: string;
  mimeType: string;
  /** User's group-level context (may be empty). */
  userContext: string;
  /** Compressed state from previous pages. Empty string on the first page. */
  sessionState: string;
  /** 1-based page index for log lines. */
  pageOrdinal: number;
  /** Filename so the agent has hint of provenance. */
  fileName: string;
};

export type Diagram = {
  /** [ymin, xmin, ymax, xmax] in 0..1000. */
  bbox: [number, number, number, number];
  caption: string;
  alt: string;
};

export type VisionerOutput = {
  /** Topic this page belongs to (continuation or new). */
  topic: string;
  /**
   *  continue  — same topic as previous page
   *  end       — this page ends the current topic (current section closes after it)
   *  new       — this page starts a new topic (current section closes BEFORE it; this page starts the next)
   */
  transition: "continue" | "end" | "new";
  /** Polished markdown of this page's content. Tables preserved. Replace diagrams with HTML comment placeholders the orchestrator will swap for image refs. */
  text: string;
  diagrams: Diagram[];
  /** One-sentence summary for the running scratchpad. */
  pageSummary: string;
  /** Updated session state for the next page (≤300 tokens). */
  sessionUpdate: string;
};

const VISIONER_SCHEMA = `{
  topic: string,                                 // the section topic this page belongs to
  transition: "continue" | "end" | "new",
  text: string,                                  // page content in clean Markdown. Use <!-- diagram:N --> placeholders where a diagram from the diagrams[] array appears.
  diagrams: { bbox: [ymin, xmin, ymax, xmax], caption: string, alt: string }[],   // [0,1000] normalised. Only include diagrams that can't be captured by markdown (charts, schematics, photos). Skip simple tables — represent those as markdown tables in text.
  pageSummary: string,                           // 1-sentence summary
  sessionUpdate: string                          // running notes for the next page (<= 300 tokens)
}`;

const VISIONER_SYSTEM = `You are the Visioner — one of several agents indexing a document for a knowledge base.
You see ONE page at a time. Your job is to:
1. Decide whether this page CONTINUES the current topic, ENDS it, or starts a NEW topic.
2. Output the page content as clean Markdown.
3. Mark every diagram that should appear as an image (not pure text) with a bounding box in [ymin, xmin, ymax, xmax] 0..1000.
4. Update the session state so the next call has the running context.

Rules:
- A page that contains a chapter/section heading and unrelated content from the previous topic is "new".
- A page that's the final page of a topic (e.g. conclusion, last paragraph before a heading break) is "end".
- A page that's mid-flow is "continue".
- Diagrams are non-text content (charts, photos, complex schematics) — NOT simple tables (those go in 'text' as markdown).
- Put a <!-- diagram:0 -->, <!-- diagram:1 -->, ... placeholder in 'text' at the position each diagram appears. The orchestrator swaps these for image references.
- Do NOT include the page number or "page N" headers in 'text'. The orchestrator handles structural framing.
- Tables: render as markdown tables.
- Equations: use $...$ / $$...$$ if present.
- Footnotes: inline as (note: ...) or attach to the running line — never invent footnote anchors.`;

export async function visioner(
  input: VisionerInput,
  signal: AbortSignal,
): Promise<VisionerOutput> {
  const prompt = `File: ${input.fileName}
Page: ${input.pageOrdinal}

USER CONTEXT (may be empty):
${input.userContext || "(none)"}

SESSION STATE FROM PREVIOUS PAGES (may be empty if this is page 1):
${input.sessionState || "(none — this is the first page)"}

Now read the attached image and respond.`;
  return jsonCall<VisionerOutput>(
    {
      prompt,
      image: { base64: input.imageBase64, mimeType: input.mimeType },
      system: VISIONER_SYSTEM,
      schema: VISIONER_SCHEMA,
      temperature: 0.2,
      // The Visioner output is structural; thinking burns budget without
      // measurable quality lift on per-page tasks. Disable thinking.
      think: false,
    },
    signal,
  );
}

/* ----------------------------------------------------------- summariser */

export type SummariserInput = {
  /** The polished section markdown. */
  sectionMarkdown: string;
  /** The topic for context (Visioner's last `topic` for the section). */
  topic: string;
  /** User's group-level context, if any. */
  userContext: string;
};

export type SummariserOutput = {
  /** ≤ 2 sentence summary in plain prose. */
  summary: string;
  /** 3-5 questions this section answers. Phrased as the reader would ask. */
  questions: string[];
  /** 3-7 concept tags. Short noun phrases. */
  concepts: string[];
};

const SUMMARISER_SCHEMA = `{
  summary: string,         // 1-2 sentence plain prose
  questions: string[],     // 3-5 entries, phrased as natural-language questions a reader would ask
  concepts: string[]       // 3-7 short noun phrases capturing the section's topics. Title-cased.
}`;

const SUMMARISER_SYSTEM = `You are the Summariser — one of several agents indexing a document for a knowledge base.
You receive ONE finished section of markdown and produce its index entry.

Rules:
- Summary: 1-2 sentences. Plain prose. NO meta-commentary ("this section talks about..." is forbidden — say what it IS, not what it does).
- Questions: things a reader would actually type into a search bar to find this section. NOT "what is X" trivia — real, retrieval-flavoured questions.
- Concepts: short noun phrases. Prefer canonical names ("Retrieval-Augmented Generation", not "the RAG approach"). Avoid generic words ("system", "approach", "framework").`;

export async function summariser(
  input: SummariserInput,
  signal: AbortSignal,
): Promise<SummariserOutput> {
  const prompt = `Section topic: ${input.topic}

USER CONTEXT (may be empty):
${input.userContext || "(none)"}

SECTION MARKDOWN:
${input.sectionMarkdown}

Produce the index entry.`;
  return jsonCall<SummariserOutput>(
    {
      prompt,
      system: SUMMARISER_SYSTEM,
      schema: SUMMARISER_SCHEMA,
      temperature: 0.3,
      think: false,
    },
    signal,
  );
}

/* ---------------------------------------------------------------- namer */

export type NamerInput = {
  /** All section summaries from the run. */
  sectionSummaries: Array<{ topic: string; summary: string }>;
  /** User's group-level context, if any. */
  userContext: string;
};

export type NamerOutput = {
  /** 2-6 words. Title case. No quotes. */
  groupName: string;
  /** One short line describing what this group covers. */
  tagline: string;
};

const NAMER_SCHEMA = `{
  groupName: string,   // 2-6 words. Title case. Specific to the actual content. No quotes.
  tagline: string      // One short line — "<N> sections on <theme>". <= 80 chars.
}`;

const NAMER_SYSTEM = `You are the Namer. You see a list of section topics and summaries from a freshly-indexed group of documents. Invent a short, specific name for the whole group.

Rules:
- Title case.
- Specific. "Q3 Board Pack" beats "Business Documents".
- No filler ("Knowledge Group", "Document Set", etc.).
- Don't quote the name.
- Tagline: one short factual sentence, never marketing.`;

export async function namer(
  input: NamerInput,
  signal: AbortSignal,
): Promise<NamerOutput> {
  const lines = input.sectionSummaries
    .map((s, i) => `${i + 1}. [${s.topic}] ${s.summary}`)
    .join("\n");
  const prompt = `USER CONTEXT (may be empty):
${input.userContext || "(none)"}

SECTIONS:
${lines}

Name this group.`;
  return jsonCall<NamerOutput>(
    {
      prompt,
      system: NAMER_SYSTEM,
      schema: NAMER_SCHEMA,
      temperature: 0.5,
      think: false,
    },
    signal,
  );
}
