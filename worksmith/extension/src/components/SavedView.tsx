import type { SavedCapture } from "../lib/types";
import { formatTime } from "../lib/format";

interface SavedViewProps {
  captures: SavedCapture[];
  onViewTree: (capture: SavedCapture) => void;
  onViewPruned: (capture: SavedCapture) => void;
  onViewAi: (capture: SavedCapture) => void;
  onOpenImage: (capture: SavedCapture) => void;
}

export function SavedView({
  captures,
  onViewTree,
  onViewPruned,
  onViewAi,
  onOpenImage,
}: SavedViewProps) {
  return (
    <section id="savedView" className="plane-view">
      <section className="panel saved-panel">
        <div className="panel-header">
          <div>
            <h2>Saved</h2>
            <span id="savedViewMeta">
              {captures.length ? `${captures.length} stable captures` : "Stable reading captures"}
            </span>
          </div>
        </div>
        <div className="saved-items">
          {captures.length ? (
            captures.map((capture) => (
              <SavedItem
                key={capture.id}
                capture={capture}
                onViewTree={onViewTree}
                onViewPruned={onViewPruned}
                onViewAi={onViewAi}
                onOpenImage={onOpenImage}
              />
            ))
          ) : (
            <p className="empty">
              No saved captures yet. Stay on a page at the same scroll state for 30 seconds.
            </p>
          )}
        </div>
      </section>
    </section>
  );
}

interface SavedItemProps {
  capture: SavedCapture;
  onViewTree: (capture: SavedCapture) => void;
  onViewPruned: (capture: SavedCapture) => void;
  onViewAi: (capture: SavedCapture) => void;
  onOpenImage: (capture: SavedCapture) => void;
}

function SavedItem({ capture, onViewTree, onViewPruned, onViewAi, onOpenImage }: SavedItemProps) {
  const hasTree = Boolean(capture.accessibilitySnapshot);

  return (
    <details className="saved-item">
      <summary className="saved-item-summary">
        <div className="saved-item-text">
          <span className="saved-item-title">{capture.title || "Untitled capture"}</span>
          <span className="saved-item-meta">
            {formatTime(capture.capturedAt)} · {capture.url || ""}
          </span>
        </div>
      </summary>
      <div className="saved-item-body">
        <button
          type="button"
          className="saved-item-thumb"
          title="Click to enlarge"
          onClick={() => onOpenImage(capture)}
        >
          <img src={capture.screenshotDataUrl} alt="" />
        </button>
        <div className="saved-item-controls">
          <span className="saved-item-substats">
            {capture.nodeCount || 0} nodes · {capture.scrollState?.boxes?.length || 0} boxes
          </span>
          <div className="saved-item-actions">
            <button
              type="button"
              className="saved-item-tree secondary"
              disabled={!hasTree}
              onClick={() => onViewTree(capture)}
            >
              View tree
            </button>
            <button
              type="button"
              className="saved-item-tree secondary"
              title="Compressed, agent-oriented tree (the original is preserved)"
              disabled={!hasTree}
              onClick={() => onViewPruned(capture)}
            >
              View pruned
            </button>
            <button
              type="button"
              className="saved-item-tree secondary"
              title="Level-by-level AI navigation tree"
              disabled={!hasTree}
              onClick={() => onViewAi(capture)}
            >
              View AI
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}
