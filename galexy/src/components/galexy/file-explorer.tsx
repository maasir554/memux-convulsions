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
import { ItemIcon } from "@/components/galexy/item-icon";
import { buildVaultTree, type Note } from "@/lib/mock-notes";
import {
  FolderActionsPopover,
  FolderContextMenu,
  ItemActionsPopover,
  ItemContextMenu,
} from "@/components/galexy/folder-actions";
import type { UploadCategory } from "@/components/galexy/use-vault";

/** The four things a user can spawn inline. */
export type CreateKind = "markdown" | "code" | "csv" | "folder";

/** Inline-create state — kind plus the folder it should land in. */
export type CreatingState = { kind: CreateKind; folder: string };

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
}: FileExplorerProps) {
  const tree = buildVaultTree(notes, folderNames);
  const creatingAtRoot = creating?.folder === "";

  return (
    <div className="flex flex-col gap-0.5 p-2 text-sm">
      {creatingAtRoot && creating && (
        <NameInputRow
          kind={creating.kind}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      )}
      {tree.map(({ folder, notes: folderNotes }) =>
        folder === "" ? (
          folderNotes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              active={note.id === activeId}
              onOpen={onOpen}
              onDelete={onDeleteItem}
            />
          ))
        ) : (
          <FolderGroup
            key={folder}
            folder={folder}
            notes={folderNotes}
            activeId={activeId}
            onOpen={onOpen}
            creating={creating?.folder === folder ? creating : null}
            onCommit={onCommit}
            onCancel={onCancel}
            onStartCreate={onStartCreate}
            onUpload={onUpload}
            onDeleteItem={onDeleteItem}
            onDeleteFolder={onDeleteFolder}
          />
        ),
      )}
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
  folder,
  notes,
  activeId,
  onOpen,
  creating,
  onCommit,
  onCancel,
  onStartCreate,
  onUpload,
  onDeleteItem,
  onDeleteFolder,
}: {
  folder: string;
  notes: Note[];
  activeId: string;
  onOpen: (id: string) => void;
  creating: CreatingState | null;
  onCommit: (name: string) => void;
  onCancel: () => void;
  onStartCreate: (kind: CreateKind, folder: string) => void;
  onUpload: (category: UploadCategory, folder: string, files: File[]) => void;
  onDeleteItem: (id: string) => void;
  onDeleteFolder: (name: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <FolderContextMenu
        folder={folder}
        onStartCreate={onStartCreate}
        onUpload={onUpload}
        onDeleteFolder={onDeleteFolder}
      >
        {/* Plain div wrapper so the popover-trigger button (Plus) can live as
            a sibling without nesting buttons. */}
        <div className="group/folder flex items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
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
            <span className="truncate font-medium">{folder}</span>
            {notes.length === 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground/60">
                empty
              </span>
            )}
          </button>
          <div className="flex items-center gap-0.5 pr-1.5">
            <FolderActionsPopover
              folder={folder}
              onStartCreate={onStartCreate}
              onUpload={onUpload}
              onDeleteFolder={onDeleteFolder}
            />
          </div>
        </div>
      </FolderContextMenu>
      {open && (
        <div className="ml-3 border-l pl-1">
          {creating && (
            <NameInputRow
              kind={creating.kind}
              onCommit={onCommit}
              onCancel={onCancel}
            />
          )}
          {notes.length === 0 && !creating ? (
            <p className="px-2 py-1 text-[11px] text-muted-foreground/60">
              No items yet.
            </p>
          ) : (
            notes.map((note) => (
              <NoteItem
                key={note.id}
                note={note}
                active={note.id === activeId}
                onOpen={onOpen}
                onDelete={onDeleteItem}
              />
            ))
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
}: {
  note: Note;
  active: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <ItemContextMenu itemId={note.id} onDelete={onDelete}>
      <div
        className={cn(
          "group/item flex items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
          active && "bg-sidebar-accent text-foreground",
        )}
      >
        <button
          type="button"
          onClick={() => onOpen(note.id)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-l-md px-2 py-1 text-left"
        >
          <ItemIcon type={note.type} className="size-4 shrink-0" />
          <span className="truncate">{note.title}</span>
        </button>
        <div className="flex items-center gap-0.5 pr-1.5">
          <ItemActionsPopover
            itemId={note.id}
            itemTitle={note.title}
            onDelete={onDelete}
          />
        </div>
      </div>
    </ItemContextMenu>
  );
}
