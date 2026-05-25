"use client";

import { useState } from "react";
import { FileText, Pencil, BookOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MarkdownView } from "@/components/galexy/markdown-view";
import { MarkdownEditor } from "@/components/galexy/markdown-editor";
import { TabStrip } from "@/components/galexy/tab-strip";
import { toggleTaskInContent, type Note } from "@/lib/mock-notes";

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
        <TabStrip
          tabs={tabs}
          activeId={activeId}
          onActivate={onActivate}
          onClose={onClose}
        />

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
                onToggleTask={(lineIndex) =>
                  onChange(
                    activeNote.id,
                    toggleTaskInContent(activeNote.content, lineIndex),
                  )
                }
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
