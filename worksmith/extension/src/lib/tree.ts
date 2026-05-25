import type { AccessibilitySnapshot, TreeNode } from "./types";

export function countTreeNodes(node: TreeNode | null | undefined): number {
  if (!node) {
    return 0;
  }
  const children = Array.isArray(node.children) ? node.children : [];
  return 1 + children.reduce((total, child) => total + countTreeNodes(child), 0);
}

export function countVisibleTreeNodes(node: TreeNode | null | undefined, query: string): number {
  if (!node) {
    return 0;
  }
  if (!query) {
    return countTreeNodes(node);
  }
  const children = Array.isArray(node.children) ? node.children : [];
  const childCount = children.reduce((total, child) => total + countVisibleTreeNodes(child, query), 0);
  return nodeMatchesQuery(node, query) || childCount > 0 ? 1 + childCount : 0;
}

export function nodeMatchesQuery(node: TreeNode, query: string): boolean {
  if (!query) {
    return false;
  }
  return getNodeSearchText(node).includes(query);
}

function getNodeSearchText(node: TreeNode): string {
  const stateText = node.state
    ? Object.entries(node.state)
        .map(([key, value]) => `${key} ${value}`)
        .join(" ")
    : "";

  return [node.role, node.name, node.tag, node.text, node.selector, stateText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function getSnapshotKey(snapshot: AccessibilitySnapshot | null | undefined): string {
  return [snapshot?.tabId, snapshot?.capturedAt, snapshot?.url, snapshot?.pruned ? "pruned" : ""]
    .filter(Boolean)
    .join("|");
}
