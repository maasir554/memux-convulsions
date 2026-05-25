import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export type DbItem = typeof items.$inferSelect;
export type NewDbItem = typeof items.$inferInsert;

// Raw DDL for first-run table creation (we seed instead of using drizzle-kit).
export const ITEMS_DDL = `
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
  updated_at timestamp NOT NULL DEFAULT now()
);
`;
