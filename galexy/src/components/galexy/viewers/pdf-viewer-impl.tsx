"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Popover as PopoverPrimitive } from "radix-ui";
import {
  Eye,
  EyeOff,
  MessageSquarePlus,
  Minus,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBlobUrl } from "@/components/galexy/use-blob-url";
import { ViewerFallback } from "@/components/galexy/viewers/viewer-fallback";
import type { Note, PdfAnnotation } from "@/lib/mock-notes";

// react-pdf's src/index.ts hardcodes a default workerSrc of `pdf.worker.mjs`
// (a relative path that 404s at /memux/chat → fake worker fallback → blank
// image-heavy pages). Force-override unconditionally and let Turbopack emit
// the worker file as a bundled asset, so the URL is guaranteed correct and
// doesn't depend on Next's public/ routing or MIME-type guessing.
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  // One-time diagnostic so you can confirm in the browser console what URL the
  // worker was actually loaded from.
  console.log("[pdf] workerSrc:", pdfjs.GlobalWorkerOptions.workerSrc);
}

const MIN_BOX = 0.01; // normalized — discard sub-1% drags as accidental clicks
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.1;

// US Letter at 96 DPI — sane placeholder size until we measure the real first
// page. Books that aren't this exact size pop to their actual size on first
// load; the visible jump is tiny because by then page 0 has rendered already.
const DEFAULT_PAGE_WIDTH = 612;
const DEFAULT_PAGE_HEIGHT = 792;

// How many pages to pre-mount around the visible window. Higher = smoother
// scroll, more memory. 3 above + 3 below is plenty for a smooth wheel-scroll.
const PREMOUNT_RADIUS = 3;

/** A draft box being drawn, or awaiting its first comment. */
type Draft = {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type Props = {
  item: Note;
  onAnnotationsChange?: (annotations: PdfAnnotation[]) => void;
};

export default function PdfViewerImpl({ item, onAnnotationsChange }: Props) {
  const blobUrl = useBlobUrl(item.blobKey);
  const src = item.blobKey ? blobUrl : item.src;

  const [numPages, setNumPages] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [pending, setPending] = useState<Draft | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");

  // Pages that should mount the real <Page> (vs. a placeholder). Starts with
  // the first few pages so the viewport has content immediately and we can
  // measure the natural page size from page 0.
  const [visiblePages, setVisiblePages] = useState<Set<number>>(
    () => new Set([0, 1, 2]),
  );

  // Suppress IO-driven pageInput updates while the user is typing in the input
  // or for a brief window after a programmatic jump. Without this the input
  // would flicker between the user's typed value and whatever the IO observes
  // mid-scroll.
  const inputFocusedRef = useRef(false);
  const ignoreIoUntilRef = useRef(0);

  // Natural page dimensions at scale=1, captured from the first page that
  // successfully loads. Until then, placeholders use the US Letter default.
  const [naturalSize, setNaturalSize] = useState<{
    width: number;
    height: number;
  }>({ width: DEFAULT_PAGE_WIDTH, height: DEFAULT_PAGE_HEIGHT });

  // Page DOM nodes (one per slot) so we can scroll-to-page and the
  // IntersectionObserver can resolve the most-visible page.
  const pageNodes = useRef(new Map<number, HTMLDivElement>());
  const scrollRef = useRef<HTMLDivElement>(null);

  const registerPageNode = useCallback(
    (pageIndex: number, node: HTMLDivElement | null) => {
      if (node) pageNodes.current.set(pageIndex, node);
      else pageNodes.current.delete(pageIndex);
    },
    [],
  );

  const annotations = useMemo(
    () => item.pdfAnnotations ?? [],
    [item.pdfAnnotations],
  );

  // Stable file= prop so react-pdf doesn't re-fetch on every render.
  const fileOption = useMemo(() => (src ? { url: src } : null), [src]);

  /**
   * Auxiliary asset URLs for pdfjs. These are copied into public/pdfjs/ at
   * install time by scripts/sync-pdfjs-assets.mjs, so the URLs are stable
   * absolute paths served by the dev / prod Next.js server.
   *
   * - cMapUrl / cMapPacked: character maps for CJK and other non-Latin PDFs.
   * - standardFontDataUrl: Foxit fallback fonts when the PDF doesn't embed.
   * - wasmUrl: openjpeg (JPEG2000 / JPX) + qcms (color management). Most
   *   scanned books compress every page as JPX, so without this they render
   *   as blank pages with "Dependent image isn't ready yet" warnings.
   *
   * Memoized once so the Document doesn't re-init on every render.
   */
  const docOptions = useMemo(
    () => ({
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
    }),
    [],
  );

  const commit = useCallback(
    (next: PdfAnnotation[]) => onAnnotationsChange?.(next),
    [onAnnotationsChange],
  );

  const savePending = useCallback(() => {
    if (!pending) return;
    const ann: PdfAnnotation = {
      id: newId(),
      pageIndex: pending.pageIndex,
      x: pending.x,
      y: pending.y,
      width: pending.width,
      height: pending.height,
      comment: pendingText.trim(),
      createdAt: new Date().toISOString(),
    };
    commit([...annotations, ann]);
    setPending(null);
    setPendingText("");
  }, [annotations, commit, pending, pendingText]);

  const discardPending = useCallback(() => {
    setPending(null);
    setPendingText("");
  }, []);

  const updateActiveComment = useCallback(
    (text: string) => {
      if (!activeId) return;
      commit(
        annotations.map((a) =>
          a.id === activeId ? { ...a, comment: text } : a,
        ),
      );
    },
    [activeId, annotations, commit],
  );

  const deleteActive = useCallback(() => {
    if (!activeId) return;
    commit(annotations.filter((a) => a.id !== activeId));
    setActiveId(null);
  }, [activeId, annotations, commit]);

  // Auto-update currentPage as the user scrolls and expand visiblePages so
  // pages near the viewport mount their real <Page> ahead of being scrolled to.
  // The "most visible" page wins for currentPage; ties go to the lower index.
  useEffect(() => {
    if (!numPages || !scrollRef.current) return;
    const root = scrollRef.current;
    const visibility = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        const newlyVisible: number[] = [];
        for (const entry of entries) {
          const idxAttr = (entry.target as HTMLElement).dataset.pageIndex;
          if (idxAttr == null) continue;
          const idx = Number(idxAttr);
          visibility.set(idx, entry.intersectionRatio);
          if (entry.isIntersecting) newlyVisible.push(idx);
        }
        if (newlyVisible.length > 0) {
          setVisiblePages((prev) => {
            let changed = false;
            const next = new Set(prev);
            for (const idx of newlyVisible) {
              for (
                let j = Math.max(0, idx - PREMOUNT_RADIUS);
                j <= Math.min(numPages - 1, idx + PREMOUNT_RADIUS);
                j++
              ) {
                if (!next.has(j)) {
                  next.add(j);
                  changed = true;
                }
              }
            }
            return changed ? next : prev;
          });
        }
        let bestIdx = 0;
        let bestRatio = -1;
        for (const [idx, ratio] of visibility) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestIdx = idx;
          }
        }
        if (bestRatio > 0) {
          setCurrentPage((prev) => {
            const next = bestIdx + 1;
            // Don't clobber the input if the user is typing into it, or if
            // we just initiated a programmatic jump (the IO settles a few
            // frames after the scroll lands).
            const suppress =
              inputFocusedRef.current ||
              performance.now() < ignoreIoUntilRef.current;
            if (next !== prev && !suppress) setPageInput(String(next));
            return next;
          });
        }
      },
      {
        root,
        // rootMargin generously expands the trigger area so pages mount before
        // they're actually on screen — no perceptible loading gap on scroll.
        rootMargin: "500px 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );
    for (const node of pageNodes.current.values()) io.observe(node);
    return () => io.disconnect();
  }, [numPages]);

  const onPageLoadSuccess = useCallback(
    (page: { originalWidth: number; originalHeight: number }) => {
      // Capture the natural page size once; books with consistent page sizes
      // (most are) will have correctly-sized placeholders for every page.
      setNaturalSize((prev) => {
        if (
          prev.width === page.originalWidth &&
          prev.height === page.originalHeight
        ) {
          return prev;
        }
        // Only update from the placeholder default — don't keep overriding on
        // every page load, otherwise pages with odd sizes would churn state.
        if (
          prev.width !== DEFAULT_PAGE_WIDTH ||
          prev.height !== DEFAULT_PAGE_HEIGHT
        ) {
          return prev;
        }
        return {
          width: page.originalWidth,
          height: page.originalHeight,
        };
      });
    },
    [],
  );

  const scrollToPage = useCallback(
    (oneBased: number) => {
      if (!numPages) return;
      const idx = Math.max(1, Math.min(numPages, Math.floor(oneBased))) - 1;
      const node = pageNodes.current.get(idx);
      if (!node) return;
      // Pre-mount the target and its neighbours so the destination is rendered
      // before the scroll lands.
      setVisiblePages((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (
          let j = Math.max(0, idx - PREMOUNT_RADIUS);
          j <= Math.min(numPages - 1, idx + PREMOUNT_RADIUS);
          j++
        ) {
          if (!next.has(j)) {
            next.add(j);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      // Lock the displayed page to what the user asked for through the IO
      // settle window (otherwise IO fires for nearby pages during render and
      // overwrites the input). 800ms covers smooth-scroll-anchor settle on
      // big-jump renders.
      setCurrentPage(idx + 1);
      setPageInput(String(idx + 1));
      ignoreIoUntilRef.current = performance.now() + 800;
      // Instant (not smooth): smooth-scrolling across hundreds of pages fires
      // the IO on every page in between, mounting them all needlessly.
      node.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" });
    },
    [numPages],
  );

  const submitPageInput = useCallback(() => {
    const n = Number.parseInt(pageInput, 10);
    if (Number.isFinite(n)) {
      scrollToPage(n);
    } else {
      setPageInput(String(currentPage));
    }
  }, [currentPage, pageInput, scrollToPage]);

  const onPageInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitPageInput();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPageInput(String(currentPage));
      (e.target as HTMLInputElement).blur();
    }
  };

  if (item.blobKey && !blobUrl) {
    return <ViewerFallback label="Loading PDF…" />;
  }
  if (!src || !fileOption) {
    return <ViewerFallback label="No PDF source set for this file." />;
  }

  const totalAnnotations = annotations.length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/10">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-sidebar px-2 text-xs">
        <Button
          variant={annotateMode ? "default" : "ghost"}
          size="sm"
          onClick={() => {
            setAnnotateMode((v) => !v);
            discardPending();
          }}
          className="h-7 gap-1.5 px-2"
        >
          <MessageSquarePlus className="size-3.5" />
          {annotateMode ? "Annotating" : "Annotate"}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setShowAnnotations((v) => {
              const next = !v;
              // Don't leave a popover dangling for an annotation that's no
              // longer rendered.
              if (!next) setActiveId(null);
              return next;
            });
          }}
          className="h-7 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
          aria-label={showAnnotations ? "Hide annotations" : "Show annotations"}
        >
          {showAnnotations ? (
            <Eye className="size-3.5" />
          ) : (
            <EyeOff className="size-3.5" />
          )}
          {showAnnotations ? "Hide" : "Show"}
        </Button>

        <div className="mx-2 h-4 w-px bg-border" />

        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label="Zoom out"
          onClick={() => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP))}
        >
          <Minus className="size-3.5" />
        </Button>
        <button
          type="button"
          onClick={() => setScale(1)}
          className="min-w-12 rounded px-2 py-0.5 text-center text-xs tabular-nums text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          aria-label="Reset zoom"
        >
          {Math.round(scale * 100)}%
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label="Zoom in"
          onClick={() => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP))}
        >
          <Plus className="size-3.5" />
        </Button>

        <div className="ml-auto flex items-center gap-3 text-muted-foreground">
          {totalAnnotations > 0 && (
            <span>
              {totalAnnotations} comment{totalAnnotations === 1 ? "" : "s"}
            </span>
          )}
          {numPages != null && (
            <div className="flex items-center gap-1.5">
              <input
                value={pageInput}
                onChange={(e) =>
                  // Allow any digits during typing; clamp on submit.
                  setPageInput(e.target.value.replace(/[^0-9]/g, ""))
                }
                onBlur={(e) => {
                  inputFocusedRef.current = false;
                  submitPageInput();
                  // Snap back to the real current page if user blurred with
                  // garbage / empty (submitPageInput already does this).
                  void e;
                }}
                onKeyDown={onPageInputKey}
                // "Select-all on every click": onFocus selects on the first
                // click, onMouseUp.preventDefault() stops the browser from
                // re-placing the caret on subsequent clicks within the field.
                onFocus={(e) => {
                  inputFocusedRef.current = true;
                  e.currentTarget.select();
                }}
                onMouseUp={(e) => e.preventDefault()}
                inputMode="numeric"
                aria-label="Go to page"
                className="h-6 w-10 rounded border bg-background px-1.5 text-center text-xs tabular-nums text-foreground outline-none focus:border-ring"
              />
              <span className="text-xs tabular-nums">
                / {numPages}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Pages */}
      <div
        ref={scrollRef}
        className={cn(
          // gap-6 between pages so each one reads as a distinct sheet against
          // the muted backdrop; py-6 keeps the same breathing room above the
          // first page and below the last.
          "flex min-h-0 flex-1 flex-col items-center gap-6 overflow-auto bg-muted/30 py-6",
          annotateMode && "select-none",
        )}
      >
        <Document
          file={fileOption}
          options={docOptions}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          loading={<ViewerFallback label="Loading PDF…" />}
          error={<ViewerFallback label="Failed to load PDF." />}
        >
          {numPages != null &&
            Array.from({ length: numPages }, (_, i) => (
              <PageWithOverlay
                key={i}
                pageIndex={i}
                scale={scale}
                annotateMode={annotateMode}
                showAnnotations={showAnnotations}
                registerNode={registerPageNode}
                mountReal={visiblePages.has(i)}
                naturalSize={naturalSize}
                onPageLoadSuccess={onPageLoadSuccess}
                annotations={annotations.filter((a) => a.pageIndex === i)}
                pending={pending?.pageIndex === i ? pending : null}
                pendingText={pendingText}
                activeId={activeId}
                onCommitDraft={(draft) => {
                  if (draft.width >= MIN_BOX && draft.height >= MIN_BOX) {
                    setPending(draft);
                    setPendingText("");
                  }
                }}
                onPendingTextChange={setPendingText}
                onPendingSave={savePending}
                onPendingCancel={discardPending}
                onAnnotationOpen={(id) => setActiveId(id)}
                onAnnotationClose={() => setActiveId(null)}
                onActiveCommentChange={updateActiveComment}
                onActiveDelete={deleteActive}
              />
            ))}
        </Document>
      </div>
    </div>
  );
}

// ---------- Per-page overlay ------------------------------------------------

type PageProps = {
  pageIndex: number;
  scale: number;
  annotateMode: boolean;
  showAnnotations: boolean;
  registerNode: (pageIndex: number, node: HTMLDivElement | null) => void;
  mountReal: boolean;
  naturalSize: { width: number; height: number };
  onPageLoadSuccess: (page: {
    originalWidth: number;
    originalHeight: number;
  }) => void;
  annotations: PdfAnnotation[];
  pending: Draft | null;
  pendingText: string;
  activeId: string | null;
  onCommitDraft: (draft: Draft) => void;
  onPendingTextChange: (v: string) => void;
  onPendingSave: () => void;
  onPendingCancel: () => void;
  onAnnotationOpen: (id: string) => void;
  onAnnotationClose: () => void;
  onActiveCommentChange: (v: string) => void;
  onActiveDelete: () => void;
};

function PageWithOverlay({
  pageIndex,
  scale,
  annotateMode,
  showAnnotations,
  registerNode,
  mountReal,
  naturalSize,
  onPageLoadSuccess,
  annotations,
  pending,
  pendingText,
  activeId,
  onCommitDraft,
  onPendingTextChange,
  onPendingSave,
  onPendingCancel,
  onAnnotationOpen,
  onAnnotationClose,
  onActiveCommentChange,
  onActiveDelete,
}: PageProps) {
  // Drag state stored in normalized [0,1] coords so the live preview can
  // render straight from state — no DOM reads during render.
  const [drag, setDrag] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);

  /** Compute normalized coords from a mouse event against the overlay. */
  const localize = (e: ReactMouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handleMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!annotateMode) return;
    // Only respond to primary-button drags on the overlay itself, not on a
    // child element (e.g. an existing annotation box).
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const { x, y } = localize(e);
    setDrag({ startX: x, startY: y, endX: x, endY: y });
  };

  const handleMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!drag) return;
    const { x, y } = localize(e);
    setDrag({ ...drag, endX: x, endY: y });
  };

  const handleMouseUp = () => {
    if (!drag) return;
    const draft: Draft = {
      pageIndex,
      x: Math.min(drag.startX, drag.endX),
      y: Math.min(drag.startY, drag.endY),
      width: Math.abs(drag.endX - drag.startX),
      height: Math.abs(drag.endY - drag.startY),
    };
    onCommitDraft(draft);
    setDrag(null);
  };

  const dragRect: CSSProperties | null = drag
    ? {
        left: `${Math.min(drag.startX, drag.endX) * 100}%`,
        top: `${Math.min(drag.startY, drag.endY) * 100}%`,
        width: `${Math.abs(drag.endX - drag.startX) * 100}%`,
        height: `${Math.abs(drag.endY - drag.startY) * 100}%`,
      }
    : null;

  // Slot dimensions in CSS px, computed from natural page size × current
  // scale. Critically, we lock this on EVERY slot — placeholder or real —
  // so flipping a slot from placeholder to real Page doesn't change the
  // wrapper's size and shift the layout under a scroll-jump. The real <Page>
  // renders into a wrapper of the exact dimensions the placeholder had, so
  // page N stays anchored at the same pixel offset across the lifetime of
  // the viewer.
  const slotWidth = naturalSize.width * scale;
  const slotHeight = naturalSize.height * scale;

  return (
    <div
      ref={(node) => registerNode(pageIndex, node)}
      data-page-index={pageIndex}
      className={cn(
        "relative shadow-md ring-1 ring-border mx-auto overflow-hidden",
        pageIndex > 0 && "mt-6",
      )}
      style={{ width: slotWidth, height: slotHeight }}
    >
      {mountReal ? (
        <Page
          pageNumber={pageIndex + 1}
          scale={scale}
          renderTextLayer={!annotateMode}
          renderAnnotationLayer={!annotateMode}
          onLoadSuccess={onPageLoadSuccess}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center bg-card/40 text-xs text-muted-foreground"
          // Pull the label slightly above center so it stays in view as the
          // page enters the viewport from below.
          style={{ paddingBottom: "30%" }}
        >
          Page {pageIndex + 1}
        </div>
      )}

      <div
        className={cn(
          // z-10 lifts the overlay above react-pdf's text layer (z-index: 2)
          // and PDF annotation layer (z-index: 3), so clicks on our boxes
          // reach the buttons even in read mode.
          "absolute inset-0 z-10",
          annotateMode && "cursor-crosshair",
        )}
        // pointer-events:none when reading lets text selection through; child
        // annotation buttons override it with their own auto.
        style={{ pointerEvents: annotateMode ? "auto" : "none" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {showAnnotations &&
          annotations.map((a) => (
            <AnnotationBox
              key={a.id}
              annotation={a}
              active={a.id === activeId}
              onOpen={() => onAnnotationOpen(a.id)}
              onClose={onAnnotationClose}
              onChangeComment={onActiveCommentChange}
              onDelete={onActiveDelete}
            />
          ))}

        {pending && (
          <PendingBox
            draft={pending}
            value={pendingText}
            onChange={onPendingTextChange}
            onSave={onPendingSave}
            onCancel={onPendingCancel}
          />
        )}

        {dragRect && (
          // Live drag rectangle — solid pink so the boundary is unambiguous
          // while the user is still drawing.
          <div
            className="pointer-events-none absolute rounded-sm border-2 border-solid border-pink-500 bg-pink-500/10"
            style={dragRect}
          />
        )}
      </div>
    </div>
  );
}

// ---------- Annotation box (existing) ---------------------------------------

function AnnotationBox({
  annotation,
  active,
  onOpen,
  onClose,
  onChangeComment,
  onDelete,
}: {
  annotation: PdfAnnotation;
  active: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChangeComment: (v: string) => void;
  onDelete: () => void;
}) {
  const positionStyle: CSSProperties = {
    left: `${annotation.x * 100}%`,
    top: `${annotation.y * 100}%`,
    width: `${annotation.width * 100}%`,
    height: `${annotation.height * 100}%`,
    pointerEvents: "auto",
  };

  return (
    <PopoverPrimitive.Root
      open={active}
      onOpenChange={(o) => {
        if (o) onOpen();
        else onClose();
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          style={positionStyle}
          className={cn(
            "absolute rounded-sm border-2 transition-colors",
            active
              ? "border-amber-500 bg-amber-300/30"
              : "border-amber-400/80 bg-amber-200/20 hover:border-amber-500 hover:bg-amber-300/30",
          )}
          aria-label={annotation.comment || "Annotation"}
        />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50 w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] tracking-wide text-muted-foreground uppercase">
            <span>page {annotation.pageIndex + 1}</span>
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-destructive hover:bg-destructive/10"
              aria-label="Delete annotation"
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
          </div>
          <textarea
            value={annotation.comment}
            onChange={(e) => onChangeComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Comment…"
            rows={3}
            className="w-full resize-none rounded border bg-background px-2 py-1 text-sm outline-none focus:border-ring"
          />
          <div className="mt-2 text-[10px] text-muted-foreground">
            Saved · changes persist as you type
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

// ---------- Pending draft box (just-drawn, awaiting first comment) ---------

function PendingBox({
  draft,
  value,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Draft;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const positionStyle: CSSProperties = {
    left: `${draft.x * 100}%`,
    top: `${draft.y * 100}%`,
    width: `${draft.width * 100}%`,
    height: `${draft.height * 100}%`,
    pointerEvents: "auto",
  };

  return (
    <PopoverPrimitive.Root open onOpenChange={(o) => !o && onCancel()}>
      <PopoverPrimitive.Trigger asChild>
        <div
          style={positionStyle}
          className="absolute rounded-sm border-2 border-solid border-pink-500 bg-pink-500/15 ring-1 ring-pink-500/40"
        />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50 w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            requestAnimationFrame(() => {
              const node = e.currentTarget as HTMLElement | null;
              const ta = node?.querySelector("textarea") as
                | HTMLTextAreaElement
                | null;
              ta?.focus();
            });
          }}
        >
          <div className="mb-1 text-[10px] tracking-wide text-muted-foreground uppercase">
            New comment · page {draft.pageIndex + 1}
          </div>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSave();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
            }}
            placeholder="Comment…"
            rows={3}
            className="w-full resize-none rounded border bg-background px-2 py-1 text-sm outline-none focus:border-ring"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button size="sm" className="h-7" onClick={onSave}>
              Save
            </Button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
