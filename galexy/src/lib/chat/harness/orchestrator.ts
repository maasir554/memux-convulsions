"use client";

/**
 * Browser-side agent orchestrator.
 *
 * The harness drives the loop:
 *   1.  Send user turn + tools manifest to /v1/chat/agentic.
 *   2.  Stream native Gemini chunks back. Two kinds of parts:
 *         • text → emit reasoning + synth-token events.
 *         • functionCall → look up the tool in the registry, run its
 *           handler against the vault DB, append the structured result
 *           to the conversation as a functionResponse part.
 *   3.  Loop until the model emits no more functionCall parts (finish).
 *   4.  Update scratchpad after each tool wave (RRF merge, shortlist).
 *
 * Why client-side: PGlite lives in the browser. Round-tripping vault
 * queries to a server proxy would double the latency of every tool
 * call and add a websocket hop we don't need.
 *
 * Context isolation: the tool result fed back to the model is the
 * compact `{ ok, summary, refs }` triple — never the full `ui` payload.
 * The UI gets the full payload via the event stream; the LLM sees only
 * what it needs to decide the next step.
 */

import { findTool, geminiToolsManifest } from "@/lib/chat/tools/registry";
import {
  loadScratchpad,
  saveScratchpad,
  emptyScratchpad,
  mergeCandidates,
  shortlistTopK,
  withHistoryEntry,
} from "@/lib/chat/scratchpad/store";
import type {
  Candidate,
  ChatEvent,
  Scratchpad,
  ToolName,
  ToolResult,
} from "@/lib/chat/types";

/* ----------------------------------------------------- agentic transport */

export type NativePart = Record<string, unknown>;
export type NativeContent = {
  role: "user" | "model" | "function";
  parts: NativePart[];
};

type AgenticRequest = {
  model?: string;
  contents: NativeContent[];
  tools?: ReturnType<typeof geminiToolsManifest>;
  systemInstruction?: string;
  temperature?: number;
  thinkingLevel?: "MINIMAL" | "STANDARD" | "HIGH";
};

/* ------------------------------------------------------ system prompt */

const SYSTEM_PROMPT = `You are the knowledge-base agent for memux/galexy — a personal vault of indexed notes, PDFs, images, captures, and code snippets.

Tools are how you find and read content. The user has indexed their captures into sections with concepts, questions, and vector embeddings. You should LEAN ON the tools rather than guess from memory.

Strategy:
- Decompose the user's question first. Identify named entities, conceptual queries, date constraints.
- Cast a wide net early. The three search tools cover three different intents — use them in parallel when the question is rich:
    • search_documents — BM25 over EVERY md/code/csv body, including notes the user never indexed. Use for natural-language word queries, multi-term phrases, typo-tolerant lookups, and "find me notes that mention X". This is your best general-purpose search across raw vault content.
    • search_semantic — vector search over INDEXED section summaries / questions / concepts. Use for conceptual / paraphrased queries where the user is asking about a TOPIC that's been through the indexer.
    • search_keyword — exact substring match, no ranking. Use only for proper nouns the user typed verbatim, code symbols, or file names.
  When the user asks something like "what do my notes say about X" or "find notes about Y", search_documents is usually the right first call. Reach for search_semantic when the user is asking about indexed/captured content specifically.
- After search, pick the most promising candidates by score + topic fit and use get_item / read_section to read their content in depth.
- If a search returns nothing useful, say so plainly. Don't pretend to have evidence you couldn't find.
- Keep your visible reasoning short — 1-2 sentences before each tool wave. The final answer should be substantive but not padded.

CITATIONS — this is how the user clicks back into their vault. Every claim you make based on a tool result MUST carry a citation.

The choice between the two schemes below is NOT about the item's type. It's about whether you're TEXT-citing the item (link in prose) or VISUALLY EMBEDDING it (inline image). The exact same image item could be cited either way: as a text chip in a sentence, OR embedded as a picture. Pick by intent, not by type.

  • Text citation — [your phrasing](vault:<itemId>)
    Use whenever you want to LINK to a vault item from inside prose, regardless of whether it's markdown, pdf, image, or anything else. The render is a small clickable chip with the item's type icon.
    Example:
      Beever AI offers two pricing tiers ([Section 03 · Pricing model](vault:idx-section-abc123)).
      The hero illustration ([cap-01-01](vault:idx-capture-9c1a)) ties the headline to the product card.

  • Image embed — ![your alt text](vault-image:<imageItemId>)
    Use ONLY when you want the image to appear inline in the reader's view, like a screenshot in a doc. NEVER use vault-image: inside a [text]() link — that's a text citation, use vault: there.
    Example:
      Here's the hero card the question is about:
      ![Beever AI hero with Beever Atlas card](vault-image:idx-capture-9c1a)

  Side-by-side: if you both want to embed the image AND reference it textually later, do both — they're not mutually exclusive.

WIDGETS — beyond text + images, two structured widgets are available. Each renders as a real interactive component inline in the chat. Use them deliberately, NOT as decoration.

  • Knowledge graph — ![label](vault-graph:id1,id2,id3)
    Renders a small inline node-graph of vault items with edges drawn between items that share concepts or link to each other. Use ONCE per answer, ONLY when you've drawn from 3+ distinct items with meaningful relationships. Comma-separated itemIds in order of importance — the first appears at the centre. Cap at ~10 items.
    Example:
      ![Items behind this answer](vault-graph:idx-section-abc,idx-section-def,idx-capture-9c1a,idx-section-ghi)

  • Chart — ![title](vault-chart:<type>,label1:value1,label2:value2,…)
    Supported types: bar, pie, donut, line, area. Use when you have actual numeric data to visualise. Pie/donut for proportional breakdowns ("storage by category"), bar for comparisons across categories ("hits by source"), line/area for time series. 3-8 data points is the sweet spot — fewer feels sparse, more crowds the SVG. Labels are PLAIN TEXT. Values are NUMBERS only (no units).
    Example:
      ![Concept coverage](vault-chart:pie,Embeddings:120,Retrieval:80,Ranking:55,RRF:30)
      ![Daily notes captured](vault-chart:line,Mon:3,Tue:7,Wed:5,Thu:12,Fri:8,Sat:2,Sun:1)
      ![Storage by type](vault-chart:donut,Captures:340,Indexed:120,Misc:80)

  • Timeline — ![title](vault-timeline:label1@YYYY-MM-DD,label2@YYYY-MM-DD,…)
    Horizontal chronology with positioned dots. Each entry is "<label>@<ISO date>", optionally with "#<itemId>" suffix to make the dot link to a vault item. Use when the answer involves dated events spanning days/weeks/months. 3-8 events. Auto-sorts chronologically.
    Example:
      ![Project milestones](vault-timeline:Spec landed@2026-01-12,Prototype@2026-02-03#idx-capture-9c1a,Demo build@2026-03-01,Hackathon@2026-03-15)

  • Comparison table — ![title](vault-table:col1|col2|col3||row1c1|row1c2|row1c3||row2c1|row2c2|row2c3)
    "||" between rows, "|" between cells. First row is headers. Numeric columns are auto-detected and right-aligned. Use when answering "how do X and Y compare" or summarising 2-5 related items side by side. Up to 6 columns, up to 8 rows.
    Example:
      ![Search tools compared](vault-table:Tool|Coverage|Ranking|Best for||search_keyword|All vault|None|Exact substrings||search_documents|All vault|BM25|Natural-language words||search_semantic|Indexed only|Vector cosine|Conceptual paraphrases)

  • Section outline — ![title](vault-outline:level-Text,~level-Text,…)
    Hierarchical doc outline. Each entry is "<level>-<text>", level 1-6. Prefix an entry with "~" to mark "I read this" — those rows are highlighted. Use when your answer drew from one big multi-section doc and you want to show which slices you consulted.
    Example:
      ![MEMUX architecture](vault-outline:1-Overview,2-Stack,~2-Indexer pipeline,~3-Visioner,3-Summariser,~3-Embedder,2-Chat harness,~3-Tool registry)

  When to skip widgets: simple answers, conversational replies, or answers that genuinely only cited 1-2 items. Widgets earn their visual weight.

Rules:
- NEVER fabricate an itemId. Only cite IDs you have literally seen in a refs[] array from a tool result this turn.
- Prefer text citations sprinkled inline through the prose, not bunched at the end. One per claim is plenty.
- Use image embeds sparingly — only when an actual image item answers the question visually. Don't embed images just to fill space.
- Widgets at most ONE of each per answer. They're closing flourishes, not headers.
- If your answer doesn't rely on the vault (e.g. clarifying a general concept), no citations needed.
- Never put a vault-image: / vault-graph: / vault-chart: / vault-timeline: / vault-table: / vault-outline: URL inside a [..]() link — those are embeds, not text citations. Use ![..](). Plain vault: links use [..]().`;

/* ------------------------------------------------ widget enrichment pass */

/**
 * Slim system prompt for the post-answer widget pass. The model is shown
 * the user's question + the assistant's just-emitted answer and asked to
 * surface ZERO or more widget markdown blocks that add visual clarity to
 * the data the answer already cites. No prose, no rewrites, no tool
 * calls.
 *
 * The widget docs intentionally mirror the main SYSTEM_PROMPT so the
 * model sees one consistent contract — the only behavioural delta is the
 * "emit nothing if not warranted" rule, which the main agent is more
 * lax about (it's also writing prose, so widgets are decoration there).
 */
const WIDGET_ENRICHMENT_PROMPT = `You are a visualisation enrichment agent. The user asked a question and got a text answer with citations. Your sole job: read the answer and emit 0-3 widget markdown blocks that make its DATA easier to see at a glance.

STRICT OUTPUT CONTRACT:
- Output ONLY widget image-markdown blocks, separated by blank lines.
- DO NOT write prose, headings, lists, transitions, or explanations.
- DO NOT repeat or paraphrase the answer text.
- DO NOT cite item IDs that don't appear in the answer.
- If nothing in the answer is worth visualising, output the empty string (nothing at all). This is the default — bias toward less.
- Each widget you emit must be supported by EXPLICIT data in the answer. No invented numbers, no invented categories.

Widgets available (only emit when the data clearly fits):

  • Knowledge graph — ![label](vault-graph:id1,id2,id3)
    When the answer references 3+ distinct vault item IDs with meaningful relationships. Comma-separated itemIds copied verbatim from the answer's citations. Cap at ~10 items.
    Example: ![Items behind this answer](vault-graph:idx-section-abc,idx-section-def,idx-capture-9c1a)

  • Chart — ![title](vault-chart:<type>,label1:value1,label2:value2,…)
    Types: bar, pie, donut, line, area. ONLY when the answer mentions ACTUAL NUMBERS attached to categories ("76 percent of X", "$2M in Y"). 3-8 data points is the sweet spot. Labels are plain text. Values are bare numbers (no %, $, k).
    Example: ![Sector breakdown](vault-chart:pie,Banking:42,Insurance:33,Other:25)

    SPECIAL CASE — binary percent answers. When the answer cites a single percentage that implies a yes/no or did/didn't split ("76 percent of X did Y", "83 percent now embed Z"), emit a 2-slice pie that visualises the implicit complement. Label the slices with what each side actually means, not "Yes/No":
      Answer: "76 percent of Indian BFSI CISOs rank AI attacks among their top priorities."
      Widget: ![CISO AI-attack priority](vault-chart:pie,Rank AI attacks top priority:76,Do not:24)
      Answer: "83 percent of institutions now embed AI in cyber operations."
      Widget: ![AI in cyber ops](vault-chart:pie,Embedding AI:83,Not yet:17)
    Pick concise but truthful labels; never invent the inverse number — it's always 100 - percent.

  • Timeline — ![title](vault-timeline:label1@YYYY-MM-DD,label2@YYYY-MM-DD,…)
    ONLY when the answer mentions 3+ dated events. Optional #itemId suffix per dot.
    Example: ![Key events](vault-timeline:Spec landed@2026-01-12,Demo@2026-03-15)

  • Comparison table — ![title](vault-table:col1|col2|col3||row1c1|row1c2|row1c3)
    ONLY when the answer compares 2+ entities across 2+ attributes. "||" between rows, "|" between cells. First row is headers. Up to 6 columns, 8 rows.
    Example: ![Tools compared](vault-table:Tool|Coverage|Best for||A|Full|Substrings||B|Indexed|Vector search)

  • Section outline — ![title](vault-outline:level-Text,~level-Text,…)
    ONLY when the answer drew from one big multi-section doc you want to map. Each entry "<level>-<text>", level 1-6. Prefix "~" for sections that were actually read.
    Example: ![Doc layout](vault-outline:1-Intro,2-Background,~2-Approach,~3-Method,2-Results)

Hard rules:
- At MOST 3 widgets. Most answers earn 0 or 1.
- One of each TYPE at most.
- If the answer is a conversational reply, a refusal, or already contains widget syntax (\`vault-chart:\`, \`vault-table:\`, \`vault-timeline:\`, \`vault-outline:\`, \`vault-graph:\`), output nothing.
- Output starts with \`![\` or is empty. No preamble, no closing remarks.`;

/** Detect whether the assistant's text already contains widget markdown.
 *  When true, the enrichment pass is skipped — the main agent already
 *  decided this answer warranted a widget and we'd just be duplicating. */
const WIDGET_ALREADY_PRESENT_RE = /!\[[^\]]*\]\(vault-(?:chart|table|timeline|outline|graph):/i;

/** Heuristic gate for whether an answer is worth enriching. Bias toward
 *  skipping: a "no" here just means the user sees the main answer with no
 *  appended widgets, which is the status quo. */
function shouldEnrichWithWidgets(answer: string): boolean {
  const trimmed = answer.trim();
  if (trimmed.length < 200) return false;             // too short to justify
  if (WIDGET_ALREADY_PRESENT_RE.test(trimmed)) return false; // already widgeted
  // At least one vault citation. Without any, the answer is general knowledge
  // and there's nothing widget-shaped to extract.
  if (!/\]\(vault:/i.test(trimmed)) return false;
  return true;
}

/**
 * Fire a slim follow-up call after the main answer finishes. The model
 * receives the question + answer and emits widget markdown which we
 * stream as additional synth-tokens into the SAME assistant message
 * (the UI just keeps appending). Non-blocking: failures, empties, and
 * trigger-misses all degrade silently — the user sees the main answer
 * exactly as before in those cases. Anti-loop: no tools, no recursion
 * possible (this function never re-enters itself).
 */
async function maybeEnrichWithWidgets(args: {
  model?: string;
  question: string;
  answer: string;
  turnId: string;
  onEvent: (e: ChatEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  if (!shouldEnrichWithWidgets(args.answer)) return;
  try {
    const stream = await openAgenticStream(
      {
        model: args.model,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `User question:\n${args.question}\n\nAssistant answer (already shown to user):\n${args.answer}`,
              },
            ],
          },
        ],
        // No tools — pure text completion. Anti-loop guarantee.
        systemInstruction: WIDGET_ENRICHMENT_PROMPT,
        temperature: 0.2,
        thinkingLevel: "MINIMAL",
      },
      args.signal,
    );
    // Inject a paragraph separator before the first enrichment token so
    // the widgets visually detach from the main answer in the rendered
    // markdown. Tracked by a closure so we only inject once.
    let separatorEmitted = false;
    const wrappedOnEvent: typeof args.onEvent = (e) => {
      if (e.kind === "synth-token") {
        if (!separatorEmitted) {
          separatorEmitted = true;
          args.onEvent({
            kind: "synth-token",
            turnId: args.turnId,
            token: "\n\n",
          });
        }
      } else if (e.kind === "reasoning") {
        // Drop enrichment's internal reasoning from the user-facing
        // activity stream — it's the same MINIMAL thinking line and
        // would just clutter the agent panel.
        return;
      }
      args.onEvent(e);
    };
    await consumeOneTurn(stream, args.turnId, wrappedOnEvent);
  } catch (err) {
    // Non-fatal: log and let the caller emit synth-done with whatever
    // the main answer already produced.
    console.warn("[orchestrator] widget enrichment failed:", err);
  }
}

/* --------------------------------------------------------- orchestrator */

export type RunChatTurnArgs = {
  sessionId: string;
  question: string;
  /** Optional prior assistant turn for follow-up context (compact, last 1-2). */
  recentHistory?: NativeContent[];
  model?: string;
  signal?: AbortSignal;
  onEvent: (event: ChatEvent) => void;
};

/**
 * Hard cap on per-question tool waves before we force a tool-less
 * synthesis turn. 60 gives genuinely agentic workflows (deep multi-
 * section research, cross-referencing concepts, region-finding in
 * multiple images, etc.) the room they need to converge naturally.
 * When the cap fires we coerce a final answer rather than erroring —
 * the user always gets a response.
 */
const MAX_TURNS = 60;

export async function runChatTurn(args: RunChatTurnArgs): Promise<void> {
  const turnId = `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  args.onEvent({ kind: "turn-start", turnId, question: args.question });

  let scratchpad = (await loadScratchpad(args.sessionId)) ?? emptyScratchpad(args.sessionId, args.question);
  if (!scratchpad.question) scratchpad = { ...scratchpad, question: args.question };

  // Build initial contents: prior history (if any) + the new user turn.
  const contents: NativeContent[] = [
    ...(args.recentHistory ?? []),
    { role: "user", parts: [{ text: args.question }] },
  ];

  // Per-turn dedupe: track every (tool, args) tuple the model has called
  // this turn. A repeat tells the model "you already ran this; pick a
  // different action" instead of silently letting it loop — which is
  // how a confused Gemini ends up calling read_section("X") 30 times.
  //
  // BUT: Gemini also routinely IGNORES our error and calls the same tool
  // again on the next loop iteration. So the polite-error path isn't
  // enough on its own. We also count cumulative duplicate hits and the
  // shape of each turn; if the model has clearly stopped making
  // progress, we hard-escape to a tool-less synthesis turn so the user
  // gets an answer.
  const callsSeen = new Map<string, number>();
  const MAX_REPEAT_PER_KEY = 1; // first call is free; the next is rejected
  /** Cumulative count of (tool, args) tuples we blocked this turn. */
  let totalDuplicates = 0;
  /** When this many cumulative duplicates fire, give up on the loop. */
  const DUPLICATE_HARD_LIMIT = 4;

  try {
    for (let step = 0; step < MAX_TURNS; step++) {
      if (args.signal?.aborted) throw new Error("Cancelled");

      const stream = await openAgenticStream({
        model: args.model,
        contents,
        tools: geminiToolsManifest(),
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.3,
        thinkingLevel: "MINIMAL",
      }, args.signal);

      const turn = await consumeOneTurn(stream, turnId, args.onEvent);

      // Persist the model's turn into contents so subsequent calls see it.
      if (turn.modelParts.length > 0) {
        contents.push({ role: "model", parts: turn.modelParts });
      }

      // If no function calls, the model finished. Run the widget
      // enrichment pass (non-blocking: degrades silently on miss) and
      // then emit the final text + done.
      if (turn.functionCalls.length === 0) {
        await maybeEnrichWithWidgets({
          model: args.model,
          question: args.question,
          answer: turn.textBuffer,
          turnId,
          onEvent: args.onEvent,
          signal: args.signal,
        });
        args.onEvent({ kind: "synth-done", turnId, finalText: turn.textBuffer });
        args.onEvent({ kind: "turn-done", turnId });
        return;
      }

      // Dispatch every function call from this turn in parallel, then feed
      // every response back in a single user-role turn — Gemini accepts
      // multiple `functionResponse` parts per content block.
      //
      // Each call goes through the dedupe gate first: if the same
      // (tool, args) tuple has already fired this turn, we short-circuit
      // with an `ok: false` result whose error tells the model exactly
      // what to do differently. This kills the read_section-on-loop
      // pathology before the LLM can spend any more budget on it.
      const responses: NativePart[] = [];
      let calledFreshThisTurn = 0;
      let duplicatesThisTurn = 0;
      for (const call of turn.functionCalls) {
        const callKey = `${call.name}:${stableArgsKey(call.args)}`;
        const seenCount = callsSeen.get(callKey) ?? 0;
        if (seenCount >= MAX_REPEAT_PER_KEY) {
          duplicatesThisTurn++;
          totalDuplicates++;
          // Tell the model AND emit an explicit tool-result event so the
          // user sees something happened. The result.ui is a tiny
          // search-results payload pointing at nothing so the card
          // renders cleanly.
          const stepId = `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
          const dupResult: ToolResult = {
            ok: false,
            error: `You already called ${call.name} with these exact arguments earlier this turn. Don't repeat the same call — either pick a DIFFERENT tool, use DIFFERENT arguments (e.g. a different itemId / different query / different folder), or write your final answer using what you have. Repeating the same call won't yield new information.`,
          };
          args.onEvent({
            kind: "tool-start",
            turnId,
            stepId,
            tool: call.name as ToolName,
            args: call.args,
          });
          args.onEvent({
            kind: "tool-result",
            turnId,
            stepId,
            tool: call.name as ToolName,
            result: dupResult,
          });
          responses.push({
            functionResponse: {
              name: call.name,
              response: toolResultForModel(dupResult),
            },
          });
          continue;
        }
        callsSeen.set(callKey, seenCount + 1);
        calledFreshThisTurn++;

        const result = await dispatchTool(call.name, call.args, turnId, args.onEvent, args.signal);
        scratchpad = await applyToolToScratchpad(scratchpad, call.name as ToolName, call.args, result, turnId);
        responses.push({
          functionResponse: {
            name: call.name,
            response: toolResultForModel(result),
          },
        });
      }
      contents.push({ role: "function", parts: responses });

      args.onEvent({
        kind: "scratchpad",
        turnId,
        candidates: shortlistTopK(scratchpad.candidates, 12),
      });
      args.onEvent({
        kind: "shortlist",
        turnId,
        shortlist: shortlistTopK(scratchpad.candidates, 6),
      });
      await saveScratchpad(scratchpad);

      // Hard escape: the model is stuck repeating itself.
      //   • totalDuplicates >= DUPLICATE_HARD_LIMIT — across the whole
      //     turn, four polite "you already did this" nudges weren't
      //     enough.
      //   • duplicatesThisTurn > 0 AND calledFreshThisTurn === 0 — this
      //     turn was 100% duplicates; the model has nothing new to add.
      // In either case, exit the tool loop early and force the tool-less
      // synthesis path below.
      const stuck =
        totalDuplicates >= DUPLICATE_HARD_LIMIT ||
        (duplicatesThisTurn > 0 && calledFreshThisTurn === 0);
      if (stuck) break;
    }

    // Tool budget exhausted. Don't show the user an error — coerce a
    // tool-less synthesis turn so the model writes an answer from
    // whatever it gathered. Omitting `tools` from the request leaves
    // it with only text output as a valid response.
    contents.push({
      role: "user",
      parts: [
        {
          text: `You've reached the tool budget for this question. Don't call any more tools. Write your final answer to the user now using ONLY the information already gathered in this turn. If you couldn't find a confident answer, say so clearly and cite what you did find.`,
        },
      ],
    });
    const finalStream = await openAgenticStream(
      {
        model: args.model,
        contents,
        // No `tools` → model can only emit text. No more function calls
        // possible from this point.
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.3,
        thinkingLevel: "MINIMAL",
      },
      args.signal,
    );
    const finalTurn = await consumeOneTurn(finalStream, turnId, args.onEvent);
    // Same enrichment opportunity on the hard-escape path — if the
    // forced final answer is substantive, the user benefits from
    // widgets the same way the normal-completion path does.
    await maybeEnrichWithWidgets({
      model: args.model,
      question: args.question,
      answer: finalTurn.textBuffer,
      turnId,
      onEvent: args.onEvent,
      signal: args.signal,
    });
    args.onEvent({
      kind: "synth-done",
      turnId,
      finalText: finalTurn.textBuffer,
    });
    args.onEvent({ kind: "turn-done", turnId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    args.onEvent({ kind: "turn-error", turnId, error: message });
    args.onEvent({ kind: "turn-done", turnId });
  }
}

/* ----------------------------------------------------------- transport */

async function openAgenticStream(
  payload: AgenticRequest,
  signal?: AbortSignal,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const res = await fetch("/v1/chat/agentic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok || !res.body) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`Agentic stream failed (${res.status}): ${detail}`);
  }
  return res.body.getReader();
}

/* ---------------------------------------------------- SSE consumption */

type ConsumedTurn = {
  modelParts: NativePart[];
  functionCalls: Array<{ name: string; args: unknown }>;
  textBuffer: string;
};

async function consumeOneTurn(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  turnId: string,
  onEvent: (e: ChatEvent) => void,
): Promise<ConsumedTurn> {
  const decoder = new TextDecoder();
  let buf = "";
  const modelParts: NativePart[] = [];
  const functionCalls: Array<{ name: string; args: unknown }> = [];
  // Gemini streamGenerateContent ships its response across multiple SSE
  // chunks. For text the chunks are incremental token deltas — what we
  // want. For function calls, the SAME functionCall part can appear in
  // several chunks as the model "settles" on its decision. If we treat
  // each chunk's part as a new call we end up dispatching the same tool
  // 20-30 times in microseconds inside the for-loop below — which looks
  // identical to a runaway agent loop but is actually a parser bug.
  // Dedupe by (name, stable-args-key) so a model decision counts once
  // no matter how many chunks carried it.
  const seenFunctionCallKeys = new Set<string>();
  let textBuffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let nl: number;
    while ((nl = buf.indexOf("\n\n")) >= 0) {
      const rawEvent = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const dataLines = rawEvent
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) continue;
      const data = dataLines.join("");
      if (data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data) as {
          candidates?: Array<{ content?: { parts?: NativePart[] }; finishReason?: string }>;
        };
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          modelParts.push(part);
          if (isTextPart(part)) {
            const text = String(part.text);
            const isThought = (part as { thought?: boolean }).thought === true;
            if (isThought) {
              onEvent({ kind: "reasoning", turnId, text });
            } else {
              textBuffer += text;
              onEvent({ kind: "synth-token", turnId, token: text });
            }
          } else if (isFunctionCallPart(part)) {
            const call = part.functionCall as { name: string; args?: unknown };
            const args = call.args ?? {};
            const key = `${call.name}:${stableArgsKey(args)}`;
            if (seenFunctionCallKeys.has(key)) continue;
            seenFunctionCallKeys.add(key);
            functionCalls.push({ name: call.name, args });
          }
        }
      } catch (err) {
        console.warn("[agentic] dropped malformed SSE chunk:", err);
      }
    }
  }
  return { modelParts, functionCalls, textBuffer };
}

function isTextPart(part: NativePart): part is { text: string; thought?: boolean } {
  return typeof (part as { text?: unknown }).text === "string";
}
function isFunctionCallPart(part: NativePart): part is { functionCall: { name: string; args?: unknown } } {
  return typeof (part as { functionCall?: unknown }).functionCall === "object";
}

/* ----------------------------------------------------- tool dispatch */

async function dispatchTool(
  name: string,
  args: unknown,
  turnId: string,
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const tool = findTool(name);
  const stepId = `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
  onEvent({ kind: "tool-start", turnId, stepId, tool: (tool?.name ?? "search_keyword") as ToolName, args });
  if (!tool) {
    const error = `Unknown tool: ${name}`;
    const result: ToolResult = { ok: false, error };
    onEvent({ kind: "tool-result", turnId, stepId, tool: "search_keyword", result });
    return result;
  }
  try {
    const result = await tool.handler(args, signal);
    onEvent({ kind: "tool-result", turnId, stepId, tool: tool.name, result });
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const result: ToolResult = { ok: false, error };
    onEvent({ kind: "tool-result", turnId, stepId, tool: tool.name, result });
    return result;
  }
}

/** Strip the UI payload before sending the tool result back to the LLM. */
function toolResultForModel(result: ToolResult): unknown {
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    summary: result.summary,
    // Substantive body (full markdown for read-tools). Without this, the
    // model "studies" a section but only sees the indexer's high-level
    // metadata summary — so specific stats / quotes / numbers in the body
    // are invisible and the model says "the notes don't provide that".
    ...(result.body ? { body: result.body } : {}),
    refs: result.refs.map((r) => ({
      itemId: r.itemId,
      title: r.title,
      type: r.type,
      folder: r.folder,
      snippet: r.snippet,
    })),
  };
}

/* ----------------------------------------------- scratchpad apply */

async function applyToolToScratchpad(
  sp: Scratchpad,
  toolName: ToolName,
  args: unknown,
  result: ToolResult,
  turnId: string,
): Promise<Scratchpad> {
  const startedAt = Date.now();
  const next = result.ok
    ? {
        ...sp,
        candidates: mergeCandidates(sp.candidates, result.refs.map((r) => ({
          itemId: r.itemId,
          title: r.title,
          type: r.type,
          folder: r.folder,
          snippet: r.snippet,
          score: r.score,
        })), toolName),
      }
    : sp;
  const shortlist = shortlistTopK(next.candidates, 6) as Candidate[];
  return withHistoryEntry(
    {
      ...next,
      shortlist: shortlist.map((c) => c.itemId),
    },
    {
      turnId,
      stepId: `${toolName}-${startedAt}`,
      tool: toolName,
      args,
      summary: result.ok ? result.summary : `error: ${result.error}`,
      refCount: result.ok ? result.refs.length : 0,
      startedAt,
      endedAt: Date.now(),
    },
  );
}

/**
 * Stable JSON key for a tool-call's args. Used by the per-turn dedupe
 * gate to detect repeats.
 *
 * - Object keys sorted recursively so {a:1,b:2} === {b:2,a:1}
 * - Strings normalised: trimmed + lowercased so " Hi " and "hi" collide
 *   (the model often re-tries the same query with cosmetic differences)
 * - Arrays compared in order (not sorted) — order is meaningful for them
 *   (limits, kinds, etc.)
 */
function stableArgsKey(args: unknown): string {
  function norm(v: unknown): unknown {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") return v.trim().toLowerCase();
    if (typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(norm);
    const o = v as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) sorted[k] = norm(o[k]);
    return sorted;
  }
  try {
    return JSON.stringify(norm(args));
  } catch {
    return String(args);
  }
}
