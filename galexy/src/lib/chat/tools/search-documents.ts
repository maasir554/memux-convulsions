"use client";

/**
 * Full-text BM25 search across the whole vault. Distinct from
 *   - `search_keyword`  — exact substring, no ranking. Good for IDs /
 *                         proper nouns the user typed verbatim.
 *   - `search_semantic` — vector search over INDEXED summaries only.
 *                         Misses anything that hasn't been through the
 *                         indexer (raw notes, daily logs, snippets).
 *
 * `search_documents` ranks every md/code/csv body in the vault by BM25
 * relevance to the query — including notes the user never indexed.
 */

import type { ToolResult } from "@/lib/chat/types";
import { searchDocuments } from "@/lib/search/document-search";

export type SearchDocumentsInput = {
  query: string;
  /** Max results. Default 10, max 30. */
  limit?: number;
};

export async function searchDocumentsTool(
  input: SearchDocumentsInput,
): Promise<ToolResult> {
  const q = input.query.trim();
  if (!q) return { ok: false, error: "Empty query" };
  const limit = Math.max(1, Math.min(input.limit ?? 10, 30));

  const hits = await searchDocuments(q, limit);

  const refs = hits.map((h) => ({
    itemId: h.itemId,
    title: h.title,
    type: h.type,
    folder: h.folder,
    snippet: h.snippet,
    score: h.score,
  }));

  return {
    ok: true,
    summary: `Doc search "${q}": ${refs.length} BM25 hit${refs.length === 1 ? "" : "s"}.`,
    refs,
    ui: { kind: "search-results", query: q, results: refs, tool: "search_documents" },
  };
}
