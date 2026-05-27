"use client";

import { useMemo, useState } from "react";
import {
  CheckSquare,
  Plus,
  Search,
  Square,
  Trash2,
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
  folderKey,
  itemKey,
  type CreateKind,
  type CreatingState,
  type SelectionKey,
} from "@/components/galexy/file-explorer";
import { GraphView } from "@/components/galexy/graph-view";
import { CreateItemDialog } from "@/components/galexy/create-item-dialog";
import type { LeftView } from "@/components/galexy/ribbon";
import {
  buildNestedTree,
  type FolderNode,
  type GraphEdge,
  type Note,
} from "@/lib/mock-notes";
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
  onDeleteBulk: (itemIds: string[], folderPaths: string[]) => void;
};

const VIEW_TITLES: Record<LeftView, string> = {
  files: "Galexy Vault",
  search: "Search",
  graph: "Graph view",
};

/** Best-effort filename parsing for the inline (per-folder) create flow. */
function parseName(
  raw: string,
  kind: CreateKind,
): { title: string; language?: string } {
  const trimmed = raw.trim();
  if (kind === "markdown") return { title: trimmed.replace(/\.md$/i, "") };
  if (kind === "csv") return { title: trimmed.replace(/\.csv$/i, "") };
  if (kind === "code") {
    const m = trimmed.match(/^(.+)\.(ts|tsx|js|jsx|py|rs|go|sh|json|css)$/i);
    if (m) return { title: m[1], language: m[2].toLowerCase() };
    return { title: trimmed };
  }
  return { title: trimmed };
}

function splitSelection(selected: Set<SelectionKey>): {
  itemIds: string[];
  folderPaths: string[];
} {
  const itemIds: string[] = [];
  const folderPaths: string[] = [];
  for (const key of selected) {
    if (key.startsWith("item:")) itemIds.push(key.slice(5));
    else if (key.startsWith("folder:")) folderPaths.push(key.slice(7));
  }
  return { itemIds, folderPaths };
}

/** Depth-first lookup of a folder node by its full path. */
function findFolderNode(
  nodes: FolderNode[],
  path: string,
): FolderNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const found = findFolderNode(node.children, path);
    if (found) return found;
  }
  return null;
}

/** Every descendant key (notes + subfolders, recursively). */
function descendantKeys(node: FolderNode): SelectionKey[] {
  const out: SelectionKey[] = [];
  for (const child of node.children) {
    out.push(folderKey(child.path));
    out.push(...descendantKeys(child));
  }
  for (const note of node.notes) {
    out.push(itemKey(note.id));
  }
  return out;
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
  onDeleteBulk,
}: LeftSidebarProps) {
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState<Set<SelectionKey>>(
    () => new Set(),
  );

  function toggleMultiSelect() {
    setMultiSelect((v) => {
      // Clear selection whenever multi-select is turned off so re-enabling
      // starts fresh.
      if (v) setSelected(new Set());
      return !v;
    });
  }

  // Folder tree used by both the file explorer and the create-dialog's
  // "Location" picker.
  const folderTree = useMemo(
    () => buildNestedTree(notes, folderNames).topLevelFolders,
    [notes, folderNames],
  );

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
      const path = creating.folder
        ? `${creating.folder}/${trimmed}`
        : trimmed;
      void onCreateFolder(path);
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

  function toggleSelect(key: SelectionKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      const wasSelected = next.has(key);

      // Folders cascade — checking a folder checks every descendant; unchecking
      // it un-checks every descendant. Files just toggle themselves.
      if (key.startsWith("folder:")) {
        const path = key.slice(7);
        const node = findFolderNode(folderTree, path);
        const descendants = node ? descendantKeys(node) : [];
        if (wasSelected) {
          next.delete(key);
          for (const d of descendants) next.delete(d);
        } else {
          next.add(key);
          for (const d of descendants) next.add(d);
        }
      } else if (wasSelected) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleBulkDelete() {
    const { itemIds, folderPaths } = splitSelection(selected);
    if (itemIds.length === 0 && folderPaths.length === 0) return;
    onDeleteBulk(itemIds, folderPaths);
    setSelected(new Set());
  }

  const selectionCount = selected.size;

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-9 shrink-0 items-center justify-between border-b pr-1 pl-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <span>{VIEW_TITLES[view]}</span>
        {view === "files" && (
          <div className="flex items-center gap-0.5">
            {multiSelect && selectionCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleBulkDelete}
                    className="h-6 gap-1 px-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    <span className="text-[10px] tabular-nums">
                      {selectionCount}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Delete {selectionCount} selected
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleMultiSelect}
                  aria-pressed={multiSelect}
                  aria-label={
                    multiSelect ? "Exit selection mode" : "Select multiple"
                  }
                  className={cn(
                    "size-6 text-muted-foreground hover:text-foreground",
                    multiSelect && "bg-sidebar-accent text-foreground",
                  )}
                >
                  {multiSelect ? (
                    <CheckSquare className="size-3.5" />
                  ) : (
                    <Square className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {multiSelect ? "Exit selection mode" : "Select multiple"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDialogOpen(true)}
                  aria-label="Create new item"
                  className="size-6 text-muted-foreground hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Create new…</TooltipContent>
            </Tooltip>
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
            multiSelect={multiSelect}
            selected={selected}
            onToggleSelect={toggleSelect}
          />
        </ScrollArea>
      )}

      <CreateItemDialog
        // Re-key on open so the dialog remounts with fresh defaults each
        // time, rather than resetting state in an effect (which the strict
        // react-hooks lint forbids).
        key={dialogOpen ? "open" : "closed"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        folderTree={folderTree}
        onCreateNote={onCreateNote}
        onCreateFolder={onCreateFolder}
      />

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
