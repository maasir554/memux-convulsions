"use client";

import { FileText, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Note } from "@/lib/mock-notes";

type EditorPaneProps = {
  tabs: Note[];
  activeId: string | null;
  activeNote: Note | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onChange: (id: string, content: string) => void;
};

export function EditorPane({
  tabs,
  activeId,
  activeNote,
  onActivate,
  onClose,
  onChange,
}: EditorPaneProps) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      {/* Tab bar */}
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-sidebar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "group flex shrink-0 items-center gap-2 border-r px-3 text-sm",
              tab.id === activeId
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent",
            )}
          >
            <button
              type="button"
              onClick={() => onActivate(tab.id)}
              className="flex items-center gap-2 py-2"
            >
              <FileText className="size-3.5" />
              <span className="max-w-40 truncate">{tab.title}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              onClick={() => onClose(tab.id)}
              className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Editor body */}
      {activeNote ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-8 py-6">
            <input
              value={activeNote.title}
              readOnly
              className="mb-4 bg-transparent text-3xl font-bold outline-none"
              aria-label="Note title"
            />
            <textarea
              value={activeNote.content}
              onChange={(e) => onChange(activeNote.id, e.target.value)}
              spellCheck={false}
              className="flex-1 resize-none bg-transparent font-mono text-sm leading-relaxed text-foreground/90 outline-none"
              placeholder="Start writing in Markdown..."
            />
          </div>
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
      <FileText className="size-10" />
      <p className="text-sm">No note open</p>
      <p className="max-w-xs text-center text-xs">
        Pick a note from the file explorer to start reading and editing.
      </p>
    </div>
  );
}
