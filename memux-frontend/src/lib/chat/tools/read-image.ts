"use client";

/**
 * Read a vault image — returns the agent-generated description (from the
 * image-reader pass at indexing time) + the OPFS blob key so the UI can
 * render the actual bytes alongside the model's answer.
 *
 * The description is what the model "sees" — we don't ship the bytes to
 * the LLM here (the agent already analysed it once; re-reading would
 * burn tokens). If the model genuinely needs to look at the image
 * again, it can call read_pdf_page-style passes, but for DOM-captured
 * images the indexed description is the canonical view.
 */

import { eq } from "drizzle-orm";

import { getVaultDb } from "@/lib/db/vault-db";
import { items } from "@/lib/db/schema";
import type { ToolResult } from "@/lib/chat/types";

export type ReadImageInput = { itemId: string };

export async function readImage(input: ReadImageInput): Promise<ToolResult> {
  const db = await getVaultDb();
  const [row] = await db.select().from(items).where(eq(items.id, input.itemId));
  if (!row) return { ok: false, error: `No item ${input.itemId}` };
  if (row.type !== "image") return { ok: false, error: `Item ${input.itemId} is ${row.type}, not an image` };

  // Stripped item-detail summary for the model. The actual image bytes
  // live behind the OPFS blob key — UI uses useBlobUrl to render them.
  const description = (row.content ?? "").trim() || row.summary || "(no description)";
  return {
    ok: true,
    summary: `Image "${row.title}": ${description.slice(0, 200)}`,
    refs: [
      {
        itemId: row.id,
        title: row.title,
        type: row.type,
        folder: row.folder,
        snippet: description.slice(0, 160),
      },
    ],
    ui: {
      kind: "image-read",
      itemId: row.id,
      alt: row.summary || row.title,
      description,
      blobKey: row.blobKey ?? undefined,
      src: row.src ?? undefined,
    },
  };
}
