"use client";

/**
 * Fetch full content + metadata for one vault item by ID. The model uses
 * this after a search wave to read the full body of a candidate it wants
 * to reason against. `bodyMd` is the markdown body (for md / section
 * notes); for non-text types we surface metadata only so the model can
 * decide whether to follow up with `read_pdf_page` / `read_image` /
 * `read_csv`.
 */

import { eq } from "drizzle-orm";

import { getVaultDb } from "@/lib/db/vault-db";
import { items } from "@/lib/db/schema";
import type { ToolResult } from "@/lib/chat/types";

export type GetItemInput = {
  itemId: string;
  /** If true, omit the body (just metadata). Default false. */
  metaOnly?: boolean;
};

export async function getItem(input: GetItemInput): Promise<ToolResult> {
  const db = await getVaultDb();
  const [row] = await db.select().from(items).where(eq(items.id, input.itemId));
  if (!row) return { ok: false, error: `No item found for id ${input.itemId}` };

  const metaPairs: Array<[string, string]> = [
    ["Type", row.type],
    ["Folder", row.folder || "(root)"],
    ["Updated", row.updatedAt instanceof Date ? row.updatedAt.toISOString().slice(0, 10) : String(row.updatedAt)],
  ];
  if (row.tags?.length) metaPairs.push(["Tags", row.tags.join(", ")]);
  if (row.summary) metaPairs.push(["Summary", row.summary]);
  if (row.links?.length) metaPairs.push(["Outgoing links", `${row.links.length}`]);

  // Body discipline: cap at ~4KB so the LLM doesn't choke on a 30-page note.
  // The model can call read_section / read_pdf_page for deeper slices.
  const fullBody = row.content ?? "";
  const truncated = fullBody.length > 4000;
  const bodyMd = input.metaOnly ? undefined : truncated ? fullBody.slice(0, 4000) + "\n\n…[truncated]" : fullBody;

  return {
    ok: true,
    summary: `Loaded "${row.title}" (${row.type}, ${row.content?.length ?? 0} chars${
      truncated ? ", truncated" : ""
    })`,
    refs: [
      {
        itemId: row.id,
        title: row.title,
        type: row.type,
        folder: row.folder,
        snippet: row.summary || "",
      },
    ],
    ui: {
      kind: "item-detail",
      itemId: row.id,
      title: row.title,
      bodyMd,
      metaPairs,
    },
  };
}
