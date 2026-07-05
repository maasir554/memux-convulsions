"use client";

/**
 * Keyword search over the vault's items.title + items.content. Uses
 * PostgreSQL ILIKE for ranking — Postgres-FTS would be sharper but PGlite
 * doesn't ship the `tsvector` ranker for arbitrary languages; ILIKE +
 * snippet extraction is good enough for the first pass and gives the
 * model deterministic, cheap matching.
 *
 * Returns the top-N rows ordered by (title-match, then content-match).
 * Title matches outweigh content matches via a synthetic priority column.
 */

import { sql } from "drizzle-orm";

import { getVaultDb } from "@/lib/db/vault-db";
import type { ItemType } from "@/lib/mock-notes";
import type { ToolResult } from "@/lib/chat/types";

const SNIPPET_LEN = 160;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

export type SearchKeywordInput = {
  query: string;
  /** Limit on number of results. Default 10, max 30. */
  limit?: number;
  /** Restrict to particular item types. */
  types?: ItemType[];
  /** Restrict to a folder subtree (matches `folder = path OR folder LIKE path/%`). */
  folderPath?: string;
};

export async function searchKeyword(input: SearchKeywordInput): Promise<ToolResult> {
  const q = input.query.trim();
  if (!q) return { ok: false, error: "Empty query" };

  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const pattern = `%${escapeLike(q)}%`;
  const typesFilter =
    input.types && input.types.length > 0
      ? sql` AND type IN (${sql.join(
          input.types.map((t) => sql`${t}`),
          sql`, `,
        )})`
      : sql``;
  const folderFilter = input.folderPath
    ? sql` AND (folder = ${input.folderPath} OR folder LIKE ${input.folderPath + "/%"})`
    : sql``;

  const db = await getVaultDb();
  const rows = await db.execute<{
    id: string;
    title: string;
    type: ItemType;
    folder: string;
    title_match: number;
    content_match: number;
    content: string;
  }>(sql`
    SELECT id, title, type, folder, content,
           CASE WHEN title ILIKE ${pattern} THEN 1 ELSE 0 END AS title_match,
           CASE WHEN content ILIKE ${pattern} THEN 1 ELSE 0 END AS content_match
    FROM items
    WHERE (title ILIKE ${pattern} OR content ILIKE ${pattern})
      ${typesFilter}
      ${folderFilter}
    ORDER BY title_match DESC, content_match DESC, updated_at DESC
    LIMIT ${limit}
  `);

  const refs = rows.rows.map((r) => ({
    itemId: r.id,
    title: r.title,
    type: r.type,
    folder: r.folder,
    snippet: extractSnippet(r.content, q),
    score: r.title_match * 2 + r.content_match,
  }));

  return {
    ok: true,
    summary: `Keyword "${q}": ${refs.length} hit${refs.length === 1 ? "" : "s"}.`,
    refs,
    ui: { kind: "search-results", query: q, results: refs, tool: "search_keyword" },
  };
}

/* ------------------------------------------------------------- helpers */

/** Escape LIKE wildcards in user input so a literal `%` doesn't match all. */
function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Pull a ~160-char window around the first match of `q` in `content`. */
function extractSnippet(content: string, q: string): string {
  if (!content) return "";
  const idx = content.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return content.slice(0, SNIPPET_LEN);
  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, idx + q.length + (SNIPPET_LEN - 40));
  const slice = content.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + slice + (end < content.length ? "…" : "");
}
