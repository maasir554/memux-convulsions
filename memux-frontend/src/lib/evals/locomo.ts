import "server-only";

import MiniSearch from "minisearch";
import { stemmer } from "stemmer";

import locomoData from "./locomo10.json";
import { getProvider } from "@/lib/memux/backend/registry";

export const LOCOMO_SUBSET_SIZE = 150;
export const LOCOMO_SEED = "memux-locomo-v1";
export const LOCOMO_DATASET_SHA256 =
  "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4";
export const DEFAULT_LOCOMO_MODEL = "gemma-4-31b-it";
export const LOCOMO_METHOD = "memux-rag-v2";
export const LOCOMO_TOP_K = 12;
export const LOCOMO_HIGHLIGHT_TURNS = 20;
export const LOCOMO_CONTEXT_CHAR_BUDGET = 42_000;

export const CATEGORY_LABELS: Record<number, string> = {
  1: "Multi-hop",
  2: "Temporal",
  3: "Open-domain",
  4: "Single-hop",
  5: "Adversarial",
};

type Turn = {
  speaker: string;
  dia_id: string;
  text: string;
  blip_caption?: string;
};

type Conversation = {
  speaker_a: string;
  speaker_b: string;
  [key: string]: string | Turn[];
};

type ObservationValue = Record<string, Array<[string, string]>>;

type LocomoQa = {
  question: string;
  answer: string | number;
  evidence?: string[];
  category: number;
};

type LocomoSample = {
  sample_id: string;
  qa: LocomoQa[];
  conversation: Conversation;
  observation?: Record<string, ObservationValue>;
  session_summary?: Record<string, string>;
};

export type LocomoQuestion = {
  id: string;
  sampleId: string;
  qaIndex: number;
  question: string;
  answer: string;
  evidence: string[];
  category: number;
};

export type LocomoItemResult = LocomoQuestion & {
  prediction: string;
  f1: number;
  retrievedSessions: number[];
  highlightedTurns: string[];
  abstentionRetried: boolean;
  evidenceRecall: number;
  latencyMs: number;
  error?: string;
};

export type LocomoSummary = {
  completed: number;
  total: number;
  score: number;
  evidenceRecall: number;
  elapsedMs: number;
  byCategory: Record<
    string,
    { category: number; label: string; count: number; score: number; evidenceRecall: number }
  >;
};

export type LocomoEvent =
  | {
      type: "start";
      total: number;
      model: string;
      method: string;
      pending: number;
      seed: string;
      datasetSha256: string;
      categoryCounts: Record<string, number>;
    }
  | { type: "item"; index: number; result: LocomoItemResult; summary: LocomoSummary }
  | {
      type: "complete";
      model: string;
      method: string;
      summary: LocomoSummary;
      results: LocomoItemResult[];
    }
  | { type: "error"; message: string };

const DATA = locomoData as unknown as LocomoSample[];

// Per-conversation quotas. They total 15 for every conversation and reproduce
// the full non-adversarial LoCoMo distribution, rounded to 150 questions:
// 28 multi-hop, 31 temporal, 9 open-domain, 82 single-hop.
const QUOTAS: Record<string, Record<number, number>> = {
  "conv-26": { 1: 3, 2: 4, 3: 1, 4: 7 },
  "conv-30": { 1: 2, 2: 5, 3: 0, 4: 8 },
  "conv-41": { 1: 3, 2: 2, 3: 1, 4: 9 },
  "conv-42": { 1: 3, 2: 3, 3: 1, 4: 8 },
  "conv-43": { 1: 3, 2: 2, 3: 1, 4: 9 },
  "conv-44": { 1: 3, 2: 3, 3: 1, 4: 8 },
  "conv-47": { 1: 2, 2: 3, 3: 1, 4: 9 },
  "conv-48": { 1: 2, 2: 3, 3: 1, 4: 9 },
  "conv-49": { 1: 4, 2: 3, 3: 1, 4: 7 },
  "conv-50": { 1: 3, 2: 3, 3: 1, 4: 8 },
};

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function getFixedLocomoSubset(): LocomoQuestion[] {
  const selected: LocomoQuestion[] = [];
  for (const sample of DATA) {
    const quota = QUOTAS[sample.sample_id];
    if (!quota) throw new Error(`Missing subset quota for ${sample.sample_id}`);
    for (const category of [1, 2, 3, 4]) {
      const candidates = sample.qa
        .map((qa, qaIndex) => ({ qa, qaIndex }))
        .filter(({ qa }) => qa.category === category)
        .sort(
          (a, b) =>
            stableHash(`${LOCOMO_SEED}:${sample.sample_id}:${a.qaIndex}`) -
            stableHash(`${LOCOMO_SEED}:${sample.sample_id}:${b.qaIndex}`),
        );
      for (const { qa, qaIndex } of candidates.slice(0, quota[category] ?? 0)) {
        selected.push({
          id: `${sample.sample_id}:q${qaIndex}`,
          sampleId: sample.sample_id,
          qaIndex,
          question: qa.question,
          answer: String(qa.answer),
          evidence: qa.evidence ?? [],
          category: qa.category,
        });
      }
    }
  }
  if (selected.length !== LOCOMO_SUBSET_SIZE) {
    throw new Error(`Expected ${LOCOMO_SUBSET_SIZE} questions, got ${selected.length}`);
  }
  return selected.sort(
    (a, b) => stableHash(`${LOCOMO_SEED}:${a.id}:run`) - stableHash(`${LOCOMO_SEED}:${b.id}:run`),
  );
}

type SearchRecord = {
  id: string;
  session: number;
  kind: "session" | "turn";
  text: string;
};

type SessionDoc = {
  number: number;
  date: string;
  turns: Turn[];
  text: string;
};

type RetrievedMemory = {
  sessions: SessionDoc[];
  highlights: Array<{ session: number; date: string; turn: Turn }>;
  queryVariants: string[];
};

class ConversationMemory {
  readonly sessions: SessionDoc[];
  private readonly search: MiniSearch<SearchRecord>;
  private readonly turns = new Map<string, { session: number; date: string; turn: Turn }>();

  constructor(private readonly sample: LocomoSample) {
    this.sessions = buildSessions(sample);
    const records: SearchRecord[] = [];
    for (const session of this.sessions) {
      records.push({
        id: `s${session.number}-memory`,
        session: session.number,
        kind: "session",
        text: session.text,
      });
      for (const turn of session.turns) {
        this.turns.set(turn.dia_id, {
          session: session.number,
          date: session.date,
          turn,
        });
        records.push({
          id: turn.dia_id,
          session: session.number,
          kind: "turn",
          text: `${session.date} ${turn.speaker}: ${turn.text} ${turn.blip_caption ?? ""}`,
        });
      }
    }
    this.search = new MiniSearch<SearchRecord>({
      idField: "id",
      fields: ["text"],
      storeFields: ["session", "kind"],
    });
    this.search.addAll(records);
  }

  retrieve(question: string, topK = LOCOMO_TOP_K): RetrievedMemory {
    const queryVariants = buildQueryVariants(question);
    const primaryHits = this.search.search(queryVariants[0]!, {
      prefix: true,
      fuzzy: 0.12,
    });
    const scores = new Map<number, number>();
    for (const hit of primaryHits.slice(0, 80)) {
      const session = Number(hit.session);
      const rankBonus = 1 / (1 + scores.size);
      scores.set(session, (scores.get(session) ?? 0) + hit.score + rankBonus);
    }

    // Query expansion has a deliberately smaller influence than the original
    // question. It recovers sessions containing individual facets of list and
    // multi-hop questions without letting a terse expansion replace the user's
    // actual intent.
    for (const variant of queryVariants.slice(1)) {
      const hits = this.search.search(variant, { prefix: true, fuzzy: 0.12 });
      hits.slice(0, 40).forEach((hit, rank) => {
        const session = Number(hit.session);
        scores.set(session, (scores.get(session) ?? 0) + 2 / (8 + rank));
      });
    }

    const rankedSessions = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([number]) => this.sessions.find((session) => session.number === number)!);

    // A few LoCoMo sessions are much longer than average. Twelve full sessions
    // plus repeated highlights can exceed Google's 16K free-tier input-token
    // window in a single request, which no retry can fix. Always keep the top
    // eight (the v1 baseline envelope), then add lower-ranked candidates while
    // staying under a conservative character budget.
    const contextSessions: SessionDoc[] = [];
    let contextChars = 0;
    for (const session of rankedSessions) {
      const sessionChars =
        session.date.length +
        session.turns.reduce(
          (sum, turn) => sum + turn.speaker.length + turn.text.length + (turn.blip_caption?.length ?? 0) + 24,
          0,
        );
      if (contextSessions.length < 8 || contextChars + sessionChars <= LOCOMO_CONTEXT_CHAR_BUDGET) {
        contextSessions.push(session);
        contextChars += sessionChars;
      }
    }
    const sessions = contextSessions.sort((a, b) => a.number - b.number);
    const selectedSessions = new Set(sessions.map((session) => session.number));

    // RRF across the original and expanded searches produces a compact
    // evidence shortlist. These turns are repeated before the full sessions so
    // the answer model sees needle facts before scanning the longer context.
    const turnScores = new Map<string, number>();
    for (const variant of queryVariants) {
      const hits = this.search.search(variant, { prefix: true, fuzzy: 0.12 });
      hits
        .filter((hit) => hit.kind === "turn" && selectedSessions.has(Number(hit.session)))
        .slice(0, 60)
        .forEach((hit, rank) => {
          const id = String(hit.id);
          turnScores.set(id, (turnScores.get(id) ?? 0) + 1 / (20 + rank));
        });
    }
    const highlights = [...turnScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, LOCOMO_HIGHLIGHT_TURNS)
      .map(([id]) => this.turns.get(id)!)
      .filter(Boolean);

    return { sessions, highlights, queryVariants };
  }
}

const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "before",
  "both",
  "did",
  "do",
  "does",
  "during",
  "for",
  "from",
  "has",
  "have",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "the",
  "their",
  "they",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "would",
]);

function buildQueryVariants(question: string): string[] {
  const stripped = question
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word && !QUERY_STOP_WORDS.has(word.toLowerCase()))
    .join(" ");
  const namedEntities =
    question.match(/\b[A-Z][\p{L}\p{M}'-]*(?:\s+[A-Z][\p{L}\p{M}'-]*)*/gu)?.join(" ") ?? "";
  const variants = [question.trim(), stripped.trim(), namedEntities.trim()].filter(
    (value) => value.length >= 3,
  );
  return [...new Set(variants)];
}

function buildSessions(sample: LocomoSample): SessionDoc[] {
  const sessionNumbers = Object.keys(sample.conversation)
    .map((key) => /^session_(\d+)$/.exec(key)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number)
    .sort((a, b) => a - b);

  return sessionNumbers.map((number) => {
    const turns = sample.conversation[`session_${number}`] as Turn[];
    const date = String(sample.conversation[`session_${number}_date_time`] ?? "");
    const summary = sample.session_summary?.[`session_${number}_summary`] ?? "";
    const observations = sample.observation?.[`session_${number}_observation`];
    const observationText = observations
      ? Object.values(observations)
          .flat()
          .map(([text]) => text)
          .join(" ")
      : "";
    return {
      number,
      date,
      turns,
      text: `${date}\n${summary}\n${observationText}\n${turns
        .map((turn) => `${turn.speaker}: ${turn.text} ${turn.blip_caption ?? ""}`)
        .join("\n")}`,
    };
  });
}

const memories = new Map<string, ConversationMemory>();

function memoryFor(sampleId: string): ConversationMemory {
  let memory = memories.get(sampleId);
  if (!memory) {
    const sample = DATA.find((candidate) => candidate.sample_id === sampleId);
    if (!sample) throw new Error(`Unknown LoCoMo sample ${sampleId}`);
    memory = new ConversationMemory(sample);
    memories.set(sampleId, memory);
  }
  return memory;
}

function formatContext(memory: RetrievedMemory): string {
  const highlights = memory.highlights.length
    ? `# Highest-relevance dialogue turns\n${memory.highlights
        .map(
          ({ session, date, turn }) =>
            `[Session ${session} · ${date} · ${turn.dia_id}] ${turn.speaker}: ${turn.text}${
              turn.blip_caption ? ` [Image: ${turn.blip_caption}]` : ""
            }`,
        )
        .join("\n")}\n\n`
    : "";
  const chronology = `# Session chronology\n${memory.sessions
    .map((session) => `Session ${session.number}: ${session.date}`)
    .join("\n")}\n\n`;
  const sessions = memory.sessions
    .map(
      (session) =>
        `## Session ${session.number} — ${session.date}\n${session.turns
          .map(
            (turn) =>
              `[${turn.dia_id}] ${turn.speaker}: ${turn.text}${
                turn.blip_caption ? ` [Image: ${turn.blip_caption}]` : ""
              }`,
          )
          .join("\n")}`,
    )
    .join("\n\n");
  return `${highlights}${chronology}# Retrieved sessions\n${sessions}`;
}

function responseText(response: unknown): string {
  const value = response as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return value.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function evaluateLocomoQuestion(
  question: LocomoQuestion,
  model = DEFAULT_LOCOMO_MODEL,
  signal = new AbortController().signal,
): Promise<LocomoItemResult> {
  const started = Date.now();
  const memory = memoryFor(question.sampleId);
  const retrieved = memory.retrieve(question.question);
  const retrievedSessions = retrieved.sessions.map((session) => session.number);
  const highlightedTurns = retrieved.highlights.map(({ turn }) => turn.dia_id);
  const provider = await getProvider();

  const context = formatContext(retrieved);
  const systemPrompt =
    "You answer questions about a long-running conversation from retrieved memory. " +
    "First inspect the highest-relevance turns, then verify against the full retrieved sessions. " +
    "Prefer the conversation's exact wording, names, titles, quantities, places, and dates over paraphrases. " +
    "For list or shared-interest questions, search across every retrieved session and return every distinct item as a comma-separated list. " +
    "For when, where, order, or duration questions, match the exact subject and event, use the session chronology, and resolve relative dates before answering; never substitute a different event. " +
    "For questions asking what is likely, suspected, implied, or would happen, make the most grounded inference supported by the memory and ordinary common knowledge. " +
    "Give only the shortest direct answer. Do not explain, cite, hedge, or repeat the question. " +
    "Say 'no information available' only after checking both the highlighted turns and all retrieved sessions.";
  const userPrompt = `Retrieved conversation memory:\n\n${context}\n\nQuestion: ${question.question}\nAnswer:`;

  const first = await chatWithQuotaRetry(
    provider,
    { model, systemPrompt, userPrompt, maxTokens: 128 },
    signal,
  );
  if (first.error) {
    return {
      ...question,
      prediction: "",
      f1: 0,
      retrievedSessions,
      highlightedTurns,
      abstentionRetried: false,
      evidenceRecall: evidenceRecall(question.evidence, retrieved.sessions),
      latencyMs: Date.now() - started,
      error: first.error,
    };
  }

  let prediction = first.text;
  let abstentionRetried = false;
  if (isAbstention(prediction) && retrieved.highlights.length > 0) {
    abstentionRetried = true;
    const retry = await chatWithQuotaRetry(
      provider,
      {
        model,
        systemPrompt,
        userPrompt:
          `${userPrompt}\n\nYour first attempt abstained. Re-examine the highlighted turns and full sessions carefully. ` +
          "If an answer can be extracted or reasonably inferred, return it using the conversation's exact wording. Abstain only if genuinely unsupported.",
        maxTokens: 128,
      },
      signal,
    );
    if (!retry.error && retry.text) prediction = retry.text;
  }

  return {
    ...question,
    prediction,
    f1: scoreLocomoAnswer(prediction, question.answer, question.category),
    retrievedSessions,
    highlightedTurns,
    abstentionRetried,
    evidenceRecall: evidenceRecall(question.evidence, retrieved.sessions),
    latencyMs: Date.now() - started,
  };
}

type ChatProvider = Awaited<ReturnType<typeof getProvider>>;

async function chatWithQuotaRetry(
  provider: ChatProvider,
  options: {
    model: string;
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
  },
  signal: AbortSignal,
): Promise<{ text: string; error?: string }> {
  let lastError = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const response = await provider.chat(
        {
          model: options.model,
          temperature: 0,
          max_tokens: options.maxTokens,
          think: false,
          messages: [
            { role: "system", content: options.systemPrompt },
            { role: "user", content: options.userPrompt },
          ],
        },
        signal,
      );
      return { text: responseText(response) };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (signal.aborted || !/\b429\b|quota|resource_exhausted/i.test(lastError)) break;
      // Google reports a sliding per-minute input-token quota and can request
      // 50+ seconds near the start of that window. Clear the full minute
      // instead of repeatedly landing inside the same quota window.
      await abortableDelay(65_000, signal);
    }
  }
  return { text: "", error: lastError || "Model call failed" };
}

function isAbstention(value: string): boolean {
  return /no information available|not mentioned|not enough information|cannot determine/i.test(value);
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, "")
    .replace(/\b(a|an|the|and)\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  const normalized = normalizeAnswer(value);
  return normalized ? normalized.split(" ").map((word) => stemmer(word)) : [];
}

function tokenF1(prediction: string, truth: string): number {
  const predicted = tokens(prediction);
  const expected = tokens(truth);
  if (predicted.length === 0 || expected.length === 0) return 0;
  const remaining = new Map<string, number>();
  for (const token of expected) remaining.set(token, (remaining.get(token) ?? 0) + 1);
  let common = 0;
  for (const token of predicted) {
    const count = remaining.get(token) ?? 0;
    if (count > 0) {
      common++;
      remaining.set(token, count - 1);
    }
  }
  if (common === 0) return 0;
  const precision = common / predicted.length;
  const recall = common / expected.length;
  return (2 * precision * recall) / (precision + recall);
}

export function scoreLocomoAnswer(prediction: string, truth: string, category: number): number {
  if (category === 5) {
    const normalized = prediction.toLowerCase();
    return normalized.includes("no information available") || normalized.includes("not mentioned")
      ? 1
      : 0;
  }
  const target = category === 3 ? truth.split(";")[0]!.trim() : truth;
  if (category !== 1) return tokenF1(prediction, target);

  const predictions = prediction.split(",").map((part) => part.trim());
  const truths = target.split(",").map((part) => part.trim());
  return (
    truths.reduce(
      (sum, expected) =>
        sum + Math.max(...predictions.map((candidate) => tokenF1(candidate, expected))),
      0,
    ) / truths.length
  );
}

function evidenceRecall(evidence: string[], sessions: SessionDoc[]): number {
  if (evidence.length === 0) return 1;
  const selected = new Set(sessions.flatMap((session) => session.turns.map((turn) => turn.dia_id)));
  return evidence.filter((id) => selected.has(id)).length / evidence.length;
}

export function summarizeLocomo(
  results: LocomoItemResult[],
  total = LOCOMO_SUBSET_SIZE,
  elapsedMs = 0,
): LocomoSummary {
  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const byCategory: LocomoSummary["byCategory"] = {};
  for (const category of [1, 2, 3, 4]) {
    const rows = results.filter((result) => result.category === category);
    byCategory[String(category)] = {
      category,
      label: CATEGORY_LABELS[category]!,
      count: rows.length,
      score: mean(rows.map((row) => row.f1)),
      evidenceRecall: mean(rows.map((row) => row.evidenceRecall)),
    };
  }
  return {
    completed: results.length,
    total,
    score: mean(results.map((result) => result.f1)),
    evidenceRecall: mean(results.map((result) => result.evidenceRecall)),
    elapsedMs,
    byCategory,
  };
}

export async function runLocomoEvaluation(options: {
  model?: string;
  concurrency?: number;
  signal?: AbortSignal;
  existingResults?: LocomoItemResult[];
  onEvent?: (event: LocomoEvent) => void | Promise<void>;
}): Promise<{ summary: LocomoSummary; results: LocomoItemResult[] }> {
  const model = options.model ?? DEFAULT_LOCOMO_MODEL;
  const questions = getFixedLocomoSubset();
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));
  const started = Date.now();
  const questionIds = new Set(questions.map((question) => question.id));
  const results = (options.existingResults ?? []).filter(
    (result) => questionIds.has(result.id) && !result.error && Boolean(result.prediction),
  );
  const completedIds = new Set(results.map((result) => result.id));
  const pending = questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => !completedIds.has(question.id));
  const categoryCounts = Object.fromEntries(
    [1, 2, 3, 4].map((category) => [
      String(category),
      questions.filter((question) => question.category === category).length,
    ]),
  );
  await options.onEvent?.({
    type: "start",
    total: questions.length,
    model,
    method: LOCOMO_METHOD,
    pending: pending.length,
    seed: LOCOMO_SEED,
    datasetSha256: LOCOMO_DATASET_SHA256,
    categoryCounts,
  });

  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      if (options.signal?.aborted) return;
      const next = pending[cursor++];
      if (!next) return;
      const { question, index } = next;
      const result = await evaluateLocomoQuestion(question, model, options.signal);
      results.push(result);
      const summary = summarizeLocomo(results, questions.length, Date.now() - started);
      await options.onEvent?.({ type: "item", index, result, summary });
    }
  });
  await Promise.all(workers);
  const ordered = results.sort(
    (a, b) => questions.findIndex((q) => q.id === a.id) - questions.findIndex((q) => q.id === b.id),
  );
  const summary = summarizeLocomo(ordered, questions.length, Date.now() - started);
  await options.onEvent?.({
    type: "complete",
    model,
    method: LOCOMO_METHOD,
    summary,
    results: ordered,
  });
  return { summary, results: ordered };
}
