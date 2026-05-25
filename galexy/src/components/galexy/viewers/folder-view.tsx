"use client";

import { ItemIcon } from "@/components/galexy/item-icon";
import type { Note } from "@/lib/mock-notes";

type FolderViewProps = {
  folder: Note;
  entries: Note[];
  onOpen: (id: string) => void;
};

export function FolderView({ folder, entries, onOpen }: FolderViewProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <h1 className="text-3xl font-bold tracking-tight">{folder.title}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{folder.summary}</p>

      <div className="flex flex-col gap-0.5">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">This folder is empty.</p>
        ) : (
          entries.map((child) => (
            <button
              key={child.id}
              type="button"
              onClick={() => onOpen(child.id)}
              className="flex items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-accent"
            >
              <ItemIcon
                type={child.type}
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 truncate font-medium">
                {child.title}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground capitalize">
                {child.type}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
