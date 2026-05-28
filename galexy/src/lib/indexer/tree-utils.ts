"use client";

/**
 * Utilities for using the pruned accessibility tree the worksmith bridge
 * stashes on a run. Kept deliberately small + framework-free so it can be
 * called from the orchestrator inside the browser tab without any DOM
 * dependency.
 */

type TreeNode = {
  role?: string;
  name?: string;
  tag?: string;
  text?: string;
  href?: string;
  src?: string;
  state?: Record<string, string | boolean>;
  children?: TreeNode[];
};

export type TreeSummary = {
  nodeCount: number;
  linkCount: number;
  /** Map of normalised anchor text → href (first occurrence wins). */
  textToHref: Map<string, string>;
};

/** Walk a tree once, collect the node count and build a text→href map. */
export function summariseTree(root: unknown): TreeSummary {
  const textToHref = new Map<string, string>();
  let nodeCount = 0;
  let linkCount = 0;

  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as TreeNode;
    nodeCount++;

    if (n.role === "link" && n.href) {
      const label = (n.name ?? n.text ?? "").trim();
      // Only enrich anchors with at least 4 chars to avoid false replacements
      // on filler words like "go" or "to".
      if (label.length >= 4) {
        const key = label.toLowerCase();
        if (!textToHref.has(key)) {
          textToHref.set(key, n.href);
          linkCount++;
        }
      }
    }
    for (const child of n.children ?? []) visit(child);
  }
  visit(root);
  return { nodeCount, linkCount, textToHref };
}

/**
 * Walk a piece of markdown and wrap anchor texts with `[text](href)` where
 * the tree knows the URL. Skips:
 *  - Text already inside a markdown link `[...](...)`
 *  - Text inside code fences ``` ... ``` or inline code `…`
 *  - Lines starting with `#` (headings stay clean)
 *  - URLs anywhere in the text (so we don't replace inside an existing URL)
 *
 * Returns the rewritten markdown + a count of substitutions made.
 */
export function enrichLinks(
  md: string,
  textToHref: Map<string, string>,
): { md: string; count: number } {
  if (textToHref.size === 0) return { md, count: 0 };

  // Split on triple-backtick fences and run the replace on the non-fence
  // segments only. Code blocks at even indices, the rest at odd indices… no,
  // String#split with the fence delimiter alternates: text, fence-content,
  // text, fence-content, …
  const parts = md.split(/(```[\s\S]*?```)/g);
  let total = 0;

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) continue; // skip fenced blocks
    const segment = parts[i];
    const rewritten = enrichSegment(segment, textToHref);
    total += rewritten.count;
    parts[i] = rewritten.md;
  }
  return { md: parts.join(""), count: total };
}

function enrichSegment(
  segment: string,
  textToHref: Map<string, string>,
): { md: string; count: number } {
  let count = 0;
  const lines = segment.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (line.startsWith("#")) continue; // skip headings
    let out = line;
    // For each anchor, attempt one replacement per line (avoid runaway).
    for (const [label, href] of textToHref) {
      // Build a regex that matches the label as a contiguous phrase, NOT
      // inside an existing markdown link, NOT inside backtick code spans.
      const escaped = escapeRegex(label);
      // Lookbehind: not `[` (avoid existing link), not backtick.
      // Lookahead: not `](` (avoid existing link), not backtick.
      const re = new RegExp(
        `(?<![\\[\`])(${escaped})(?![\`\\]])(?![^\\(]*\\))`,
        "i",
      );
      if (re.test(out)) {
        out = out.replace(re, (_, m1) => `[${m1}](${href})`);
        count++;
        break; // one enrichment per line — avoids accidental cascades
      }
    }
    lines[li] = out;
  }
  return { md: lines.join("\n"), count };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ============================================================================
 * Document outline — heading-only walk that produces a hierarchical TOC the
 * Visioner can use to anchor topic decisions across pages it can't see.
 * ========================================================================== */

export type OutlineEntry = {
  /** 1..6, derived from tag (h1–h6) or aria-level state. Defaults to 2. */
  level: number;
  text: string;
};

const OUTLINE_MAX_ENTRIES = 80;
const OUTLINE_MIN_TEXT_LEN = 4;

/**
 * Walk the tree once, collect every `role: "heading"` node with non-trivial
 * text into a flat ordered outline. Decorative headings (text shorter than
 * OUTLINE_MIN_TEXT_LEN) are dropped to filter out styled-div false positives.
 * Capped at OUTLINE_MAX_ENTRIES so very long docs don't blow the prompt.
 */
export function buildTreeOutline(root: unknown): OutlineEntry[] {
  const out: OutlineEntry[] = [];

  function visit(node: unknown): void {
    if (!node || typeof node !== "object" || out.length >= OUTLINE_MAX_ENTRIES) {
      return;
    }
    const n = node as TreeNode;
    if (n.role === "heading") {
      const text = (n.name ?? n.text ?? "").trim();
      if (text.length >= OUTLINE_MIN_TEXT_LEN) {
        out.push({ level: inferHeadingLevel(n), text });
      }
    }
    for (const child of n.children ?? []) {
      if (out.length >= OUTLINE_MAX_ENTRIES) break;
      visit(child);
    }
  }
  visit(root);
  return out;
}

function inferHeadingLevel(node: TreeNode): number {
  // Prefer the tag (h1–h6) when present.
  const tag = node.tag?.toLowerCase();
  const tagMatch = tag ? /^h([1-6])$/.exec(tag) : null;
  if (tagMatch) return Number(tagMatch[1]);
  // Fall back to an explicit aria-level on the state.
  const ariaLevel = node.state?.["aria-level"];
  if (typeof ariaLevel === "string") {
    const n = Number(ariaLevel);
    if (n >= 1 && n <= 6) return n;
  }
  return 2;
}

/**
 * Render outline entries as a numbered hierarchical text outline. Counters
 * reset on level descent, so going from `1.2` → an H1 emits `2.`, and a
 * deeper level emits a new `2.1`. Indentation = (level - 1) × 2 spaces.
 */
/**
 * Locate the node in the tree that corresponds to a DOM image (matched by
 * `src`) and gather the surrounding context an image-reader agent can use
 * to interpret what the image means on the page:
 *
 *   - ancestorHeading: closest `role=heading` ancestor
 *   - parentRole / parentName: role+name of the immediate parent (often
 *     "link"/"button" — tells the reader the image is interactive)
 *   - siblings: short text from sibling nodes (captions, labels)
 *   - linkTarget: href if the image is wrapped in a link
 *   - selfAlt: name/alt from the node itself (fallback to caller's alt)
 *
 * Returns null if the src isn't found in the tree (e.g. it was a CSS
 * background that the tree captured but we resolved to a different URL).
 */
export type ImageContext = {
  ancestorHeading?: string;
  parentRole?: string;
  parentName?: string;
  siblings: string[];
  linkTarget?: string;
  selfAlt?: string;
};

export function findImageContext(
  root: unknown,
  src: string,
): ImageContext | null {
  const target = normaliseUrl(src);
  if (!target) return null;

  // Stack of ancestors built during traversal so we can look upward when we
  // find the target node. visit() returns the path-to-target on the first
  // hit; callers up the recursion bubble that up. Returning from the
  // closure (instead of mutating a captured variable) keeps TypeScript's
  // control-flow narrowing happy.
  const stack: TreeNode[] = [];

  function visit(node: unknown): TreeNode[] | null {
    if (!node || typeof node !== "object") return null;
    const n = node as TreeNode;
    stack.push(n);
    const nodeSrc = normaliseUrl(n.src);
    if (nodeSrc && nodeSrc === target) {
      const path = stack.slice();
      stack.pop();
      return path;
    }
    for (const child of n.children ?? []) {
      const hit = visit(child);
      if (hit) {
        stack.pop();
        return hit;
      }
    }
    stack.pop();
    return null;
  }
  const path = visit(root);
  if (!path) return null;

  const node = path[path.length - 1];
  const ctx: ImageContext = { siblings: [] };
  ctx.selfAlt = (node.name ?? node.text ?? "").trim() || undefined;

  // Walk ancestors from closest to furthest. The immediate parent gets a
  // role+name; further up we look for the closest heading + link target.
  for (let i = path.length - 2; i >= 0; i--) {
    const a = path[i];
    if (!ctx.parentRole && a.role && a.role !== "generic") {
      ctx.parentRole = a.role;
      ctx.parentName = (a.name ?? a.text ?? "").trim() || undefined;
    }
    if (!ctx.linkTarget && a.role === "link" && a.href) {
      ctx.linkTarget = a.href;
    }
    if (!ctx.ancestorHeading && a.role === "heading") {
      const txt = (a.name ?? a.text ?? "").trim();
      if (txt.length >= 3) ctx.ancestorHeading = txt;
    }
  }

  // Sibling text: peek at the parent's children (the ones that aren't the
  // image itself) and collect short text snippets. Capped at 6 entries /
  // 200 chars to keep the prompt tight.
  const parent = path[path.length - 2];
  if (parent?.children) {
    for (const sib of parent.children) {
      if (sib === node) continue;
      const txt = (sib.name ?? sib.text ?? "").trim();
      if (txt.length < 2 || txt.length > 80) continue;
      ctx.siblings.push(txt);
      if (ctx.siblings.length >= 6) break;
    }
  }

  return ctx;
}

/**
 * Render an ImageContext as a compact human-readable block the image-reader
 * agent can ingest. Skips empty fields so the prompt stays terse.
 */
export function formatImageContext(ctx: ImageContext): string {
  const lines: string[] = [];
  if (ctx.ancestorHeading) lines.push(`Section heading: ${ctx.ancestorHeading}`);
  if (ctx.parentRole) {
    lines.push(
      `Container: <${ctx.parentRole}${ctx.parentName ? ` "${ctx.parentName}"` : ""}>`,
    );
  }
  if (ctx.linkTarget) lines.push(`Wrapped in link to: ${ctx.linkTarget}`);
  if (ctx.selfAlt) lines.push(`Alt text: ${ctx.selfAlt}`);
  if (ctx.siblings.length > 0) {
    lines.push(`Nearby text: ${ctx.siblings.map((s) => `"${s}"`).join(", ")}`);
  }
  return lines.join("\n");
}

/** Normalise URLs for comparison: strip fragment/query, decode, lowercase. */
function normaliseUrl(raw: string | undefined): string {
  if (!raw) return "";
  try {
    const u = new URL(raw, "http://x.invalid/");
    u.hash = "";
    u.search = "";
    return u.toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

export function formatOutline(entries: readonly OutlineEntry[]): string {
  if (entries.length === 0) return "";
  const counters: number[] = [];
  const lines: string[] = [];
  for (const e of entries) {
    // Trim deeper counters when we ascend.
    while (counters.length > e.level) counters.pop();
    // Pad to current level so we can increment.
    while (counters.length < e.level) counters.push(0);
    counters[e.level - 1] = (counters[e.level - 1] ?? 0) + 1;
    const numbering = counters.slice(0, e.level).join(".");
    const indent = "  ".repeat(Math.max(0, e.level - 1));
    lines.push(`${indent}${numbering}. ${e.text}`);
  }
  return lines.join("\n");
}
