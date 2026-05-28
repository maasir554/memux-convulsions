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
  imageReaderCall,
  namerCall,
  summariserCall,
  visionerCall,
} from "@/lib/indexer/agent-client";
import { readBlobUrl } from "@/lib/blob-store";
import type { VisionerOutput } from "@/lib/indexer/agents";
import {
  extractorFor,
  fileFromRef,
  preflightThumbnails,
} from "@/lib/indexer/extractors";
import {
  buildTreeOutline,
  collectAvailableLinks,
  enrichLinks,
  findImageContext,
  formatImageContext,
  formatOutline,
  harvestSectionLinks,
  summariseTree,
  type AvailableLink,
} from "@/lib/indexer/tree-utils";
import {
  inlineDiagramRefs,
  materialiseDomImages,
  materialiseSourceCapture,
  planIndexFolders,
  recordBboxOnSource,
  renameIndexGroup,
  updateCaptureSummary,
  writeManifest,
  writeSectionNote,
} from "@/lib/indexer/materialise";
import { writeBlob } from "@/lib/blob-store";
import { getVaultDb } from "@/lib/db/vault-db";
import { indexChunks, sections, type IndexerDomImage } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

import type { Group } from "@/lib/indexer/queue-db";

/** DOM image enriched with the Image Reader agent's output. */
type IndexerDomImageWithRead = IndexerDomImage;
import { useIndexerStore } from "@/lib/indexer/queue-store";
import { useLiveProgress } from "@/lib/indexer/live-progress";
import { USER_CANCELLED } from "@/lib/indexer/runs-registry";

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
    /**
     * `items.id` of the materialised source-capture for this page, if any.
     * Section md uses this to record bboxes against the source instead of
     * writing a separate cropped image. Undefined for text-only sources.
     */
    sourceItemId?: string;
  }>;
};

/**
 * Encode an HTMLCanvasElement to a PNG blob in OPFS and return the
 * resulting blobKey. Used for PDF pages, where the source file's
 * blobKey points at the whole PDF — each rendered page needs its own
 * blob so a vault image item can reference just that page's bytes.
 */
async function encodeCanvasToBlobKey(canvas: HTMLCanvasElement, name: string): Promise<string> {
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob((b) => res(b), "image/png"),
  );
  if (!blob) throw new Error("Canvas → blob failed");
  const file = new File([blob], name, { type: "image/png" });
  return writeBlob(file);
}

export async function runOne(group: Group, hooks: RunHooks = {}): Promise<void> {
  const { signal } = hooks;
  const runId = group.id;
  const userContext = group.prompt;

  // Empty group name → AI will name on completion. Use a stable provisional
  // name for the folder until then.
  const userProvidedName = group.groupName.trim();
  let groupName = userProvidedName || `Group ${new Date().toISOString().slice(0, 16)}`;

  // Tree-as-context is the worksmith capture marker — the bridge stashes the
  // pruned tree on the run row, and the orchestrator walks it for link
  // enrichment + node-count signal.
  const treeUsed = !!group.prunedTree;
  const treeSummary = treeUsed
    ? summariseTree(group.prunedTree)
    : { nodeCount: 0, linkCount: 0, textToHref: new Map<string, string>() };
  // Heading-only outline — anchors topic decisions across pages the Visioner
  // can't see in one shot. Computed once, sent to every page's call.
  const outlineEntries = treeUsed ? buildTreeOutline(group.prunedTree) : [];
  const documentOutline =
    outlineEntries.length > 0 ? formatOutline(outlineEntries) : undefined;
  // Anchor-text → href list harvested from the tree. Briefed to every
  // Visioner call so the model can naturally render anchors as markdown
  // links inline (vs. relying on post-process enrichment alone). Capped
  // at 80 entries; ample for almost any landing-page-sized capture.
  const availableLinks: AvailableLink[] = treeUsed
    ? collectAvailableLinks(group.prunedTree)
    : [];

  live.getState().startRun(runId, groupName || "(naming pending)", group.files.length, treeUsed);
  if (treeUsed) {
    live.getState().setTreeNodes(treeSummary.nodeCount);
    live.getState().pushAction(
      `Read tree · ${treeSummary.nodeCount} nodes · ${treeSummary.linkCount} links`,
    );
    if (outlineEntries.length > 0) {
      live.getState().setOutlineHeadings(outlineEntries.length);
      live.getState().pushAction(
        `Read outline · ${outlineEntries.length} heading${outlineEntries.length === 1 ? "" : "s"}`,
      );
    }
  }

  try {
    await setStatus(runId, "preparing");
    await scratch(runId, `## Run started\n- Files: ${group.files.length}\n- Will auto-name: ${userProvidedName ? "no" : "yes"}`);
    const folder = planIndexFolders(groupName);
    await store.getState().applyStatus(runId, "preparing", { folderName: folder });

    // Seed the live-view thumbnail strip with every page we know about
    // before walking starts. For images this is essentially instant; for
    // PDFs we render every page at scale 0.35 just to get a small preview.
    // The orchestrator then promotes each thumb to active → done as it
    // processes the page, so the strip's total size stays stable.
    live.getState().pushAction("Preflighting thumbnails");
    const seeds = await preflightThumbnails(group.files, signal);
    if (seeds.length > 0) {
      live.getState().seedPendingThumbnails(seeds);
      live.getState().pushAction(
        `Seeded ${seeds.length} preview${seeds.length === 1 ? "" : "s"}`,
      );
    }
    if (signal?.aborted) throw new Error("Cancelled");

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
    /** Background promises for per-capture summaries + embeddings. Awaited
     *  before manifest write so the captures show up with descriptions. */
    const captureSummaryPromises: Promise<unknown>[] = [];

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

        // Materialise THIS page as a first-class capture item. PDF pages
        // get a freshly-encoded blob; worksmith image files reuse the
        // existing OPFS blob from the run's file ref so we don't double-
        // store the same bytes. The resulting itemId is what every bbox
        // recorded later this section is attached to.
        const isImageFile = fileRef.mimeType.startsWith("image/");
        let captureBlobKey: string | undefined;
        if (isImageFile && fileRef.blobKey) {
          captureBlobKey = fileRef.blobKey;
        } else if (extracted.bitmap) {
          try {
            captureBlobKey = await encodeCanvasToBlobKey(
              extracted.bitmap,
              `${fileRef.name}-p${extracted.ordinal}.png`,
            );
          } catch (err) {
            console.warn(`[indexer] page encode failed (${fileRef.name} p${extracted.ordinal}):`, err);
          }
        }
        let sourceCaptureId: string | undefined;
        if (captureBlobKey) {
          try {
            const captureOrdinal = `${String(fileIdx + 1).padStart(2, "0")}-${String(extracted.ordinal).padStart(2, "0")}`;
            const { itemId } = await materialiseSourceCapture({
              groupName,
              ordinal: captureOrdinal,
              blobKey: captureBlobKey,
              mimeType: extracted.mimeType ?? "image/png",
            });
            sourceCaptureId = itemId;
          } catch (err) {
            console.warn(`[indexer] capture materialise failed (${fileRef.name} p${extracted.ordinal}):`, err);
          }
        }

        live.getState().setCurrentAction({
          verb: "reading",
          subject: `p${extracted.ordinal}`,
        });
        const result = await visionerCall(
          {
            imageBase64: extracted.imageBase64,
            mimeType: extracted.mimeType ?? "image/png",
            userContext,
            sessionState,
            pageOrdinal: extracted.ordinal,
            fileName: fileRef.name,
            documentOutline,
            availableLinks: availableLinks.length > 0 ? availableLinks : undefined,
          },
          signal,
        );
        live.getState().setCurrentAction(null);

        // Fire imageReader on the page in the background so we get a
        // standalone description for the capture (becomes the item's
        // summary + a vector chunk). Doesn't block the Visioner loop.
        if (sourceCaptureId) {
          captureSummaryPromises.push(
            summariseAndEmbedCapture({
              captureItemId: sourceCaptureId,
              imageBase64: extracted.imageBase64,
              mimeType: extracted.mimeType ?? "image/png",
              fileName: fileRef.name,
              pageOrdinal: extracted.ordinal,
              userContext,
              signal,
            }).catch((err) =>
              console.warn(
                `[indexer] capture summary failed (${fileRef.name} p${extracted.ordinal}):`,
                err,
              ),
            ),
          );
        }
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
          sourceItemId: sourceCaptureId,
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
      live.getState().setCurrentAction({
        verb: "summarising",
        subject: `§${sect.ordinal}`,
      });
      const sum = await summariserCall(
        {
          sectionMarkdown: sect.sectionMarkdown,
          topic: sect.topic,
          userContext,
        },
        signal,
      );
      live.getState().setCurrentAction(null);
      sect.summary = sum.summary;
      sect.questions = sum.questions;
      sect.concepts = sum.concepts;
      sum.concepts.forEach((c) => allConcepts.add(c));

      // Enrich the section md with markdown links pulled from the pruned
      // tree's {text → href} map (no-op when no tree was captured). The
      // Visioner already renders most anchors as proper md links thanks
      // to the availableLinks brief; this is the belt-and-braces pass
      // for anchors it transcribed but didn't link.
      if (treeSummary.textToHref.size > 0) {
        const enriched = enrichLinks(sect.sectionMarkdown, treeSummary.textToHref);
        sect.sectionMarkdown = enriched.md;
        if (enriched.count > 0) {
          live.getState().bumpLinksEnriched(enriched.count);
          live.getState().pushAction(
            `§${sect.ordinal} · enriched ${enriched.count} link${enriched.count === 1 ? "" : "s"}`,
          );
        }
      }

      // Harvest the per-section link set: inline [text](href) + tree hrefs
      // whose anchor the section mentions + bare URLs caught by regex.
      // Stored as structured jsonb so chat tools can query without
      // re-parsing prose later.
      const sectionLinks = harvestSectionLinks(sect.sectionMarkdown, availableLinks);

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
        links: sectionLinks,
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
        live.getState().setCurrentAction({
          verb: "naming",
          subject: "the group",
        });
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
        live.getState().setCurrentAction(null);
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
    // Same for per-capture image-reader summaries — these populate the
    // capture items' `summary` field and their vector chunks.
    await Promise.allSettled(captureSummaryPromises);

    // Materialise DOM images (worksmith captures). For each one we:
    //   1. Look up the surrounding DOM context in the pruned tree (heading,
    //      container role, neighbouring text, link target).
    //   2. Send the image bytes + that context to the Image Reader agent.
    //      The agent returns a 1-3 sentence description + tags + a "kind"
    //      classification (decorative / ui / content).
    //   3. Drop "decorative" results so the vault doesn't fill up with
    //      separator strips and background glyphs.
    //   4. Persist the rest as vault items, with the description as both
    //      `summary` (search-indexed) and `content` (visible in viewer).
    //   5. Create a synthetic `section` row per image + a `summary`-kind
    //      embedding chunk for the description, so the run's vector store
    //      can answer queries like "the picture of X" or "logo of Y".
    //
    // Skipped entirely when the group has no DOM images (i.e. non-worksmith
    // captures like PDF uploads).
    let domImagesIndex: Array<{
      title: string;
      alt: string;
      src: string;
      itemId: string;
      description: string;
      tags: string[];
    }> = [];
    if (group.domImages.length > 0) {
      const readImages: IndexerDomImageWithRead[] = [];
      for (let i = 0; i < group.domImages.length; i++) {
        if (signal?.aborted) throw new Error("Cancelled");
        const img = group.domImages[i];
        live.getState().setCurrentAction({
          verb: "viewing",
          subject: `dom-${i + 1}`,
        });

        // Gemma 4 doesn't accept SVG. Rather than fail the run, keep the
        // SVG as a vault item with no agent-generated description (it's
        // still viewable + still vector-searchable via its alt text on the
        // section md that references it). Same fallback applies to
        // anything else we know Gemma can't decode.
        const mime = (img.mimeType || "").toLowerCase();
        const READER_UNSUPPORTED_MIMES = new Set(["image/svg+xml"]);
        if (READER_UNSUPPORTED_MIMES.has(mime)) {
          await scratch(
            runId,
            `- Kept dom-${i + 1} without read (mime ${mime} unsupported by reader)`,
          );
          readImages.push({ ...img });
          continue;
        }

        try {
          const base64 = await readBlobAsBase64(img.blobKey);
          const ctx = group.prunedTree
            ? findImageContext(group.prunedTree, img.src)
            : null;
          const contextText = ctx ? formatImageContext(ctx) : "";
          const result = await imageReaderCall(
            {
              imageBase64: base64,
              mimeType: img.mimeType || "image/png",
              src: img.src,
              alt: img.alt || "",
              context: contextText,
              userContext,
            },
            signal,
          );
          if (result.kind === "decorative") {
            await scratch(
              runId,
              `- Skipped decorative DOM image dom-${i + 1} (${img.src})`,
            );
            continue;
          }
          readImages.push({
            ...img,
            description: result.description,
            tags: result.tags,
            readerKind: result.kind,
          });
        } catch (err) {
          // Reader failed (network, bad bytes, etc.) — keep the image but
          // without a description so it still appears in the vault.
          console.warn(`[indexer] image reader failed for dom-${i + 1}:`, err);
          readImages.push({ ...img });
        }
      }
      live.getState().setCurrentAction(null);

      if (readImages.length > 0) {
        live.getState().setCurrentAction({
          verb: "saving",
          subject: `${readImages.length} DOM image${readImages.length === 1 ? "" : "s"}`,
        });
        domImagesIndex = await materialiseDomImages({
          groupName,
          domImages: readImages,
        });
        live.getState().setCurrentAction(null);

        if (domImagesIndex.length > 0) {
          live.getState().bumpDomImages(domImagesIndex.length);
          live.getState().pushAction(
            `Saved ${domImagesIndex.length} DOM image${domImagesIndex.length === 1 ? "" : "s"}`,
          );
        }

        // Embed each described image. One section row per image (kind
        // "image", topic = description), one summary chunk per image. The
        // embedPromises array is awaited above this block, so push to a
        // local promises list and await it before manifest write.
        const domEmbedPromises: Promise<unknown>[] = [];
        const db = await getVaultDb();
        for (const indexed of domImagesIndex) {
          if (!indexed.description) continue;
          const sectionRowId = `sec-${crypto.randomUUID()}`;
          await db.insert(sections).values({
            id: sectionRowId,
            runId,
            sourceItemId: "",
            noteItemId: indexed.itemId,
            ordinal: sectionGlobalOrdinal + domImagesIndex.indexOf(indexed) + 1,
            kind: "image",
            topic: indexed.alt || indexed.title,
            contentText: indexed.description,
            summary: indexed.description,
            questions: [],
            concepts: indexed.tags,
            images: [],
          });
          domEmbedPromises.push(
            embedSectionChunks(
              sectionRowId,
              {
                summary: indexed.description,
                questions: [],
                concepts: indexed.tags,
              },
              signal,
            ).catch((err) =>
              console.warn(
                `[indexer] dom-image embed failed for ${indexed.title}:`,
                err,
              ),
            ),
          );
        }
        await Promise.allSettled(domEmbedPromises);
      }
    }

    const conceptIndex = [...allConcepts].sort((a, b) => a.localeCompare(b));
    live.getState().setCurrentAction({ verb: "writing", subject: "manifest" });
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
      domImages: domImagesIndex,
    });

    live.getState().setCurrentAction(null);
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
    // Distinguish user-cancelled runs (signal.aborted with the registry's
    // sentinel reason) from genuine failures so the queue + UI reflect intent.
    const cancelled =
      signal?.aborted &&
      (signal.reason === USER_CANCELLED ||
        message.toLowerCase().includes("cancelled") ||
        message.toLowerCase().includes("aborted"));
    if (cancelled) {
      console.warn("[indexer] run cancelled:", message);
      live.getState().setCurrentAction(null);
      await store.getState().applyStatus(runId, "cancelled");
      live.getState().finish(false);
      live.getState().pushAction(`Cancelled`);
      await scratch(runId, `\n## Cancelled`);
    } else {
      console.error("[indexer] run failed:", message);
      live.getState().setCurrentAction(null);
      await store.getState().applyStatus(runId, "failed", { error: message });
      live.getState().finish(false);
      live.getState().pushAction(`Failed: ${message}`);
      await scratch(runId, `\n## Failed: ${message}`);
    }
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
    const swaps: Array<{ sourceItemId?: string; bboxId?: string; alt: string }> = [];
    for (let i = 0; i < v.diagrams.length; i++) {
      const d = v.diagrams[i];
      diagramCounter++;
      // No source item materialised (text-only file, or per-page encode
      // failed). Render the diagram description as italic text via the
      // empty-title degrade path in inlineDiagramRefs.
      if (!p.sourceItemId) {
        swaps.push({ alt: d.alt });
        continue;
      }
      try {
        const { bboxId } = await recordBboxOnSource({
          sourceItemId: p.sourceItemId,
          bbox: d.bbox,
          alt: d.alt,
          caption: d.caption,
        });
        swaps.push({
          sourceItemId: p.sourceItemId,
          bboxId,
          alt: d.alt || d.caption || `Figure ${diagramCounter}`,
        });
      } catch (err) {
        console.warn(`[indexer] bbox record failed s${opts.sectionOrdinal} d${diagramCounter}:`, err);
        swaps.push({ alt: d.alt });
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

/**
 * Read an OPFS blob (by key) and return its bytes as a bare base64 string
 * — no `data:` prefix. Used to ship DOM image bytes to the image-reader
 * agent without re-downloading them from the original page.
 */
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

/**
 * Run imageReader on a freshly-materialised source capture, persist the
 * description as the item's summary, and embed it as a `summary`-kind
 * chunk so the chat agent's `search_semantic` can hit the original page
 * directly.
 *
 * Synthetic section row: we don't have a "real" section for whole pages
 * (sections are derived from the Visioner's topic transitions across
 * pages), so we create a kind=`image` section row keyed to the run with
 * the description as both contentText and summary. The chunk's
 * sectionId points at this row.
 */
async function summariseAndEmbedCapture(opts: {
  captureItemId: string;
  imageBase64: string;
  mimeType: string;
  fileName: string;
  pageOrdinal: number;
  userContext: string;
  signal?: AbortSignal;
}): Promise<void> {
  const result = await imageReaderCall(
    {
      imageBase64: opts.imageBase64,
      mimeType: opts.mimeType,
      src: opts.fileName,
      alt: `Page ${opts.pageOrdinal} of ${opts.fileName}`,
      context: "", // whole-page summary — no neighbouring-DOM context
      userContext: opts.userContext,
    },
    opts.signal,
  );
  const description = result.description.trim();
  if (!description) return;
  await updateCaptureSummary({
    itemId: opts.captureItemId,
    summary: description,
    tags: result.tags,
  });

  // Embed: section row of kind=image, one summary chunk for the page.
  const sectionRowId = `sec-${crypto.randomUUID()}`;
  const db = await getVaultDb();
  await db.insert(sections).values({
    id: sectionRowId,
    runId: "", // not tied to a run, derivable via items.id if needed
    sourceItemId: opts.captureItemId,
    noteItemId: opts.captureItemId,
    ordinal: opts.pageOrdinal,
    kind: "image",
    topic: `Page ${opts.pageOrdinal}`,
    contentText: description,
    summary: description,
    questions: [],
    concepts: result.tags,
    images: [],
  });
  await embedSectionChunks(
    sectionRowId,
    { summary: description, questions: [], concepts: result.tags },
    opts.signal,
  ).catch((err) => console.warn("[indexer] capture embed failed:", err));
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

