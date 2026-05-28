"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileBox,
  FileImage,
  FileSpreadsheet,
  FileText,
  Files as FilesIcon,
  Globe,
  Hash,
  Loader2,
  Pen,
  Sparkles,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useBlobUrl } from "@/components/galexy/use-blob-url";
import { useLiveProgress, type CurrentAction } from "@/lib/indexer/live-progress";
import type { IndexerFileRef } from "@/lib/db/schema";

/* ============================================================================
 * Shared header-outside-box collapsible. Title row sits in flow (not in a
 * card) with icon + label + count on the left, optional right label + chevron
 * on the right. Below it sits a bordered box containing `children`. Open/
 * close is height-animated via the CSS grid `0fr ↔ 1fr` trick — the inner
 * `<div className="overflow-hidden">` is the measured row.
 * ========================================================================== */

function CollapsibleSection({
  icon,
  title,
  count,
  rightLabel,
  defaultOpen = true,
  children,
}: {
  icon: ReactNode;
  title: string;
  count?: number;
  rightLabel?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group/section flex w-full items-center justify-between gap-3 px-1 py-1.5 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground group-hover/section:text-foreground">
            {icon}
          </span>
          <span className="text-sm font-medium">{title}</span>
          {count !== undefined && (
            <span className="text-xs tabular-nums text-muted-foreground/80">
              {count}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {rightLabel && (
            <span className="text-[11px] font-mono text-muted-foreground/70">
              {rightLabel}
            </span>
          )}
          <ChevronRight
            className={cn(
              "size-3.5 text-muted-foreground transition-transform group-hover/section:text-foreground",
              open && "rotate-90",
            )}
          />
        </div>
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="mt-2 rounded-lg border bg-card/40">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * Source card — replaces the raw prompt dump for worksmith-style captures.
 * Falls back to a plain "Your context" block for file-upload groups whose
 * prompt is just user-typed text.
 * ========================================================================== */

type ParsedPrompt =
  | { isCapture: false; userContext: string }
  | {
      isCapture: true;
      url?: string;
      title?: string;
      capturedAt?: string;
      userContext: string;
      hasTree: boolean;
    };

const URL_RE = /^Captured from (.+)$/m;
const TITLE_RE = /^Title: (.+)$/m;
const CAPTURED_RE = /^Captured at: (.+)$/m;
// `User context:` now ends the prompt (the legacy JSON-tree block that used
// to follow is gone). Trailing-anchor `$` is enough.
const USER_CTX_RE = /User context:\n([\s\S]*?)$/;
// Case-insensitive: the new compact form starts with "A pruned…" (lowercase
// p), while legacy captures used "Pruned accessibility tree".
const HAS_TREE_RE = /pruned accessibility tree/i;

export function parseCapturePrompt(prompt: string): ParsedPrompt {
  const url = URL_RE.exec(prompt)?.[1]?.trim();
  const title = TITLE_RE.exec(prompt)?.[1]?.trim();
  const capturedAt = CAPTURED_RE.exec(prompt)?.[1]?.trim();
  const hasTree = HAS_TREE_RE.test(prompt);
  if (!url && !title && !capturedAt && !hasTree) {
    return { isCapture: false, userContext: prompt.trim() };
  }
  return {
    isCapture: true,
    url,
    title,
    capturedAt,
    userContext: USER_CTX_RE.exec(prompt)?.[1]?.trim() ?? "",
    hasTree,
  };
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return d.toLocaleDateString();
}

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SourceCard({ prompt }: { prompt: string }) {
  const parsed = useMemo(() => parseCapturePrompt(prompt), [prompt]);

  if (!parsed.isCapture) {
    if (!parsed.userContext) return null;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Pen className="size-3" />
          Your context
        </div>
        <div className="whitespace-pre-wrap rounded-lg border bg-card/40 px-3 py-2 text-sm">
          {parsed.userContext}
        </div>
      </div>
    );
  }

  const host = hostOf(parsed.url);

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3 rounded-lg border bg-card/40 px-3 py-2.5">
        <SiteFavicon host={host} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {parsed.title || host || "Web capture"}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {parsed.url && (
              <a
                href={parsed.url}
                target="_blank"
                rel="noreferrer"
                className="truncate hover:text-foreground"
              >
                {hostOf(parsed.url)}
              </a>
            )}
            {parsed.capturedAt && (
              <>
                <span>·</span>
                <span>{formatRelative(parsed.capturedAt)}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {parsed.hasTree && (
            <span
              className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-primary"
              title="The pruned accessibility tree is included as Visioner context."
            >
              +a11y tree
            </span>
          )}
          {parsed.userContext && (
            <span
              className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
              title={parsed.userContext}
            >
              +context
            </span>
          )}
        </div>
      </div>
      {parsed.userContext && (
        <div className="whitespace-pre-wrap rounded-lg border bg-card/30 px-3 py-2 text-sm">
          {parsed.userContext}
        </div>
      )}
    </div>
  );
}

/**
 * Renders the captured site's favicon as a small avatar. Pulls from Google's
 * favicon service (returns a 64px PNG, well-cached, no CORS issues). Falls
 * back to a Globe icon if the request fails or no host is known.
 */
function SiteFavicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  if (!host || failed) {
    return (
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Globe className="size-3.5" />
      </div>
    );
  }
  return (
    <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-card/60">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
        alt=""
        width={20}
        height={20}
        onError={() => setFailed(true)}
        className="size-5 object-contain"
      />
    </div>
  );
}

/* ============================================================================
 * Files section — collapsible header, scrollable body, click → modal preview
 * with prev/next via buttons + ← / → keys + Esc to close.
 * ========================================================================== */

export function FilesSection({ files }: { files: IndexerFileRef[] }) {
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);

  return (
    <>
      <CollapsibleSection
        icon={<FilesIcon className="size-4" />}
        title="Files"
        count={files.length}
      >
        <div className="max-h-60 overflow-y-auto px-2 py-1.5">
          {files.map((file, i) => {
            const Icon = iconForMime(file.mimeType, file.name);
            const canPreview = isPreviewable(file);
            return (
              <button
                key={file.id}
                type="button"
                disabled={!canPreview}
                onClick={() => canPreview && setPreviewIdx(i)}
                className={cn(
                  "group/file flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  canPreview
                    ? "hover:bg-sidebar-accent hover:text-foreground"
                    : "cursor-default",
                )}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {formatBytes(file.size)}
                </span>
                {canPreview && (
                  <Eye className="size-3.5 opacity-0 transition-opacity group-hover/file:opacity-60" />
                )}
              </button>
            );
          })}
        </div>
      </CollapsibleSection>

      {previewIdx !== null && (
        <FilePreviewModal
          files={files}
          initialIndex={previewIdx}
          onClose={() => setPreviewIdx(null)}
        />
      )}
    </>
  );
}

function isPreviewable(file: IndexerFileRef): boolean {
  return !!file.blobKey && (file.mimeType.startsWith("image/") || file.mimeType === "application/pdf");
}

export function FilePreviewModal({
  files,
  initialIndex,
  onClose,
}: {
  files: IndexerFileRef[];
  /** Index in `files` to open at. Will snap to the nearest previewable. */
  initialIndex: number;
  onClose: () => void;
}) {
  const previewable = useMemo(
    () => files.map((f, i) => (isPreviewable(f) ? i : -1)).filter((i) => i >= 0),
    [files],
  );
  // Snap initialIndex to a previewable one (in case the caller hands us a
  // non-image file index, e.g. a text file from the Files list).
  const initialInList = useMemo(() => {
    const exact = previewable.indexOf(initialIndex);
    if (exact >= 0) return exact;
    // Fall back to the first previewable.
    return previewable.length > 0 ? 0 : -1;
  }, [previewable, initialIndex]);
  const [posInList, setPosInList] = useState(initialInList);
  const activeIndex = posInList >= 0 ? previewable[posInList] : -1;
  const file = activeIndex >= 0 ? files[activeIndex] : null;
  const url = useBlobUrl(file?.blobKey ?? undefined);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft")
        setPosInList((p) => (p > 0 ? p - 1 : p));
      else if (e.key === "ArrowRight")
        setPosInList((p) => (p < previewable.length - 1 ? p + 1 : p));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, previewable.length]);

  if (!file) {
    return null;
  }
  const hasPrev = posInList > 0;
  const hasNext = posInList < previewable.length - 1;
  const onPrev = () => hasPrev && setPosInList((p) => p - 1);
  const onNext = () => hasNext && setPosInList((p) => p + 1);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 border-b border-white/10 bg-background/40 px-4 py-3 backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <FileImage className="size-4 text-muted-foreground" />
          <span className="truncate font-medium">{file.name}</span>
          <span className="text-[11px] text-muted-foreground">
            {posInList + 1} / {previewable.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          aria-label="Close preview"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Prev */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPrev();
        }}
        disabled={!hasPrev}
        className={cn(
          "absolute left-4 top-1/2 -translate-y-1/2 rounded-full border bg-background/70 p-2 backdrop-blur transition-opacity",
          hasPrev ? "opacity-100 hover:bg-sidebar-accent" : "opacity-30",
        )}
        aria-label="Previous"
      >
        <ChevronLeft className="size-5" />
      </button>

      {/* Image */}
      <div
        className="max-h-[82vh] max-w-[82vw] animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={file.name}
            className="max-h-[82vh] max-w-[82vw] rounded-lg border bg-card object-contain shadow-2xl"
          />
        ) : (
          <div className="flex h-64 w-96 items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
            Loading…
          </div>
        )}
      </div>

      {/* Next */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onNext();
        }}
        disabled={!hasNext}
        className={cn(
          "absolute right-4 top-1/2 -translate-y-1/2 rounded-full border bg-background/70 p-2 backdrop-blur transition-opacity",
          hasNext ? "opacity-100 hover:bg-sidebar-accent" : "opacity-30",
        )}
        aria-label="Next"
      >
        <ChevronRight className="size-5" />
      </button>

      {/* Footer hint */}
      <div className="absolute inset-x-0 bottom-3 text-center text-[10px] tracking-wide text-muted-foreground">
        ←  →  arrow keys · Esc to close
      </div>
    </div>
  );
}

function iconForMime(mime: string, name: string) {
  const lower = name.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) return FileBox;
  if (mime.startsWith("image/")) return FileImage;
  if (mime === "text/csv" || lower.endsWith(".csv")) return FileSpreadsheet;
  return FileText;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* ============================================================================
 * Scratchpad stream — parses the markdown the orchestrator appends into
 * structured events and renders them as a timeline. New events fade in.
 * ========================================================================== */

type ScratchEvent =
  | { kind: "started"; fileCount: number; autoName: boolean }
  | { kind: "file"; name: string }
  | { kind: "page"; ordinal: number; transition: "new" | "continue" | "end"; topic: string; summary: string }
  | { kind: "section-closed"; ordinal: number; topic: string; pages: number }
  | { kind: "section-text"; ordinal: number; label: string }
  | { kind: "section-summarised"; ordinal: number; questions: number; concepts: number }
  | { kind: "named"; name: string; tagline: string }
  | { kind: "done"; sections: number; concepts: number }
  | { kind: "failed"; message: string };

function parseScratchpad(md: string): ScratchEvent[] {
  const out: ScratchEvent[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line === "## Run started") {
      // Following lines like "- Files: 8" / "- Will auto-name: yes"
      let files = 0;
      let autoName = false;
      while (i + 1 < lines.length && lines[i + 1].startsWith("-")) {
        const next = lines[i + 1].trim();
        const fm = /Files: (\d+)/.exec(next);
        if (fm) files = Number(fm[1]);
        if (/auto-name: yes/.test(next)) autoName = true;
        i++;
      }
      out.push({ kind: "started", fileCount: files, autoName });
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^### File: (.+)$/.exec(line))) {
      out.push({ kind: "file", name: m[1] });
      continue;
    }
    if ((m = /^- Page (\d+): (new|continue|end) · (.+?) — (.+)$/.exec(line))) {
      out.push({
        kind: "page",
        ordinal: Number(m[1]),
        transition: m[2] as "new" | "continue" | "end",
        topic: m[3],
        summary: m[4],
      });
      continue;
    }
    if ((m = /^- Closed section (\d+): \*\*(.+?)\*\* \((\d+) pages?\)$/.exec(line))) {
      out.push({
        kind: "section-closed",
        ordinal: Number(m[1]),
        topic: m[2],
        pages: Number(m[3]),
      });
      continue;
    }
    if ((m = /^- Text section (\d+): \*\*(.+?)\*\*$/.exec(line))) {
      out.push({ kind: "section-text", ordinal: Number(m[1]), label: m[2] });
      continue;
    }
    if ((m = /^- Summarised section (\d+): (\d+) Q, (\d+) concepts$/.exec(line))) {
      out.push({
        kind: "section-summarised",
        ordinal: Number(m[1]),
        questions: Number(m[2]),
        concepts: Number(m[3]),
      });
      continue;
    }
    if ((m = /^## Named: \*\*(.+?)\*\* — (.+)$/.exec(line))) {
      out.push({ kind: "named", name: m[1], tagline: m[2] });
      continue;
    }
    if ((m = /^## Done — (\d+) sections?, (\d+) concepts?$/.exec(line))) {
      out.push({ kind: "done", sections: Number(m[1]), concepts: Number(m[2]) });
      continue;
    }
    if ((m = /^## Failed: (.+)$/.exec(line))) {
      out.push({ kind: "failed", message: m[1] });
      continue;
    }
    // Unrecognised lines are silently skipped — the orchestrator's emit format
    // is owned here, so anything outside the grammar is noise.
  }
  return out;
}

export function ScratchpadStream({ md }: { md: string }) {
  const events = useMemo(() => parseScratchpad(md), [md]);
  const currentAction = useLiveProgress((s) => s.currentAction);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new events / when the live action changes,
  // but only if the user is already near the bottom — so they can scroll
  // up to read history without being yanked away.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (isNearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [events.length, currentAction]);

  const isEmpty = events.length === 0 && !currentAction;

  return (
    <CollapsibleSection
      icon={<Activity className="size-4" />}
      title="Agent timeline"
      rightLabel={
        events.length === 0 && !currentAction
          ? "waiting…"
          : `${events.length} event${events.length === 1 ? "" : "s"}`
      }
    >
      {isEmpty ? (
        <div className="px-3 py-6 text-center text-[11px] italic text-muted-foreground">
          The agent will narrate its work here.
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="max-h-72 overflow-y-auto px-3 py-2.5"
        >
          <ol className="space-y-1.5">
            {events.map((e, i) => (
              <li
                key={i}
                className="animate-in fade-in slide-in-from-bottom-1 duration-300 fill-mode-both"
              >
                <EventRow event={e} />
              </li>
            ))}
            {currentAction && (
              <li
                key="__current-action"
                className="animate-in fade-in slide-in-from-bottom-1 duration-200"
              >
                <CurrentActionRow action={currentAction} />
              </li>
            )}
          </ol>
        </div>
      )}
    </CollapsibleSection>
  );
}

/**
 * Transient "this is happening right now" row at the bottom of the timeline.
 * Spinner icon + mono subject prefix + shimmer-animated verb. Replaced by the
 * concrete EventRow once the agent call lands and the scratchpad updates.
 */
function CurrentActionRow({ action }: { action: NonNullable<CurrentAction> }) {
  return (
    <div className="flex items-start gap-2.5 text-[12px] leading-snug">
      <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        <Loader2 className="size-3.5 animate-spin text-primary [animation-duration:1.4s]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {action.subject && (
            <span className="font-mono text-muted-foreground">{action.subject}</span>
          )}
          <span className={cn("ai-text-shimmer", action.subject && "ml-2")}>
            {action.verb}…
          </span>
        </div>
      </div>
    </div>
  );
}

function EventRow({ event }: { event: ScratchEvent }) {
  switch (event.kind) {
    case "started":
      return (
        <Row
          icon={<Sparkles className="size-3.5 text-primary" />}
          title="Run started"
          detail={
            <>
              {event.fileCount} file{event.fileCount === 1 ? "" : "s"}
              {event.autoName && " · AI will name"}
            </>
          }
        />
      );
    case "file":
      return (
        <div className="mt-3 flex items-center gap-2 border-b pb-1 text-[11px] uppercase tracking-wider text-muted-foreground first:mt-0">
          <FileImage className="size-3" />
          <span className="truncate normal-case tracking-normal text-foreground/80">
            {event.name}
          </span>
        </div>
      );
    case "page":
      return (
        <Row
          icon={<TransitionDot transition={event.transition} />}
          title={
            <>
              <span className="font-mono text-muted-foreground">p{event.ordinal}</span>
              <span className="ml-2">{event.topic}</span>
            </>
          }
          detail={event.summary}
        />
      );
    case "section-closed":
      return (
        <Row
          icon={<Hash className="size-3.5 text-muted-foreground" />}
          title={
            <>
              <span className="font-mono text-muted-foreground">§{event.ordinal}</span>
              <span className="ml-2 font-medium">{event.topic}</span>
            </>
          }
          detail={`closed · ${event.pages} page${event.pages === 1 ? "" : "s"}`}
        />
      );
    case "section-text":
      return (
        <Row
          icon={<Hash className="size-3.5 text-muted-foreground" />}
          title={
            <>
              <span className="font-mono text-muted-foreground">§{event.ordinal}</span>
              <span className="ml-2">{event.label}</span>
            </>
          }
          detail="text section"
        />
      );
    case "section-summarised":
      return (
        <Row
          icon={<Sparkles className="size-3.5 text-primary/70" />}
          title={
            <>
              <span className="font-mono text-muted-foreground">§{event.ordinal}</span>
              <span className="ml-2">summarised</span>
            </>
          }
          detail={`${event.questions}Q · ${event.concepts} concepts`}
        />
      );
    case "named":
      return (
        <Row
          icon={<Sparkles className="size-3.5 text-primary" />}
          title={<span className="font-medium">{event.name}</span>}
          detail={event.tagline}
          tone="primary"
        />
      );
    case "done":
      return (
        <Row
          icon={<Sparkles className="size-3.5 text-emerald-500" />}
          title={<span className="font-medium text-emerald-500">Done</span>}
          detail={`${event.sections} sections · ${event.concepts} concepts`}
          tone="success"
        />
      );
    case "failed":
      return (
        <Row
          icon={<X className="size-3.5 text-destructive" />}
          title={<span className="font-medium text-destructive">Failed</span>}
          detail={event.message}
          tone="destructive"
        />
      );
  }
}

function Row({
  icon,
  title,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  detail?: React.ReactNode;
  tone?: "primary" | "success" | "destructive";
}) {
  return (
    <div className="flex items-start gap-2.5 text-[12px] leading-snug">
      <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate",
            tone === "primary" && "text-primary",
            tone === "success" && "text-emerald-500",
            tone === "destructive" && "text-destructive",
          )}
        >
          {title}
        </div>
        {detail && (
          <div className="truncate text-[11px] text-muted-foreground">
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

function TransitionDot({ transition }: { transition: "new" | "continue" | "end" }) {
  const cls =
    transition === "new"
      ? "bg-primary"
      : transition === "end"
        ? "bg-emerald-500"
        : "bg-muted-foreground/50";
  return (
    <span
      className={cn("size-1.5 rounded-full", cls)}
      title={transition}
    />
  );
}
