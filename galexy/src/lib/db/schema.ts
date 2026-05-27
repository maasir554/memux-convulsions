import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { PdfAnnotation, SheetMeta } from "@/lib/mock-notes";

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
  blobKey: text("blob_key"),
  sheetMeta: jsonb("sheet_meta").$type<SheetMeta>(),
  pdfAnnotations: jsonb("pdf_annotations").$type<PdfAnnotation[]>(),
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
];
