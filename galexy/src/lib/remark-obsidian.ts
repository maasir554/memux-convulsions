// A small remark plugin that adds Obsidian-flavored syntax on top of GFM:
//   - [[Wiki Links]], [[Target|alias]], [[Target#heading]]  -> link (url "wikilink:Target")
//   - #tags                                                  -> link (url "tag:name")
//   - > [!type] Title  callouts                              -> <div class="callout" data-callout="type">
//
// It operates on the mdast tree directly (no extra deps). Generated link nodes
// are rendered by MarkdownView, which inspects the url prefix.

type MdNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
};

export function remarkObsidian() {
  return (tree: MdNode) => walk(tree);
}

function walk(node: MdNode): void {
  if (node.type === "blockquote") applyCallout(node);

  if (!node.children) return;

  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      next.push(...splitText(child.value));
    } else {
      // Don't descend into code; leave wikilink/tag-looking text intact there.
      if (child.type !== "code" && child.type !== "inlineCode") walk(child);
      next.push(child);
    }
  }
  node.children = next;
}

// --- inline: wiki links + tags ----------------------------------------------

function splitText(value: string): MdNode[] {
  const out: MdNode[] = [];
  for (const node of splitWikiLinks(value)) {
    if (node.type === "text" && typeof node.value === "string") {
      out.push(...splitTags(node.value));
    } else {
      out.push(node);
    }
  }
  return out;
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function splitWikiLinks(value: string): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((match = WIKILINK_RE.exec(value))) {
    if (match.index > last) {
      out.push({ type: "text", value: value.slice(last, match.index) });
    }
    out.push(makeWikiLink(match[1]));
    last = match.index + match[0].length;
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out.length ? out : [{ type: "text", value }];
}

function makeWikiLink(raw: string): MdNode {
  const [targetPart, alias] = raw.split("|");
  const target = targetPart.split("#")[0].trim();
  const display = (alias ?? targetPart).trim();
  return {
    type: "link",
    url: `wikilink:${target}`,
    children: [{ type: "text", value: display }],
  };
}

const TAG_RE = /#[A-Za-z][\w/-]*/g;

function splitTags(value: string): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(value))) {
    const before = match.index === 0 ? "" : value[match.index - 1];
    // Only treat as a tag at a word boundary (start, whitespace, or paren).
    if (before && !/[\s(]/.test(before)) continue;
    if (match.index > last) {
      out.push({ type: "text", value: value.slice(last, match.index) });
    }
    out.push(makeTag(match[0].slice(1)));
    last = match.index + match[0].length;
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out.length ? out : [{ type: "text", value }];
}

function makeTag(name: string): MdNode {
  return {
    type: "link",
    url: `tag:${name}`,
    children: [{ type: "text", value: `#${name}` }],
  };
}

// --- block: callouts ---------------------------------------------------------

const CALLOUT_RE = /^\[!(\w+)\][+-]?\s*(.*)$/;

function applyCallout(node: MdNode): void {
  const firstParagraph = node.children?.[0];
  if (firstParagraph?.type !== "paragraph") return;

  const firstText = firstParagraph.children?.[0];
  if (firstText?.type !== "text" || typeof firstText.value !== "string") return;

  const newlineAt = firstText.value.indexOf("\n");
  const firstLine =
    newlineAt === -1 ? firstText.value : firstText.value.slice(0, newlineAt);
  const rest = newlineAt === -1 ? "" : firstText.value.slice(newlineAt + 1);

  const match = CALLOUT_RE.exec(firstLine);
  if (!match) return;

  const type = match[1].toLowerCase();
  const title = match[2].trim() || capitalize(type);

  // Render the blockquote as a callout container.
  node.data = {
    hName: "div",
    hProperties: { className: ["callout"], "data-callout": type },
  };

  // Strip the marker line; keep any text that followed it on later lines.
  firstText.value = rest;

  const titleNode: MdNode = {
    type: "paragraph",
    data: { hName: "div", hProperties: { className: ["callout-title"] } },
    children: [{ type: "text", value: title }],
  };
  node.children = [titleNode, ...(node.children ?? [])];
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
