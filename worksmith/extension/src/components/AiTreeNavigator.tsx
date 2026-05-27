import { useMemo, useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import type { AccessibilitySnapshot } from "../lib/types";
import { AI_KIND_LABELS, AI_KIND_ORDER, buildAiTree, type AiNode } from "../lib/aitree";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface AiTreeNavigatorProps {
  snapshot: AccessibilitySnapshot;
}

export function AiTreeNavigator({ snapshot }: AiTreeNavigatorProps) {
  const tree = useMemo(() => buildAiTree(snapshot.tree), [snapshot]);
  const [path, setPath] = useState<number[]>([]);

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
    <div className="flex min-h-0 flex-1 flex-col">
      {/* breadcrumb */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-border/70 bg-card/80 px-3 py-2 backdrop-blur">
        {along.map((crumb, index) => (
          <span key={crumb.id} className="flex min-w-0 items-center">
            {index > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />}
            <button
              type="button"
              onClick={() => setPath(validPath.slice(0, index))}
              className={cn(
                "max-w-[180px] truncate rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-muted hover:text-foreground",
                index === along.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {crumbLabel(crumb, index === 0)}
            </button>
          </span>
        ))}
      </div>

      {/* current node */}
      <div className="border-b border-border/60 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-accent-foreground">{current.role}</span>
          {current.name && <span className="truncate text-sm font-medium">{current.name}</span>}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {summaryText(current)} <span className="text-muted-foreground/50">·</span>{" "}
          <span className="font-semibold text-canary">{tree.total} addressable</span> on page
        </div>
      </div>

      {/* level list (document order preserved) */}
      <div className="min-h-0 flex-1 overflow-auto py-1.5">
        {childEntries.length === 0 && <p className="empty">This node has no children</p>}
        {childEntries.map(({ child, index }) => {
          const isSection = child.kind === "section";
          const drill = isSection ? () => setPath([...validPath, index]) : undefined;
          return (
            <div
              key={child.id}
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
              className={cn(
                "group mx-1.5 flex items-center gap-2 rounded-md border-l-2 border-transparent px-2.5 py-1.5 outline-none",
                isSection
                  ? "cursor-pointer hover:border-l-primary/60 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                  : "",
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {child.index != null && (
                  <span className="inline-flex h-[18px] shrink-0 items-center rounded border border-canary/40 bg-canary/15 px-1.5 font-mono text-[10px] font-semibold text-canary">
                    @{child.index}
                  </span>
                )}
                <span
                  className={cn(
                    "shrink-0 font-mono text-[11px] font-semibold",
                    isSection ? "text-muted-foreground" : "text-accent-foreground",
                  )}
                >
                  {child.role}
                </span>
                {(child.name || isSection) && (
                  <span className="truncate text-[12.5px] text-foreground/90">
                    {child.name || `unnamed ${child.role}`}
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {isSection && (
                  <span className="rounded-full border border-border bg-background/40 px-2 py-px text-[10px] text-muted-foreground">
                    {describeSection(child)}
                  </span>
                )}
                <ItemInfo node={child} />
                <span className="rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground/90">
                  {child.kind}
                </span>
                {isSection && (
                  <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                )}
              </div>
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
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Element details"
          onClick={(event) => event.stopPropagation()}
          className="grid size-5 place-items-center rounded text-muted-foreground/60 opacity-60 transition hover:bg-background hover:text-foreground group-hover:opacity-100"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[340px] font-mono text-[11px]">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <span className="text-muted-foreground">selector</span>
          <span className="break-all">{node.selector || "—"}</span>
          <span className="text-muted-foreground">rect</span>
          <span>{rect ? `x:${rect.x} y:${rect.y} w:${rect.width} h:${rect.height}` : "—"}</span>
          {node.index != null && (
            <>
              <span className="text-muted-foreground">index</span>
              <span>@{node.index}</span>
            </>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
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
