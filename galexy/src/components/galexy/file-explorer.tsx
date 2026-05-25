"use client";

import { useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";

import { cn } from "@/lib/utils";
import { buildVaultTree, type Note } from "@/lib/mock-notes";

type FileExplorerProps = {
  notes: Note[];
  activeId: string;
  onOpen: (id: string) => void;
};

export function FileExplorer({ notes, activeId, onOpen }: FileExplorerProps) {
  const tree = buildVaultTree(notes);

  return (
    <div className="flex flex-col gap-0.5 p-2 text-sm">
      {tree.map(({ folder, notes: folderNotes }) =>
        folder === "" ? (
          folderNotes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              active={note.id === activeId}
              onOpen={onOpen}
            />
          ))
        ) : (
          <FolderGroup
            key={folder}
            folder={folder}
            notes={folderNotes}
            activeId={activeId}
            onOpen={onOpen}
          />
        ),
      )}
    </div>
  );
}

function FolderGroup({
  folder,
  notes,
  activeId,
  onOpen,
}: {
  folder: string;
  notes: Note[];
  activeId: string;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
      >
        <ChevronRight
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
        {open ? (
          <FolderOpen className="size-4" />
        ) : (
          <Folder className="size-4" />
        )}
        <span className="truncate font-medium">{folder}</span>
      </button>
      {open && (
        <div className="ml-3 border-l pl-1">
          {notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              active={note.id === activeId}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteItem({
  note,
  active,
  onOpen,
}: {
  note: Note;
  active: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(note.id)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
        active && "bg-sidebar-accent text-foreground",
      )}
    >
      <FileText className="size-4 shrink-0" />
      <span className="truncate">{note.title}</span>
    </button>
  );
}
