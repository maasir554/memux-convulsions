import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";

import { ITEMS_DDL, items, type DbItem, type NewDbItem } from "@/lib/db/schema";
import { NOTES, type ItemType, type Note } from "@/lib/mock-notes";

type Schema = { items: typeof items };
export type VaultDb = PgliteDatabase<Schema>;

let dbPromise: Promise<VaultDb> | null = null;

/** Lazily create (once) the PGlite-backed, IndexedDB-persisted vault DB. */
export function getVaultDb(): Promise<VaultDb> {
  if (!dbPromise) dbPromise = create();
  return dbPromise;
}

async function create(): Promise<VaultDb> {
  const client = await PGlite.create("idb://galexy", {
    relaxedDurability: true,
  });
  await client.exec(ITEMS_DDL);
  const db = drizzle(client, { schema: { items } });
  await seedIfEmpty(db);
  return db;
}

async function seedIfEmpty(db: VaultDb): Promise<void> {
  const [row] = await db
    .select({ count: sql<string>`count(*)` })
    .from(items);
  if (Number(row?.count ?? 0) > 0) return;
  await db.insert(items).values(NOTES.map(noteToRow));
}

// --- mapping -----------------------------------------------------------------

function noteToRow(note: Note): NewDbItem {
  return {
    id: note.id,
    title: note.title,
    folder: note.folder,
    type: note.type as DbItem["type"],
    summary: note.summary,
    content: note.content,
    tags: note.tags,
    links: note.links ?? [],
    language: note.language ?? null,
    src: note.src ?? null,
    blobKey: null,
    updatedAt: note.updatedAt ? new Date(note.updatedAt) : new Date(),
  };
}

function rowToNote(row: DbItem): Note {
  return {
    id: row.id,
    title: row.title,
    folder: row.folder,
    type: row.type as ItemType,
    summary: row.summary,
    content: row.content,
    tags: row.tags,
    links: row.links,
    language: row.language ?? undefined,
    src: row.src ?? undefined,
    updatedAt: row.updatedAt.toISOString().slice(0, 10),
  };
}

// --- queries -----------------------------------------------------------------

export async function loadAllItems(db: VaultDb): Promise<Note[]> {
  const rows = await db.select().from(items);
  return rows.map(rowToNote);
}

export async function persistContent(
  db: VaultDb,
  id: string,
  content: string,
): Promise<void> {
  await db
    .update(items)
    .set({ content, updatedAt: new Date() })
    .where(eq(items.id, id));
}
