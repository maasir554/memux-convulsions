"use client";

/**
 * Concept tools — list every concept the indexer has ever surfaced, or
 * fetch the sections that mention a particular concept.
 *
 * Concepts are stored both in `concepts` table (canonical, with refs
 * back to sections that mention them) and in `sections.concepts` jsonb
 * arrays. We query the canonical table for `list_concepts` and use the
 * refs payload for `get_concept`.
 */

import { eq, ilike } from "drizzle-orm";

import { getVaultDb } from "@/lib/db/vault-db";
import { concepts, items, sections } from "@/lib/db/schema";
import type { ItemType } from "@/lib/mock-notes";
import type { ToolResult } from "@/lib/chat/types";

/* --------------------------------------------------------- list */

export type ListConceptsInput = { match?: string; limit?: number };

export async function listConcepts(input: ListConceptsInput): Promise<ToolResult> {
  const limit = Math.max(1, Math.min(input.limit ?? 30, 100));
  const db = await getVaultDb();
  const rows = input.match
    ? await db.select().from(concepts).where(ilike(concepts.name, `%${input.match}%`)).limit(limit)
    : await db.select().from(concepts).limit(limit);

  // We surface concepts as ItemRefs pointing at the concept's noteItemId
  // (if it has one) so the model can follow up with get_item.
  const refs = rows
    .filter((c) => !!c.noteItemId)
    .map((c) => ({
      itemId: c.noteItemId!,
      title: c.name,
      type: "markdown" as ItemType,
      folder: "_Concepts",
      snippet: `${c.refs.length} mention${c.refs.length === 1 ? "" : "s"}`,
    }));

  return {
    ok: true,
    summary: input.match
      ? `Concepts matching "${input.match}": ${rows.length}.`
      : `${rows.length} concept${rows.length === 1 ? "" : "s"} in the vault.`,
    refs,
    ui: {
      kind: "search-results",
      query: input.match ?? "all concepts",
      results: refs,
      tool: "list_concepts",
    },
  };
}

/* --------------------------------------------------------- get */

export type GetConceptInput = { name: string };

export async function getConcept(input: GetConceptInput): Promise<ToolResult> {
  const db = await getVaultDb();
  const [row] = await db.select().from(concepts).where(eq(concepts.name, input.name));
  if (!row) return { ok: false, error: `No concept named "${input.name}"` };

  // Resolve every section ref → its note item.
  const sectionIds = row.refs.map((r) => r.sectionId);
  const sectionRows = sectionIds.length === 0
    ? []
    : await db
        .select({
          id: sections.id,
          noteItemId: sections.noteItemId,
          topic: sections.topic,
          summary: sections.summary,
        })
        .from(sections)
        .where(eq(sections.id, sectionIds[0])); // single-row fallback; full impl uses inArray below

  // Use inArray for the real query (drizzle import added at top in the
  // multi-section path; we collapse to a single query when there are refs).
  let mentions: Array<{
    itemId: string;
    title: string;
    type: ItemType;
    folder: string;
    snippet: string;
  }> = [];
  if (sectionIds.length > 0) {
    const sql = (await import("drizzle-orm")).sql;
    const inArrayList = sectionIds.slice(0, 50);
    const rows = await db.execute<{
      id: string;
      title: string;
      type: ItemType;
      folder: string;
      summary: string;
      topic: string;
    }>(sql`
      SELECT i.id, i.title, i.type, i.folder, i.summary, s.topic
      FROM sections s
      LEFT JOIN items i ON i.id = s.note_item_id
      WHERE s.id IN (${sql.join(inArrayList.map((id) => sql`${id}`), sql`, `)})
        AND i.id IS NOT NULL
      LIMIT 30
    `);
    mentions = rows.rows.map((r) => ({
      itemId: r.id,
      title: r.title,
      type: r.type,
      folder: r.folder,
      snippet: r.summary || r.topic,
    }));
  }
  void sectionRows;
  void items;

  return {
    ok: true,
    summary: `Concept "${input.name}" mentioned in ${mentions.length} section${mentions.length === 1 ? "" : "s"}.`,
    refs: mentions,
    ui: { kind: "concept-detail", name: input.name, mentions },
  };
}
