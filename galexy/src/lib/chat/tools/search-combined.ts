"use client";

/**
 * Composite search: runs keyword + semantic in parallel, fuses results
 * via RRF (Reciprocal Rank Fusion). Returns a single ranked list.
 *
 * Why: the model often doesn't know whether the user's question is
 * better served by exact-string or paraphrased semantic search. Forcing
 * it to choose wastes a turn. Exposing search_combined as a single tool
 * lets the model do one wave and get the best-of-both ranking.
 *
 * RRF formula: score(item) = Σ 1/(k + rank_in_tool). k=60 is the
 * canonical Cormack & Clarke constant.
 */

import type { ToolResult } from "@/lib/chat/types";
import { searchKeyword, type SearchKeywordInput } from "@/lib/chat/tools/search-keyword";
import { searchSemantic, type SearchSemanticInput } from "@/lib/chat/tools/search-semantic";

const RRF_K = 60;

export type SearchCombinedInput = {
  query: string;
  /** Max results returned after fusion. Default 10, max 30. */
  limit?: number;
};

export async function searchCombined(
  input: SearchCombinedInput,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const q = input.query.trim();
  if (!q) return { ok: false, error: "Empty query" };
  const limit = Math.max(1, Math.min(input.limit ?? 10, 30));

  const [kwResult, semResult] = await Promise.all([
    searchKeyword({ query: q, limit: 20 } as SearchKeywordInput),
    searchSemantic({ query: q, limit: 20 } as SearchSemanticInput, signal),
  ]);

  type Bucket = {
    itemId: string;
    title: string;
    type: ToolResult extends { refs: Array<infer R> } ? R extends { type: infer T } ? T : never : never;
    folder: string;
    snippet: string;
    score: number;
  };
  const fused = new Map<string, Bucket>();

  function ingest(result: ToolResult): void {
    if (!result.ok) return;
    result.refs.forEach((r, i) => {
      const rank = i + 1;
      const contribution = 1 / (RRF_K + rank);
      const existing = fused.get(r.itemId);
      if (existing) {
        existing.score += contribution;
      } else {
        fused.set(r.itemId, {
          itemId: r.itemId,
          title: r.title,
          type: r.type as Bucket["type"],
          folder: r.folder,
          snippet: r.snippet ?? "",
          score: contribution,
        });
      }
    });
  }
  ingest(kwResult);
  ingest(semResult);

  const refs = Array.from(fused.values())
    .sort((a, b) => b.score - a.score || a.itemId.localeCompare(b.itemId))
    .slice(0, limit)
    .map((b) => ({
      itemId: b.itemId,
      title: b.title,
      type: b.type,
      folder: b.folder,
      snippet: b.snippet,
      score: b.score,
    }));

  return {
    ok: true,
    summary: `Combined "${q}": ${refs.length} fused hit${refs.length === 1 ? "" : "s"} (keyword + semantic RRF).`,
    refs,
    ui: { kind: "search-results", query: q, results: refs, tool: "search_combined" },
  };
}
