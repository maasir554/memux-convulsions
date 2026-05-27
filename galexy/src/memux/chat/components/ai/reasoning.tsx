"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Brain } from "lucide-react";
import { Streamdown } from "streamdown";
import { cn } from "@/memux/chat/lib/utils";

/**
 * Collapsible "thinking" window. Auto-opens while the model is actively
 * streaming a thought; auto-closes once thinking finishes. The user can
 * override either way and the choice sticks.
 *
 * Collapsed: just text + icons (no box). Open: bordered panel with a
 * fixed max height that scrolls internally.
 */
export function Reasoning({
  content,
  streaming,
  className,
}: {
  content: string;
  streaming?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(streaming ?? false);
  const [userOverrode, setUserOverrode] = useState(false);

  useEffect(() => {
    if (userOverrode) return;
    setOpen(Boolean(streaming));
  }, [streaming, userOverrode]);

  const elapsedSec = useElapsedSec(streaming, content);

  if (!content.trim() && !streaming) return null;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => {
          setUserOverrode(true);
          setOpen((v) => !v);
        }}
        className="flex items-center gap-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 transition-transform shrink-0",
            open && "rotate-90",
          )}
        />
        <Brain className="h-3.5 w-3.5 shrink-0" />
        <span className={cn("font-medium", streaming && "plasma-shimmer")}>
          {labelFor(streaming, elapsedSec)}
        </span>
      </button>
      {/*
        grid-template-rows 0fr → 1fr is the modern trick for animating
        a container between collapsed and auto height. The inner div needs
        overflow-hidden + min-h-0 so it clips smoothly during the transition.
      */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr] mt-1" : "grid-rows-[0fr]",
        )}
        aria-hidden={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <ReasoningStream content={content} streaming={streaming} />
        </div>
      </div>
    </div>
  );
}

function labelFor(streaming: boolean | undefined, sec: number): string {
  if (streaming) {
    return sec > 0 ? `Thinking… ${formatDuration(sec)}` : "Thinking…";
  }
  if (sec > 0) return `Thought for ${formatDuration(sec)}`;
  return "Thought";
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

/**
 * Track elapsed seconds across the lifetime of a thinking phase. Starts on the
 * first frame where the model is streaming, freezes once streaming ends.
 */
function useElapsedSec(
  streaming: boolean | undefined,
  content: string,
): number {
  const startRef = useRef<number | null>(null);
  const endRef = useRef<number | null>(null);
  const [, force] = useState(0);

  // Reset / start the clock when we first see thinking activity.
  useEffect(() => {
    if (streaming && startRef.current === null) {
      startRef.current = Date.now();
      endRef.current = null;
    }
    if (!streaming && startRef.current !== null && endRef.current === null) {
      endRef.current = Date.now();
      force((x) => x + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  // Also start the clock if content arrives before `streaming` becomes true
  // (covers the initial render where state has only just been initialised).
  useEffect(() => {
    if (content && startRef.current === null) {
      startRef.current = Date.now();
    }
  }, [content]);

  // Tick every second while streaming so the displayed value updates.
  useEffect(() => {
    if (!streaming) return;
    const i = window.setInterval(() => force((x) => x + 1), 1000);
    return () => window.clearInterval(i);
  }, [streaming]);

  if (startRef.current === null) return 0;
  const end = endRef.current ?? Date.now();
  return Math.max(0, Math.floor((end - startRef.current) / 1000));
}

function ReasoningStream({
  content,
  streaming,
  className,
}: {
  content: string;
  streaming?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
  };

  useEffect(() => {
    if (!streaming || !pinnedRef.current) return;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content, streaming]);

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className={cn(
        "max-h-64 overflow-y-auto rounded-md border border-foreground/10 bg-muted/40 px-3 py-2",
        "prose prose-invert max-w-none",
        // Smaller, tighter than the main body — this is a secondary surface.
        "text-[13.5px] leading-[1.45] text-foreground/75 font-[300]",
        "prose-p:my-1.5 prose-p:leading-[1.45] prose-p:font-[300]",
        "prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-li:leading-[1.45] prose-li:font-[300]",
        "prose-headings:font-semibold prose-headings:text-foreground/80 prose-headings:mt-3 prose-headings:mb-1.5",
        "prose-h1:text-base prose-h2:text-sm prose-h3:text-sm prose-h4:text-[13px]",
        "prose-strong:font-semibold prose-strong:text-foreground/85",
        "prose-em:text-foreground/80",
        "prose-pre:bg-background prose-pre:text-foreground prose-pre:rounded prose-pre:my-1.5 prose-pre:p-2 prose-pre:text-[12px] prose-pre:leading-5",
        "prose-code:bg-background prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-normal prose-code:before:hidden prose-code:after:hidden",
        "prose-blockquote:my-1.5 prose-hr:my-2",
        className,
      )}
    >
      <Streamdown>{content || (streaming ? "…" : "")}</Streamdown>
    </div>
  );
}

/**
 * Extract all `<think>…</think>` (or unclosed trailing) blocks from a streaming
 * assistant text. Returns the joined reasoning, the body with the blocks
 * removed, and a `thinking` flag set when an unclosed block is in progress.
 */
export function splitThinking(text: string): {
  reasoning: string;
  body: string;
  thinking: boolean;
} {
  const reasoningParts: string[] = [];
  let body = "";
  let thinking = false;
  let cursor = 0;

  while (cursor < text.length) {
    const open = text.indexOf("<think>", cursor);
    if (open === -1) {
      body += text.slice(cursor);
      break;
    }
    body += text.slice(cursor, open);
    const close = text.indexOf("</think>", open + 7);
    if (close === -1) {
      reasoningParts.push(text.slice(open + 7));
      thinking = true;
      break;
    }
    reasoningParts.push(text.slice(open + 7, close));
    cursor = close + 8;
  }

  return {
    reasoning: reasoningParts.join("\n\n").trim(),
    body: body.trimStart(),
    thinking,
  };
}
