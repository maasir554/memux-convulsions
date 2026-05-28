import type { ChatRequest, ModelInfo, Provider } from "./types.js";

type LemonadeOptions = {
  baseUrl: string;
  apiKey?: string;
};

/**
 * AMD Lemonade adapter. Lemonade exposes OpenAI-compatible endpoints on
 * `${baseUrl}` (default http://localhost:13305/v1), plus Lemonade-specific
 * routes for model lifecycle and health.
 *
 * Think-mode translation: Lemonade has no documented top-level `thinking`
 * flag. Models that follow the Qwen template accept
 * `chat_template_kwargs.enable_thinking`. We pass that through whenever the
 * caller sets `think`; harmless for models that ignore it.
 */
export function lemonade(opts: LemonadeOptions): Provider {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  function buildBody(req: ChatRequest, stream: boolean) {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.max_tokens !== undefined) body.max_tokens = req.max_tokens;
    if (req.think !== undefined) {
      body.chat_template_kwargs = { enable_thinking: req.think };
    }
    return body;
  }

  return {
    id: "lemonade",

    async *streamChat(req, signal) {
      const body = buildBody(req, true);
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        console.error(
          `[lemonade] stream ${res.status} model=${req.model} ` +
            `messages=${req.messages.length} body=${text.slice(0, 500)}`,
        );
        throw new Error(`Lemonade ${res.status}: ${text || res.statusText}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (chunk) yield chunk + "\n\n";
        }
      }
      if (buf.trim()) yield buf + "\n\n";
    },

    async chat(req, signal) {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(buildBody(req, false)),
        signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(
          `[lemonade] chat ${res.status} model=${req.model} ` +
            `body=${text.slice(0, 500)}`,
        );
        throw new Error(`Lemonade ${res.status}: ${text || res.statusText}`);
      }
      return res.json();
    },

    async listModels(): Promise<ModelInfo[]> {
      const res = await fetch(`${base}/models`, { headers });
      if (!res.ok) throw new Error(`Lemonade /models ${res.status}`);
      const json = (await res.json()) as {
        data?: Array<{
          id: string;
          context_size?: number;
          reasoning?: boolean;
          vision?: boolean;
          labels?: string[];
          tags?: string[];
          [k: string]: unknown;
        }>;
      };
      return (json.data ?? []).map((m) => {
        const labels = [
          ...(Array.isArray(m.labels) ? m.labels : []),
          ...(Array.isArray(m.tags) ? m.tags : []),
        ].map((s) => String(s).toLowerCase());
        const vision =
          typeof m.vision === "boolean"
            ? m.vision
            : labels.includes("vision") || /-vl-|vision|llava/i.test(m.id);
        return {
          id: m.id,
          context_size:
            typeof m.context_size === "number" ? m.context_size : undefined,
          reasoning:
            typeof m.reasoning === "boolean" ? m.reasoning : undefined,
          vision,
          meta: m,
        };
      });
    },

    async health() {
      try {
        const res = await fetch(`${base}/health`, { headers });
        const detail = await res.json().catch(() => undefined);
        return { ok: res.ok, detail };
      } catch (err) {
        return { ok: false, detail: String(err) };
      }
    },
  };
}
