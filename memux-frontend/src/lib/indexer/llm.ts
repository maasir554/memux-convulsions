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
- Escape every literal backslash inside a string as \\\\ (for example, LaTeX \\alpha must be written as \\\\alpha in the JSON source).
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

      // Gemma occasionally places Markdown/LaTeX backslashes directly in a
      // JSON string (for example `\alpha`). Preserve that content by escaping
      // only backslashes that JSON itself does not recognise, then parse once
      // more before spending another model call on a retry.
      const repaired = repairInvalidJsonEscapes(stripped);
      if (repaired !== stripped) {
        try {
          const parsed = JSON.parse(repaired) as T;
          console.warn(
            `[indexer/llm] Recovered invalid JSON escape (${parseErrorContext(stripped, msg)})`,
          );
          return parsed;
        } catch {
          // The response has another syntax problem; let the normal retry path
          // ask the model for a clean replacement.
        }
      }

      feedback = `\n\nYour previous response did not parse as JSON: ${msg}. Respond again with valid JSON only.`;
      console.warn(
        `[indexer/llm] JSON parse failed (attempt ${attempt + 1}): ${msg} (${parseErrorContext(stripped, msg)})`,
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

/**
 * Double illegal backslashes inside JSON strings while leaving valid JSON
 * escapes and all content outside strings untouched.
 */
function repairInvalidJsonEscapes(s: string): string {
  let repaired = "";
  let inString = false;

  for (let i = 0; i < s.length; i++) {
    const char = s[i]!;
    if (char === '"') {
      inString = !inString;
      repaired += char;
      continue;
    }

    if (!inString || char !== "\\") {
      repaired += char;
      continue;
    }

    const next = s[i + 1];
    if (next && '"\\/bfnrt'.includes(next)) {
      repaired += char + next;
      i++;
      continue;
    }
    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) {
      repaired += s.slice(i, i + 6);
      i += 5;
      continue;
    }

    repaired += "\\\\";
  }

  return repaired;
}

/** Return a minimal diagnostic without copying document text into logs. */
function parseErrorContext(s: string, message: string): string {
  const match = /position (\d+)/.exec(message);
  if (!match) return "location unavailable";
  const position = Number(match[1]);
  return `position ${position}, token ${JSON.stringify(s.slice(position, position + 2))}`;
}
