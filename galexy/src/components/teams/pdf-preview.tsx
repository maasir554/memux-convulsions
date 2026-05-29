/**
 * PDF preview for the chat attachment modal.
 *
 * Distinct from the vault's pdf-viewer (src/components/galexy/viewers/) —
 * that one carries Note coupling and a different annotation model. This
 * one's tailored to chat:
 *   - Scroll every page top-to-bottom.
 *   - +/- zoom, fit-to-width, Ctrl/Cmd + wheel.
 *   - Page-jump input synced to the page currently visible.
 *   - Shared, team-scoped annotations: rectangle + comment, normalised
 *     coords, author colour stable per user, author-only delete.
 *
 * Annotations are loaded over REST when the reader opens. On save, we
 * append locally and POST — no WS broadcast yet, so other users see
 * fresh data when they reopen the PDF. Fine for a small team; can be
 * lifted to live updates later by piggy-backing on the TeamRoom DO.
 */

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  Maximize2,
  Minus,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { teamsApi, ApiError } from "@/lib/teams/api";
import type { PdfAnnotation } from "@/lib/teams/types";
import { cn } from "@/lib/utils";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

const MIN_SCALE = 0.4;
const MAX_SCALE = 4.0;
const SCALE_STEP = 0.2;
const DEFAULT_SCALE = 1.0;
const MIN_NORM_SIZE = 0.01; // ignore <1% drags as accidental clicks

interface PdfPreviewProps {
  url: string;
  /** When provided alongside attachmentKey, annotation UI is enabled. */
  teamId?: string;
  attachmentKey?: string;
  /** Used to decide who can delete which annotation. */
  myUserId?: string | null;
}

export function PdfPreview({
  url,
  teamId,
  attachmentKey,
  myUserId,
}: PdfPreviewProps) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [containerWidth, setContainerWidth] = useState(800);
  const [currentPage, setCurrentPage] = useState(1);
  const [fitWidth, setFitWidth] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const jumpInputRef = useRef<HTMLInputElement | null>(null);

  // Annotations
  const annotationsEnabled = Boolean(teamId && attachmentKey);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [annotationsVisible, setAnnotationsVisible] = useState(true);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [annotationsError, setAnnotationsError] = useState<string | null>(null);

  // ─────────────────────────────────────────────────────────────────
  // Container measurement
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // Visible-page tracking via IntersectionObserver
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (numPages === 0) return;
    const visibility = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const idx = Number((e.target as HTMLElement).dataset.pageIdx);
          visibility.set(idx, e.intersectionRatio);
        }
        let best = 1;
        let bestRatio = -1;
        for (const [idx, ratio] of visibility) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = idx + 1;
          }
        }
        setCurrentPage(best);
      },
      { root: containerRef.current, threshold: [0.05, 0.25, 0.5, 0.75, 0.95] },
    );
    for (const el of pageRefs.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, [numPages]);

  // ─────────────────────────────────────────────────────────────────
  // Ctrl/Cmd + wheel zoom
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -SCALE_STEP : SCALE_STEP;
      setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s + delta)));
      setFitWidth(false);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // Annotations: initial fetch
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!annotationsEnabled || !teamId || !attachmentKey) return;
    let cancelled = false;
    teamsApi
      .listAnnotations(teamId, attachmentKey)
      .then(({ annotations }) => {
        if (!cancelled) setAnnotations(annotations);
      })
      .catch((e) => {
        if (cancelled) return;
        setAnnotationsError(
          e instanceof ApiError ? e.message : "Failed to load annotations",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [annotationsEnabled, teamId, attachmentKey]);

  const onLoad = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    pageRefs.current = new Array(numPages).fill(null);
  }, []);

  const jumpTo = useCallback((page: number) => {
    const clamped = Math.max(1, Math.min(page, pageRefs.current.length));
    const el = pageRefs.current[clamped - 1];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    const el = jumpInputRef.current;
    if (el && document.activeElement !== el) {
      el.value = String(currentPage);
    }
  }, [currentPage]);

  const pageWidth = useMemo(() => {
    const usable = Math.max(200, containerWidth - 32);
    return fitWidth ? usable : usable * scale;
  }, [containerWidth, scale, fitWidth]);

  const effectiveScalePct = useMemo(() => {
    const usable = Math.max(200, containerWidth - 32);
    return Math.round((pageWidth / usable) * 100);
  }, [containerWidth, pageWidth]);

  function applyManualScale(next: number) {
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)));
    setFitWidth(false);
  }

  async function handleCreate(input: {
    page: number;
    x: number;
    y: number;
    w: number;
    h: number;
    body: string;
  }) {
    if (!teamId || !attachmentKey) return;
    try {
      const { annotation } = await teamsApi.createAnnotation(teamId, {
        key: attachmentKey,
        ...input,
      });
      setAnnotations((prev) => [annotation, ...prev]);
    } catch (e) {
      setAnnotationsError(
        e instanceof ApiError ? e.message : "Failed to save annotation",
      );
    }
  }

  async function handleDelete(id: string) {
    if (!teamId) return;
    try {
      await teamsApi.deleteAnnotation(teamId, id);
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setAnnotationsError(
        e instanceof ApiError ? e.message : "Failed to delete annotation",
      );
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-background/80 px-3 text-xs">
        {/* Page jump */}
        <div className="flex items-center gap-1 rounded-md border bg-card px-1.5 py-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => jumpTo(currentPage - 1)}
            aria-label="Previous page"
            disabled={currentPage <= 1}
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <input
            ref={jumpInputRef}
            type="text"
            inputMode="numeric"
            defaultValue={String(currentPage)}
            onInput={(e) => {
              const el = e.currentTarget;
              el.value = el.value.replace(/[^0-9]/g, "");
            }}
            onBlur={(e) => {
              const n = parseInt(e.currentTarget.value, 10);
              if (Number.isFinite(n)) jumpTo(n);
              else e.currentTarget.value = String(currentPage);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="w-9 bg-transparent text-center tabular-nums outline-none"
            aria-label="Page"
          />
          <span className="text-muted-foreground">/ {numPages || "—"}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => jumpTo(currentPage + 1)}
            aria-label="Next page"
            disabled={currentPage >= numPages}
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-1 rounded-md border bg-card px-1.5 py-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => applyManualScale(scale - SCALE_STEP)}
            aria-label="Zoom out"
            disabled={!fitWidth && scale <= MIN_SCALE}
          >
            <Minus className="size-3.5" />
          </Button>
          <span className="w-10 text-center tabular-nums text-muted-foreground">
            {effectiveScalePct}%
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => applyManualScale(scale + SCALE_STEP)}
            aria-label="Zoom in"
            disabled={!fitWidth && scale >= MAX_SCALE}
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant={fitWidth ? "default" : "ghost"}
            className="ml-1 h-6 px-2"
            onClick={() => setFitWidth((v) => !v)}
            aria-pressed={fitWidth}
            title="Fit to width"
          >
            <Maximize2 className="mr-1 size-3" /> Fit
          </Button>
        </div>

        {/* Annotate toggle — only enabled when we have a teamId + key */}
        {annotationsEnabled && (
          <>
            <Button
              size="sm"
              variant={annotateMode ? "default" : "outline"}
              className="h-7 px-2"
              onClick={() => {
                // Entering annotate mode while annotations are hidden
                // would lead to a "drew a box that disappeared" surprise.
                // Force-show on enter; leave the user's choice alone on exit.
                setAnnotateMode((v) => {
                  if (!v) setAnnotationsVisible(true);
                  return !v;
                });
              }}
              aria-pressed={annotateMode}
              title="Draw an annotation"
            >
              <Pencil className="mr-1 size-3" />
              {annotateMode ? "Drawing…" : "Annotate"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => setAnnotationsVisible((v) => !v)}
              aria-pressed={!annotationsVisible}
              disabled={annotateMode}
              title={
                annotateMode
                  ? "Can't hide while drawing"
                  : annotationsVisible
                    ? `Hide annotations${annotations.length ? ` (${annotations.length})` : ""}`
                    : `Show annotations${annotations.length ? ` (${annotations.length})` : ""}`
              }
            >
              {annotationsVisible ? (
                <Eye className="size-3.5" />
              ) : (
                <EyeOff className="size-3.5" />
              )}
            </Button>
          </>
        )}

        <span className="ml-auto text-[10px] text-muted-foreground">
          ⌘/Ctrl + scroll to zoom
          {annotateMode && <> · drag on a page to draw a box</>}
          {!annotateMode && annotationsEnabled && !annotationsVisible && annotations.length > 0 && (
            <> · {annotations.length} annotation{annotations.length === 1 ? "" : "s"} hidden</>
          )}
        </span>
      </div>

      {annotationsError && (
        <div className="border-b bg-destructive/10 px-3 py-1.5 text-[10px] text-destructive">
          {annotationsError}
        </div>
      )}

      {/* Pages */}
      <div
        ref={containerRef}
        className="flex-1 touch-pan-y overflow-auto bg-muted/30 px-4 py-4"
      >
        <Document
          file={url}
          onLoadSuccess={onLoad}
          options={DOC_OPTIONS}
          loading={
            <div className="flex h-40 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading PDF…
            </div>
          }
          error={
            <div className="py-8 text-center text-xs text-destructive">
              Couldn’t load PDF.
            </div>
          }
          className="flex flex-col items-center gap-3"
        >
          {Array.from({ length: numPages }, (_, i) => {
            const pageAnnotations = annotations.filter((a) => a.page === i + 1);
            return (
              <div
                key={i}
                ref={(el) => {
                  pageRefs.current[i] = el;
                }}
                data-page-idx={i}
                className="relative"
              >
                <Page
                  pageNumber={i + 1}
                  width={pageWidth}
                  renderTextLayer={!annotateMode /* avoid text selection while drawing */}
                  renderAnnotationLayer={false}
                  className="bg-white shadow-md"
                  loading={
                    <div className="flex h-40 w-full items-center justify-center text-xs text-muted-foreground">
                      <Loader2 className="mr-2 size-3.5 animate-spin" />
                      Page {i + 1}…
                    </div>
                  }
                />
                <AnnotationLayer
                  pageIdx={i}
                  annotations={pageAnnotations}
                  showSaved={annotationsVisible}
                  myUserId={myUserId ?? null}
                  annotateMode={annotateMode}
                  onCreate={(input) => handleCreate({ page: i + 1, ...input })}
                  onDelete={handleDelete}
                />
              </div>
            );
          })}
        </Document>
      </div>
    </div>
  );
}

// Reusing the same options object across renders keeps react-pdf from
// re-fetching when our state changes (the lib treats `options` by identity).
const DOC_OPTIONS = {
  cMapUrl: "https://unpkg.com/pdfjs-dist/cmaps/",
  cMapPacked: true,
} as const;

// ─────────────────────────────────────────────────────────────────────────
// AnnotationLayer — overlay per page that renders saved annotations and
// (in annotate mode) captures pointer drags to create new ones.
// ─────────────────────────────────────────────────────────────────────────

function AnnotationLayer({
  annotations,
  showSaved,
  myUserId,
  annotateMode,
  onCreate,
  onDelete,
}: {
  pageIdx: number;
  annotations: PdfAnnotation[];
  /** When false, saved annotations are not rendered. Drawing still works
   *  if annotateMode is on — but the parent ensures showSaved is true
   *  whenever drawing starts, so the just-drawn rect isn't invisible. */
  showSaved: boolean;
  myUserId: string | null;
  annotateMode: boolean;
  onCreate: (input: { x: number; y: number; w: number; h: number; body: string }) => void;
  onDelete: (id: string) => void;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  // The in-progress drag rect (normalised). null when not drawing.
  const [draft, setDraft] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  // Once the user lets go on a real-sized rect we hold it here and show
  // a comment composer near it; null while not composing.
  const [pendingFinal, setPendingFinal] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  // Drag handlers — only active in annotateMode.
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!annotateMode || pendingFinal) return;
      const el = layerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setDraft({ x, y, w: 0, h: 0 });
      el.setPointerCapture(e.pointerId);
    },
    [annotateMode, pendingFinal],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draft) return;
      const el = layerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const curX = clamp01((e.clientX - rect.left) / rect.width);
      const curY = clamp01((e.clientY - rect.top) / rect.height);
      const x = Math.min(draft.x, curX);
      const y = Math.min(draft.y, curY);
      const w = Math.abs(curX - draft.x);
      const h = Math.abs(curY - draft.y);
      setDraft({ x, y, w, h });
    },
    [draft],
  );
  const onPointerUp = useCallback(() => {
    if (!draft) return;
    const final = draft;
    setDraft(null);
    if (final.w < MIN_NORM_SIZE || final.h < MIN_NORM_SIZE) return;
    setPendingFinal(final);
  }, [draft]);

  function submit(body: string) {
    if (!pendingFinal) return;
    onCreate({ ...pendingFinal, body });
    setPendingFinal(null);
  }

  // The layer fills the page and only intercepts pointer events when we
  // need it to. In view-only mode the layer's children are clickable
  // (for the comment hover-card) but the layer itself passes through.
  return (
    <div
      ref={layerRef}
      className={cn(
        "absolute inset-0",
        annotateMode ? "cursor-crosshair" : "pointer-events-none",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {showSaved &&
        annotations.map((a) => (
          <SavedRect
            key={a.id}
            annotation={a}
            canDelete={a.userId === myUserId}
            onDelete={() => onDelete(a.id)}
          />
        ))}
      {/* In-progress drag preview */}
      {draft && (
        <div
          className="absolute border-2 border-dashed border-primary/80 bg-primary/10"
          style={rectStyle(draft)}
        />
      )}
      {/* Comment composer — appears once a rect is finished */}
      {pendingFinal && (
        <NewCommentPopover
          rect={pendingFinal}
          onCancel={() => setPendingFinal(null)}
          onSubmit={submit}
        />
      )}
    </div>
  );
}

// One saved annotation, rendered as a coloured outline + author chip.
function SavedRect({
  annotation,
  canDelete,
  onDelete,
}: {
  annotation: PdfAnnotation;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const color = colourForUserId(annotation.userId);
  return (
    <div
      className="pointer-events-auto absolute"
      style={rectStyle(annotation)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="absolute inset-0 border-2 transition hover:bg-white/10"
        style={{
          borderColor: color,
          backgroundColor: open ? `${color}33` : `${color}1a`,
        }}
        title={`${annotation.userName} · ${formatTime(annotation.createdAt)}`}
        aria-label={`Annotation by ${annotation.userName}`}
      />
      {/* Author chip — top-left, outside the box */}
      <div
        className="absolute -top-5 left-0 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium text-white"
        style={{ backgroundColor: color }}
      >
        {annotation.userImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={annotation.userImage}
            alt=""
            referrerPolicy="no-referrer"
            className="size-3 rounded-full ring-1 ring-white/40"
          />
        ) : null}
        <span className="max-w-[8rem] truncate">{annotation.userName}</span>
      </div>
      {open && (
        <div
          className="absolute top-full left-0 z-10 mt-1 w-64 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <span>{annotation.userName}</span>
            <span>·</span>
            <span>{formatTime(annotation.createdAt)}</span>
            {canDelete && (
              <button
                type="button"
                onClick={onDelete}
                aria-label="Delete annotation"
                className="ml-auto rounded p-0.5 hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="size-3" />
              </button>
            )}
          </div>
          <div className="whitespace-pre-wrap break-words">
            {annotation.body}
          </div>
        </div>
      )}
    </div>
  );
}

// Popover with a text input, anchored just below the drawn rect.
function NewCommentPopover({
  rect,
  onCancel,
  onSubmit,
}: {
  rect: { x: number; y: number; w: number; h: number };
  onCancel: () => void;
  onSubmit: (body: string) => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function maybeSubmit() {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <>
      {/* Echo the drawn rect so the user can still see what they're commenting on */}
      <div
        className="pointer-events-none absolute border-2 border-primary/80 bg-primary/10"
        style={rectStyle(rect)}
      />
      <div
        className="pointer-events-auto absolute z-20 w-72 rounded-md border bg-popover p-2 shadow-lg"
        style={{
          left: `${rect.x * 100}%`,
          top: `calc(${(rect.y + rect.h) * 100}% + 6px)`,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              maybeSubmit();
            }
            if (e.key === "Escape") onCancel();
          }}
          placeholder="Comment…"
          rows={2}
          className="w-full resize-none rounded-sm border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring/50"
        />
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>⌘/Ctrl+Enter to save</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onCancel}
              className="flex h-6 items-center gap-1 rounded px-2 hover:bg-muted"
            >
              <X className="size-3" /> Cancel
            </button>
            <button
              type="button"
              onClick={maybeSubmit}
              disabled={!value.trim()}
              className="h-6 rounded bg-primary px-2 text-primary-foreground disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function rectStyle(r: { x: number; y: number; w: number; h: number }) {
  return {
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`,
  } as const;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Stable per-user colour — HSL with fixed S/L so adjacent users stay
 *  distinct without ever clashing with the chrome. */
function colourForUserId(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue} 70% 50%)`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
