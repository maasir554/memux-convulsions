"use client";

/**
 * Two tools that expose what the indexer learned at run-time but never
 * surfaced to the chat agent before:
 *
 *   • get_section_links — returns the persisted SectionLink[] for one
 *     section: href, anchor text, source (tree / transcribed / bare-url).
 *     Use to answer "what does this section link to" without scraping
 *     prose.
 *
 *   • query_section_tree — fetches the pruned accessibility tree of the
 *     RUN the section belongs to (today's tree is per-run; we don't slice
 *     per-section), runs it through the server-side treeQuery agent with
 *     a natural-language query, and returns a tight answer + the
 *     supporting nodes. Use to answer structural questions ("what other
 *     links were on this page", "what's the heading hierarchy near
 *     this section") that the agent can't answer from section md alone.
 */

import { eq } from "drizzle-orm";

import { getVaultDb } from "@/lib/db/vault-db";
import { indexRuns, items, sections, type SectionLink } from "@/lib/db/schema";
import { treeQueryCall } from "@/lib/indexer/agent-client";
import type { ItemRef, ToolResult } from "@/lib/chat/types";

/* ------------------------------------------------------------- get_section_links */

export type GetSectionLinksInput = { sectionId: string };

export async function getSectionLinks(input: GetSectionLinksInput): Promise<ToolResult> {
  const db = await getVaultDb();
  const [row] = await db
    .select({
      id: sections.id,
      noteItemId: sections.noteItemId,
      topic: sections.topic,
      links: sections.links,
    })
    .from(sections)
    .where(eq(sections.id, input.sectionId));
  if (!row) return { ok: false, error: `No section ${input.sectionId}` };

  const links = (row.links ?? []) as SectionLink[];
  const sectionTitle = row.topic || row.noteItemId || row.id;

  // Build ItemRefs for the chat agent. Hrefs aren't vault items, so we
  // synthesise an `itemId` from the href — the agent can use it as a
  // string handle without us pretending it's a real item id. Citation
  // chips will hit the `Unknown vault item` fallback if the model tries
  // to chip them; that's the correct behaviour.
  const refs: ItemRef[] = links.map((l) => ({
    itemId: `url:${l.href}`,
    title: l.anchor || l.href,
    type: "markdown", // closest fit for a non-item ref
    folder: "(external)",
    snippet: l.href,
  }));

  return {
    ok: true,
    summary: `Section "${sectionTitle}" has ${links.length} external link${
      links.length === 1 ? "" : "s"
    }.`,
    refs,
    ui: {
      kind: "section-links",
      sectionId: row.id,
      sectionTitle,
      links,
    },
  };
}

/* ------------------------------------------------------ query_section_tree */

export type QuerySectionTreeInput = {
  sectionId: string;
  query: string;
};

const MAX_TREE_JSON_LEN = 60_000;

export async function querySectionTree(
  input: QuerySectionTreeInput,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const q = input.query.trim();
  if (!q) return { ok: false, error: "Empty query" };

  const db = await getVaultDb();
  const [section] = await db
    .select({
      id: sections.id,
      runId: sections.runId,
      topic: sections.topic,
      noteItemId: sections.noteItemId,
    })
    .from(sections)
    .where(eq(sections.id, input.sectionId));
  if (!section) return { ok: false, error: `No section ${input.sectionId}` };

  const [run] = await db
    .select({ prunedTree: indexRuns.prunedTree, groupName: indexRuns.groupName })
    .from(indexRuns)
    .where(eq(indexRuns.id, section.runId));
  if (!run || !run.prunedTree) {
    return {
      ok: false,
      error: `Section ${section.id} has no captured accessibility tree (run ${section.runId})`,
    };
  }

  let treeJson = JSON.stringify(run.prunedTree);
  let truncated = false;
  if (treeJson.length > MAX_TREE_JSON_LEN) {
    // Pragmatic cap: tail-truncate. Real fix would be smart slicing but
    // 60KB is generous for a pruned tree and rarely hit.
    treeJson = treeJson.slice(0, MAX_TREE_JSON_LEN);
    truncated = true;
  }

  // Find a human title for the page (the section's source note, if any).
  let pageTitle: string | undefined;
  if (section.noteItemId) {
    const [note] = await db
      .select({ title: items.title })
      .from(items)
      .where(eq(items.id, section.noteItemId));
    pageTitle = note?.title;
  }
  pageTitle = pageTitle || run.groupName || section.topic;

  const out = await treeQueryCall(
    { treeJson, query: q, pageTitle },
    signal,
  );

  return {
    ok: true,
    summary: truncated
      ? `Tree query (truncated to 60KB): ${out.answer}`
      : `Tree query: ${out.answer}`,
    refs: [], // tree nodes aren't vault items; expose via the UI payload
    ui: {
      kind: "tree-query",
      sectionId: section.id,
      query: q,
      answer: out.answer,
      relevantNodes: out.relevantNodes ?? [],
    },
  };
}
