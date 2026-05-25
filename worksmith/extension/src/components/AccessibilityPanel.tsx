import { useRef, useState } from "react";
import type { AccessibilitySnapshot } from "../lib/types";
import { formatTime } from "../lib/format";
import { countTreeNodes, countVisibleTreeNodes, getSnapshotKey } from "../lib/tree";
import { TreeView } from "./TreeView";
import { AiTreeNavigator } from "./AiTreeNavigator";

export type AxView = "tree" | "raw" | "ai";

interface AccessibilityPanelProps {
  snapshot: AccessibilitySnapshot | null;
  captureError: string | null;
  view: AxView;
  onViewChange: (view: AxView) => void;
}

export function AccessibilityPanel({ snapshot, captureError, view, onViewChange }: AccessibilityPanelProps) {
  const [query, setQuery] = useState("");
  const explorerRef = useRef<HTMLDivElement>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const suffix = snapshot?.pruned ? " · pruned" : view === "ai" ? " · AI" : "";
  const meta = snapshot
    ? snapshot.capturedAt
      ? `${formatTime(snapshot.capturedAt)} · Tab ${snapshot.tabId}${suffix}`
      : `Tab ${snapshot.tabId}${suffix}`
    : captureError
      ? "Capture failed"
      : "No snapshot";

  const total = snapshot ? countTreeNodes(snapshot.tree) : 0;
  const visible = snapshot ? countVisibleTreeNodes(snapshot.tree, normalizedQuery) : 0;
  const countLabel = normalizedQuery ? `${visible} of ${total} nodes` : `${total} nodes`;

  const setAllOpen = (open: boolean) => {
    explorerRef.current?.querySelectorAll("details").forEach((details) => {
      (details as HTMLDetailsElement).open = open;
    });
  };

  const showTree = view === "tree";

  return (
    <section className="panel tree-panel">
      <div className="panel-header tree-header">
        <div>
          <h2>Accessibility</h2>
          <span id="treeMeta">{meta}</span>
        </div>
        <div className="tree-tools">
          <div className="segmented" aria-label="Accessibility view">
            <button type="button" className={view === "tree" ? "selected" : ""} onClick={() => onViewChange("tree")}>
              Tree
            </button>
            <button type="button" className={view === "ai" ? "selected" : ""} onClick={() => onViewChange("ai")}>
              AI
            </button>
            <button type="button" className={view === "raw" ? "selected" : ""} onClick={() => onViewChange("raw")}>
              Raw
            </button>
          </div>
          {showTree && (
            <>
              <button type="button" className="ghost" onClick={() => setAllOpen(true)}>
                Expand
              </button>
              <button type="button" className="ghost" onClick={() => setAllOpen(false)}>
                Collapse
              </button>
            </>
          )}
        </div>
      </div>

      {showTree && (
        <div className="tree-search-row">
          <input
            type="search"
            placeholder="Search role, name, text, tag, selector"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span>{snapshot ? countLabel : "0 nodes"}</span>
        </div>
      )}

      {snapshot ? (
        view === "raw" ? (
          <pre className="tree-output">{JSON.stringify(snapshot.tree, null, 2)}</pre>
        ) : view === "ai" ? (
          <AiTreeNavigator key={getSnapshotKey(snapshot)} snapshot={snapshot} />
        ) : (
          <TreeView ref={explorerRef} snapshot={snapshot} query={query} />
        )
      ) : (
        <div className="tree-explorer">
          <p className="empty">{captureError || "No snapshot captured"}</p>
        </div>
      )}
    </section>
  );
}
