import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import type { ImageBbox, PdfAnnotation, SheetMeta } from "@/lib/mock-notes";

// Empty folders need a home of their own — folders are otherwise derived from
// the files they contain, so an empty folder would vanish on reload.
export const folders = pgTable("folders", {
  name: text("name").primaryKey(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export type DbFolder = typeof folders.$inferSelect;
export type NewDbFolder = typeof folders.$inferInsert;

export const FOLDERS_CREATE = `
CREATE TABLE IF NOT EXISTS folders (
  name text PRIMARY KEY,
  created_at timestamp NOT NULL DEFAULT now()
);
`;

// Files only (markdown/code/csv/pdf/image). Folders are derived at runtime,
// not stored. Binaries live in OPFS with their key in blob_key.
export const items = pgTable("items", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  folder: text("folder").notNull().default(""),
  type: text("type", {
    enum: ["markdown", "code", "csv", "pdf", "image"],
  }).notNull(),
  summary: text("summary").notNull().default(""),
  content: text("content").notNull().default(""),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  links: jsonb("links").$type<string[]>().notNull().default([]),
  language: text("language"),
  src: text("src"),
  /**
   * Original web URL the item came from. For capture-derived image items
   * this is the page the screenshot was taken from; chat surfaces it as a
   * "view source" affordance with the site's favicon. Null for items not
   * sourced from the web.
   */
  sourceUrl: text("source_url"),
  blobKey: text("blob_key"),
  sheetMeta: jsonb("sheet_meta").$type<SheetMeta>(),
  pdfAnnotations: jsonb("pdf_annotations").$type<PdfAnnotation[]>(),
  /**
   * For image-type items only: persistent bounding-box metadata so notes
   * can reference a region of the image without materialising a separate
   * cropped file. Each entry is one named region the indexer (or a chat
   * agent) recorded against this image.
   */
  bboxes: jsonb("bboxes").$type<ImageBbox[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export type DbItem = typeof items.$inferSelect;
export type NewDbItem = typeof items.$inferInsert;

// First-run table creation (we seed instead of using drizzle-kit).
export const ITEMS_CREATE = `
CREATE TABLE IF NOT EXISTS items (
  id text PRIMARY KEY,
  title text NOT NULL,
  folder text NOT NULL DEFAULT '',
  type text NOT NULL,
  summary text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  links jsonb NOT NULL DEFAULT '[]'::jsonb,
  language text,
  src text,
  blob_key text,
  sheet_meta jsonb,
  pdf_annotations jsonb,
  updated_at timestamp NOT NULL DEFAULT now()
);
`;

// Idempotent post-create migrations for columns added after the initial table
// existed in someone's IndexedDB. Each statement must be safe to re-run on
// every load, and is executed independently so one failing can't shadow the
// next.
export const ITEMS_MIGRATIONS: readonly string[] = [
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS sheet_meta jsonb;`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS pdf_annotations jsonb;`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS bboxes jsonb NOT NULL DEFAULT '[]'::jsonb;`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS source_url text;`,
];

// ===========================================================================
// Indexer schema — runs, sections, vectors, concepts.
// pgvector is enabled at boot (see vault-db.ts). Embedding dim = 1536,
// matryoshka-truncated from gemini-embedding-001's native 3072 and manually
// L2-normalised on the way in.
// ===========================================================================

export type RunStatus =
  | "draft"
  | "queued"
  | "preparing"
  | "walking"
  | "sectioning"
  | "summarising"
  | "embedding"
  | "naming"
  | "finalising"
  | "done"
  | "failed"
  | "cancelled";

export type SectionTransition = "continue" | "end" | "new";

export type IndexerFileRef = {
  /** Stable id used to address the file inside the run; not the items.id. */
  id: string;
  /** Omitted on legacy attachments; those are treated as regular files. */
  sourceKind?: "file" | "text";
  name: string;
  size: number;
  mimeType: string;
  /** OPFS blob_key once the file has been uploaded to OPFS. Null while still in draft (browser File). */
  blobKey?: string | null;
  /** Optional user heading for a pasted-text source. */
  heading?: string;
  /** Inline body for a pasted-text source; avoids an unnecessary OPFS blob. */
  inlineText?: string;
};

/**
 * An image extracted from the captured page's DOM. Stored as a vault item by
 * the orchestrator's finalising phase, so the section md / manifest can
 * reference it via `wikilink:dom-N`.
 */
export type IndexerDomImage = {
  /** Original page URL the image was loaded from. */
  src: string;
  alt?: string;
  /** OPFS blob_key where the fetched bytes live. */
  blobKey: string;
  mimeType: string;
  width?: number;
  height?: number;
  /**
   * Image-reader agent output, populated at finalise. Stored back on the
   * group so re-rendering the manifest or re-embedding can re-use the
   * agent's read without burning another LLM call.
   */
  description?: string;
  tags?: string[];
  /** "decorative" images get filtered out before this even gets set. */
  readerKind?: "ui" | "content";
};

export const indexRuns = pgTable("index_runs", {
  id: text("id").primaryKey(),
  /** Position in the queue (lower = earlier). Set to NULL once status moves past `queued`. */
  queuePosition: integer("queue_position"),
  status: text("status").$type<RunStatus>().notNull().default("draft"),
  /** User-supplied (empty → Namer fills it on completion). */
  groupName: text("group_name").notNull().default(""),
  /** User-supplied context prompt. */
  prompt: text("prompt").notNull().default(""),
  /** Files attached to this group. */
  files: jsonb("files").$type<IndexerFileRef[]>().notNull().default([]),
  /**
   * Images extracted from the captured page's DOM (when this group came from
   * a worksmith capture). Materialised as vault items during finalising so
   * they become wikilink-addressable inside the section md / manifest.
   */
  domImages: jsonb("dom_images")
    .$type<IndexerDomImage[]>()
    .notNull()
    .default([]),
  /**
   * Pruned accessibility tree from a worksmith capture, when present. The
   * orchestrator walks it for {text → href} link enrichment + emits the
   * node count to live-progress so the UI can show "Read tree (N nodes)".
   * Shape mirrors the extension's `TreeNode`; stored as unknown jsonb here
   * so we don't have to mirror the type across packages.
   */
  prunedTree: jsonb("pruned_tree").$type<unknown>(),
  /** Live agent notepad. Markdown. */
  scratchpadMd: text("scratchpad_md").notNull().default(""),
  /** The _Indexes/<group>/ folder name once materialised. */
  folderName: text("folder_name"),
  error: text("error"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { mode: "date" }),
  finishedAt: timestamp("finished_at", { mode: "date" }),
});

export type DbIndexRun = typeof indexRuns.$inferSelect;
export type NewDbIndexRun = typeof indexRuns.$inferInsert;

export const INDEX_RUNS_CREATE = `
CREATE TABLE IF NOT EXISTS index_runs (
  id text PRIMARY KEY,
  queue_position integer,
  status text NOT NULL DEFAULT 'draft',
  group_name text NOT NULL DEFAULT '',
  auto_name text NOT NULL DEFAULT 'false',
  prompt text NOT NULL DEFAULT '',
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  scratchpad_md text NOT NULL DEFAULT '',
  folder_name text,
  error text,
  created_at timestamp NOT NULL DEFAULT now(),
  started_at timestamp,
  finished_at timestamp
);
`;

/** Per-file progress inside a run. One row per file the run is responsible for. */
export const indexTargets = pgTable("index_targets", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  fileRefId: text("file_ref_id").notNull(),
  status: text("status").$type<RunStatus | "pending">().notNull().default("pending"),
  totalSections: integer("total_sections").notNull().default(0),
  doneSections: integer("done_sections").notNull().default(0),
  error: text("error"),
});

export const INDEX_TARGETS_CREATE = `
CREATE TABLE IF NOT EXISTS index_targets (
  id text PRIMARY KEY,
  run_id text NOT NULL,
  file_ref_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  total_sections integer NOT NULL DEFAULT 0,
  done_sections integer NOT NULL DEFAULT 0,
  error text
);
CREATE INDEX IF NOT EXISTS index_targets_run_id ON index_targets (run_id);
`;

/**
 * One row per discrete chunk of source content: PDF page, markdown heading
 * section, CSV table, image. Carries the polished summary + extracted
 * concepts + questions. The actual md materialised into _Indexes/<Group>/
 * lives in items as usual; this row points to it via item_id.
 */
export const sections = pgTable("sections", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  /** The source file the section came from (the items.id of the uploaded source). */
  sourceItemId: text("source_item_id").notNull(),
  /** The materialised section markdown row in items (Section NN · topic.md). Null until written. */
  noteItemId: text("note_item_id"),
  ordinal: integer("ordinal").notNull(),
  kind: text("kind", {
    enum: ["pdf-page", "md-heading", "csv-table", "image", "code-symbol"],
  }).notNull(),
  /** Topic label the Visioner assigned. */
  topic: text("topic").notNull().default(""),
  /** Cache key — re-running with the same hash short-circuits to existing summary/concepts. */
  contentHash: text("content_hash").notNull().default(""),
  contentText: text("content_text").notNull().default(""),
  summary: text("summary").notNull().default(""),
  questions: jsonb("questions").$type<string[]>().notNull().default([]),
  concepts: jsonb("concepts").$type<string[]>().notNull().default([]),
  /** Diagrams cropped from the source: [{ blobKey, caption, alt, bbox }]. */
  images: jsonb("images")
    .$type<Array<{ blobKey: string; caption: string; alt: string; bbox?: [number, number, number, number] }>>()
    .notNull()
    .default([]),
  /**
   * External hyperlinks associated with this section. Populated at index
   * time from three sources, deduped by href:
   *   - "tree":         href came from a role=link node in the pruned a11y tree
   *                     whose anchor text the Visioner mentioned in this section
   *   - "transcribed":  the Visioner wrote out the link verbatim as [text](url)
   *   - "bare-url":     a bare URL was found inline by post-process regex scan
   *
   * Surfaces in the section md (already inline) AND as a structured list the
   * chat agent can query via `get_section_links` without parsing prose.
   */
  links: jsonb("links")
    .$type<SectionLink[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

/**
 * One external link captured against a section. `anchor` is the visible
 * text the link appears under (best-effort — empty for bare URLs).
 */
export type SectionLink = {
  href: string;
  anchor: string;
  source: "tree" | "transcribed" | "bare-url";
};

export const SECTIONS_CREATE = `
CREATE TABLE IF NOT EXISTS sections (
  id text PRIMARY KEY,
  run_id text NOT NULL,
  source_item_id text NOT NULL,
  note_item_id text,
  ordinal integer NOT NULL,
  kind text NOT NULL,
  topic text NOT NULL DEFAULT '',
  content_hash text NOT NULL DEFAULT '',
  content_text text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  concepts jsonb NOT NULL DEFAULT '[]'::jsonb,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sections_run_id ON sections (run_id);
CREATE INDEX IF NOT EXISTS sections_source_item ON sections (source_item_id);
CREATE INDEX IF NOT EXISTS sections_content_hash ON sections (content_hash);
`;

/**
 * Embeddings live in their own table — three flavours per section (summary,
 * each question, each concept). pgvector handles ANN. drizzle has no first-
 * class `vector` column, so we declare it as the raw SQL type and use the
 * client API for ops.
 */
export const indexChunks = pgTable("index_chunks", {
  id: text("id").primaryKey(),
  sectionId: text("section_id").notNull(),
  kind: text("kind", {
    enum: ["summary", "question", "concept"],
  }).notNull(),
  text: text("text").notNull(),
  // declare for typing; the actual column is vector(1536) — see DDL below.
  embedding: jsonb("embedding").$type<number[]>().notNull().default(
    sql`'[]'::jsonb`,
  ),
});

export const INDEX_CHUNKS_CREATE = `
CREATE TABLE IF NOT EXISTS index_chunks (
  id text PRIMARY KEY,
  section_id text NOT NULL,
  kind text NOT NULL,
  text text NOT NULL,
  embedding vector(1536)
);
CREATE INDEX IF NOT EXISTS index_chunks_section ON index_chunks (section_id);
`;

/**
 * Emergent concepts surfaced across runs. Merged by cosine similarity above
 * a threshold (default 0.85) rather than string equality, so "RAG" /
 * "Retrieval-Augmented Generation" collapse into one node.
 */
export const concepts = pgTable("concepts", {
  id: text("id").primaryKey(),
  /** Items row that holds the concept's markdown body (under _Concepts/). */
  noteItemId: text("note_item_id"),
  name: text("name").notNull(),
  /** Sections that mention this concept: [{section_id, run_id}]. */
  refs: jsonb("refs")
    .$type<Array<{ sectionId: string; runId: string }>>()
    .notNull()
    .default([]),
});

export const CONCEPTS_CREATE = `
CREATE TABLE IF NOT EXISTS concepts (
  id text PRIMARY KEY,
  note_item_id text,
  name text NOT NULL,
  refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  embedding vector(1536)
);
CREATE INDEX IF NOT EXISTS concepts_name ON concepts (name);
`;

/** Run these once at boot, after CREATE EXTENSION vector. */
export const INDEXER_DDL: readonly string[] = [
  INDEX_RUNS_CREATE,
  INDEX_TARGETS_CREATE,
  SECTIONS_CREATE,
  INDEX_CHUNKS_CREATE,
  CONCEPTS_CREATE,
];

/**
 * Forward-compatible column adds for the indexer tables. Each is idempotent
 * (IF NOT EXISTS) so a running DB picks them up on next boot.
 */
export const INDEXER_MIGRATIONS: readonly string[] = [
  `ALTER TABLE index_runs ADD COLUMN IF NOT EXISTS dom_images jsonb NOT NULL DEFAULT '[]'::jsonb;`,
  `ALTER TABLE index_runs ADD COLUMN IF NOT EXISTS pruned_tree jsonb;`,
  `ALTER TABLE sections ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb;`,
];

export type DbSection = typeof sections.$inferSelect;
export type DbIndexChunk = typeof indexChunks.$inferSelect;
export type DbConcept = typeof concepts.$inferSelect;
export type DbIndexTarget = typeof indexTargets.$inferSelect;
