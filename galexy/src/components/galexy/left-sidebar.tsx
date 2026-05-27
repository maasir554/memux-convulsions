"use client";

import { useState } from "react";
import {
  FilePlus,
  FolderPlus,
  Search,
  Sheet,
  SquareCode,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  FileExplorer,
  type CreateKind,
  type CreatingState,
} from "@/components/galexy/file-explorer";
import { GraphView } from "@/components/galexy/graph-view";
import type { LeftView } from "@/components/galexy/ribbon";
import type { GraphEdge, Note } from "@/lib/mock-notes";
import type { UploadCategory } from "@/components/galexy/use-vault";

type CreateNoteInput = {
  type: "markdown" | "code" | "csv";
  title: string;
  folder?: string;
  language?: string;
};

type LeftSidebarProps = {
  view: LeftView;
  notes: Note[];
  items: Note[];
  folderNames: string[];
  activeId: string;
  onOpen: (id: string) => void;
  query: string;
  onQueryChange: (value: string) => void;
  edges: GraphEdge[];
  backlinkCount: Record<string, number>;
  onCreateNote: (input: CreateNoteInput) => void | Promise<void>;
  onCreateFolder: (name: string) => void | Promise<void>;
  onUploadFiles: (
    category: UploadCategory,
    folder: string,
    files: File[],
  ) => void | Promise<void>;
  onDeleteItem: (id: string) => void;
  onDeleteFolder: (name: string) => void;
};

const VIEW_TITLES: Record<LeftView, string> = {
  files: "Galexy Vault",
  search: "Search",
  graph: "Graph view",
};

const ROOT_TOOLBAR_BUTTONS: {
  kind: CreateKind;
  label: string;
  Icon: typeof FilePlus;
}[] = [
  { kind: "markdown", label: "New note (root)", Icon: FilePlus },
  { kind: "code", label: "New code file (root)", Icon: SquareCode },
  { kind: "csv", label: "New sheet (root)", Icon: Sheet },
  { kind: "folder", label: "New folder (root)", Icon: FolderPlus },
];

/** Best-effort filename parsing: strip extension, infer code language. */
function parseName(
  raw: string,
  kind: CreateKind,
): { title: string; language?: string } {
  const trimmed = raw.trim();
  if (kind === "markdown") {
    return { title: trimmed.replace(/\.md$/i, "") };
  }
  if (kind === "csv") {
    return { title: trimmed.replace(/\.csv$/i, "") };
  }
  if (kind === "code") {
    const m = trimmed.match(/^(.+)\.(ts|tsx|js|jsx|py|rs|go|sh|json|css)$/i);
    if (m) return { title: m[1], language: m[2].toLowerCase() };
    return { title: trimmed };
  }
  return { title: trimmed };
}

export function LeftSidebar({
  view,
  notes,
  items,
  folderNames,
  activeId,
  onOpen,
  query,
  onQueryChange,
  edges,
  backlinkCount,
  onCreateNote,
  onCreateFolder,
  onUploadFiles,
  onDeleteItem,
  onDeleteFolder,
}: LeftSidebarProps) {
  const [creating, setCreating] = useState<CreatingState | null>(null);

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

  function startCreate(kind: CreateKind, folder: string) {
    setCreating({ kind, folder });
  }

  function handleCommit(name: string) {
    const trimmed = name.trim();
    if (!trimmed || !creating) {
      setCreating(null);
      return;
    }
    if (creating.kind === "folder") {
      void onCreateFolder(trimmed);
    } else {
      const { title, language } = parseName(trimmed, creating.kind);
      if (title) {
        void onCreateNote({
          type: creating.kind,
          title,
          folder: creating.folder,
          language,
        });
      }
    }
    setCreating(null);
  }

  function handleUpload(
    category: UploadCategory,
    folder: string,
    files: File[],
  ) {
    void onUploadFiles(category, folder, files);
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-9 shrink-0 items-center justify-between border-b pr-1 pl-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <span>{VIEW_TITLES[view]}</span>
        {view === "files" && (
          <div className="flex items-center gap-0.5">
            {ROOT_TOOLBAR_BUTTONS.map(({ kind, label, Icon }) => (
              <Tooltip key={kind}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "size-6 text-muted-foreground hover:text-foreground",
                      creating?.kind === kind &&
                        creating.folder === "" &&
                        "bg-sidebar-accent text-foreground",
                    )}
                    onClick={() =>
                      setCreating((current) =>
                        current?.kind === kind && current.folder === ""
                          ? null
                          : { kind, folder: "" },
                      )
                    }
                    aria-label={label}
                  >
                    <Icon className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </div>

      {view === "files" && (
        <ScrollArea className="flex-1">
          <FileExplorer
            notes={notes}
            folderNames={folderNames}
            activeId={activeId}
            onOpen={onOpen}
            creating={creating}
            onCommit={handleCommit}
            onCancel={() => setCreating(null)}
            onStartCreate={startCreate}
            onUpload={handleUpload}
            onDeleteItem={onDeleteItem}
            onDeleteFolder={onDeleteFolder}
          />
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
