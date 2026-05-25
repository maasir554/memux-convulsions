"use client";

import { useState } from "react";
import { FileText, Pencil, BookOpen, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MarkdownView } from "@/components/galexy/markdown-view";
import { MarkdownEditor } from "@/components/galexy/markdown-editor";
import type { Note } from "@/lib/mock-notes";

type EditorMode = "read" | "edit";

type EditorPaneProps = {
  tabs: Note[];
  activeId: string | null;
  activeNote: Note | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onChange: (id: string, content: string) => void;
  linkExists: (title: string) => boolean;
  onOpenWikiLink: (title: string) => void;
  onOpenTag: (tag: string) => void;
};

export function EditorPane({
  tabs,
  activeId,
  activeNote,
  onActivate,
  onClose,
  onChange,
  linkExists,
  onOpenWikiLink,
  onOpenTag,
}: EditorPaneProps) {
  const [mode, setMode] = useState<EditorMode>("read");

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      {/* Tab bar */}
      <div className="flex h-9 shrink-0 items-stretch border-b bg-sidebar">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
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

        {activeNote && (
          <div className="flex shrink-0 items-center border-l px-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={() => setMode((m) => (m === "read" ? "edit" : "read"))}
                  aria-label={
                    mode === "read" ? "Edit (source)" : "Read (preview)"
                  }
                >
                  {mode === "read" ? (
                    <Pencil className="size-4" />
                  ) : (
                    <BookOpen className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {mode === "read" ? "Edit source" : "Reading view"}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Body */}
      {activeNote ? (
        mode === "read" ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-8 py-8">
              <MarkdownView
                content={activeNote.content}
                linkExists={linkExists}
                onOpenWikiLink={onOpenWikiLink}
                onOpenTag={onOpenTag}
              />
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            <div className="mx-auto h-full w-full max-w-3xl px-8 py-4">
              <MarkdownEditor
                value={activeNote.content}
                onChange={(content) => onChange(activeNote.id, content)}
              />
            </div>
          </div>
        )
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
