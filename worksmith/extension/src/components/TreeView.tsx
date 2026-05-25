import { forwardRef } from "react";
import type { CSSProperties } from "react";
import type { AccessibilitySnapshot, TreeNode as TreeNodeData } from "../lib/types";
import { nodeMatchesQuery } from "../lib/tree";

interface TreeViewProps {
  snapshot: AccessibilitySnapshot;
  query: string;
}

export const TreeView = forwardRef<HTMLDivElement, TreeViewProps>(function TreeView(
  { snapshot, query },
  ref,
) {
  const normalizedQuery = query.trim().toLowerCase();

  // Remount the subtree (resetting default open state) only when the tab, pruned
  // flag, or search query changes — NOT when a new snapshot for the same tab
  // arrives, so the user's expand/collapse navigation is preserved across live
  // updates and 30s auto-recaptures.
  const treeKey = `${snapshot.tabId}|${snapshot.pruned ? 1 : 0}|${normalizedQuery}`;
  const rootVisible = !normalizedQuery || subtreeMatches(snapshot.tree, normalizedQuery);

  return (
    <div className="tree-explorer" ref={ref}>
      <div className="tree-root" key={treeKey}>
        {rootVisible ? (
          <TreeNode node={snapshot.tree} depth={0} path="0" query={normalizedQuery} />
        ) : (
          <p className="empty">No matching nodes</p>
        )}
      </div>
    </div>
  );
});

interface TreeNodeProps {
  node: TreeNodeData;
  depth: number;
  path: string;
  query: string;
}

function TreeNode({ node, depth, path, query }: TreeNodeProps) {
  const children = Array.isArray(node.children) ? node.children : [];
  const renderedChildren = children
    .map((child, index) => ({ child, index }))
    .filter(({ child }) => !query || subtreeMatches(child, query));

  const selfMatches = nodeMatchesQuery(node, query);
  const descendantMatches = renderedChildren.length > 0;
  const shouldRender = !query || selfMatches || descendantMatches;

  if (!shouldRender) {
    return null;
  }

  const open = query ? descendantMatches : depth < 2;
  const isLeaf = renderedChildren.length === 0;

  return (
    <details
      className={`tree-node${selfMatches && query ? " matched" : ""}${isLeaf ? " leaf" : ""}`}
      style={{ "--depth": depth } as CSSProperties}
      open={open}
    >
      <summary className="tree-node-summary" title={node.selector || node.tag || node.role || ""}>
        <NodeMain node={node} />
        <NodeMeta node={node} childCount={renderedChildren.length} />
      </summary>
      <NodeData node={node} />
      <div className="tree-node-children">
        {renderedChildren.map(({ child, index }) => (
          <TreeNode key={index} node={child} depth={depth + 1} path={`${path}.${index}`} query={query} />
        ))}
      </div>
    </details>
  );
}

function NodeMain({ node }: { node: TreeNodeData }) {
  return (
    <span className="tree-node-main">
      <span className="tree-role">{node.role || "generic"}</span>
      {node.name ? (
        <span className="tree-name">{node.name}</span>
      ) : node.text ? (
        <span className="tree-text">{node.text}</span>
      ) : null}
    </span>
  );
}

function NodeMeta({ node, childCount }: { node: TreeNodeData; childCount: number }) {
  const pills: string[] = [];
  if (node.tag) {
    pills.push(node.tag);
  }
  if (childCount) {
    pills.push(String(childCount));
  }
  if (node.state) {
    Object.entries(node.state).forEach(([key, value]) => pills.push(`${key}:${value}`));
  }
  if (node.rect) {
    pills.push(`${Math.round(node.rect.width)}x${Math.round(node.rect.height)}`);
  }

  return (
    <span className="tree-node-meta">
      {pills.map((pill, index) => (
        <span className="tree-pill" key={index}>
          {pill}
        </span>
      ))}
    </span>
  );
}

function NodeData({ node }: { node: TreeNodeData }) {
  const rows: Array<[string, string]> = [];
  const add = (label: string, value: string | undefined | null) => {
    if (value === null || value === undefined || value === "") {
      return;
    }
    rows.push([label, String(value)]);
  };

  add("role", node.role);
  add("name", node.name);
  add("tag", node.tag);
  add("text", node.text);
  add("selector", node.selector);
  if (node.state && Object.keys(node.state).length) {
    add("state", JSON.stringify(node.state));
  }
  if (node.rect) {
    add("rect", `x:${node.rect.x} y:${node.rect.y} w:${node.rect.width} h:${node.rect.height}`);
  }
  if (!rows.length) {
    add("data", "No additional node data");
  }

  return (
    <dl className="tree-node-data">
      {rows.map(([label, value], index) => (
        <div key={index} style={{ display: "contents" }}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function subtreeMatches(node: TreeNodeData, query: string): boolean {
  if (nodeMatchesQuery(node, query)) {
    return true;
  }
  return (node.children || []).some((child) => subtreeMatches(child, query));
}
