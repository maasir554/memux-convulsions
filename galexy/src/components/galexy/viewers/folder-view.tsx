"use client";

import { ItemIcon } from "@/components/galexy/item-icon";
import type { Note } from "@/lib/mock-notes";

type FolderViewProps = {
  folder: Note;
  entries: Note[];
  onOpen: (id: string) => void;
};

export function FolderView({ folder, entries, onOpen }: FolderViewProps) {
  // Display the folder's last segment as the title (so `_Indexes/Group X`
  // reads as "Group X" — the breadcrumb above already shows the chain).
  const displayTitle = folder.title.split("/").pop() || folder.title;

  // Count children from what we're actually about to render, not from the
  // pre-computed `folder.summary` (which only sees direct files and would
  // claim "0 items" for a folder that contains only sub-folders).
  const fileCount = entries.filter((e) => e.type !== "folder").length;
  const folderCount = entries.filter((e) => e.type === "folder").length;
  const summaryBits: string[] = [];
  if (folderCount > 0) {
    summaryBits.push(`${folderCount} folder${folderCount === 1 ? "" : "s"}`);
  }
  if (fileCount > 0) {
    summaryBits.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
  }
  const summary =
    summaryBits.length > 0 ? `Folder — ${summaryBits.join(" · ")}` : "Folder";

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <h1 className="text-3xl font-bold tracking-tight">{displayTitle}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{summary}</p>

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
                language={child.language}
                className="size-4 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate font-medium">
                {child.type === "folder"
                  ? child.title.split("/").pop() || child.title
                  : child.title}
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
