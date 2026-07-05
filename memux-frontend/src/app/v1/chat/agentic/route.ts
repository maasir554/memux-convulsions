import "server-only";

import { loadGoogleKeys, KeyRotator, RetryWithNextKey, runWithRotation, maskKey } from "@/lib/memux/backend/keys";

/**
 * Native Gemini function-calling proxy for the agentic chat.
 *
 * Why a separate route from /v1/chat/completions:
 *   • The OpenAI-compat shape strips functionCall / functionResponse
 *     details we need round-tripped verbatim. Here we keep the native
 *     Gemini envelope end-to-end so the browser-side harness sees every
 *     functionCall part the model emits and can replay tool responses
 *     in the next turn unchanged.
 *
 * Browser → server payload:
 *   {
 *     model: string,
 *     contents: NativeContent[],          // full turn history incl. function-call / response parts
 *     tools?: GeminiToolsManifest,        // optional but the whole point of this route
 *     systemInstruction?: string,
 *     temperature?, topP?, maxOutputTokens?,
 *     thinkingLevel?: "MINIMAL" | "STANDARD" | "HIGH",
 *   }
 *
 * Server → browser SSE: a stream of `data: <native chunk JSON>\n\n`.
 * No re-shaping; the harness parses native chunks directly.
 *
 * Key rotation matches /v1/chat/completions: round-robin, failover on
 * 401/403/429/5xx. Failed key + status is logged to stderr.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const RETRYABLE_STATUSES = new Set([401, 403, 429, 500, 502, 503, 504]);
const DEFAULT_MODEL = "gemma-4-31b-it";

let rotatorPromise: Promise<KeyRotator> | null = null;
function getRotator(): Promise<KeyRotator> {
  if (!rotatorPromise) {
    rotatorPromise = (async () => {
      const keys = await loadGoogleKeys();
      if (keys.length === 0) {
        throw new Error("No GOOGLE_AI_* keys configured");
      }
      return new KeyRotator(keys);
    })();
  }
  return rotatorPromise;
}

type AgenticBody = {
  model?: string;
  contents: Array<{
    role: "user" | "model" | "function";
    parts: Array<Record<string, unknown>>;
  }>;
  tools?: { functionDeclarations: Array<{ name: string; description: string; parameters: Record<string, unknown> }> };
  systemInstruction?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  thinkingLevel?: "MINIMAL" | "STANDARD" | "HIGH";
};

export async function POST(req: Request): Promise<Response> {
  let body: AgenticBody;
  try {
    body = (await req.json()) as AgenticBody;
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  if (!Array.isArray(body.contents) || body.contents.length === 0) {
    return jsonError(400, "contents[] is required");
  }

  const model = body.model || DEFAULT_MODEL;
  const generationConfig: Record<string, unknown> = {};
  if (body.temperature !== undefined) generationConfig.temperature = body.temperature;
  if (body.topP !== undefined) generationConfig.topP = body.topP;
  if (body.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = body.maxOutputTokens;
  if (body.thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: body.thinkingLevel };

  const nativeBody: Record<string, unknown> = {
    contents: body.contents,
    generationConfig,
  };
  if (body.tools) nativeBody.tools = [body.tools];
  if (body.systemInstruction) {
    nativeBody.systemInstruction = { parts: [{ text: body.systemInstruction }] };
  }

  let rotator: KeyRotator;
  try {
    rotator = await getRotator();
  } catch (err) {
    return jsonError(500, err instanceof Error ? err.message : String(err));
  }

  // Open the upstream once via runWithRotation; if the first response
  // status is retryable we throw RetryWithNextKey and try the next key.
  try {
    const upstream = await runWithRotation(rotator, async (key) => {
      const path = `${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
      const res = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify(nativeBody),
        signal: req.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(
          `[agentic] status=${res.status} key=${maskKey(key)} body=${text.slice(0, 500)}`,
        );
        if (RETRYABLE_STATUSES.has(res.status)) {
          throw new RetryWithNextKey(new Error(`Google ${res.status}: ${text || res.statusText}`));
        }
        throw new Error(`Google ${res.status}: ${text || res.statusText}`);
      }
      return res;
    });

    // Pipe the upstream SSE straight through to the browser.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agentic] failed:", message);
    return jsonError(502, message);
  }
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
