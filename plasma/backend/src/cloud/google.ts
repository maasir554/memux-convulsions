import type {
  ChatMessage,
  ChatRequest,
  ModelInfo,
  Provider,
} from "../providers/types.js";
import {
  KeyRotator,
  RetryWithNextKey,
  loadGoogleKeys,
  maskKey,
  runWithRotation,
} from "./keys.js";

/**
 * Native Google Gemini API client (not the OpenAI-compat layer).
 *
 * Why native? Gemma 4 always thinks, and Google's OpenAI-compat layer
 * 1) rejects any `reasoning_effort` / thinking-budget knob, and
 * 2) folds the model's thoughts into `delta.content`, so the chat UI shows
 *    raw reasoning preamble glued onto the final answer.
 *
 * The native API exposes `generationConfig.thinkingConfig.includeThoughts`
 * and labels reasoning chunks with `part.thought: true`. We translate:
 *
 *   OpenAI request  →  native `:streamGenerateContent`
 *   native SSE part →  OpenAI `delta.content` / `delta.reasoning_content`
 *
 * so the frontend's existing parser sees the familiar OpenAI shape and routes
 * thought chunks into the Thinking panel.
 *
 * Auth: round-robin keys from KeyRotator. Failover on 401/403/429/5xx.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

const MODELS: ModelInfo[] = [
  {
    id: "gemma-4-31b-it",
    context_size: 262_144,
    reasoning: true,
    vision: true,
  },
  {
    id: "gemma-4-26b-a4b-it",
    context_size: 262_144,
    reasoning: true,
    vision: true,
  },
];

const RETRYABLE_STATUSES = new Set([401, 403, 429, 500, 502, 503, 504]);

/* ---------------- native request shapes --------------------------------- */

type NativePart =
  | { text: string; thought?: boolean }
  | { inlineData: { mimeType: string; data: string } };

type NativeContent = {
  role: "user" | "model";
  parts: NativePart[];
};

function partsFromOpenAIContent(content: ChatMessage["content"]): NativePart[] {
  if (typeof content === "string") {
    return content ? [{ text: content }] : [];
  }
  const out: NativePart[] = [];
  for (const p of content) {
    if (p.type === "text") {
      if (p.text) out.push({ text: p.text });
      continue;
    }
    if (p.type === "image_url") {
      const url = p.image_url.url;
      const m = /^data:([^;]+);base64,(.+)$/.exec(url);
      if (!m) {
        throw new Error(
          "Native Gemini requires base64 data: URLs for images, not remote URLs.",
        );
      }
      out.push({ inlineData: { mimeType: m[1]!, data: m[2]! } });
    }
  }
  return out;
}

function textFromOpenAIContent(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("\n");
}

function translateMessages(messages: ChatMessage[]): {
  systemInstruction?: { parts: { text: string }[] };
  contents: NativeContent[];
} {
  const systemTexts: string[] = [];
  const contents: NativeContent[] = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "tool") {
      const t = textFromOpenAIContent(m.content);
      if (t) systemTexts.push(t);
      continue;
    }
    const role = m.role === "assistant" ? "model" : "user";
    const parts = partsFromOpenAIContent(m.content);
    if (parts.length === 0) continue;
    contents.push({ role, parts });
  }
  return {
    systemInstruction: systemTexts.length
      ? { parts: [{ text: systemTexts.join("\n\n") }] }
      : undefined,
    contents,
  };
}

function buildBody(req: ChatRequest) {
  const { systemInstruction, contents } = translateMessages(req.messages);
  const generationConfig: Record<string, unknown> = {};
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
  if (req.top_p !== undefined) generationConfig.topP = req.top_p;
  if (req.max_tokens !== undefined) generationConfig.maxOutputTokens = req.max_tokens;

  // Gemma 4 thinking control via the native API. `thinkingBudget` is
  // rejected for Gemma 4 specifically ("Thinking budget is not supported
  // for this model"); the working knob is `thinkingLevel`:
  //   "MINIMAL"  → effectively disable thinking, jump straight to the answer
  //   (default) → auto / model decides how much to think
  //   plus `includeThoughts` controls whether thought parts stream back
  if (req.think === false) {
    generationConfig.thinkingConfig = { thinkingLevel: "MINIMAL" };
  } else if (req.think === true) {
    generationConfig.thinkingConfig = { includeThoughts: true };
  }

  const body: Record<string, unknown> = { contents, generationConfig };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  return body;
}

/* ---------------- transport helpers ------------------------------------- */

async function postNative(
  apiKey: string,
  model: string,
  action: "streamGenerateContent" | "generateContent",
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  const path = action === "streamGenerateContent"
    ? `${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
    : `${BASE}/models/${encodeURIComponent(model)}:generateContent`;
  return fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal,
  });
}

async function ensureOkOrRetry(res: Response, key: string, op: string): Promise<void> {
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  const status = res.status;
  console.error(
    `[google] ${op} status=${status} key=${maskKey(key)} body=${text.slice(0, 500)}`,
  );
  if (RETRYABLE_STATUSES.has(status)) {
    throw new RetryWithNextKey(new Error(`Google ${status}: ${text || res.statusText}`));
  }
  throw new Error(`Google ${status}: ${text || res.statusText}`);
}

/* ---------------- native → OpenAI SSE translation ----------------------- */

type NativeStreamChunk = {
  candidates?: Array<{
    content?: { parts?: NativePart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

function partsToOpenAIDelta(parts: NativePart[]): {
  content: string;
  reasoning: string;
} {
  let content = "";
  let reasoning = "";
  for (const p of parts) {
    if ("text" in p && typeof p.text === "string") {
      if (p.thought) reasoning += p.text;
      else content += p.text;
    }
  }
  return { content, reasoning };
}

function nativeChunkToSSE(rawChunk: string): string | null {
  let payload = "";
  for (const line of rawChunk.split("\n")) {
    if (line.startsWith("data:")) {
      payload += line.slice(5).trim();
    }
  }
  if (!payload) return null;
  let native: NativeStreamChunk;
  try {
    native = JSON.parse(payload);
  } catch {
    return null;
  }
  const parts = native.candidates?.[0]?.content?.parts ?? [];
  const { content, reasoning } = partsToOpenAIDelta(parts);
  const delta: Record<string, string> = {};
  if (content) delta.content = content;
  if (reasoning) delta.reasoning_content = reasoning;
  if (!delta.content && !delta.reasoning_content) return null;
  const openaiChunk = {
    choices: [{ index: 0, delta }],
    ...(native.usageMetadata
      ? {
          usage: {
            prompt_tokens: native.usageMetadata.promptTokenCount,
            completion_tokens: native.usageMetadata.candidatesTokenCount,
            total_tokens: native.usageMetadata.totalTokenCount,
          },
        }
      : {}),
  };
  return `data: ${JSON.stringify(openaiChunk)}\n\n`;
}

/* ---------------- provider ---------------------------------------------- */

export function google(): Provider & { keyCount(): number } {
  const rotator = new KeyRotator(loadGoogleKeys());

  return {
    id: "google-ai-studio",
    keyCount: () => rotator.size(),

    async *streamChat(req, signal) {
      const body = buildBody(req);
      const res = await runWithRotation(rotator, async (key) => {
        const r = await postNative(key, req.model, "streamGenerateContent", body, signal);
        await ensureOkOrRetry(r, key, "stream");
        return r;
      });
      if (!res.body) throw new Error("Google returned no body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        // Google sends `\r\n\r\n` between SSE events. Normalise so the
        // single `\n\n` boundary check below works for both flavours.
        buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const sse = nativeChunkToSSE(chunk);
          if (sse) yield sse;
        }
      }
      // Flush trailing chunk (some servers don't end with blank line).
      if (buf.trim()) {
        const sse = nativeChunkToSSE(buf);
        if (sse) yield sse;
      }
      // OpenAI sentinel — the frontend parser uses it to mark completion.
      yield "data: [DONE]\n\n";
    },

    async chat(req, signal) {
      const body = buildBody(req);
      const res = await runWithRotation(rotator, async (key) => {
        const r = await postNative(key, req.model, "generateContent", body, signal);
        await ensureOkOrRetry(r, key, "chat");
        return r;
      });
      const native = (await res.json()) as NativeStreamChunk;
      const parts = native.candidates?.[0]?.content?.parts ?? [];
      const { content, reasoning } = partsToOpenAIDelta(parts);
      return {
        choices: [
          {
            index: 0,
            message: {
              role: "assistant" as const,
              content,
              ...(reasoning ? { reasoning_content: reasoning } : {}),
            },
            finish_reason: native.candidates?.[0]?.finishReason ?? "stop",
          },
        ],
        usage: native.usageMetadata
          ? {
              prompt_tokens: native.usageMetadata.promptTokenCount,
              completion_tokens: native.usageMetadata.candidatesTokenCount,
              total_tokens: native.usageMetadata.totalTokenCount,
            }
          : undefined,
      };
    },

    async listModels(): Promise<ModelInfo[]> {
      return MODELS;
    },

    async health() {
      return {
        ok: rotator.size() > 0,
        detail: { provider: "google-ai-studio", keys: rotator.size() },
      };
    },
  };
}
