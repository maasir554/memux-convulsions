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

type NativePart = Record<string, unknown>;
type NativeContent = {
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
- Cast a wide net early: run search_semantic AND search_keyword in parallel waves when the question is rich. Use search_keyword for proper nouns / exact phrases, search_semantic for conceptual paraphrases.
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

Rules:
- NEVER fabricate an itemId. Only cite IDs you have literally seen in a refs[] array from a tool result this turn.
- Prefer text citations sprinkled inline through the prose, not bunched at the end. One per claim is plenty.
- Use image embeds sparingly — only when an actual image item answers the question visually. Don't embed images just to fill space.
- If your answer doesn't rely on the vault (e.g. clarifying a general concept), no citations needed.
- Never put a vault-image: URL inside a [..]() link — that's always wrong. Inline images use ![..](), text links use [..](). The reverse — vault: URLs inside ![]() — is also wrong, but less harmful.`;

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

const MAX_TURNS = 12;

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

      // If no function calls, the model finished. Emit the final text + done.
      if (turn.functionCalls.length === 0) {
        args.onEvent({ kind: "synth-done", turnId, finalText: turn.textBuffer });
        args.onEvent({ kind: "turn-done", turnId });
        return;
      }

      // Dispatch every function call from this turn in parallel, then feed
      // every response back in a single user-role turn — Gemini accepts
      // multiple `functionResponse` parts per content block.
      const responses: NativePart[] = [];
      for (const call of turn.functionCalls) {
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
    }

    // Tool budget exhausted.
    args.onEvent({
      kind: "turn-error",
      turnId,
      error: `Tool budget exhausted after ${MAX_TURNS} turns`,
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
            functionCalls.push({ name: call.name, args: call.args ?? {} });
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
