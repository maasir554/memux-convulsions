import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { and, eq, sql } from "drizzle-orm";

import {
  FOLDERS_CREATE,
  INDEXER_DDL,
  INDEXER_MIGRATIONS,
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
  type ImageBbox,
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

const LEGACY_WELCOME_CONTENT = `# Welcome to galexy

This is a graph-based notebook, inspired by [[MEMUX]] and Obsidian.

## Get started
- Open notes from the file explorer on the left
- Follow a link like [[Graph View]] or [[Zettelkasten]]
- Watch the **Backlinks** panel on the right update as you browse

> [!note] Tip
> Everything here is mock data for the shell. Real editing comes next.

#start`;

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
  for (const stmt of INDEXER_MIGRATIONS) {
    try {
      await client.exec(stmt);
    } catch (err) {
      console.warn("[vault] indexer migration failed:", stmt, err);
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

  // Carry existing untouched starter vaults into the unified MEMUX language.
  // Exact-content matching protects anyone who has edited their Welcome note.
  const welcome = NOTES.find((seed) => seed.id === "welcome");
  if (welcome) {
    await db
      .update(items)
      .set({
        content: welcome.content,
        summary: welcome.summary,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(items.id, welcome.id),
          eq(items.content, LEGACY_WELCOME_CONTENT),
        ),
      );
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
    sourceUrl: note.sourceUrl ?? null,
    blobKey: note.blobKey ?? null,
    sheetMeta: note.sheetMeta ?? null,
    pdfAnnotations: note.pdfAnnotations ?? null,
    bboxes: note.bboxes ?? [],
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
    sourceUrl: row.sourceUrl ?? undefined,
    blobKey: row.blobKey ?? undefined,
    sheetMeta: row.sheetMeta ?? undefined,
    pdfAnnotations: row.pdfAnnotations ?? undefined,
    bboxes: row.bboxes ?? undefined,
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

/**
 * Append a bounding-box region to an image item's `bboxes` jsonb. Pure
 * metadata write — no PNG encoding, no separate item row. The indexer
 * calls this for every Visioner diagram instead of materialising a crop.
 */
export async function appendBbox(
  db: VaultDb,
  id: string,
  bbox: ImageBbox,
): Promise<void> {
  const [row] = await db
    .select({ bboxes: items.bboxes })
    .from(items)
    .where(eq(items.id, id));
  const existing = (row?.bboxes ?? []) as ImageBbox[];
  await db
    .update(items)
    .set({ bboxes: [...existing, bbox], updatedAt: new Date() })
    .where(eq(items.id, id));
}

/** Replace the manually-added outgoing-links list on an item. */
export async function persistLinks(
  db: VaultDb,
  id: string,
  links: string[],
): Promise<void> {
  await db
    .update(items)
    .set({ links, updatedAt: new Date() })
    .where(eq(items.id, id));
}

/** Move an item to a different folder path. "" moves to vault root. */
export async function persistItemFolder(
  db: VaultDb,
  id: string,
  folder: string,
): Promise<void> {
  await db
    .update(items)
    .set({ folder, updatedAt: new Date() })
    .where(eq(items.id, id));
}

/** Rename an item — just the title. */
export async function persistTitle(
  db: VaultDb,
  id: string,
  title: string,
): Promise<void> {
  await db
    .update(items)
    .set({ title, updatedAt: new Date() })
    .where(eq(items.id, id));
}

/**
 * Rename a folder path AND every nested folder + every item that lives
 * under it. The rename is a prefix swap: `oldPath` itself plus any descendant
 * (`${oldPath}/...`) is rewritten to use `newPath`.
 */
export async function renameFolderPath(
  db: VaultDb,
  oldPath: string,
  newPath: string,
): Promise<void> {
  if (oldPath === newPath) return;
  const oldPrefix = `${oldPath}/`;
  // items: exact match → newPath
  await db
    .update(items)
    .set({ folder: newPath, updatedAt: new Date() })
    .where(eq(items.folder, oldPath));
  // items: under oldPrefix → rewrite prefix
  await db.execute(
    sql`UPDATE items
        SET folder = ${newPath} || substring(folder FROM ${oldPath.length + 1}),
            updated_at = now()
        WHERE folder LIKE ${oldPrefix + "%"}`,
  );
  // folders: nested rows first (so the row for the bare path can still be
  // matched after if we did it the other way around the prefix selector
  // would no longer match — but either order works because we're using the
  // OLD path in both WHEREs).
  await db.execute(
    sql`UPDATE folders
        SET name = ${newPath} || substring(name FROM ${oldPath.length + 1})
        WHERE name LIKE ${oldPrefix + "%"}`,
  );
  // folders: the bare row
  await db
    .update(folders)
    .set({ name: newPath })
    .where(eq(folders.name, oldPath));
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
