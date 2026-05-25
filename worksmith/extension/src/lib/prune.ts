import type { TreeNode } from "./types";

// Collapse the raw DOM-derived tree into a compact, agent-oriented "semantic
// interaction tree": keep interactive, landmark, heading, media, text-bearing,
// and stateful nodes; drop structural wrapper chains and hoist their meaningful
// descendants upward. The input tree is never mutated.

const PRUNE_INTERACTIVE_ROLES = new Set([
  "button", "link", "checkbox", "radio", "switch", "textbox", "searchbox",
  "combobox", "listbox", "option", "slider", "spinbutton", "menuitem",
  "menuitemcheckbox", "menuitemradio", "tab", "treeitem", "gridcell",
  "menu", "menubar", "scrollbar",
]);

const PRUNE_LANDMARK_ROLES = new Set([
  "banner", "navigation", "main", "complementary", "contentinfo", "region",
  "form", "search", "article", "dialog", "alertdialog",
]);

const PRUNE_STRUCTURE_ROLES = new Set([
  "heading", "img", "figure", "list", "listitem", "table", "row", "cell",
  "columnheader", "rowheader", "tabpanel", "alert", "status", "progressbar",
  "meter", "tooltip",
]);

const PRUNE_MEANINGFUL_STATES = new Set([
  "checked", "disabled", "expanded", "pressed", "selected",
]);

export function pruneAccessibilityTree(root: TreeNode): TreeNode {
  if (!root) {
    return root;
  }

  const { children, ...rest } = root;
  return { ...rest, children: (children || []).flatMap(pruneTreeNode) };
}

function pruneTreeNode(node: TreeNode): TreeNode[] {
  const prunedChildren = (node.children || []).flatMap(pruneTreeNode);

  if (!isMeaningfulTreeNode(node)) {
    // Structural wrapper: drop it and lift its meaningful descendants up a level.
    return prunedChildren;
  }

  const { children, ...rest } = node;
  void children;
  const name = (node.name || "").toLowerCase();
  const keptChildren = name
    ? prunedChildren.filter((child) => !isRedundantTextEcho(child, name))
    : prunedChildren;

  return [{ ...rest, children: keptChildren }];
}

function isMeaningfulTreeNode(node: TreeNode): boolean {
  const role = node.role || "";

  if (
    PRUNE_INTERACTIVE_ROLES.has(role) ||
    PRUNE_LANDMARK_ROLES.has(role) ||
    PRUNE_STRUCTURE_ROLES.has(role)
  ) {
    return true;
  }

  if (node.name || node.text) {
    return true;
  }

  return hasMeaningfulState(node);
}

// Drop a text-only child whose text just echoes an ancestor's accessible name
// (e.g. a <span>Submit</span> inside a button already named "Submit").
function isRedundantTextEcho(node: TreeNode, parentName: string): boolean {
  if (node.children && node.children.length) {
    return false;
  }

  if (node.name || hasMeaningfulState(node)) {
    return false;
  }

  const role = node.role || "";
  if (PRUNE_INTERACTIVE_ROLES.has(role) || PRUNE_LANDMARK_ROLES.has(role) || role === "heading") {
    return false;
  }

  return Boolean(node.text) && parentName.includes((node.text || "").toLowerCase());
}

function hasMeaningfulState(node: TreeNode): boolean {
  return Boolean(node.state) && Object.keys(node.state!).some((key) => PRUNE_MEANINGFUL_STATES.has(key));
}
