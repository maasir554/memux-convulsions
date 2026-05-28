"use client";

/**
 * Browser-side fetch wrappers for the agent dispatch route. Keeps the
 * orchestrator free of fetch-shaped boilerplate.
 */

import type {
  ImageReaderInput,
  ImageReaderOutput,
  NamerInput,
  NamerOutput,
  RegionFinderInput,
  RegionFinderOutput,
  SummariserInput,
  SummariserOutput,
  VisionerInput,
  VisionerOutput,
} from "@/lib/indexer/agents";

async function callAgent<K extends string, I, O>(
  kind: K,
  input: I,
  signal?: AbortSignal,
): Promise<O> {
  const res = await fetch("/v1/index/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, input }),
    signal,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`Agent ${kind} failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as O;
}

export function visionerCall(
  input: VisionerInput,
  signal?: AbortSignal,
): Promise<VisionerOutput> {
  return callAgent("visioner", input, signal);
}

export function summariserCall(
  input: SummariserInput,
  signal?: AbortSignal,
): Promise<SummariserOutput> {
  return callAgent("summariser", input, signal);
}

export function namerCall(
  input: NamerInput,
  signal?: AbortSignal,
): Promise<NamerOutput> {
  return callAgent("namer", input, signal);
}

export function imageReaderCall(
  input: ImageReaderInput,
  signal?: AbortSignal,
): Promise<ImageReaderOutput> {
  return callAgent("imageReader", input, signal);
}

export function regionFinderCall(
  input: RegionFinderInput,
  signal?: AbortSignal,
): Promise<RegionFinderOutput> {
  return callAgent("regionFinder", input, signal);
}

/** Embed batch — uses /v1/embed directly (no agent dispatch needed). */
export async function embedBatch(
  texts: string[],
  signal?: AbortSignal,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch("/v1/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: texts,
      task_type: "RETRIEVAL_DOCUMENT",
      output_dimensionality: 1536,
    }),
    signal,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`Embed failed (${res.status}): ${detail}`);
  }
  const body = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
  };
  return body.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}
