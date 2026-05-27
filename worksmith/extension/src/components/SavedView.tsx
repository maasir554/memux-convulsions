import { ChevronRight, Layers, Trash2 } from "lucide-react";
import type { CaptureKind, SavedCapture } from "../lib/types";
import { formatTime } from "../lib/format";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface SavedViewProps {
  captures: SavedCapture[];
  onViewTree: (capture: SavedCapture) => void;
  onViewPruned: (capture: SavedCapture) => void;
  onViewAi: (capture: SavedCapture) => void;
  onOpenImage: (capture: SavedCapture) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

export function SavedView({
  captures,
  onViewTree,
  onViewPruned,
  onViewAi,
  onOpenImage,
  onDelete,
  onClearAll,
}: SavedViewProps) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card/60">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold leading-tight">Saved captures</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {captures.length
              ? `${captures.length} capture${captures.length === 1 ? "" : "s"} · user (snap / full) + stable auto-capture`
              : "User captures (snap / full) and stable auto-captures"}
          </p>
        </div>
        {captures.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={onClearAll}
          >
            <Trash2 className="size-3.5" />
            Clear all
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        {captures.length ? (
          captures.map((capture) => (
            <SavedItem
              key={capture.id}
              capture={capture}
              onViewTree={onViewTree}
              onViewPruned={onViewPruned}
              onViewAi={onViewAi}
              onOpenImage={onOpenImage}
              onDelete={onDelete}
            />
          ))
        ) : (
          <p className="empty">
            No saved captures yet. Stay on a page at the same scroll state for 30 seconds.
          </p>
        )}
      </div>
    </section>
  );
}

interface SavedItemProps {
  capture: SavedCapture;
  onViewTree: (capture: SavedCapture) => void;
  onViewPruned: (capture: SavedCapture) => void;
  onViewAi: (capture: SavedCapture) => void;
  onOpenImage: (capture: SavedCapture) => void;
  onDelete: (id: string) => void;
}

function SavedItem({ capture, onViewTree, onViewPruned, onViewAi, onOpenImage, onDelete }: SavedItemProps) {
  const hasTree = Boolean(capture.accessibilitySnapshot);
  const kind: CaptureKind = capture.kind || "stable";
  const shots =
    capture.screenshots && capture.screenshots.length > 0
      ? capture.screenshots
      : capture.screenshotDataUrl
        ? [capture.screenshotDataUrl]
        : [];
  const firstShot = shots[0];
  const isFull = kind === "full";

  return (
    <Collapsible className="overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-border/100 data-[state=open]:border-border data-[state=open]:bg-elevated">
      <div className="flex items-stretch">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-90" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[13px] font-medium">
                {capture.title || "Untitled capture"}
              </span>
              <KindChip kind={kind} shots={shots.length} />
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {formatTime(capture.capturedAt)} · {capture.url || ""}
            </span>
          </span>
        </CollapsibleTrigger>
        <button
          type="button"
          title="Delete capture"
          aria-label="Delete capture"
          onClick={() => onDelete(capture.id)}
          className="grid w-9 shrink-0 place-items-center border-l border-border/40 text-muted-foreground/50 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 border-t border-border/60 p-3">
          {capture.context && (
            <p className="rounded-md border-l-2 border-primary/50 bg-muted/30 px-2.5 py-1.5 text-[12px] italic text-foreground/90">
              “{capture.context}”
            </p>
          )}
          <div className="flex items-start gap-3">
            <button
              type="button"
              title="Click to enlarge"
              onClick={() => onOpenImage(capture)}
              className="group/thumb relative aspect-video w-[200px] max-w-[45%] shrink-0 cursor-zoom-in overflow-hidden rounded-md border border-border bg-black"
            >
              {firstShot && (
                <img
                  src={firstShot}
                  alt=""
                  className="size-full object-cover transition duration-200 group-hover/thumb:scale-[1.03]"
                />
              )}
              {isFull && shots.length > 1 && (
                <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  <Layers className="size-3" />
                  {shots.length}
                </span>
              )}
              <span className="absolute inset-0 bg-black/0 transition-colors group-hover/thumb:bg-black/10" />
            </button>
            <div className="flex min-w-0 flex-col items-start gap-2.5">
              <span className="text-[11px] text-muted-foreground">
                {capture.nodeCount || 0} nodes
                {isFull
                  ? ` · ${shots.length} viewport${shots.length === 1 ? "" : "s"}`
                  : capture.scrollState?.boxes?.length
                    ? ` · ${capture.scrollState.boxes.length} boxes`
                    : ""}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" className="h-7" disabled={!hasTree} onClick={() => onViewTree(capture)}>
                  View tree
                </Button>
                <Button size="sm" variant="secondary" className="h-7" disabled={!hasTree} onClick={() => onViewPruned(capture)}>
                  View pruned
                </Button>
                <Button
                  size="sm"
                  className="h-7"
                  title="Level-by-level AI navigation tree"
                  disabled={!hasTree}
                  onClick={() => onViewAi(capture)}
                >
                  View AI
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function KindChip({ kind, shots }: { kind: CaptureKind; shots: number }) {
  const styles =
    kind === "full"
      ? "border-primary/40 bg-primary/15 text-primary"
      : kind === "snap"
        ? "border-canary/40 bg-canary/15 text-canary"
        : "border-border bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded border px-1.5 py-px font-mono text-[9.5px] font-semibold uppercase tracking-wider",
        styles,
      )}
      title={
        kind === "full"
          ? `Full-page capture (${shots} viewport${shots === 1 ? "" : "s"})`
          : kind === "snap"
            ? "Single-viewport user capture"
            : "Stable auto-capture (30s)"
      }
    >
      {kind}
    </span>
  );
}
