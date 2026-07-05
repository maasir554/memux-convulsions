"use client";

import { wordCount, type Note } from "@/lib/mock-notes";

type StatusBarProps = {
  activeNote: Note | null;
  backlinkCount: number;
};

export function StatusBar({ activeNote, backlinkCount }: StatusBarProps) {
  return (
    <div className="flex h-6 shrink-0 items-center justify-end gap-4 border-t bg-sidebar px-3 text-xs text-muted-foreground">
      {activeNote ? (
        <>
          <span>{backlinkCount} backlinks</span>
          <span>{activeNote.content.length} chars</span>
          <span>{wordCount(activeNote.content)} words</span>
        </>
      ) : (
        <span>galexy</span>
      )}
    </div>
  );
}
