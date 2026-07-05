"use client";

/**
 * Browser-side BM25 full-text index over vault items. Built with
 * `minisearch` — pure JS, no PGlite gymnastics, sub-ms queries once
 * the index is warm. Handles natural-language word queries that the
 * existing ILIKE-based `search_keyword` tool can't rank.
 *
 * Lifecycle:
 *   - The index is a module-level singleton; first call to
 *     `searchDocuments` lazily builds it from PGlite.
 *   - Staleness check: on every query, we compare the current
 *     MAX(items.updated_at) against the timestamp at which the index
 *     was last built. If the vault has been touched since, we rebuild.
 *     One small SQL query per search; rebuilds only when needed.
 *   - Folder items (id starting with "folder:") are excluded — they
 *     aren't real content, just navigation nodes.
 *
 * Why not persist to IndexedDB: the build is fast enough at the scales
 * we expect (~10K items × ~5KB markdown = 50MB corpus, indexed in
 * single-digit seconds). Persistence introduces invalidation bugs and
 * stale-index headaches for marginal benefit. Defer.
 *
 * Tuning: minisearch's default scoring IS BM25-family. We tweak the
 * field boosts (title weighted more than content) and use prefix +
 * fuzzy matching so users get hits on typos and partial words.
 */

import MiniSearch from "minisearch";
import { sql } from "drizzle-orm";

import { getVaultDb } from "@/lib/db/vault-db";
import { items } from "@/lib/db/schema";
import type { ItemType } from "@/lib/mock-notes";

/* ----------------------------------------------------------- types */

export type DocSearchHit = {
  itemId: string;
  title: string;
  type: ItemType;
  folder: string;
  /** BM25 score the model can read for relative ranking. */
  score: number;
  /** ~140 char snippet around the first matched term. */
  snippet: string;
};

/* ----------------------------------------------------- singleton */

type IndexState = {
  /** Built minisearch instance. Null until first build. */
  mini: MiniSearch<DocRow> | null;
  /** Item lookup by id — minisearch only stores ids + searchable text. */
  byId: Map<string, DocRow>;
  /** ISO ts of the most recent `items.updated_at` at build time. */
  builtFromMaxUpdatedAt: string | null;
  /** Row count at build time. Cheap secondary check for deletes. */
  builtFromRowCount: number;
  /** Promise of an in-flight rebuild — concurrent searches share it. */
  rebuilding: Promise<void> | null;
};

const state: IndexState = {
  mini: null,
  byId: new Map(),
  builtFromMaxUpdatedAt: null,
  builtFromRowCount: 0,
  rebuilding: null,
};

type DocRow = {
  id: string;
  title: string;
  type: ItemType;
  folder: string;
  content: string;
};

/* --------------------------------------------------------- public */

export async function searchDocuments(
  query: string,
  limit = 12,
): Promise<DocSearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  await ensureFreshIndex();
  if (!state.mini) return [];

  const results = state.mini.search(q, {
    boost: { title: 3 },
    prefix: true,
    fuzzy: 0.15,
  });

  return results.slice(0, limit).map((r) => {
    const row = state.byId.get(String(r.id));
    return {
      itemId: String(r.id),
      title: row?.title ?? "(unknown)",
      type: (row?.type ?? "markdown") as ItemType,
      folder: row?.folder ?? "",
      score: r.score,
      snippet: extractSnippet(row?.content ?? "", q),
    };
  });
}

/**
 * Force a rebuild on the next call. Most callers don't need this —
 * the staleness check handles updates automatically — but the queue's
 * indexer can call it explicitly after a big run completes to avoid
 * waiting for the next search to discover the new items.
 */
export function invalidateDocumentIndex(): void {
  state.mini = null;
  state.builtFromMaxUpdatedAt = null;
  state.builtFromRowCount = 0;
}

/* ---------------------------------------------------- internals */

/**
 * Check if the cached index is stale and rebuild if so. Cheap when
 * the index is fresh (one `SELECT MAX(updated_at), COUNT(*)` query).
 */
async function ensureFreshIndex(): Promise<void> {
  if (state.rebuilding) {
    await state.rebuilding;
    return;
  }
  const db = await getVaultDb();
  const stat = await db.execute<{ max_updated_at: string | null; row_count: number }>(
    sql`SELECT MAX(updated_at) AS max_updated_at, COUNT(*)::int AS row_count FROM items`,
  );
  const { max_updated_at, row_count } = stat.rows[0] ?? {
    max_updated_at: null,
    row_count: 0,
  };
  const fresh =
    state.mini &&
    state.builtFromMaxUpdatedAt === max_updated_at &&
    state.builtFromRowCount === row_count;
  if (fresh) return;

  state.rebuilding = (async () => {
    const rows = await db
      .select({
        id: items.id,
        title: items.title,
        type: items.type,
        folder: items.folder,
        content: items.content,
      })
      .from(items);

    const byId = new Map<string, DocRow>();
    const docs: DocRow[] = [];
    for (const r of rows) {
      // Skip derived folder pseudo-items (they aren't real content).
      if (r.id.startsWith("folder:")) continue;
      const row: DocRow = {
        id: r.id,
        title: r.title,
        type: r.type as ItemType,
        folder: r.folder,
        content: r.content ?? "",
      };
      byId.set(r.id, row);
      docs.push(row);
    }

    const mini = new MiniSearch<DocRow>({
      fields: ["title", "content"],
      storeFields: ["title"], // minimal — we look up the rest via byId
      // Defaults already use BM25-ish scoring. Override extractor so
      // we can still address documents by string id.
      idField: "id",
    });
    mini.addAll(docs);

    state.mini = mini;
    state.byId = byId;
    state.builtFromMaxUpdatedAt = max_updated_at;
    state.builtFromRowCount = row_count;
  })().finally(() => {
    state.rebuilding = null;
  });
  await state.rebuilding;
}

/** Pull a ~140-char window around the first match of `q` in `content`. */
function extractSnippet(content: string, q: string): string {
  if (!content) return "";
  const head = q.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!head) return content.slice(0, 140);
  const idx = content.toLowerCase().indexOf(head);
  if (idx < 0) return content.slice(0, 140);
  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, idx + head.length + 100);
  const slice = content.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + slice + (end < content.length ? "…" : "");
}
