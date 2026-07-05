"use client";

/**
 * Date-range search across the vault.
 *
 * Two scopes:
 *   • "vault" — items.updated_at (when the file was last touched)
 *   • "indexed" — sections.created_at via join (when the LLM section was
 *     written). Useful for "what did I index last Tuesday?".
 *
 * Inputs accept ISO date strings (YYYY-MM-DD) or full ISO timestamps.
 */

import { sql } from "drizzle-orm";

import { getVaultDb } from "@/lib/db/vault-db";
import type { ItemType } from "@/lib/mock-notes";
import type { ToolResult } from "@/lib/chat/types";

export type FindByDateInput = {
  /** Inclusive ISO date (YYYY-MM-DD) or full timestamp. */
  from?: string;
  /** Exclusive ISO date. Omit for open-ended. */
  to?: string;
  scope?: "vault" | "indexed";
  limit?: number;
};

export async function findByDateRange(input: FindByDateInput): Promise<ToolResult> {
  const scope = input.scope ?? "vault";
  const from = input.from ? new Date(input.from) : null;
  const to = input.to ? new Date(input.to) : null;
  if ((input.from && Number.isNaN(from?.getTime())) || (input.to && Number.isNaN(to?.getTime()))) {
    return { ok: false, error: "Invalid ISO date in from/to" };
  }
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50));

  const db = await getVaultDb();
  type Row = { id: string; title: string; type: ItemType; folder: string; created_at: string };
  let rows: { rows: Row[] };
  if (scope === "indexed") {
    rows = await db.execute<Row>(sql`
      SELECT i.id, i.title, i.type, i.folder, s.created_at
      FROM sections s
      JOIN items i ON i.id = s.note_item_id
      WHERE 1=1
        ${from ? sql` AND s.created_at >= ${from.toISOString()}` : sql``}
        ${to ? sql` AND s.created_at < ${to.toISOString()}` : sql``}
      ORDER BY s.created_at DESC
      LIMIT ${limit}
    `);
  } else {
    rows = await db.execute<Row>(sql`
      SELECT id, title, type, folder, updated_at AS created_at
      FROM items
      WHERE 1=1
        ${from ? sql` AND updated_at >= ${from.toISOString()}` : sql``}
        ${to ? sql` AND updated_at < ${to.toISOString()}` : sql``}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `);
  }

  const entries = rows.rows.map((r) => ({
    itemId: r.id,
    title: r.title,
    type: r.type,
    folder: r.folder,
    snippet: r.created_at?.slice(0, 10) ?? "",
  }));

  return {
    ok: true,
    summary: `Date range (${scope}): ${entries.length} item${entries.length === 1 ? "" : "s"}.`,
    refs: entries,
    ui: {
      kind: "date-results",
      range: {
        from: input.from ?? "",
        to: input.to ?? "",
      },
      entries,
    },
  };
}
