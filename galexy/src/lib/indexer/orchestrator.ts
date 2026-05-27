"use client";

/**
 * Master orchestrator — runs in the browser tab. Pops the next queued group,
 * walks every file page-by-page via the Visioner agent, accumulates pages
 * into sections by the agent's topic-transition signal, then for each
 * closed section runs Summariser + writes the section md + (background)
 * embedder. At the end it runs Namer if needed and writes the manifest.
 *
 * Scratchpad updates throughout so the read-only view can render progress.
 *
 * Errors are caught per-section so one bad page can't kill the whole run.
 */

import {
  embedBatch,
  namerCall,
  summariserCall,
  visionerCall,
} from "@/lib/indexer/agent-client";
import type { VisionerOutput } from "@/lib/indexer/agents";
import { extractorFor, fileFromRef } from "@/lib/indexer/extractors";
import {
  inlineDiagramRefs,
  planIndexFolders,
  renameIndexGroup,
  writeCropImage,
  writeManifest,
  writeSectionNote,
} from "@/lib/indexer/materialise";
import { getVaultDb } from "@/lib/db/vault-db";
import { indexChunks, sections } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

import type { Group } from "@/lib/indexer/queue-db";
import { useIndexerStore } from "@/lib/indexer/queue-store";
import { useLiveProgress } from "@/lib/indexer/live-progress";

type RunHooks = {
  signal?: AbortSignal;
};

const store = useIndexerStore;
const live = useLiveProgress;

/** Append a line to scratchpad through the store so the UI re-renders. */
async function scratch(id: string, line: string): Promise<void> {
  await store.getState().scratch(id, line);
}

/** Promote a run through its status states (re-using the same applyStatus path). */
async function setStatus(
  id: string,
  status: Group["status"],
  extra?: { error?: string; folderName?: string },
): Promise<void> {
  await store.getState().applyStatus(id, status, extra);
}

type PendingSection = {
  ordinal: number;
  topic: string;
  /** Pages accumulated so far. */
  pages: Array<{
    pageOrdinal: number;
    visionerOutput: VisionerOutput;
    bitmap?: HTMLCanvasElement;
  }>;
};

export async function runOne(group: Group, hooks: RunHooks = {}): Promise<void> {
  const { signal } = hooks;
  const runId = group.id;
  const userContext = group.prompt;

  // Empty group name → AI will name on completion. Use a stable provisional
  // name for the folder until then.
  const userProvidedName = group.groupName.trim();
  let groupName = userProvidedName || `Group ${new Date().toISOString().slice(0, 16)}`;

  // Tree-as-context is the worksmith capture marker — the bridge appends a
  // "Pruned accessibility tree" block to the prompt.
  const treeUsed = /Pruned accessibility tree/i.test(group.prompt);
  live.getState().startRun(runId, groupName || "(naming pending)", group.files.length, treeUsed);

  try {
    await setStatus(runId, "preparing");
    await scratch(runId, `## Run started\n- Files: ${group.files.length}\n- Will auto-name: ${userProvidedName ? "no" : "yes"}`);
    const folder = planIndexFolders(groupName);
    await store.getState().applyStatus(runId, "preparing", { folderName: folder });

    // ---------------- walking ----------------
    await setStatus(runId, "walking");
    live.getState().setPhase("walking");
    const allClosedSections: Array<{
      sourceFileName: string;
      ordinal: number;
      topic: string;
      sectionMarkdown: string;
      summary?: string;
      questions?: string[];
      concepts?: string[];
      noteItemId?: string;
    }> = [];

    let sectionGlobalOrdinal = 0;
    let sessionState = "";

    for (let fileIdx = 0; fileIdx < group.files.length; fileIdx++) {
      const fileRef = group.files[fileIdx];
      if (signal?.aborted) throw new Error("Cancelled");
      await scratch(runId, `\n### File: ${fileRef.name}`);
      live.getState().startFile(fileRef.name, fileIdx);
      live.getState().pushAction(`Opening ${fileRef.name}`);
      const file = await fileFromRef(fileRef);
      const extract = extractorFor(fileRef);

      let current: PendingSection | null = null;
      let pageOrdinal = 0;

      const closeCurrent = async (): Promise<void> => {
        if (!current || current.pages.length === 0) return;
        sectionGlobalOrdinal++;
        const closed = current;
        current = null;
        // Build section markdown by concatenating page texts (with diagrams cropped)
        const sectionMd = await buildSectionMd({
          runId,
          groupName,
          sectionOrdinal: sectionGlobalOrdinal,
          topic: closed.topic,
          pages: closed.pages,
        });
        allClosedSections.push({
          sourceFileName: fileRef.name,
          ordinal: sectionGlobalOrdinal,
          topic: closed.topic,
          sectionMarkdown: sectionMd,
        });
        await scratch(
          runId,
          `- Closed section ${sectionGlobalOrdinal}: **${closed.topic}** (${closed.pages.length} page${closed.pages.length === 1 ? "" : "s"})`,
        );
      };

      for await (const extracted of extract(file)) {
        if (signal?.aborted) throw new Error("Cancelled");
        pageOrdinal++;

        // Text-only extractors (md/csv/code) don't need the Visioner — fast-path them.
        if (!extracted.imageBase64) {
          await closeCurrent();
          sectionGlobalOrdinal++;
          await scratch(
            runId,
            `- Text section ${sectionGlobalOrdinal}: **${extracted.label}**`,
          );
          allClosedSections.push({
            sourceFileName: fileRef.name,
            ordinal: sectionGlobalOrdinal,
            topic: extracted.label,
            sectionMarkdown: extracted.text ?? "",
          });
          continue;
        }

        // Vision-required (PDF page / image). Push the page to the live view
        // BEFORE calling the agent so the panel updates the instant the
        // scanner starts working, not when the response lands.
        if (extracted.fullDataUrl) {
          live.getState().setActivePage(
            extracted.ordinal,
            extracted.fullDataUrl,
            extracted.thumbnailDataUrl,
          );
        }
        const result = await visionerCall(
          {
            imageBase64: extracted.imageBase64,
            mimeType: extracted.mimeType ?? "image/png",
            userContext,
            sessionState,
            pageOrdinal: extracted.ordinal,
            fileName: fileRef.name,
          },
          signal,
        );
        sessionState = result.sessionUpdate;
        live.getState().setCurrentTopic(result.topic);
        live.getState().markPageDone(extracted.ordinal);
        live.getState().pushAction(
          `p${extracted.ordinal} · ${result.transition} · ${result.topic}`,
        );
        await scratch(
          runId,
          `- Page ${extracted.ordinal}: ${result.transition} · ${result.topic} — ${result.pageSummary}`,
        );

        if (result.transition === "new" && current) {
          await closeCurrent();
        }

        if (!current) {
          current = { ordinal: pageOrdinal, topic: result.topic, pages: [] };
        }
        current.pages.push({
          pageOrdinal: extracted.ordinal,
          visionerOutput: result,
          bitmap: extracted.bitmap,
        });

        if (result.transition === "end") {
          await closeCurrent();
        }
      }
      // End of file → close whatever's open.
      await closeCurrent();
    }

    // ---------------- summarising + materialising + embedding ----------------
    await setStatus(runId, "summarising");
    live.getState().setPhase("summarising");
    const allConcepts = new Set<string>();
    const embedPromises: Promise<unknown>[] = [];

    for (const sect of allClosedSections) {
      if (signal?.aborted) throw new Error("Cancelled");
      const sum = await summariserCall(
        {
          sectionMarkdown: sect.sectionMarkdown,
          topic: sect.topic,
          userContext,
        },
        signal,
      );
      sect.summary = sum.summary;
      sect.questions = sum.questions;
      sect.concepts = sum.concepts;
      sum.concepts.forEach((c) => allConcepts.add(c));

      // Write the section md.
      const noteItemId = await writeSectionNote({
        groupName,
        ordinal: sect.ordinal,
        topic: sect.topic,
        markdown: sect.sectionMarkdown,
        summary: sum.summary,
        questions: sum.questions,
        concepts: sum.concepts,
      });
      sect.noteItemId = noteItemId;

      // Persist the section row in the DB for downstream graph/retrieval use.
      const sectionRowId = `sec-${crypto.randomUUID()}`;
      const db = await getVaultDb();
      await db.insert(sections).values({
        id: sectionRowId,
        runId,
        sourceItemId: "",
        noteItemId,
        ordinal: sect.ordinal,
        kind: "pdf-page",
        topic: sect.topic,
        contentText: sect.sectionMarkdown,
        summary: sum.summary,
        questions: sum.questions,
        concepts: sum.concepts,
        images: [],
      });

      // Embed in the background — don't block the next section's summariser.
      embedPromises.push(
        embedSectionChunks(sectionRowId, sum, signal).catch((err) => {
          console.warn(`[indexer] embed failed for section ${sect.ordinal}:`, err);
        }),
      );

      live.getState().bumpSection(sum.concepts.length);
      live.getState().pushAction(
        `§${sect.ordinal} summarised · ${sum.questions.length}Q · ${sum.concepts.length}c`,
      );
      await scratch(
        runId,
        `- Summarised section ${sect.ordinal}: ${sum.questions.length} Q, ${sum.concepts.length} concepts`,
      );
    }

    // ---------------- naming ----------------
    if (!userProvidedName) {
      await setStatus(runId, "naming");
      live.getState().setPhase("naming");
      live.getState().pushAction("Naming the group");
      try {
        const named = await namerCall(
          {
            sectionSummaries: allClosedSections.map((s) => ({
              topic: s.topic,
              summary: s.summary ?? "",
            })),
            userContext,
          },
          signal,
        );
        // Atomically migrate _Indexes/<old>/ → _Indexes/<new>/, including
        // every section md, every cropped image, and the folder rows. Without
        // this, the manifest written below would land in the new folder and
        // every section would stay orphaned in the provisional one.
        const previousName = groupName;
        const renamed = await renameIndexGroup(runId, previousName, named.groupName);
        groupName = renamed.finalName;
        await store.getState().applyStatus(runId, "naming");
        await scratch(runId, `\n## Named: **${renamed.finalName}** — ${named.tagline}`);
      } catch (err) {
        console.warn("[indexer] namer failed:", err);
        await scratch(runId, `- Namer failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // ---------------- finalising ----------------
    await setStatus(runId, "finalising");
    live.getState().setPhase("finalising");
    live.getState().pushAction("Writing manifest");

    // Wait for any straggling embeds (don't block the manifest on slow ones).
    await Promise.allSettled(embedPromises);

    const conceptIndex = [...allConcepts].sort((a, b) => a.localeCompare(b));
    await writeManifest({
      groupName,
      tagline: "",
      prompt: userContext,
      fileCount: group.files.length,
      sections: allClosedSections.map((s) => ({
        ordinal: s.ordinal,
        title: `Section ${String(s.ordinal).padStart(2, "0")} · ${s.topic}`,
        topic: s.topic,
        summary: s.summary ?? "",
        concepts: s.concepts ?? [],
        noteItemId: s.noteItemId ?? "",
      })),
      conceptIndex,
    });

    await store.getState().applyStatus(runId, "done");
    live.getState().finish(true);
    live.getState().pushAction(`Done · ${allClosedSections.length} sections`);
    await scratch(runId, `\n## Done — ${allClosedSections.length} sections, ${conceptIndex.length} concepts`);
    const db = await getVaultDb();
    await db.execute(
      sql`UPDATE index_runs SET finished_at = now() WHERE id = ${runId}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[indexer] run failed:", message);
    await store.getState().applyStatus(runId, "failed", { error: message });
    live.getState().finish(false);
    live.getState().pushAction(`Failed: ${message}`);
    await scratch(runId, `\n## Failed: ${message}`);
  }
}

/** Concatenate per-page markdown into the section body, swapping diagram placeholders for image refs. */
async function buildSectionMd(opts: {
  runId: string;
  groupName: string;
  sectionOrdinal: number;
  topic: string;
  pages: PendingSection["pages"];
}): Promise<string> {
  // NOTE — no synthetic `# ${opts.topic}` prepend here. The section file's
  // vault title ("Section NN · <topic>") and the frontmatter callout
  // (`> [!note] <topic>`) already title the section; the Visioner faithfully
  // transcribes whatever H1 the actual page had. Adding our own would create
  // adjacent duplicates that the dedupe pass below catches anyway.
  const out: string[] = [];
  let diagramCounter = 0;
  for (const p of opts.pages) {
    const v = p.visionerOutput;
    const swaps: Array<{ title: string; alt: string }> = [];
    for (let i = 0; i < v.diagrams.length; i++) {
      const d = v.diagrams[i];
      diagramCounter++;
      if (!p.bitmap) {
        swaps.push({ title: "", alt: d.alt });
        continue;
      }
      try {
        const { title } = await writeCropImage({
          source: p.bitmap,
          bbox: d.bbox,
          groupName: opts.groupName,
          sectionOrdinal: opts.sectionOrdinal,
          diagramOrdinal: diagramCounter,
          alt: d.alt,
          caption: d.caption,
        });
        swaps.push({ title, alt: d.alt || d.caption || `Figure ${diagramCounter}` });
      } catch (err) {
        console.warn(`[indexer] crop failed s${opts.sectionOrdinal} d${diagramCounter}:`, err);
        swaps.push({ title: "", alt: d.alt });
      }
    }
    out.push(inlineDiagramRefs(v.text, swaps));
  }
  return dedupeConsecutiveHeadings(out.join("\n\n"));
}

/**
 * Collapse adjacent identical headings (any level) inside a section body.
 *
 * Catches two patterns the Visioner produces:
 *  - Multi-page section where every page transcription starts with the same
 *    H1 — joining yields "# X\n…body…\n\n# X\n…body…", we keep the first.
 *  - Page text that begins with the same heading the orchestrator's
 *    frontmatter already shows.
 *
 * Two headings count as "adjacent" if only blank lines separate them — any
 * intervening prose resets the tracker so distant repeats are preserved.
 */
function dedupeConsecutiveHeadings(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let lastHeadingKey: string | null = null;
  let pendingBlanks = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(trimmed);
    if (headingMatch) {
      const key = `${headingMatch[1].length}:${headingMatch[2].toLowerCase()}`;
      if (key === lastHeadingKey) {
        // Skip this duplicate AND the pending blanks that led up to it.
        pendingBlanks = 0;
        continue;
      }
      lastHeadingKey = key;
      for (let i = 0; i < pendingBlanks; i++) out.push("");
      pendingBlanks = 0;
      out.push(line);
      continue;
    }
    if (trimmed === "") {
      pendingBlanks++;
      continue;
    }
    // Non-blank, non-heading content — flush blanks, emit, reset tracker.
    for (let i = 0; i < pendingBlanks; i++) out.push("");
    pendingBlanks = 0;
    lastHeadingKey = null;
    out.push(line);
  }
  for (let i = 0; i < pendingBlanks; i++) out.push("");
  return out.join("\n");
}

async function embedSectionChunks(
  sectionId: string,
  sum: { summary: string; questions: string[]; concepts: string[] },
  signal?: AbortSignal,
): Promise<void> {
  const all: Array<{ kind: "summary" | "question" | "concept"; text: string }> = [
    { kind: "summary", text: sum.summary },
    ...sum.questions.map((q) => ({ kind: "question" as const, text: q })),
    ...sum.concepts.map((c) => ({ kind: "concept" as const, text: c })),
  ];
  if (all.length === 0) return;
  const embeddings = await embedBatch(all.map((x) => x.text), signal);
  const db = await getVaultDb();
  for (let i = 0; i < all.length; i++) {
    const chunkId = `chunk-${crypto.randomUUID()}`;
    const vec = embeddings[i];
    if (!vec) continue;
    // pgvector accepts a [x,y,z]-style literal as text.
    const literal = `[${vec.join(",")}]`;
    await db.execute(
      sql`INSERT INTO index_chunks (id, section_id, kind, text, embedding)
          VALUES (${chunkId}, ${sectionId}, ${all[i].kind}, ${all[i].text}, ${literal}::vector)`,
    );
  }
  void indexChunks; // referenced for the schema type
}

