import { useMemo, useState } from "react";
import type { AccessibilitySnapshot } from "../lib/types";
import { AI_KIND_LABELS, AI_KIND_ORDER, buildAiTree, type AiNode } from "../lib/aitree";
import { Icon } from "./IconSprite";

interface AiTreeNavigatorProps {
  snapshot: AccessibilitySnapshot;
}

export function AiTreeNavigator({ snapshot }: AiTreeNavigatorProps) {
  const tree = useMemo(() => buildAiTree(snapshot.tree), [snapshot]);
  const [path, setPath] = useState<number[]>([]);

  // Resolve the current node along the path, clamping if the data changed.
  const along: AiNode[] = [tree.root];
  let node = tree.root;
  const validPath: number[] = [];
  for (const childIndex of path) {
    const next = node.children[childIndex];
    if (!next || next.kind !== "section") break;
    node = next;
    along.push(node);
    validPath.push(childIndex);
  }
  const current = node;

  const childEntries = current.children.map((child, index) => ({ child, index }));

  return (
    <div className="ai-nav">
      <div className="ai-breadcrumb">
        {along.map((crumb, index) => (
          <span key={crumb.id} className="ai-crumb-wrap">
            {index > 0 && <span className="ai-crumb-sep">›</span>}
            <button
              type="button"
              className={`ai-crumb${index === along.length - 1 ? " current" : ""}`}
              onClick={() => setPath(validPath.slice(0, index))}
            >
              {crumbLabel(crumb, index === 0)}
            </button>
          </span>
        ))}
      </div>

      <div className="ai-current">
        <div className="ai-current-title">
          <span className="ai-role">{current.role}</span>
          {current.name && <span className="ai-current-name">{current.name}</span>}
        </div>
        <div className="ai-current-summary">
          {summaryText(current)} · {tree.total} addressable on page
        </div>
      </div>

      <div className="ai-list">
        {childEntries.length === 0 && <p className="empty">This node has no children</p>}
        {childEntries.map(({ child, index }) => {
          const isSection = child.kind === "section";
          const drill = isSection ? () => setPath([...validPath, index]) : undefined;
          return (
            <div
              key={child.id}
              className={`ai-row ai-row-${isSection ? "section" : "item"}`}
              role={isSection ? "button" : undefined}
              tabIndex={isSection ? 0 : undefined}
              onClick={drill}
              onKeyDown={
                isSection
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        drill?.();
                      }
                    }
                  : undefined
              }
            >
              <span className="ai-row-main">
                {child.index != null && <span className="ai-index">@{child.index}</span>}
                <span className="ai-role">{child.role}</span>
                {(child.name || isSection) && (
                  <span className="ai-row-name">{child.name || `(unnamed ${child.role})`}</span>
                )}
              </span>
              <span className="ai-row-meta">
                {isSection && <span className="ai-pill">{describeSection(child)}</span>}
                <ItemInfo node={child} />
                <span className={`ai-chip ai-chip-${child.kind}`}>{child.kind}</span>
                {isSection && <span className="ai-chevron">›</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ItemInfo({ node }: { node: AiNode }) {
  const rect = node.rect;
  return (
    <span className="ai-info-wrap" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="ai-info" aria-label="Element details">
        <Icon id="icon-info" className="icon ai-info-icon" />
      </button>
      <span className="ai-info-pop" role="tooltip">
        <span className="ai-info-row">
          <span className="ai-info-key">selector</span>
          <code>{node.selector || "—"}</code>
        </span>
        <span className="ai-info-row">
          <span className="ai-info-key">rect</span>
          <code>
            {rect ? `x:${rect.x} y:${rect.y} w:${rect.width} h:${rect.height}` : "—"}
          </code>
        </span>
        {node.index != null && (
          <span className="ai-info-row">
            <span className="ai-info-key">index</span>
            <code>@{node.index}</code>
          </span>
        )}
      </span>
    </span>
  );
}

function crumbLabel(node: AiNode, isRoot: boolean): string {
  if (isRoot) {
    return node.name || "Page";
  }
  return node.name || node.role;
}

function summaryText(node: AiNode): string {
  const parts: string[] = [];
  for (const kind of AI_KIND_ORDER) {
    const count = node.counts[kind];
    if (count) {
      parts.push(`${count} ${AI_KIND_LABELS[kind].toLowerCase()}`);
    }
  }
  return parts.length ? parts.join(" · ") : "empty";
}

function describeSection(node: AiNode): string {
  if (node.descendantInteractive > 0) {
    return `${node.descendantInteractive} interactive`;
  }
  const total = node.children.length;
  return total ? `${total} item${total === 1 ? "" : "s"}` : "empty";
}
