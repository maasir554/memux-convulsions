"use client";

/**
 * Find a region inside a vault image item that matches a natural-language
 * query. Reads the OPFS blob → runs the regionFinder agent → returns a
 * bbox. The chat reply embeds the result as
 * `![alt](wikilink:<itemId>#bbox=<bboxId>)`, reusing the same markdown
 * renderer the indexer's section md uses.
 *
 * The bbox is also persisted to the image's `bboxes` jsonb so the user
 * can find this region again later (e.g. via get_item) without burning
 * another LLM call.
 */

import { eq } from "drizzle-orm";

import { getVaultDb } from "@/lib/db/vault-db";
import { items } from "@/lib/db/schema";
import { readBlobUrl } from "@/lib/blob-store";
import {
  fetchBytes,
  renderPdfPageToCanvas,
} from "@/lib/pdf-render";
import { regionFinderCall } from "@/lib/indexer/agent-client";
import { recordBboxOnSource } from "@/lib/indexer/materialise";
import type { ToolResult } from "@/lib/chat/types";

export type FindImageRegionInput = {
  itemId: string;
  query: string;
  /** 1-based page, required when the item is a pdf. */
  page?: number;
};

export async function findImageRegion(
  input: FindImageRegionInput,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const q = input.query.trim();
  if (!q) return { ok: false, error: "Empty query" };

  const db = await getVaultDb();
  const [row] = await db.select().from(items).where(eq(items.id, input.itemId));
  if (!row) return { ok: false, error: `No item ${input.itemId}` };
  if (row.type !== "image" && row.type !== "pdf") {
    return { ok: false, error: `Item ${input.itemId} is ${row.type}, not an image or pdf` };
  }

  // Resolve the bytes to send to the region finder:
  //   • image → the stored bytes
  //   • pdf   → rasterise the requested page on demand (we store the original
  //             PDF, not page screenshots)
  let base64: string;
  let mimeType: string;
  let page: number | undefined;
  if (row.type === "pdf") {
    page = input.page;
    if (!page || page < 1) {
      return { ok: false, error: "Item is a pdf — pass a 1-based `page` to search." };
    }
    const url = row.blobKey ? await readBlobUrl(row.blobKey) : row.src;
    if (!url) return { ok: false, error: "PDF has no bytes to read" };
    try {
      const bytes = await fetchBytes(url);
      const canvas = await renderPdfPageToCanvas(bytes, page);
      base64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
    } finally {
      if (row.blobKey) URL.revokeObjectURL(url);
    }
    mimeType = "image/png";
  } else {
    if (!row.blobKey) return { ok: false, error: "Image has no OPFS blob to read" };
    base64 = await readBlobAsBase64(row.blobKey);
    mimeType = guessMime(row.title, row.src) || "image/png";
  }

  const out = await regionFinderCall(
    { imageBase64: base64, mimeType, query: q },
    signal,
  );

  if (!out.bbox) {
    return {
      ok: true,
      summary: `No "${q}" region found in ${row.title}.`,
      refs: [],
      ui: {
        kind: "item-detail",
        itemId: row.id,
        title: row.title,
        metaPairs: [["Searched for", q], ["Result", out.caption || "not found"]],
      },
    };
  }

  const { bboxId } = await recordBboxOnSource({
    sourceItemId: row.id,
    bbox: out.bbox,
    alt: out.caption || q,
    caption: out.caption || q,
    page,
    source: "chat-agent",
  });

  // The chat reply can now reference this region inline.
  const refLink = `wikilink:${row.id}#bbox=${bboxId}`;
  return {
    ok: true,
    summary: `Found "${q}" in ${row.title} (confidence ${out.confidence || "n/a"}). Reference: ![${out.caption || q}](${refLink})`,
    refs: [
      {
        itemId: row.id,
        title: row.title,
        type: row.type,
        folder: row.folder,
        snippet: out.caption,
      },
    ],
    ui: {
      kind: "item-detail",
      itemId: row.id,
      title: row.title,
      metaPairs: [
        ["Searched for", q],
        ["Match", out.caption || "(no caption)"],
        ["Confidence", out.confidence || "n/a"],
        ["BBox", out.bbox.join(", ")],
        ["Reference", `![${out.caption || q}](${refLink})`],
      ],
    },
  };
}

/* ----------------------------------------------------- helpers */

async function readBlobAsBase64(blobKey: string): Promise<string> {
  const url = await readBlobUrl(blobKey);
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = String(reader.result ?? "");
        const idx = dataUrl.indexOf("base64,");
        if (idx < 0) {
          reject(new Error("Reader returned non-base64 data URL"));
          return;
        }
        resolve(dataUrl.slice(idx + "base64,".length));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function guessMime(title: string, src: string | null | undefined): string | null {
  const haystack = `${title} ${src ?? ""}`.toLowerCase();
  if (haystack.endsWith(".png") || haystack.includes(".png")) return "image/png";
  if (haystack.endsWith(".jpg") || haystack.endsWith(".jpeg")) return "image/jpeg";
  if (haystack.endsWith(".webp")) return "image/webp";
  if (haystack.endsWith(".gif")) return "image/gif";
  return null;
}
