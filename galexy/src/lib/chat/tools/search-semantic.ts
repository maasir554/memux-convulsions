"use client";

/**
 * Semantic search over the indexed knowledge base. Embeds the query with
 * gemini-embedding-001 (1536-d, L2-normalised, RETRIEVAL_QUERY), then
 * pgvector cosine search over `index_chunks`. Joins back to `sections`
 * for the human-readable topic + back to `items` for the note metadata.
 *
 * One result = one chunk. The same source section can surface multiple
 * times if it has multiple matching chunks (summary + each question +
 * each concept). The harness later dedupes by itemId when building the
 * candidate map.
 */

import { sql } from "drizzle-orm";

import { embedBatch } from "@/lib/indexer/agent-client";
import { getVaultDb } from "@/lib/db/vault-db";
import type { ItemType } from "@/lib/mock-notes";
import type { ToolResult } from "@/lib/chat/types";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

export type SearchSemanticInput = {
  query: string;
  /** Limit on number of chunks returned. Default 10, max 30. */
  limit?: number;
  /** Restrict to particular chunk kinds (summary / question / concept / image). */
  kinds?: Array<"summary" | "question" | "concept" | "image">;
};

export async function searchSemantic(
  input: SearchSemanticInput,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const q = input.query.trim();
  if (!q) return { ok: false, error: "Empty query" };
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT));

  const [vec] = await embedBatch([q], signal);
  if (!vec) return { ok: false, error: "Embedding returned no vector" };
  const literal = `[${vec.join(",")}]`;

  const kindFilter =
    input.kinds && input.kinds.length > 0
      ? sql` AND c.kind IN (${sql.join(
          input.kinds.map((k) => sql`${k}`),
          sql`, `,
        )})`
      : sql``;

  const db = await getVaultDb();
  // 1 - cosine_distance gives cosine similarity in [-1, 1]; for unit-norm
  // vectors (which these are) it lives in [0, 1]. We sort by distance ASC
  // and return the similarity for ergonomics.
  const rows = await db.execute<{
    chunk_id: string;
    chunk_text: string;
    chunk_kind: string;
    section_id: string;
    note_item_id: string | null;
    topic: string;
    item_title: string | null;
    item_type: ItemType | null;
    item_folder: string | null;
    similarity: number;
  }>(sql`
    SELECT
      c.id AS chunk_id,
      c.text AS chunk_text,
      c.kind AS chunk_kind,
      s.id AS section_id,
      s.note_item_id,
      s.topic,
      i.title AS item_title,
      i.type AS item_type,
      i.folder AS item_folder,
      (1 - (c.embedding <=> ${literal}::vector)) AS similarity
    FROM index_chunks c
    JOIN sections s ON s.id = c.section_id
    LEFT JOIN items i ON i.id = s.note_item_id
    WHERE c.embedding IS NOT NULL ${kindFilter}
    ORDER BY c.embedding <=> ${literal}::vector ASC
    LIMIT ${limit}
  `);

  // Dedupe by note_item_id, keep top similarity per item.
  const seen = new Map<string, typeof rows.rows[number]>();
  for (const r of rows.rows) {
    const key = r.note_item_id ?? r.section_id;
    if (!seen.has(key)) seen.set(key, r);
  }

  const refs = Array.from(seen.values())
    .filter((r) => !!r.item_title)
    .map((r) => ({
      itemId: r.note_item_id ?? r.section_id,
      title: r.item_title ?? r.topic,
      type: (r.item_type ?? "markdown") as ItemType,
      folder: r.item_folder ?? "",
      snippet: r.chunk_text.slice(0, 160),
      score: Number(r.similarity),
    }));

  return {
    ok: true,
    summary: `Semantic "${q}": ${refs.length} match${refs.length === 1 ? "" : "es"}.`,
    refs,
    ui: { kind: "search-results", query: q, results: refs, tool: "search_semantic" },
  };
}
