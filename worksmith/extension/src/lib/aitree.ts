import type { Rect, TreeNode } from "./types";
import { pruneAccessibilityTree } from "./prune";

// "AI tree" — an agent-optimized semantic interaction graph.
//
// Approach (synthesised from web-agent research):
//   1. Prune the raw DOM-derived tree to a semantic interaction tree
//      (drop structural wrappers, hoist meaningful descendants). [AgentOccam:
//      consolidation]
//   2. Segment what remains into a landmark/section hierarchy: sections are the
//      navigable containers; everything else becomes a typed leaf item.
//   3. Assign stable, document-order indices to addressable items (links,
//      buttons, inputs, images) so an agent can reference "@7" directly.
//      [Set-of-Marks / browser-use selector_map]
//   4. Expose it one level at a time: each section reports its direct children
//      grouped by kind plus how many actionable items lie deeper, so an agent
//      (or the UI) drills in node by node. [AgentOccam: branch into a subtree]

export type AiKind = "section" | "heading" | "link" | "button" | "input" | "image" | "text";

export interface AiNode {
  id: string; // hierarchical path, e.g. "0.2.1"
  kind: AiKind;
  role: string;
  name: string;
  selector?: string;
  rect?: Rect | null; // bounding box (for the hover detail overlay)
  index?: number; // stable global index for addressable (leaf) items
  children: AiNode[]; // populated for sections only
  counts: Partial<Record<AiKind, number>>; // direct children, by kind
  descendantInteractive: number; // links + buttons + inputs anywhere below
}

export interface AiTree {
  root: AiNode;
  total: number; // count of indexed (addressable) items
  byIndex: Record<number, AiNode>;
}

const LINK_ROLES = new Set(["link"]);
const BUTTON_ROLES = new Set([
  "button", "checkbox", "radio", "switch", "menuitem", "menuitemcheckbox",
  "menuitemradio", "tab", "option", "treeitem",
]);
const INPUT_ROLES = new Set([
  "textbox", "searchbox", "combobox", "slider", "spinbutton",
]);
const IMAGE_ROLES = new Set(["img", "figure"]);
const HEADING_ROLES = new Set(["heading"]);
const SECTION_ROLES = new Set([
  "main", "navigation", "banner", "contentinfo", "complementary", "region",
  "article", "dialog", "alertdialog", "form", "search", "list", "listitem",
  "table", "row", "rowgroup", "grid", "group", "tablist", "tabpanel", "menu",
  "menubar", "toolbar", "feed", "document", "listbox",
]);

// Every leaf item (anything that isn't a navigable section) is addressable and
// gets a stable index — links, buttons, inputs, images, headings, and text.
const INTERACTIVE: AiKind[] = ["link", "button", "input"];

export function buildAiTree(tree: TreeNode): AiTree {
  const pruned = pruneAccessibilityTree(tree);
  const byIndex: Record<number, AiNode> = {};
  const counter = { value: 0 };

  const root =
    convert(pruned, "0", counter, byIndex) ??
    emptySection(pruned);

  return { root, total: counter.value, byIndex };
}

function convert(
  node: TreeNode,
  id: string,
  counter: { value: number },
  byIndex: Record<number, AiNode>,
): AiNode | null {
  const kind = classify(node);

  if (kind !== "section") {
    const ai: AiNode = {
      id,
      kind,
      role: node.role || "generic",
      name: node.name || node.text || "",
      selector: node.selector,
      rect: node.rect ?? null,
      children: [],
      counts: {},
      descendantInteractive: 0,
    };
    ai.index = (counter.value += 1);
    byIndex[ai.index] = ai;
    return ai;
  }

  const children: AiNode[] = [];
  (node.children || []).forEach((child, i) => {
    const built = convert(child, `${id}.${i}`, counter, byIndex);
    if (built) {
      children.push(built);
    }
  });

  // Collapse an anonymous single-child section into that child (e.g. a
  // `listitem` wrapping one `link` becomes just the link) so each navigation
  // level stays meaningful instead of a chain of one-item containers.
  if (!node.name && children.length === 1) {
    return children[0];
  }

  // Drop empty, anonymous sections — they add depth without information.
  if (!children.length && !node.name) {
    return null;
  }

  const counts: Partial<Record<AiKind, number>> = {};
  for (const child of children) {
    counts[child.kind] = (counts[child.kind] || 0) + 1;
  }

  const descendantInteractive = children.reduce(
    (total, child) =>
      total + (INTERACTIVE.includes(child.kind) ? 1 : 0) + child.descendantInteractive,
    0,
  );

  return {
    id,
    kind: "section",
    role: node.role || "generic",
    name: node.name || "",
    selector: node.selector,
    rect: node.rect ?? null,
    children,
    counts,
    descendantInteractive,
  };
}

function classify(node: TreeNode): AiKind {
  const role = node.role || "";

  if (HEADING_ROLES.has(role)) return "heading";
  if (LINK_ROLES.has(role)) return "link";
  if (BUTTON_ROLES.has(role)) return "button";
  if (INPUT_ROLES.has(role)) return "input";
  if (IMAGE_ROLES.has(role)) return "image";
  if (SECTION_ROLES.has(role)) return "section";

  // Unknown role: a container if it has children, otherwise text or an empty box.
  if (node.children && node.children.length) return "section";
  if (node.name || node.text) return "text";
  return "section";
}

function emptySection(node: TreeNode): AiNode {
  return {
    id: "0",
    kind: "section",
    role: node?.role || "document",
    name: node?.name || "",
    children: [],
    counts: {},
    descendantInteractive: 0,
  };
}

export const AI_KIND_ORDER: AiKind[] = [
  "section",
  "heading",
  "link",
  "button",
  "input",
  "image",
  "text",
];

export const AI_KIND_LABELS: Record<AiKind, string> = {
  section: "Sections",
  heading: "Headings",
  link: "Links",
  button: "Buttons",
  input: "Inputs",
  image: "Images",
  text: "Text",
};

export function isAddressable(kind: AiKind): boolean {
  return kind !== "section";
}
