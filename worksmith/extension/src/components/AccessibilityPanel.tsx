import { useRef, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import type { AccessibilitySnapshot } from "../lib/types";
import { formatTime } from "../lib/format";
import { countTreeNodes, countVisibleTreeNodes } from "../lib/tree";
import { TreeView } from "./TreeView";
import { AiTreeNavigator } from "./AiTreeNavigator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
  const suffix = snapshot?.pruned ? "pruned" : view === "ai" ? "AI" : null;

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
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-border/70 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold leading-tight">Accessibility</h2>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
            {snapshot ? (
              <>
                {snapshot.capturedAt && <span>{formatTime(snapshot.capturedAt)}</span>}
                <span className="text-muted-foreground/50">·</span>
                <span>Tab {snapshot.tabId}</span>
                {suffix && (
                  <span className="rounded bg-primary/15 px-1.5 py-px text-[10px] font-medium text-primary">
                    {suffix}
                  </span>
                )}
              </>
            ) : captureError ? (
              <span className="text-destructive">Capture failed</span>
            ) : (
              <span>No snapshot</span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Tabs value={view} onValueChange={(value) => onViewChange(value as AxView)}>
            <TabsList className="h-7 p-0.5">
              <TabsTrigger value="tree" className="h-6 px-2.5 text-xs">Tree</TabsTrigger>
              <TabsTrigger value="ai" className="h-6 px-2.5 text-xs">AI</TabsTrigger>
              <TabsTrigger value="raw" className="h-6 px-2.5 text-xs">Raw</TabsTrigger>
            </TabsList>
          </Tabs>
          {showTree && (
            <div className="flex items-center">
              <Button variant="ghost" size="icon" className="size-7" title="Expand all" onClick={() => setAllOpen(true)}>
                <ChevronsUpDown className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7" title="Collapse all" onClick={() => setAllOpen(false)}>
                <ChevronsDownUp className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      </header>

      {showTree && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
          <Input
            type="search"
            placeholder="Search role, name, text, tag, selector"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-7 text-xs"
          />
          <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
            {snapshot ? countLabel : "0 nodes"}
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {snapshot ? (
          view === "raw" ? (
            <pre className="tree-output">{JSON.stringify(snapshot.tree, null, 2)}</pre>
          ) : view === "ai" ? (
            // Key on tab/pruned only — NOT capturedAt — so live auto-captures for
            // the same tab don't reset the user's drill path.
            <AiTreeNavigator
              key={`${snapshot.tabId}|${snapshot.pruned ? 1 : 0}`}
              snapshot={snapshot}
            />
          ) : (
            <TreeView ref={explorerRef} snapshot={snapshot} query={query} />
          )
        ) : (
          <p className="empty">{captureError || "No snapshot captured"}</p>
        )}
      </div>
    </section>
  );
}
