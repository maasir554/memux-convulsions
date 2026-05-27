import "server-only";

import { getCloudProvider } from "@/lib/memux/backend/registry";
import type { ChatContentPart, ChatMessage } from "@/lib/memux/backend/types";

/**
 * Thin LLM harness used by the orchestrator and every sub-agent.
 *
 * Why this layer (and not just calling provider.chat directly):
 *  - JSON-only mode with markdown-fence stripping and parse-retry. Gemma 4 31B
 *    follows "respond with JSON only" the vast majority of the time but
 *    occasionally wraps the body in ```json … ``` or appends a sentence; one
 *    place to handle it.
 *  - One signature for text and vision so agents don't branch on input shape.
 *  - System prompt scaffolding so every agent inherits the same JSON discipline.
 */

const DEFAULT_MODEL = "gemma-4-31b-it";
const DEFAULT_TEMP = 0.3;
const MAX_PARSE_RETRIES = 2;

const JSON_DISCIPLINE = `You must respond with a single valid JSON value and nothing else.
- No prose before or after.
- No markdown fences (no \`\`\`json wrapper).
- All keys and string values double-quoted.
- No trailing commas.
If the requested schema is given, every required field must appear.`;

export type AgentCallParams = {
  /** Free-form user prompt. */
  prompt: string;
  /** Optional image bytes (raw base64, no data: prefix). */
  image?: { base64: string; mimeType: string };
  /** System instruction prepended to JSON discipline. */
  system?: string;
  /**
   * Human-readable schema sketch dropped into the prompt — Gemma 4 doesn't
   * accept native response-schema; we describe the shape in text.
   * Example: "{ topic: string, transition: 'continue' | 'end' | 'new', diagrams: {bbox: [x,y,w,h], caption: string}[] }"
   */
  schema?: string;
  temperature?: number;
  maxTokens?: number;
  /** Whether to allow Gemma 4 to "think". Defaults to true. */
  think?: boolean;
};

/** Returns parsed JSON (typed as T at the call site) with retry-on-parse-error. */
export async function jsonCall<T>(
  params: AgentCallParams,
  signal: AbortSignal,
): Promise<T> {
  let lastError: unknown;
  let feedback = "";
  for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const raw = await rawCall({ ...params, prompt: params.prompt + feedback }, signal);
    const stripped = stripFences(raw);
    try {
      return JSON.parse(stripped) as T;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      feedback = `\n\nYour previous response did not parse as JSON: ${msg}. Respond again with valid JSON only.`;
      console.warn(
        `[indexer/llm] JSON parse failed (attempt ${attempt + 1}): ${msg}`,
      );
    }
  }
  throw new Error(
    `LLM did not return valid JSON after ${MAX_PARSE_RETRIES + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/** Plain text — no JSON parsing. */
export async function textCall(
  params: Omit<AgentCallParams, "schema">,
  signal: AbortSignal,
): Promise<string> {
  return rawCall(params, signal);
}

async function rawCall(
  params: AgentCallParams,
  signal: AbortSignal,
): Promise<string> {
  const provider = getCloudProvider();
  const systemBits = [
    params.system?.trim(),
    params.schema
      ? `Respond strictly matching this schema (TypeScript notation):\n${params.schema}`
      : "",
    JSON_DISCIPLINE,
  ].filter(Boolean);

  const userContent: ChatContentPart[] = [];
  if (params.image) {
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:${params.image.mimeType};base64,${params.image.base64}`,
      },
    });
  }
  userContent.push({ type: "text", text: params.prompt });

  const messages: ChatMessage[] = [
    { role: "system", content: systemBits.join("\n\n") },
    { role: "user", content: userContent.length === 1 && userContent[0].type === "text"
        ? userContent[0].text
        : userContent },
  ];

  const result = (await provider.chat(
    {
      model: DEFAULT_MODEL,
      messages,
      temperature: params.temperature ?? DEFAULT_TEMP,
      max_tokens: params.maxTokens,
      think: params.think ?? true,
    },
    signal,
  )) as {
    choices: Array<{ message: { content?: string } }>;
  };

  return result.choices?.[0]?.message?.content ?? "";
}

/** Strip ```json … ``` and ``` … ``` fences if Gemma 4 wraps the body anyway. */
function stripFences(s: string): string {
  const trimmed = s.trim();
  const fence = /^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  if (fence) return fence[1].trim();
  return trimmed;
}
