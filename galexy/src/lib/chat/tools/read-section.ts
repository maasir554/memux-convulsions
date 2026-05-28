"use client";

/**
 * Read a full indexed section note (the `Section NN · <topic>.md` files
 * the indexer writes into `_Indexes/<group>/`). Returns the parsed
 * markdown plus a back-reference to its manifest so the model can
 * navigate to the parent group.
 *
 * Distinct from `get_item` because:
 *  - sections always carry summary + questions + concepts in frontmatter,
 *    which we surface as structured pairs the model can ingest faster
 *    than re-parsing markdown.
 *  - sections live under a stable folder convention (`_Indexes/.../`)
 *    so the manifest pointer is deterministic.
 */

import { and, eq, like } from "drizzle-orm";

import { getVaultDb } from "@/lib/db/vault-db";
import { items } from "@/lib/db/schema";
import type { ToolResult } from "@/lib/chat/types";

export type ReadSectionInput = {
  noteItemId: string;
};

export async function readSection(input: ReadSectionInput): Promise<ToolResult> {
  const db = await getVaultDb();
  const [section] = await db.select().from(items).where(eq(items.id, input.noteItemId));
  if (!section) return { ok: false, error: `No section found for id ${input.noteItemId}` };
  if (section.type !== "markdown") {
    return { ok: false, error: `Item ${input.noteItemId} is ${section.type}, not a markdown section` };
  }

  // Locate the manifest in the same folder for a back-ref.
  const [manifest] = await db
    .select({ id: items.id, title: items.title, summary: items.summary })
    .from(items)
    .where(and(eq(items.folder, section.folder), like(items.title, "_manifest")));

  return {
    ok: true,
    summary: `Read "${section.title}" (${section.content?.length ?? 0} chars)`,
    refs: manifest
      ? [
          {
            itemId: section.id,
            title: section.title,
            type: section.type,
            folder: section.folder,
            snippet: section.summary || "",
          },
          {
            itemId: manifest.id,
            title: manifest.title,
            type: "markdown" as const,
            folder: section.folder,
            snippet: manifest.summary,
          },
        ]
      : [
          {
            itemId: section.id,
            title: section.title,
            type: section.type,
            folder: section.folder,
            snippet: section.summary || "",
          },
        ],
    ui: {
      kind: "section-read",
      noteItemId: section.id,
      sectionTitle: section.title,
      markdown: section.content ?? "",
    },
  };
}
