"use client";

/**
 * Materialiser — writes a finished run's output into the vault DB as real
 * `items` rows so the file explorer, graph view, and chat can all find it.
 *
 * Bypasses useVault and talks to PGlite directly: the orchestrator runs
 * outside any React render. The vault hook re-reads on mount, so the user
 * sees the new files next time they navigate to the main vault view.
 *
 * Layout (per run):
 *   _Indexes/<group-name>/
 *     _manifest.md
 *     Section 01 · <topic>.md
 *     Section 02 · <topic>.md
 *     ...
 *     images/                       (image blobs are vault items too, type=image)
 */

import { eq, inArray, sql } from "drizzle-orm";

import { insertFolder, insertItem, getVaultDb } from "@/lib/db/vault-db";
import { writeBlob } from "@/lib/blob-store";
import {
  folders,
  indexRuns,
  items,
  type IndexerDomImage,
} from "@/lib/db/schema";
import type { Note } from "@/lib/mock-notes";

const ROOT = "_Indexes";

/** Sanitise a folder/file segment so it's safe to use as a path component. */
export function sanitiseSegment(s: string): string {
  return s
    .trim()
    .replace(/[/\\:|*?"<>]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "Untitled";
}

export function indexFolderName(groupName: string): string {
  return `${ROOT}/${sanitiseSegment(groupName)}`;
}

export function imagesFolderName(groupName: string): string {
  return `${indexFolderName(groupName)}/images`;
}

/**
 * Folder for source captures — the original screenshots / rendered PDF
 * pages the run started from. These are first-class image items so
 * notes can wikilink them with `#bbox=…` fragments and bypass the old
 * crop-as-separate-file model.
 */
export function capturesFolderName(groupName: string): string {
  return `${indexFolderName(groupName)}/captures`;
}

/**
 * Returns the per-run folder path. Lazy: does NOT create any folder rows in
 * the DB up front. Each write function below calls `insertFolder` itself the
 * moment it has content to drop in. That way a run that fails before writing
 * anything leaves no orphan empty folders.
 */
export function planIndexFolders(groupName: string): string {
  return indexFolderName(groupName);
}

/**
 * One-shot cleanup. Drops `_Indexes` and any `_Indexes/<group>` /
 * `_Indexes/<group>/images` folder rows that have zero child items. Safe to
 * call on every indexer-page mount — it's a small query against PGlite.
 */
export async function cleanupEmptyIndexFolders(): Promise<number> {
  const db = await getVaultDb();
  const folderRows = await db
    .select({ name: folders.name })
    .from(folders)
    .where(sql`${folders.name} = ${ROOT} OR ${folders.name} LIKE ${ROOT + "/%"}`);
  const folderNames = folderRows.map((r) => r.name);
  if (folderNames.length === 0) return 0;

  const childCounts = await db
    .select({ folder: items.folder, n: sql<string>`count(*)` })
    .from(items)
    .where(inArray(items.folder, folderNames))
    .groupBy(items.folder);
  const hasChildren = new Set(
    childCounts
      .filter((r) => Number(r.n) > 0)
      .map((r) => r.folder),
  );
  const empties = folderNames.filter((n) => !hasChildren.has(n));
  for (const name of empties) {
    try {
      await db.delete(folders).where(eq(folders.name, name));
    } catch (err) {
      console.warn("[indexer] cleanup failed for", name, err);
    }
  }
  return empties.length;
}

/**
 * Atomically rename a group's `_Indexes/<old>/` subtree to `_Indexes/<new>/`.
 *
 * Steps, in order:
 *  1. Sanitise the new name; if it collapses to the same path as the old
 *     one, no-op (returns the existing name unchanged).
 *  2. Resolve uniqueness — if `_Indexes/<new>` already exists in the
 *     folders table (collision with another run), append " 2", " 3", … up
 *     to 99 before giving up and falling back to the old name.
 *  3. UPDATE items SET folder for the exact path and every descendant
 *     (matched by `folder LIKE oldPath/%`). Done in one SQL with SUBSTR so
 *     intermediate subtrees (e.g. `<old>/images`) come along for the ride.
 *  4. Insert remapped folders rows; delete the old ones.
 *  5. Update `index_runs.group_name` and `index_runs.folder_name` so the
 *     queue store + scratchpad reflect the new identity on next refresh.
 *
 * Returns the actually-used name so the caller can update its local var.
 */
export async function renameIndexGroup(
  runId: string,
  oldName: string,
  newName: string,
): Promise<{ finalName: string; finalPath: string }> {
  const db = await getVaultDb();
  const oldPath = indexFolderName(oldName);
  const oldSegment = sanitiseSegment(oldName);
  const desired = sanitiseSegment(newName);

  // No-op if the path doesn't actually change.
  if (desired === oldSegment) {
    return { finalName: oldName, finalPath: oldPath };
  }

  // Resolve uniqueness — avoid colliding with another run's _Indexes/<X>/.
  let finalSegment = desired;
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidatePath = `${ROOT}/${finalSegment}`;
    if (candidatePath === oldPath) break; // moving from this exact path
    const [hit] = await db
      .select({ name: folders.name })
      .from(folders)
      .where(eq(folders.name, candidatePath));
    if (!hit) break;
    finalSegment = `${desired} ${suffix}`;
    if (suffix === 99) {
      console.warn("[indexer] rename: gave up after 99 suffix attempts");
    }
  }
  const newPath = `${ROOT}/${finalSegment}`;
  if (newPath === oldPath) {
    return { finalName: oldName, finalPath: oldPath };
  }

  // Migrate every item under the old subtree. SUBSTR in PG is 1-indexed; for
  // an exact match (folder === oldPath) SUBSTR returns '' so we just get
  // newPath. For a descendant (oldPath/<rest>) we get '/<rest>' appended.
  await db.execute(sql`
    UPDATE items
    SET folder = ${newPath} || SUBSTR(folder, ${oldPath.length + 1})
    WHERE folder = ${oldPath} OR folder LIKE ${oldPath + "/%"}
  `);

  // Migrate the folders table: insert remapped rows, then delete the old ones.
  const subtree = await db
    .select({ name: folders.name })
    .from(folders)
    .where(
      sql`${folders.name} = ${oldPath} OR ${folders.name} LIKE ${oldPath + "/%"}`,
    );
  for (const row of subtree) {
    const remapped = newPath + row.name.slice(oldPath.length);
    await db.insert(folders).values({ name: remapped }).onConflictDoNothing();
  }
  // Make sure _Indexes/<new> exists even if the subtree query was empty
  // (e.g. lazy folder creation hadn't fired yet because no section was
  // materialised — unlikely on this code path but harmless).
  await db.insert(folders).values({ name: newPath }).onConflictDoNothing();
  await db.insert(folders).values({ name: ROOT }).onConflictDoNothing();
  await db
    .delete(folders)
    .where(
      sql`${folders.name} = ${oldPath} OR ${folders.name} LIKE ${oldPath + "/%"}`,
    );

  // Update the run row so subsequent reads see the new identity.
  await db
    .update(indexRuns)
    .set({ groupName: finalSegment, folderName: newPath })
    .where(eq(indexRuns.id, runId));

  return { finalName: finalSegment, finalPath: newPath };
}

/** Write a section md file. Returns the items.id. Creates folder rows lazily. */
/**
 * Persist an original source page (worksmith screenshot or rendered PDF
 * page) as a vault `image` item so notes can reference regions of it
 * via `wikilink:<itemId>#bbox=…`. The bytes already live in OPFS — we
 * just create the items row pointing at the same blob, no copy.
 *
 * Returns the items.id so callers can record bboxes against it later.
 */
export async function materialiseSourceCapture(opts: {
  groupName: string;
  /** Stable handle within the run (e.g. fileIdx-pageOrdinal). Used for the title. */
  ordinal: string;
  /** Optional caption / summary text. May be empty; updated by imageReader later. */
  summary?: string;
  blobKey?: string | null;
  /** Optional packaged-asset URL (legacy / pre-shipped images). */
  src?: string | null;
  /** Original web URL the capture was taken from (worksmith page URL). */
  sourceUrl?: string | null;
  /** Source-file mime so the viewer picks the right renderer. */
  mimeType?: string;
}): Promise<{ itemId: string; title: string }> {
  const db = await getVaultDb();
  const folder = capturesFolderName(opts.groupName);
  await insertFolder(db, ROOT);
  await insertFolder(db, indexFolderName(opts.groupName));
  await insertFolder(db, folder);
  const title = `cap-${opts.ordinal}`;
  const id = `idx-capture-${crypto.randomUUID()}`;
  const note: Note = {
    id,
    title,
    folder,
    type: "image",
    summary: (opts.summary ?? "").trim(),
    content: "",
    tags: ["indexed", "capture"],
    updatedAt: new Date().toISOString().slice(0, 10),
    blobKey: opts.blobKey ?? undefined,
    src: opts.src ?? undefined,
    sourceUrl: opts.sourceUrl ?? undefined,
    bboxes: [],
  };
  await insertItem(db, note);
  return { itemId: id, title };
}

/**
 * Update an already-materialised capture with the imageReader agent's
 * description (runs *after* the source page has been visualised, when
 * we have the LLM's summary in hand). Only writes if non-empty so a
 * failed reader call doesn't blank out an existing summary.
 */
export async function updateCaptureSummary(opts: {
  itemId: string;
  summary: string;
  /** Optional model-derived tag list to append to the item's tags. */
  tags?: string[];
}): Promise<void> {
  const summary = opts.summary.trim();
  if (!summary) return;
  const db = await getVaultDb();
  const [row] = await db
    .select({ tags: items.tags })
    .from(items)
    .where(eq(items.id, opts.itemId));
  const existingTags = (row?.tags ?? []) as string[];
  const merged = Array.from(
    new Set([...existingTags, ...(opts.tags?.filter((t) => t.trim()) ?? [])]),
  );
  await db
    .update(items)
    .set({ summary, tags: merged, updatedAt: new Date() })
    .where(eq(items.id, opts.itemId));
}

/**
 * Append a bounding-box region to a previously-materialised capture's
 * `bboxes` jsonb. Replacement for the old `writeCropImage` path —
 * pure metadata, no encoding. Returns the bbox id so the section md
 * can build a stable `#bbox=<id>` reference.
 */
export async function recordBboxOnSource(opts: {
  sourceItemId: string;
  bbox: [number, number, number, number];
  alt: string;
  caption: string;
  sectionId?: string;
  source?: string;
}): Promise<{ bboxId: string }> {
  const bboxId = `bb-${crypto.randomUUID()}`;
  const db = await getVaultDb();
  const [row] = await db
    .select({ bboxes: items.bboxes })
    .from(items)
    .where(eq(items.id, opts.sourceItemId));
  const existing = ((row?.bboxes as unknown) as Array<{
    id: string;
    bbox: [number, number, number, number];
    alt: string;
    caption: string;
    sectionId?: string;
    source?: string;
  }> | null) ?? [];
  await db
    .update(items)
    .set({
      bboxes: [
        ...existing,
        {
          id: bboxId,
          bbox: opts.bbox,
          alt: opts.alt,
          caption: opts.caption,
          sectionId: opts.sectionId,
          source: opts.source ?? "visioner",
        },
      ],
      updatedAt: new Date(),
    })
    .where(eq(items.id, opts.sourceItemId));
  return { bboxId };
}

export async function writeSectionNote(opts: {
  groupName: string;
  ordinal: number;
  topic: string;
  markdown: string;
  summary: string;
  questions: string[];
  concepts: string[];
}): Promise<string> {
  const db = await getVaultDb();
  const folder = indexFolderName(opts.groupName);
  await insertFolder(db, ROOT);
  await insertFolder(db, folder);
  const title = `Section ${String(opts.ordinal).padStart(2, "0")} · ${sanitiseSegment(opts.topic)}`;
  const id = `idx-section-${crypto.randomUUID()}`;
  const frontmatter = buildSectionFrontmatter(opts);
  const note: Note = {
    id,
    title,
    folder,
    type: "markdown",
    summary: opts.summary,
    content: `${frontmatter}\n\n${opts.markdown.trim()}\n`,
    tags: ["indexed", ...opts.concepts.map(slugTag)],
    updatedAt: new Date().toISOString().slice(0, 10),
  };
  await insertItem(db, note);
  return id;
}

/** Build a YAML-ish frontmatter block the markdown viewer can render as a callout-like header. */
function buildSectionFrontmatter(opts: {
  topic: string;
  summary: string;
  questions: string[];
  concepts: string[];
}): string {
  return `> [!note] ${opts.topic}\n> ${opts.summary.replace(/\n/g, "\n> ")}\n\n**Answers:**\n${opts.questions.map((q) => `- ${q}`).join("\n")}\n\n**Concepts:** ${opts.concepts.map((c) => `\`${c}\``).join(" · ")}`;
}

function slugTag(c: string): string {
  return c.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Write the manifest md. Returns the items.id. */
export async function writeManifest(opts: {
  groupName: string;
  tagline: string;
  prompt: string;
  fileCount: number;
  sections: Array<{
    ordinal: number;
    title: string;
    topic: string;
    summary: string;
    concepts: string[];
    noteItemId: string;
  }>;
  conceptIndex: string[];
  /** Optional DOM-image index appended at the bottom of the manifest. */
  domImages?: Array<{
    title: string;
    alt: string;
    src: string;
    description?: string;
  }>;
}): Promise<string> {
  const db = await getVaultDb();
  const folder = indexFolderName(opts.groupName);
  await insertFolder(db, ROOT);
  await insertFolder(db, folder);
  const id = `idx-manifest-${crypto.randomUUID()}`;
  const lines: string[] = [];
  lines.push(`# ${opts.groupName}`);
  if (opts.tagline) lines.push("", `*${opts.tagline}*`);
  lines.push("", "#indexed", "");
  if (opts.prompt.trim()) {
    lines.push("## Context", "", opts.prompt.trim(), "");
  }
  lines.push("## Sections", "");
  for (const s of opts.sections) {
    lines.push(`### ${s.ordinal}. ${s.topic}`);
    if (s.summary) lines.push(s.summary);
    lines.push(`→ [[${s.title}]]`);
    if (s.concepts.length > 0) {
      lines.push(`**Concepts:** ${s.concepts.map((c) => `\`${c}\``).join(" · ")}`);
    }
    lines.push("");
  }
  if (opts.conceptIndex.length > 0) {
    lines.push("## Concept index", "");
    lines.push(opts.conceptIndex.map((c) => `\`${c}\``).join(" · "));
  }
  if (opts.domImages && opts.domImages.length > 0) {
    lines.push("", "## Source images", "");
    lines.push(
      `${opts.domImages.length} image${opts.domImages.length === 1 ? "" : "s"} pulled from the captured page DOM.`,
      "",
    );
    for (const img of opts.domImages) {
      lines.push(`![${img.alt}](wikilink:${encodeURIComponent(img.title)})`);
      if (img.description) {
        lines.push("", `> ${img.description}`, "");
      }
    }
  }
  lines.push("", `*Indexed ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${opts.fileCount} file${opts.fileCount === 1 ? "" : "s"}*`);

  const note: Note = {
    id,
    title: "_manifest",
    folder,
    type: "markdown",
    summary: opts.tagline || `Indexed group with ${opts.sections.length} sections`,
    content: lines.join("\n"),
    tags: ["indexed", "manifest"],
    updatedAt: new Date().toISOString().slice(0, 10),
  };
  await insertItem(db, note);
  return id;
}

/**
 * Crop a region from a source canvas, save as PNG to OPFS, and register an
 * image item in the vault under <group>/images/. Returns the new item's id
 * (used as the wikilink target) and the suggested markdown image reference.
 */
export async function writeCropImage(opts: {
  source: HTMLCanvasElement;
  /** [ymin, xmin, ymax, xmax] in 0..1000 (Gemini convention). */
  bbox: [number, number, number, number];
  groupName: string;
  sectionOrdinal: number;
  diagramOrdinal: number;
  alt: string;
  caption: string;
}): Promise<{ itemId: string; title: string }> {
  const db = await getVaultDb();
  const { source, bbox } = opts;
  const [ymin, xmin, ymax, xmax] = bbox;
  const w = source.width;
  const h = source.height;
  const x = Math.max(0, Math.floor((xmin / 1000) * w));
  const y = Math.max(0, Math.floor((ymin / 1000) * h));
  const cw = Math.max(1, Math.floor(((xmax - xmin) / 1000) * w));
  const ch = Math.max(1, Math.floor(((ymax - ymin) / 1000) * h));
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Failed to acquire 2D context for crop");
  ctx.drawImage(source, x, y, cw, ch, 0, 0, cw, ch);
  const blob = await new Promise<Blob | null>((res) =>
    out.toBlob((b) => res(b), "image/png"),
  );
  if (!blob) throw new Error("Crop encode failed");
  const file = new File(
    [blob],
    `s${opts.sectionOrdinal}-d${opts.diagramOrdinal}.png`,
    { type: "image/png" },
  );
  const blobKey = await writeBlob(file);
  const title = `s${opts.sectionOrdinal}-d${opts.diagramOrdinal}`;
  const id = `idx-image-${crypto.randomUUID()}`;
  // Lazy-create the images subfolder the first time we actually write a crop.
  await insertFolder(db, ROOT);
  await insertFolder(db, indexFolderName(opts.groupName));
  await insertFolder(db, imagesFolderName(opts.groupName));
  const note: Note = {
    id,
    title,
    folder: imagesFolderName(opts.groupName),
    type: "image",
    summary: opts.caption || opts.alt,
    content: "",
    tags: ["indexed", "diagram"],
    updatedAt: new Date().toISOString().slice(0, 10),
    blobKey,
  };
  await insertItem(db, note);
  return { itemId: id, title };
}

/**
 * Materialise the run's DOM-captured images as vault items under
 * `_Indexes/<group>/images/`. Each becomes an `image`-type item titled
 * `dom-N`, addressable from any section md via `![alt](wikilink:dom-N)`.
 *
 * Each image carries its agent-generated description as the item's
 * `summary` AND as a small markdown body in `content` — so vault search
 * (text + future vector) finds it, and the image's detail view shows the
 * read-out next to the picture.
 *
 * Returns the list of created items so the manifest can index them.
 */
export async function materialiseDomImages(opts: {
  groupName: string;
  domImages: IndexerDomImage[];
}): Promise<
  Array<{
    title: string;
    alt: string;
    src: string;
    itemId: string;
    description: string;
    tags: string[];
  }>
> {
  if (opts.domImages.length === 0) return [];
  const db = await getVaultDb();
  await insertFolder(db, ROOT);
  await insertFolder(db, indexFolderName(opts.groupName));
  await insertFolder(db, imagesFolderName(opts.groupName));

  const out: Array<{
    title: string;
    alt: string;
    src: string;
    itemId: string;
    description: string;
    tags: string[];
  }> = [];
  for (let i = 0; i < opts.domImages.length; i++) {
    const img = opts.domImages[i];
    const title = `dom-${i + 1}`;
    const id = `idx-domimg-${crypto.randomUUID()}`;
    const description = img.description?.trim() || "";
    const llmTags = Array.isArray(img.tags) ? img.tags.filter((t) => t.trim()) : [];
    // Body: just the description in italics + a tiny source line. The
    // image itself renders separately in the vault viewer.
    const contentLines: string[] = [];
    if (description) contentLines.push(`*${description}*`);
    if (img.src) contentLines.push(`\n[Source](${img.src})`);
    const note: Note = {
      id,
      title,
      folder: imagesFolderName(opts.groupName),
      type: "image",
      summary: description || img.alt || "",
      content: contentLines.join("\n"),
      tags: Array.from(
        new Set([
          "indexed",
          "dom-image",
          ...(img.readerKind ? [img.readerKind] : []),
          ...llmTags,
        ]),
      ),
      updatedAt: new Date().toISOString().slice(0, 10),
      blobKey: img.blobKey,
    };
    try {
      await insertItem(db, note);
      out.push({
        title,
        alt: img.alt || title,
        src: img.src,
        itemId: id,
        description,
        tags: llmTags,
      });
    } catch (err) {
      console.warn(`[indexer] DOM image insert failed for ${title}:`, err);
    }
  }
  return out;
}

/**
 * Replace <!-- diagram:N --> placeholders in a page's markdown with image
 * references pointing at the source capture + a `#bbox=<bboxId>` fragment.
 * The renderer (markdown-view) reads the fragment, looks up the named
 * region in the source image's `bboxes` metadata, and renders just that
 * crop inline (with the full image available via the modal).
 *
 * Unmatched placeholders are removed silently. Swaps without a source
 * (capture materialise / bbox record failed) degrade to an italic
 * descriptor block — never a broken wikilink.
 *
 * For backwards-compat: an entry with a `title` field (legacy crop item
 * shape) still emits the old `wikilink:<cropTitle>` form so groups indexed
 * before this change keep rendering. New runs always emit the new form.
 */
export function inlineDiagramRefs(
  text: string,
  diagrams: Array<{
    sourceItemId?: string;
    bboxId?: string;
    title?: string;
    alt: string;
  }>,
): string {
  return text.replace(/<!--\s*diagram:(\d+)\s*-->/g, (_, indexStr) => {
    const i = Number.parseInt(indexStr, 10);
    const d = diagrams[i];
    if (!d) return "";
    if (d.sourceItemId && d.bboxId) {
      const url = `wikilink:${encodeURIComponent(d.sourceItemId)}#bbox=${encodeURIComponent(d.bboxId)}`;
      return `\n\n![${d.alt}](${url})\n\n`;
    }
    if (d.title) {
      // Legacy: a separately-stored crop item with its own title.
      return `\n\n![${d.alt}](wikilink:${encodeURIComponent(d.title)})\n\n`;
    }
    // No materialised target — render the description as a quote block.
    return d.alt ? `\n\n> *${d.alt}*\n\n` : "";
  });
}
