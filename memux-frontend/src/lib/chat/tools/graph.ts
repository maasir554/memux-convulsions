"use client";

/**
 * Graph navigation tools — backlinks, outlinks, folder contents,
 * 1- or 2-hop neighborhood expansion. The vault doesn't ship a
 * dedicated link graph table; items.links carries the outgoing edges
 * as titles. We resolve titles → ids via a single in-memory pass.
 */

import { eq, like, or } from "drizzle-orm";

import { getVaultDb } from "@/lib/db/vault-db";
import { items } from "@/lib/db/schema";
import type { ItemType } from "@/lib/mock-notes";
import type { ToolResult } from "@/lib/chat/types";

/* ------------------------------------------------------------ backlinks */

export type GetBacklinksInput = { itemId: string; limit?: number };

export async function getBacklinks(input: GetBacklinksInput): Promise<ToolResult> {
  const db = await getVaultDb();
  const [self] = await db.select().from(items).where(eq(items.id, input.itemId));
  if (!self) return { ok: false, error: `No item ${input.itemId}` };

  // Postgres jsonb @> '"title"' tests array containment. We rely on the
  // fact that `links` is jsonb of string titles.
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
  const rows = await db
    .select({ id: items.id, title: items.title, type: items.type, folder: items.folder, summary: items.summary })
    .from(items)
    .where(eq(items.links as never, [self.title] as never))
    .limit(limit);

  const refs = rows.map((r) => ({
    itemId: r.id,
    title: r.title,
    type: r.type as ItemType,
    folder: r.folder,
    snippet: r.summary,
  }));
  return {
    ok: true,
    summary: `Backlinks to "${self.title}": ${refs.length}.`,
    refs,
    ui: {
      kind: "graph-fan",
      centerItemId: self.id,
      incoming: refs,
      outgoing: [],
    },
  };
}

/* ------------------------------------------------------------- outlinks */

export type GetOutlinksInput = { itemId: string };

export async function getOutlinks(input: GetOutlinksInput): Promise<ToolResult> {
  const db = await getVaultDb();
  const [self] = await db.select().from(items).where(eq(items.id, input.itemId));
  if (!self) return { ok: false, error: `No item ${input.itemId}` };

  const titles = Array.isArray(self.links) ? self.links : [];
  if (titles.length === 0) {
    return {
      ok: true,
      summary: `"${self.title}" has no outgoing links.`,
      refs: [],
      ui: { kind: "graph-fan", centerItemId: self.id, incoming: [], outgoing: [] },
    };
  }

  const rows = await db
    .select({ id: items.id, title: items.title, type: items.type, folder: items.folder, summary: items.summary })
    .from(items)
    .where(or(...titles.map((t) => eq(items.title, t))));

  const refs = rows.map((r) => ({
    itemId: r.id,
    title: r.title,
    type: r.type as ItemType,
    folder: r.folder,
    snippet: r.summary,
  }));
  return {
    ok: true,
    summary: `"${self.title}" links to ${refs.length} item${refs.length === 1 ? "" : "s"}.`,
    refs,
    ui: {
      kind: "graph-fan",
      centerItemId: self.id,
      incoming: [],
      outgoing: refs,
    },
  };
}

/* ----------------------------------------------------- folder contents */

export type GetFolderContentsInput = { folderPath: string; recursive?: boolean };

export async function getFolderContents(input: GetFolderContentsInput): Promise<ToolResult> {
  const db = await getVaultDb();
  const path = input.folderPath;
  const rows = input.recursive
    ? await db
        .select({ id: items.id, title: items.title, type: items.type, folder: items.folder, summary: items.summary })
        .from(items)
        .where(or(eq(items.folder, path), like(items.folder, `${path}/%`)))
        .limit(100)
    : await db
        .select({ id: items.id, title: items.title, type: items.type, folder: items.folder, summary: items.summary })
        .from(items)
        .where(eq(items.folder, path))
        .limit(100);

  const refs = rows.map((r) => ({
    itemId: r.id,
    title: r.title,
    type: r.type as ItemType,
    folder: r.folder,
    snippet: r.summary,
  }));
  return {
    ok: true,
    summary: `Folder "${path}" ${input.recursive ? "(recursive)" : ""}: ${refs.length} item${refs.length === 1 ? "" : "s"}.`,
    refs,
    ui: { kind: "folder-list", folderPath: path, entries: refs },
  };
}
