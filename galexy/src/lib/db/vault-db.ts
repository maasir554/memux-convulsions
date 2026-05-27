import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { and, eq, sql } from "drizzle-orm";

import {
  FOLDERS_CREATE,
  INDEXER_DDL,
  ITEMS_CREATE,
  ITEMS_MIGRATIONS,
  concepts,
  folders,
  indexChunks,
  indexRuns,
  indexTargets,
  items,
  sections,
  type DbItem,
  type NewDbItem,
} from "@/lib/db/schema";
import {
  NOTES,
  type ItemType,
  type Note,
  type PdfAnnotation,
  type SheetMeta,
} from "@/lib/mock-notes";

type Schema = {
  items: typeof items;
  folders: typeof folders;
  indexRuns: typeof indexRuns;
  indexTargets: typeof indexTargets;
  sections: typeof sections;
  indexChunks: typeof indexChunks;
  concepts: typeof concepts;
};
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
    extensions: { vector },
  });
  // pgvector first — index_chunks / concepts both declare vector(1536) columns.
  try {
    await client.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  } catch (err) {
    console.warn("[vault] pgvector enable failed:", err);
  }
  await client.exec(ITEMS_CREATE);
  await client.exec(FOLDERS_CREATE);
  // Run each migration in its own exec so one statement can't shadow the next
  // (and existing DBs created before a column was added still pick it up).
  for (const stmt of ITEMS_MIGRATIONS) {
    try {
      await client.exec(stmt);
    } catch (err) {
      console.warn("[vault] migration failed:", stmt, err);
    }
  }
  // Indexer tables — each in its own exec so a single CREATE INDEX failure
  // can't shadow the table beneath it.
  for (const stmt of INDEXER_DDL) {
    try {
      await client.exec(stmt);
    } catch (err) {
      console.warn("[vault] indexer DDL failed:", stmt, err);
    }
  }
  const db = drizzle(client, {
    schema: { items, folders, indexRuns, indexTargets, sections, indexChunks, concepts },
  });
  await seedIfEmpty(db);
  await applyContentUpgrades(db);
  return db;
}

async function seedIfEmpty(db: VaultDb): Promise<void> {
  const [row] = await db
    .select({ count: sql<string>`count(*)` })
    .from(items);
  if (Number(row?.count ?? 0) > 0) return;
  await db.insert(items).values(NOTES.map(noteToRow));
}

/**
 * Idempotent: if any seeded item still has empty content (e.g. an existing DB
 * was seeded before this content was added), fill it. Safe across reloads —
 * only touches rows whose content is still "".
 */
async function applyContentUpgrades(db: VaultDb): Promise<void> {
  for (const seed of NOTES) {
    if (!seed.content) continue;
    await db
      .update(items)
      .set({ content: seed.content, updatedAt: new Date() })
      .where(and(eq(items.id, seed.id), eq(items.content, "")));
  }
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
    blobKey: note.blobKey ?? null,
    sheetMeta: note.sheetMeta ?? null,
    pdfAnnotations: note.pdfAnnotations ?? null,
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
    blobKey: row.blobKey ?? undefined,
    sheetMeta: row.sheetMeta ?? undefined,
    pdfAnnotations: row.pdfAnnotations ?? undefined,
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

export async function persistSheetMeta(
  db: VaultDb,
  id: string,
  sheetMeta: SheetMeta,
): Promise<void> {
  await db
    .update(items)
    .set({ sheetMeta, updatedAt: new Date() })
    .where(eq(items.id, id));
}

export async function persistPdfAnnotations(
  db: VaultDb,
  id: string,
  pdfAnnotations: PdfAnnotation[],
): Promise<void> {
  await db
    .update(items)
    .set({ pdfAnnotations, updatedAt: new Date() })
    .where(eq(items.id, id));
}

export async function insertItem(db: VaultDb, note: Note): Promise<void> {
  await db.insert(items).values(noteToRow(note));
}

export async function loadAllFolders(db: VaultDb): Promise<string[]> {
  const rows = await db.select({ name: folders.name }).from(folders);
  return rows.map((r) => r.name);
}

export async function insertFolder(db: VaultDb, name: string): Promise<void> {
  // ON CONFLICT DO NOTHING so re-creating an existing folder is a no-op.
  await db.insert(folders).values({ name }).onConflictDoNothing();
}

/**
 * Delete an item and return its previous blob_key (if any) so the caller can
 * also clean up the OPFS blob. Returns null if the row didn't exist.
 */
export async function deleteItem(
  db: VaultDb,
  id: string,
): Promise<string | null> {
  const rows = await db
    .delete(items)
    .where(eq(items.id, id))
    .returning({ blobKey: items.blobKey });
  return rows[0]?.blobKey ?? null;
}

/**
 * Delete a folder row AND every nested folder beneath it. Without the
 * subtree wipe, buildNestedTree would re-create the parent on next render
 * from any surviving descendant's path.
 */
export async function deleteFolderName(
  db: VaultDb,
  name: string,
): Promise<void> {
  await db
    .delete(folders)
    .where(
      sql`${folders.name} = ${name} OR ${folders.name} LIKE ${`${name}/%`}`,
    );
}
