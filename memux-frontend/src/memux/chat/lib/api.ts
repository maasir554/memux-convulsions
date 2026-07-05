import type { ChatMessage } from "./store";
import { useClient } from "./clientSettings";
import { makeSmoother } from "./smoother";

export type ModelInfo = {
  id: string;
  context_size?: number;
  reasoning?: boolean;
  vision?: boolean;
};

/**
 * Read-only snapshot of the backend's configuration. The Cloud backend's
 * provider and credentials are env-driven on the server; the client only
 * gets `ready` (boolean) — we deliberately don't expose key counts or
 * other infrastructure details to the browser.
 */
export type BackendInfo = {
  provider: string;
  ready: boolean;
  configurable: false;
};

/* ---------------- endpoint resolution ----------------------------------- */

type Endpoints = {
  chatUrl: string;
  modelsUrl: string;
  healthUrl: string;
  headers: Record<string, string>;
  /**
   * When true, the frontend is speaking OpenAI dialect straight to a local
   * provider — Plasma-level extensions like `think` must be translated
   * here on the client instead of being sent to a backend translator.
   */
  direct: boolean;
};

function getEndpoints(): Endpoints {
  const s = useClient.getState();
  if (s.mode === "direct") {
    const base = s.directBaseUrl.replace(/\/+$/, "");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (s.directApiKey) headers.Authorization = `Bearer ${s.directApiKey}`;
    return {
      chatUrl: `${base}/chat/completions`,
      modelsUrl: `${base}/models`,
      healthUrl: `${base}/health`,
      headers,
      direct: true,
    };
  }
  return {
    chatUrl: "/v1/chat/completions",
    modelsUrl: "/v1/models",
    healthUrl: "/api/health",
    headers: { "Content-Type": "application/json" },
    direct: false,
  };
}

/* ---------------- backend info (only meaningful in cloud mode) ---------- */

export async function getBackendInfo(): Promise<BackendInfo> {
  const r = await fetch("/api/settings");
  if (!r.ok) {
    throw new Error(`Backend unreachable: HTTP ${r.status}`);
  }
  return r.json();
}

/* ---------------- model metadata derivation ----------------------------- */

type RawModel = {
  id?: unknown;
  context_size?: unknown;
  reasoning?: unknown;
  vision?: unknown;
  labels?: unknown;
  tags?: unknown;
};

/**
 * Normalise a Lemonade model payload into a ModelInfo. Mirrors the same
 * heuristics the backend uses (vision/reasoning from labels/tags/id pattern).
 */
function deriveModelInfo(m: RawModel): ModelInfo {
  const labelsRaw = [
    ...(Array.isArray(m.labels) ? m.labels : []),
    ...(Array.isArray(m.tags) ? m.tags : []),
  ];
  const labels = labelsRaw.map((s) => String(s).toLowerCase());
  const id = String(m.id ?? "");
  const vision =
    typeof m.vision === "boolean"
      ? m.vision
      : labels.includes("vision") || /-vl-|vision|llava/i.test(id);
  return {
    id,
    context_size:
      typeof m.context_size === "number" ? m.context_size : undefined,
    reasoning:
      typeof m.reasoning === "boolean" ? m.reasoning : undefined,
    vision,
  };
}

/* ---------------- public API -------------------------------------------- */

export async function listModels(): Promise<ModelInfo[]> {
  const ep = getEndpoints();
  try {
    const r = await fetch(ep.modelsUrl, { headers: ep.headers });
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: RawModel[] };
    return (j.data ?? []).map(deriveModelInfo);
  } catch {
    return [];
  }
}

export async function getHealth(): Promise<{ ok: boolean; provider: string }> {
  const ep = getEndpoints();
  try {
    const r = await fetch(ep.healthUrl, { headers: ep.headers });
    if (ep.direct) return { ok: r.ok, provider: "lemonade" };
    const j = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      provider?: string;
    };
    return { ok: !!j.ok, provider: j.provider ?? "?" };
  } catch {
    return { ok: false, provider: ep.direct ? "lemonade" : "?" };
  }
}

/* ---------------- wire-format helpers ----------------------------------- */

type WireContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function toWireMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    const parts = m.parts;
    const hasImages = parts.some((p) => p.type === "image");
    if (!hasImages) {
      const text = parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { type: "text"; text: string }).text)
        .join("\n");
      return { role: m.role, content: text };
    }
    const content: WireContent[] = parts.map((p) =>
      p.type === "text"
        ? { type: "text" as const, text: p.text }
        : { type: "image_url" as const, image_url: { url: p.url } },
    );
    return { role: m.role, content };
  });
}

function buildChatBody(
  args: { model: string; messages: ChatMessage[]; think?: boolean; temperature?: number },
  stream: boolean,
  ep: Endpoints,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: args.model,
    messages: toWireMessages(args.messages),
    stream,
  };
  if (args.temperature !== undefined) body.temperature = args.temperature;
  if (args.think !== undefined) {
    if (ep.direct) {
      // Speak provider-native: Qwen3 / DeepSeek-R1 honour this template kwarg.
      body.chat_template_kwargs = { enable_thinking: args.think };
    } else {
      // Backend will translate based on configured provider.
      body.think = args.think;
    }
  }
  return body;
}

/* ---------------- streaming chat ---------------------------------------- */

export type StreamChatArgs = {
  model: string;
  messages: ChatMessage[];
  think?: boolean;
  temperature?: number;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
  onDone: (usage?: { prompt_tokens?: number; completion_tokens?: number }) => void;
  onError: (err: unknown) => void;
};

export async function streamChat(args: StreamChatArgs) {
  const ep = getEndpoints();
  // Bursty SSE chunks → steady typewriter cadence in the UI. Everything we
  // would have passed to args.onDelta now goes through `smoother.push`, and
  // the smoother drains at ~60 chars/sec (with catch-up if it falls behind).
  const smoother = makeSmoother(args.onDelta);
  try {
    const res = await fetch(ep.chatUrl, {
      method: "POST",
      headers: ep.headers,
      body: JSON.stringify(buildChatBody(args, true, ep)),
      signal: args.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      smoother.abort();
      args.onError(
        new Error(`${ep.direct ? "Lemonade" : "backend"} ${res.status}: ${text}`),
      );
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    let deltaCount = 0;
    let sawDoneMarker = false;
    /**
     * Lemonade / DeepSeek-R1 / Qwen3 stream reasoning in a sibling field
     * (`reasoning_content` or `reasoning`) instead of putting `<think>` tags
     * inside `content`. Splice into the message stream as a synthetic
     * `<think>…</think>` block so the existing `splitThinking` parser picks
     * it up.
     */
    let inReasoning = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            sawDoneMarker = true;
            continue;
          }
          if (!payload) continue;
          try {
            const j = JSON.parse(payload);
            if (j?.error) {
              const msg =
                typeof j.error === "string"
                  ? j.error
                  : j.error?.message ?? JSON.stringify(j.error);
              smoother.abort();
              args.onError(new Error(msg));
              return;
            }
            const choice = j?.choices?.[0];
            const reasoningDelta: string =
              choice?.delta?.reasoning_content ??
              choice?.delta?.reasoning ??
              "";
            const contentDelta: string = choice?.delta?.content ?? "";
            if (reasoningDelta) {
              if (!inReasoning) {
                smoother.push("<think>");
                inReasoning = true;
              }
              smoother.push(reasoningDelta);
              deltaCount += 1;
            }
            if (contentDelta) {
              if (inReasoning) {
                smoother.push("</think>\n\n");
                inReasoning = false;
              }
              smoother.push(contentDelta);
              deltaCount += 1;
            }
            if (j?.usage) usage = j.usage;
          } catch {
            // non-JSON keepalive — ignore
          }
        }
      }
    }
    if (inReasoning) smoother.push("</think>");
    if (deltaCount === 0) {
      smoother.abort();
      args.onError(
        new Error(
          sawDoneMarker
            ? "Model returned no content (empty response)."
            : "Stream closed without any content or [DONE] marker.",
        ),
      );
      return;
    }
    // Wait for the smoothing queue to fully drain before signalling done,
    // so the assistant bubble doesn't snap "complete" while text is still
    // being typed out.
    await smoother.end();
    args.onDone(usage);
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      // User hit Stop — discard whatever was queued.
      smoother.abort();
      return;
    }
    smoother.abort();
    args.onError(err);
  }
}

export async function chatOnce(
  messages: ChatMessage[],
  model: string,
): Promise<string> {
  const ep = getEndpoints();
  const res = await fetch(ep.chatUrl, {
    method: "POST",
    headers: ep.headers,
    body: JSON.stringify(buildChatBody({ model, messages }, false, ep)),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = j?.error?.message ?? j?.error ?? `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  const content = j?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("Empty response from model");
  }
  return content;
}
