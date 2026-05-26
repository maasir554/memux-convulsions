"use client";

import { useState } from "react";
import { FileText, Pencil, BookOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MarkdownView } from "@/components/galexy/markdown-view";
import { MarkdownEditor } from "@/components/galexy/markdown-editor";
import { TabStrip } from "@/components/galexy/tab-strip";
import { FolderView } from "@/components/galexy/viewers/folder-view";
import { PdfViewer } from "@/components/galexy/viewers/pdf-viewer";
import { ImageViewer } from "@/components/galexy/viewers/image-viewer";
import { CsvViewer } from "@/components/galexy/viewers/csv-viewer";
import { CodeView } from "@/components/galexy/viewers/code-view";
import { toggleTaskInContent, type Note } from "@/lib/mock-notes";

type EditorMode = "read" | "edit";

type EditorPaneProps = {
  tabs: Note[];
  activeId: string | null;
  activeNote: Note | null;
  folderChildren: Note[];
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onOpen: (id: string) => void;
  onChange: (id: string, content: string) => void;
  linkExists: (title: string) => boolean;
  onOpenWikiLink: (title: string) => void;
  onOpenTag: (tag: string) => void;
};

export function EditorPane({
  tabs,
  activeId,
  activeNote,
  folderChildren,
  onActivate,
  onClose,
  onOpen,
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

        {activeNote?.type === "markdown" && (
          <div className="flex shrink-0 items-center border-l px-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={() => setMode((m) => (m === "read" ? "edit" : "read"))}
                  aria-label={mode === "read" ? "Edit (source)" : "Read (preview)"}
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
        <Body
          item={activeNote}
          mode={mode}
          folderChildren={folderChildren}
          onOpen={onOpen}
          onChange={onChange}
          linkExists={linkExists}
          onOpenWikiLink={onOpenWikiLink}
          onOpenTag={onOpenTag}
        />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function Body({
  item,
  mode,
  folderChildren,
  onOpen,
  onChange,
  linkExists,
  onOpenWikiLink,
  onOpenTag,
}: {
  item: Note;
  mode: EditorMode;
  folderChildren: Note[];
  onOpen: (id: string) => void;
  onChange: (id: string, content: string) => void;
  linkExists: (title: string) => boolean;
  onOpenWikiLink: (title: string) => void;
  onOpenTag: (tag: string) => void;
}) {
  switch (item.type) {
    case "markdown":
      return mode === "read" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-8 py-8">
            <MarkdownView
              content={item.content}
              linkExists={linkExists}
              onOpenWikiLink={onOpenWikiLink}
              onOpenTag={onOpenTag}
              onToggleTask={(lineIndex) =>
                onChange(item.id, toggleTaskInContent(item.content, lineIndex))
              }
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <div className="mx-auto h-full w-full max-w-3xl px-8 py-4">
            <MarkdownEditor
              value={item.content}
              onChange={(content) => onChange(item.id, content)}
            />
          </div>
        </div>
      );

    case "code":
      return (
        <div className="min-h-0 flex-1">
          <div className="mx-auto h-full w-full max-w-3xl px-6 py-4">
            <CodeView
              value={item.content}
              language={item.language}
              onChange={(content) => onChange(item.id, content)}
            />
          </div>
        </div>
      );

    case "csv":
      return (
        <div className="min-h-0 flex-1">
          <CsvViewer
            key={item.id}
            item={item}
            onChange={(content) => onChange(item.id, content)}
          />
        </div>
      );

    case "pdf":
      return (
        <div className="min-h-0 flex-1">
          <PdfViewer item={item} />
        </div>
      );

    case "image":
      return (
        <div className="min-h-0 flex-1">
          <ImageViewer item={item} />
        </div>
      );

    case "folder":
      return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FolderView folder={item} entries={folderChildren} onOpen={onOpen} />
        </div>
      );

    default:
      return <EmptyState />;
  }
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
      <FileText className="size-10" />
      <p className="text-sm">Nothing open</p>
      <p className="max-w-xs text-center text-xs">
        Pick an item from the file explorer to view it here.
      </p>
    </div>
  );
}
