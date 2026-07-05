"use client";

import * as React from "react";
import { Plus, Image as ImageIcon, Brain, Send, Square, X, Database } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/memux/chat/components/ui/popover";
import { Button } from "@/memux/chat/components/ui/button";
import { cn } from "@/memux/chat/lib/utils";

export type Attachment = {
  id: string;
  /** data: URL */
  url: string;
  mime: string;
  name?: string;
};

export function PromptInput({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  attachments,
  onAttach,
  onRemoveAttachment,
  think,
  onThinkChange,
  thinkSupported,
  kbMode,
  onKbToggle,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isStreaming: boolean;
  attachments: Attachment[];
  onAttach: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  think: boolean;
  onThinkChange: (v: boolean) => void;
  thinkSupported?: boolean;
  kbMode?: boolean;
  onKbToggle?: () => void;
  placeholder?: string;
  className?: string;
}) {
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }, [value]);

  const canSubmit = (value.trim().length > 0 || attachments.length > 0) && !isStreaming;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) onSubmit();
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];
    for (const item of e.clipboardData.items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      onAttach(files);
    }
  };

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card shadow-sm focus-within:ring-1 focus-within:ring-ring",
        className,
      )}
    >
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="relative group rounded-md border overflow-hidden"
            >
              <img src={a.url} alt={a.name ?? ""} className="h-16 w-16 object-cover" />
              <button
                type="button"
                onClick={() => onRemoveAttachment(a.id)}
                className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 opacity-0 group-hover:opacity-100 transition"
                aria-label="Remove attachment"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={placeholder ?? "Message…"}
        rows={1}
        className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm outline-none placeholder:text-muted-foreground"
      />

      <div className="flex items-center gap-1.5 px-2 pb-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="rounded-full size-8"
              aria-label="More"
            >
              <Plus />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-1">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            >
              <ImageIcon className="h-4 w-4" />
              Attach image
            </button>
            {onKbToggle && (
              <label
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              >
                <span className="flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Vault
                </span>
                <input
                  type="checkbox"
                  checked={!!kbMode}
                  onChange={onKbToggle}
                  className="h-4 w-4 accent-foreground"
                />
              </label>
            )}
            <label
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer",
                !thinkSupported && "opacity-60",
              )}
            >
              <span className="flex items-center gap-2">
                <Brain className="h-4 w-4" />
                Think mode
              </span>
              <input
                type="checkbox"
                checked={think}
                onChange={(e) => onThinkChange(e.target.checked)}
                className="h-4 w-4 accent-foreground"
              />
            </label>
            {!thinkSupported && (
              <div className="px-2 pb-1 text-[11px] text-muted-foreground">
                Model isn&apos;t tagged as reasoning, but the flag is sent anyway.
              </div>
            )}
          </PopoverContent>
        </Popover>

        {/* Vault chip — when on, a dismissable pill sits next to the + button. */}
        {kbMode && onKbToggle && (
          <div className="group/chip flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
            <Database className="size-3" />
            <span>Vault</span>
            <button
              type="button"
              onClick={onKbToggle}
              aria-label="Remove Vault context"
              className="ml-0.5 rounded-full p-0.5 text-primary/70 transition-colors hover:bg-primary/15 hover:text-primary"
            >
              <X className="size-3" />
            </button>
          </div>
        )}

        {think && (
          <div className="flex items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[11px] text-foreground/80">
            <Brain className="h-3 w-3" />
            think
          </div>
        )}

        <div className="flex-1" />

        {isStreaming ? (
          // Dark-on-foreground rounded button with a red glyph inside.
          // Reads as "halt" without the full-red urgency of a destructive
          // button — fits a streaming-cancel action better.
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop"
            className={cn(
              "flex size-8 items-center justify-center rounded-full border border-border bg-foreground/[0.06]",
              "text-destructive transition-colors",
              "hover:bg-foreground/10 hover:text-destructive",
            )}
          >
            <Square className="size-3 fill-current" />
          </button>
        ) : (
          <Button
            size="icon"
            className="rounded-full size-8"
            disabled={!canSubmit}
            onClick={onSubmit}
            aria-label="Send"
          >
            <Send />
          </Button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onAttach(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
    </div>
  );
}
