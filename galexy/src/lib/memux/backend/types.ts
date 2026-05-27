import "server-only";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string; detail?: "auto" | "low" | "high" };
    };

export type ChatMessage = {
  role: ChatRole;
  /** OpenAI vision shape: string OR array of typed parts. */
  content: string | ChatContentPart[];
  name?: string;
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  /** Plasma-level toggle. Providers translate this to their own knob. */
  think?: boolean;
};

export type ModelInfo = {
  id: string;
  /** Best-effort context-window hint (tokens). */
  context_size?: number;
  /** True if the model advertises reasoning/thinking. */
  reasoning?: boolean;
  /** True if the model accepts image_url content parts. */
  vision?: boolean;
  /** Free-form metadata from upstream. */
  meta?: Record<string, unknown>;
};

export type EmbedTaskType =
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY"
  | "SEMANTIC_SIMILARITY"
  | "CLASSIFICATION"
  | "CLUSTERING"
  | "QUESTION_ANSWERING"
  | "FACT_VERIFICATION"
  | "CODE_RETRIEVAL_QUERY";

export type EmbedRequest = {
  /** Defaults to gemini-embedding-001 when omitted. */
  model?: string;
  input: string[];
  taskType?: EmbedTaskType;
  /** Matryoshka truncation. Default 1536. */
  outputDimensionality?: number;
};

export type EmbedResponse = {
  model: string;
  /** Already L2-normalised. */
  embeddings: number[][];
  usage?: { prompt_tokens?: number; total_tokens?: number };
};

export interface Provider {
  id: string;
  /** SSE-style chunks ("data: {...}\n\n"). Caller forwards them to the client. */
  streamChat(req: ChatRequest, signal: AbortSignal): AsyncIterable<string>;
  chat(req: ChatRequest, signal: AbortSignal): Promise<unknown>;
  embed(req: EmbedRequest, signal: AbortSignal): Promise<EmbedResponse>;
  listModels(): Promise<ModelInfo[]>;
  health(): Promise<{ ok: boolean; detail?: unknown }>;
}
