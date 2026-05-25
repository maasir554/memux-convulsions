"use client";

import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileExplorer } from "@/components/galexy/file-explorer";
import { GraphView } from "@/components/galexy/graph-view";
import type { LeftView } from "@/components/galexy/ribbon";
import type { GraphEdge, Note } from "@/lib/mock-notes";

type LeftSidebarProps = {
  view: LeftView;
  notes: Note[];
  items: Note[];
  activeId: string;
  onOpen: (id: string) => void;
  query: string;
  onQueryChange: (value: string) => void;
  edges: GraphEdge[];
  backlinkCount: Record<string, number>;
};

const VIEW_TITLES: Record<LeftView, string> = {
  files: "Galexy Vault",
  search: "Search",
  graph: "Graph view",
};

export function LeftSidebar({
  view,
  notes,
  items,
  activeId,
  onOpen,
  query,
  onQueryChange,
  edges,
  backlinkCount,
}: LeftSidebarProps) {
  const results =
    query.trim().length > 0
      ? notes.filter((note) => {
          const q = query.toLowerCase();
          return (
            note.title.toLowerCase().includes(q) ||
            note.content.toLowerCase().includes(q)
          );
        })
      : [];

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-9 shrink-0 items-center border-b px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {VIEW_TITLES[view]}
      </div>

      {view === "files" && (
        <ScrollArea className="flex-1">
          <FileExplorer notes={notes} activeId={activeId} onOpen={onOpen} />
        </ScrollArea>
      )}

      {view === "search" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="p-2">
            <div className="relative">
              <Search className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="Search notes..."
                className="pl-8"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-0.5 p-2 text-sm">
              {query.trim().length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  Type to search across the vault.
                </p>
              ) : results.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No matches for “{query}”.
                </p>
              ) : (
                results.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => onOpen(note.id)}
                    className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent"
                  >
                    <span className="font-medium">{note.title}</span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {note.folder || "vault root"}
                    </span>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {view === "graph" && (
        <div className="min-h-0 flex-1">
          <GraphView
            items={items}
            edges={edges}
            activeId={activeId || null}
            backlinkCount={backlinkCount}
            onOpen={onOpen}
          />
        </div>
      )}
    </div>
  );
}
