"use client";

/**
 * Central tool registry. Each entry has:
 *  - name: matches ToolName union exactly
 *  - description: one-line model-facing pitch ("when to use this tool")
 *  - parameters: OpenAPI 3.0 schema for native function-calling
 *  - handler: client-side dispatcher
 *
 * The harness:
 *  1. Exposes every tool's name+description+parameters in the system
 *     prompt / tools manifest sent to Gemini.
 *  2. When Gemini emits a functionCall part, looks up the tool by name
 *     and invokes its handler with the JSON args.
 *
 * Adding a new tool is two lines: import the handler, add a registry
 * entry. The harness picks it up automatically.
 */

import type { ToolName, ToolResult } from "@/lib/chat/types";
import { searchKeyword, type SearchKeywordInput } from "@/lib/chat/tools/search-keyword";
import { searchSemantic, type SearchSemanticInput } from "@/lib/chat/tools/search-semantic";
import { searchCombined, type SearchCombinedInput } from "@/lib/chat/tools/search-combined";
import { getItem, type GetItemInput } from "@/lib/chat/tools/get-item";
import { readSection, type ReadSectionInput } from "@/lib/chat/tools/read-section";
import { readImage, type ReadImageInput } from "@/lib/chat/tools/read-image";
import { findByDateRange, type FindByDateInput } from "@/lib/chat/tools/find-by-date";
import {
  getBacklinks,
  getOutlinks,
  getFolderContents,
  type GetBacklinksInput,
  type GetOutlinksInput,
  type GetFolderContentsInput,
} from "@/lib/chat/tools/graph";
import { listConcepts, getConcept, type ListConceptsInput, type GetConceptInput } from "@/lib/chat/tools/concepts";
import { findImageRegion, type FindImageRegionInput } from "@/lib/chat/tools/find-image-region";
import {
  searchDocumentsTool,
  type SearchDocumentsInput,
} from "@/lib/chat/tools/search-documents";
import {
  getSectionLinks,
  querySectionTree,
  type GetSectionLinksInput,
  type QuerySectionTreeInput,
} from "@/lib/chat/tools/section-tree";

export type ToolDef = {
  name: ToolName;
  description: string;
  parameters: Record<string, unknown>;
  handler: (input: unknown, signal?: AbortSignal) => Promise<ToolResult>;
};

export const TOOLS: ToolDef[] = [
  {
    name: "search_keyword",
    description:
      "Literal-string search over the vault. Use for proper nouns, code symbols, exact phrases the user mentioned, or filenames. Title matches outrank content matches.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Exact substring to look for." },
        limit: { type: "integer", minimum: 1, maximum: 30, description: "Max results (default 10)." },
        types: {
          type: "array",
          items: { type: "string", enum: ["markdown", "code", "csv", "pdf", "image"] },
          description: "Restrict to particular item types.",
        },
        folderPath: { type: "string", description: "Restrict to a folder subtree." },
      },
      required: ["query"],
    },
    handler: (input, _signal) => searchKeyword(input as SearchKeywordInput),
  },
  {
    name: "search_documents",
    description:
      "BM25 full-text search across EVERY md / code / csv item in the vault — including notes the user never sent through the indexer. Use for natural-language word queries (multiple terms, paraphrases, typos OK). Distinct from search_keyword (exact substring, no ranking) and search_semantic (only indexed summaries; misses unindexed notes).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language words / phrase to search for." },
        limit: { type: "integer", minimum: 1, maximum: 30, description: "Max results (default 10)." },
      },
      required: ["query"],
    },
    handler: (input, _signal) => searchDocumentsTool(input as SearchDocumentsInput),
  },
  {
    name: "search_semantic",
    description:
      "Vector search over indexed section summaries, questions, concepts, and DOM-image descriptions. Use for conceptual / paraphrased / fuzzy queries where the exact words may not appear.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language question or topic." },
        limit: { type: "integer", minimum: 1, maximum: 30, description: "Max chunks (default 10)." },
        kinds: {
          type: "array",
          items: { type: "string", enum: ["summary", "question", "concept", "image"] },
          description: "Filter by chunk kind (default: all).",
        },
      },
      required: ["query"],
    },
    handler: (input, signal) => searchSemantic(input as SearchSemanticInput, signal),
  },
  {
    name: "get_item",
    description:
      "Fetch one vault item's full content + metadata by ID. Use after a search to read a candidate in depth.",
    parameters: {
      type: "object",
      properties: {
        itemId: { type: "string" },
        metaOnly: { type: "boolean", description: "If true, omit the body. Default false." },
      },
      required: ["itemId"],
    },
    handler: (input, _signal) => getItem(input as GetItemInput),
  },
  {
    name: "read_section",
    description:
      "Read one indexed section note (Section NN · <topic>.md). Returns the parsed markdown plus a manifest backref so you can navigate to the parent indexed group.",
    parameters: {
      type: "object",
      properties: {
        noteItemId: { type: "string", description: "items.id of the section note." },
      },
      required: ["noteItemId"],
    },
    handler: (input, _signal) => readSection(input as ReadSectionInput),
  },
  {
    name: "search_combined",
    description:
      "Best-of-both search: runs keyword AND semantic in parallel, fuses the rankings (RRF). Use as your default search unless you have a strong reason to pick one specifically.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 30 },
      },
      required: ["query"],
    },
    handler: (input, signal) => searchCombined(input as SearchCombinedInput, signal),
  },
  {
    name: "read_image",
    description:
      "Read a vault image item — returns the indexer-generated description plus a UI handle to render the bytes alongside your answer.",
    parameters: {
      type: "object",
      properties: { itemId: { type: "string" } },
      required: ["itemId"],
    },
    handler: (input, _signal) => readImage(input as ReadImageInput),
  },
  {
    name: "find_by_date_range",
    description:
      "Find items by date. scope=vault uses item.updated_at; scope=indexed uses section.created_at (when the LLM section was authored). ISO dates, exclusive upper bound.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO date YYYY-MM-DD or full timestamp." },
        to: { type: "string", description: "Exclusive upper bound. Omit for open-ended." },
        scope: { type: "string", enum: ["vault", "indexed"] },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
    handler: (input, _signal) => findByDateRange(input as FindByDateInput),
  },
  {
    name: "get_backlinks",
    description: "Find items that link TO this item via wikilink. Useful for figuring out where a note is referenced.",
    parameters: {
      type: "object",
      properties: {
        itemId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["itemId"],
    },
    handler: (input, _signal) => getBacklinks(input as GetBacklinksInput),
  },
  {
    name: "get_outlinks",
    description: "Find items this item links TO. Use to follow a chain of references.",
    parameters: {
      type: "object",
      properties: { itemId: { type: "string" } },
      required: ["itemId"],
    },
    handler: (input, _signal) => getOutlinks(input as GetOutlinksInput),
  },
  {
    name: "get_folder_contents",
    description: "List items inside a folder. recursive=true returns the whole subtree (capped at 100).",
    parameters: {
      type: "object",
      properties: {
        folderPath: { type: "string" },
        recursive: { type: "boolean" },
      },
      required: ["folderPath"],
    },
    handler: (input, _signal) => getFolderContents(input as GetFolderContentsInput),
  },
  {
    name: "list_concepts",
    description: "List concepts the indexer has surfaced across all runs. Optional substring filter.",
    parameters: {
      type: "object",
      properties: {
        match: { type: "string", description: "Substring to filter concept names." },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
    handler: (input, _signal) => listConcepts(input as ListConceptsInput),
  },
  {
    name: "get_concept",
    description: "Fetch a concept by exact name plus every section that mentions it.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    handler: (input, _signal) => getConcept(input as GetConceptInput),
  },
  {
    name: "find_image_region",
    description:
      "Locate a region of a vault image item that matches a natural-language query (e.g. 'the pricing table'). Returns a bbox you can cite inline as ![alt](wikilink:<itemId>#bbox=<bboxId>). Persists the region on the image so future calls can reuse it.",
    parameters: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "Vault image item id." },
        query: { type: "string", description: "Natural-language description of the region to find." },
      },
      required: ["itemId", "query"],
    },
    handler: (input, signal) => findImageRegion(input as FindImageRegionInput, signal),
  },
  {
    name: "get_section_links",
    description:
      "Return the structured list of external hyperlinks captured for a section at index time. Each entry has {href, anchor, source: tree|transcribed|bare-url}. Use to answer 'what does this section link to' without scraping prose.",
    parameters: {
      type: "object",
      properties: {
        sectionId: { type: "string", description: "sections.id (typically from a section row, not a vault item id)." },
      },
      required: ["sectionId"],
    },
    handler: (input, _signal) => getSectionLinks(input as GetSectionLinksInput),
  },
  {
    name: "query_section_tree",
    description:
      "Ask a structural question about the captured web page a section was indexed from (e.g. 'what other links were on this page', 'what's the heading hierarchy', 'list all navigation items'). Runs a side agent over the pruned accessibility tree and returns a tight answer + supporting nodes. Use for questions the section markdown can't answer alone.",
    parameters: {
      type: "object",
      properties: {
        sectionId: { type: "string", description: "sections.id whose run's tree to query." },
        query: { type: "string", description: "Natural-language question about the page's structure or contents." },
      },
      required: ["sectionId", "query"],
    },
    handler: (input, signal) => querySectionTree(input as QuerySectionTreeInput, signal),
  },
];

/** Look up a tool by name; returns undefined if unknown. */
export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

/**
 * Native Gemini function-calling envelope. We emit one Tool with N
 * functionDeclarations; Gemini surfaces those names to the model.
 */
export function geminiToolsManifest(): {
  functionDeclarations: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
} {
  return {
    functionDeclarations: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  };
}
