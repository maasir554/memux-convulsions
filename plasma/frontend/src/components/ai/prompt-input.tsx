import * as React from "react";
import { Plus, Image as ImageIcon, Brain, Send, Square, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

      <div className="flex items-center gap-1 px-2 pb-2">
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
                Model isn't tagged as reasoning, but the flag is sent anyway.
              </div>
            )}
          </PopoverContent>
        </Popover>

        {think && (
          <div className="flex items-center gap-1 text-[11px] text-foreground/80 px-1.5 py-0.5 rounded-full bg-accent">
            <Brain className="h-3 w-3" />
            think
          </div>
        )}

        <div className="flex-1" />

        {isStreaming ? (
          <Button
            size="icon"
            variant="destructive"
            className="rounded-full size-8"
            onClick={onStop}
            aria-label="Stop"
          >
            <Square className="!h-3 !w-3 fill-current" />
          </Button>
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
