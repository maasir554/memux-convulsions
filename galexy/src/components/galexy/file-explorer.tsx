"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ChevronRight,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Sheet,
  SquareCode,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { ItemIcon } from "@/components/galexy/item-icon";
import { buildNestedTree, type FolderNode, type Note } from "@/lib/mock-notes";
import {
  FolderActionsPopover,
  FolderContextMenu,
  ItemActionsPopover,
  ItemContextMenu,
} from "@/components/galexy/folder-actions";
import type { UploadCategory } from "@/components/galexy/use-vault";

/**
 * Drag-and-drop wire format. Custom MIME so we don't accidentally accept
 * payloads from the OS file picker (those use "Files") or from other apps.
 */
const DRAG_MIME = "application/x-galexy-move";
type DragPayload =
  | { kind: "item"; id: string }
  | { kind: "folder"; path: string };

/** The four things a user can spawn inline. */
export type CreateKind = "markdown" | "code" | "csv" | "folder";

/** Inline-create state — kind plus the folder it should land in. */
export type CreatingState = { kind: CreateKind; folder: string };

/** Selection key encoding used by the multi-select bulk delete flow. */
export type SelectionKey = `item:${string}` | `folder:${string}`;
export const itemKey = (id: string): SelectionKey => `item:${id}`;
export const folderKey = (path: string): SelectionKey => `folder:${path}`;

// CSS color used to tint folder icons (matches the graph tier color so the
// file tree and graph view share one visual identity for folders).
const FOLDER_COLOR = "var(--graph-folder)";

const PLACEHOLDER: Record<CreateKind, string> = {
  markdown: "Note name",
  code: "filename.ts",
  csv: "Sheet name",
  folder: "Folder name",
};

function PendingIcon({ kind }: { kind: CreateKind }) {
  const cls = "size-4 shrink-0 text-muted-foreground";
  switch (kind) {
    case "markdown":
      return <FilePlus className={cls} />;
    case "code":
      return <SquareCode className={cls} />;
    case "csv":
      return <Sheet className={cls} />;
    case "folder":
      return <FolderPlus className={cls} style={{ color: FOLDER_COLOR }} />;
  }
}

type FileExplorerProps = {
  notes: Note[];
  folderNames: string[];
  activeId: string;
  onOpen: (id: string) => void;
  creating: CreatingState | null;
  onCommit: (name: string) => void;
  onCancel: () => void;
  onStartCreate: (kind: CreateKind, folder: string) => void;
  onUpload: (category: UploadCategory, folder: string, files: File[]) => void;
  onDeleteItem: (id: string) => void;
  onDeleteFolder: (name: string) => void;
  onRenameItem: (id: string) => void;
  onRenameFolder: (name: string) => void;
  /** Move an item into a different folder path. "" = vault root. */
  onMoveItem: (id: string, folder: string) => void;
  /** Move a folder under a different parent. "" = vault root. */
  onMoveFolder: (oldPath: string, newParent: string) => void;
  /** Multi-select mode — when true, rows render a checkbox. */
  multiSelect: boolean;
  selected: Set<SelectionKey>;
  onToggleSelect: (key: SelectionKey) => void;
};

export function FileExplorer({
  notes,
  folderNames,
  activeId,
  onOpen,
  creating,
  onCommit,
  onCancel,
  onStartCreate,
  onUpload,
  onDeleteItem,
  onDeleteFolder,
  onRenameItem,
  onRenameFolder,
  onMoveItem,
  onMoveFolder,
  multiSelect,
  selected,
  onToggleSelect,
}: FileExplorerProps) {
  const { rootNotes, topLevelFolders } = buildNestedTree(notes, folderNames);
  const creatingAtRoot = creating?.folder === "";

  /**
   * Common drop handler. `targetFolder` is "" for vault-root drops or the
   * folder's full path for a folder-row drop. Rejects no-op moves and
   * cycle-causing folder moves silently.
   */
  function dropPayloadOnFolder(
    e: React.DragEvent<HTMLElement>,
    targetFolder: string,
  ): boolean {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return false;
    e.preventDefault();
    let payload: DragPayload;
    try {
      payload = JSON.parse(raw) as DragPayload;
    } catch {
      return false;
    }
    if (payload.kind === "item") {
      const note = notes.find((n) => n.id === payload.id);
      if (!note || note.folder === targetFolder) return false;
      onMoveItem(payload.id, targetFolder);
      return true;
    }
    const oldPath = payload.path;
    if (!oldPath) return false;
    // Cycle / no-op guards.
    if (targetFolder === oldPath) return false;
    if (targetFolder.startsWith(`${oldPath}/`)) return false;
    const lastSlash = oldPath.lastIndexOf("/");
    const currentParent = lastSlash >= 0 ? oldPath.slice(0, lastSlash) : "";
    if (currentParent === targetFolder) return false;
    onMoveFolder(oldPath, targetFolder);
    return true;
  }

  return (
    <div
      className="flex flex-col gap-0.5 p-2 text-sm"
      // Allow drop on empty tree space → vault root. The handler does its
      // own MIME validation, and inner rows preventDefault before reaching
      // here, so this only fires for drops on the gaps.
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault();
        }
      }}
      onDrop={(e) => dropPayloadOnFolder(e, "")}
    >
      {creatingAtRoot && creating && (
        <NameInputRow
          kind={creating.kind}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      )}
      {rootNotes.map((note) => (
        <NoteItem
          key={note.id}
          note={note}
          active={note.id === activeId}
          onOpen={onOpen}
          onDelete={onDeleteItem}
          onRename={onRenameItem}
          dropPayloadOnFolder={dropPayloadOnFolder}
          multiSelect={multiSelect}
          selected={selected}
          onToggleSelect={onToggleSelect}
        />
      ))}
      {topLevelFolders.map((node) => (
        <FolderGroup
          key={node.path}
          node={node}
          activeId={activeId}
          onOpen={onOpen}
          creating={creating}
          onCommit={onCommit}
          onCancel={onCancel}
          onStartCreate={onStartCreate}
          onUpload={onUpload}
          onDeleteItem={onDeleteItem}
          onDeleteFolder={onDeleteFolder}
          onRenameItem={onRenameItem}
          onRenameFolder={onRenameFolder}
          dropPayloadOnFolder={dropPayloadOnFolder}
          multiSelect={multiSelect}
          selected={selected}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  );
}

function NameInputRow({
  kind,
  onCommit,
  onCancel,
}: {
  kind: CreateKind;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  // Re-focus whenever the kind switches so clicking a different toolbar button
  // moves focus into the fresh input.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [kind]);

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="mb-1 flex items-center gap-1.5 rounded-md border border-dashed border-sidebar-accent bg-sidebar-accent/30 px-2 py-1">
      <PendingIcon kind={kind} />
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => {
          // Commit on blur if the user typed something, otherwise cancel.
          if (value.trim()) onCommit(value);
          else onCancel();
        }}
        placeholder={PLACEHOLDER[kind]}
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
      />
    </div>
  );
}

function FolderGroup({
  node,
  activeId,
  onOpen,
  creating,
  onCommit,
  onCancel,
  onStartCreate,
  onUpload,
  onDeleteItem,
  onDeleteFolder,
  onRenameItem,
  onRenameFolder,
  dropPayloadOnFolder,
  multiSelect,
  selected,
  onToggleSelect,
}: {
  node: FolderNode;
  activeId: string;
  onOpen: (id: string) => void;
  creating: CreatingState | null;
  onCommit: (name: string) => void;
  onCancel: () => void;
  onStartCreate: (kind: CreateKind, folder: string) => void;
  onUpload: (category: UploadCategory, folder: string, files: File[]) => void;
  onDeleteItem: (id: string) => void;
  onDeleteFolder: (name: string) => void;
  onRenameItem: (id: string) => void;
  onRenameFolder: (name: string) => void;
  /** Reused drop logic threaded down from FileExplorer. */
  dropPayloadOnFolder: (
    e: React.DragEvent<HTMLElement>,
    targetFolder: string,
  ) => boolean;
  multiSelect: boolean;
  selected: Set<SelectionKey>;
  onToggleSelect: (key: SelectionKey) => void;
}) {
  // Folders start collapsed; the user opens what they want to see.
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const creatingHere = creating?.folder === node.path ? creating : null;
  const isEmpty = node.notes.length === 0 && node.children.length === 0;

  return (
    <div>
      <FolderContextMenu
        folder={node.path}
        onStartCreate={onStartCreate}
        onUpload={onUpload}
        onDeleteFolder={onDeleteFolder}
        onRenameFolder={onRenameFolder}
      >
        <div
          draggable={!multiSelect}
          onDragStart={(e) => {
            const payload: DragPayload = { kind: "folder", path: node.path };
            e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
            e.dataTransfer.effectAllowed = "move";
            setDragging(true);
            // Prevent the parent row's drag from also firing.
            e.stopPropagation();
          }}
          onDragEnd={() => setDragging(false)}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            // Ignore dragleave that's actually entering a child element.
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDragOver(false);
          }}
          onDrop={(e) => {
            setDragOver(false);
            e.stopPropagation();
            dropPayloadOnFolder(e, node.path);
          }}
          className={cn(
            "group/folder flex items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            multiSelect &&
              selected.has(folderKey(node.path)) &&
              "bg-sidebar-accent text-foreground",
            dragging && "opacity-40",
            dragOver && "ring-2 ring-primary/60",
          )}
        >
          {multiSelect && (
            <div className="pl-2">
              <Checkbox
                checked={selected.has(folderKey(node.path))}
                onCheckedChange={() => onToggleSelect(folderKey(node.path))}
                aria-label={`Select folder ${node.label}`}
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-1 rounded-l-md px-2 py-1 text-left"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", open && "rotate-90")}
            />
            {open ? (
              <FolderOpen className="size-4" style={{ color: FOLDER_COLOR }} />
            ) : (
              <Folder className="size-4" style={{ color: FOLDER_COLOR }} />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{node.label}</span>
            {isEmpty && (
              <span className="ml-1 text-[10px] text-muted-foreground/60">
                empty
              </span>
            )}
          </button>
          <div className="flex items-center gap-0.5 pr-1.5">
            <FolderActionsPopover
              folder={node.path}
              onStartCreate={onStartCreate}
              onUpload={onUpload}
              onDeleteFolder={onDeleteFolder}
              onRenameFolder={onRenameFolder}
            />
          </div>
        </div>
      </FolderContextMenu>
      {open && (
        <div className="ml-3 border-l pl-1">
          {creatingHere && (
            <NameInputRow
              kind={creatingHere.kind}
              onCommit={onCommit}
              onCancel={onCancel}
            />
          )}
          {node.children.map((child) => (
            <FolderGroup
              key={child.path}
              node={child}
              activeId={activeId}
              onOpen={onOpen}
              creating={creating}
              onCommit={onCommit}
              onCancel={onCancel}
              onStartCreate={onStartCreate}
              onUpload={onUpload}
              onDeleteItem={onDeleteItem}
              onDeleteFolder={onDeleteFolder}
              onRenameItem={onRenameItem}
              onRenameFolder={onRenameFolder}
              dropPayloadOnFolder={dropPayloadOnFolder}
              multiSelect={multiSelect}
              selected={selected}
              onToggleSelect={onToggleSelect}
            />
          ))}
          {node.notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              active={note.id === activeId}
              onOpen={onOpen}
              onDelete={onDeleteItem}
              onRename={onRenameItem}
              dropPayloadOnFolder={dropPayloadOnFolder}
              multiSelect={multiSelect}
              selected={selected}
              onToggleSelect={onToggleSelect}
            />
          ))}
          {isEmpty && !creatingHere && (
            <p className="px-2 py-1 text-[11px] text-muted-foreground/60">
              No items yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function NoteItem({
  note,
  active,
  onOpen,
  onDelete,
  onRename,
  dropPayloadOnFolder,
  multiSelect,
  selected,
  onToggleSelect,
}: {
  note: Note;
  active: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string) => void;
  /** Reused drop logic — passed in so the item row can resolve "drop on
   *  this file" to "drop into this file's parent folder". */
  dropPayloadOnFolder: (
    e: React.DragEvent<HTMLElement>,
    targetFolder: string,
  ) => boolean;
  multiSelect: boolean;
  selected: Set<SelectionKey>;
  onToggleSelect: (key: SelectionKey) => void;
}) {
  const sk = itemKey(note.id);
  const isSelected = multiSelect && selected.has(sk);
  const [dragging, setDragging] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  return (
    <ItemContextMenu itemId={note.id} onRename={onRename} onDelete={onDelete}>
      <div
        draggable={!multiSelect}
        onDragStart={(e) => {
          const payload: DragPayload = { kind: "item", id: note.id };
          e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
          e.dataTransfer.effectAllowed = "move";
          setDragging(true);
        }}
        onDragEnd={() => setDragging(false)}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOver(false);
        }}
        onDrop={(e) => {
          setDragOver(false);
          e.stopPropagation();
          // Resolve "drop on file" → "drop in this file's parent folder".
          dropPayloadOnFolder(e, note.folder);
        }}
        className={cn(
          "group/item flex items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
          active && "bg-sidebar-accent text-foreground",
          isSelected && "bg-primary/10 text-foreground",
          dragging && "opacity-40",
          dragOver && "ring-2 ring-primary/40",
        )}
      >
        {multiSelect && (
          <div className="pl-2">
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect(sk)}
              aria-label={`Select ${note.title}`}
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => onOpen(note.id)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-l-md px-2 py-1 text-left"
        >
          <ItemIcon
            type={note.type}
            language={note.language}
            className="size-4 shrink-0"
          />
          <span className="min-w-0 flex-1 truncate">{note.title}</span>
        </button>
        <div className="flex items-center gap-0.5 pr-1.5">
          <ItemActionsPopover
            itemId={note.id}
            itemTitle={note.title}
            onRename={onRename}
            onDelete={onDelete}
          />
        </div>
      </div>
    </ItemContextMenu>
  );
}
