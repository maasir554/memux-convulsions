/**
 * PDF preview for the chat attachment modal.
 *
 * Distinct from the vault's pdf-viewer (src/components/galexy/viewers/) —
 * that one carries Note coupling and a different annotation model. The chat
 * reader is its own surface: scroll through every page, zoom in/out, jump
 * to a page, optionally fit-to-width, and (Wave 2) draw + read annotations
 * shared with the rest of the team.
 *
 * Worker setup matches the vault viewer's: force the bundled worker URL so
 * we don't depend on Next's public/ routing.
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
  Loader2,
  Maximize2,
  Minus,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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

export function PdfPreview({ url }: { url: string }) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [containerWidth, setContainerWidth] = useState(800);
  const [currentPage, setCurrentPage] = useState(1);
  // `fitWidth` snaps the scale to whatever fills the container. When the
  // user manually zooms (toolbar or Ctrl+wheel) we unstick it so their
  // intent isn't overridden on the next render.
  const [fitWidth, setFitWidth] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  // The page-jump input is uncontrolled — we sync its value via a ref so
  // typing isn't fighting the intersection observer's currentPage updates.
  const jumpInputRef = useRef<HTMLInputElement | null>(null);

  // Container width drives both fit-to-width and the per-page render size.
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

  // Track which page is currently in view. We use IntersectionObserver
  // against each page wrapper and pick the most-visible one — robust to
  // partially scrolled pages.
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
      {
        root: containerRef.current,
        threshold: [0.05, 0.25, 0.5, 0.75, 0.95],
      },
    );
    for (const el of pageRefs.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, [numPages]);

  // Ctrl/Cmd + wheel = zoom. Without this the chrome zoom would fire (and
  // resize the whole modal). With it, zoom feels natural on a trackpad.
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

  const onLoad = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    pageRefs.current = new Array(numPages).fill(null);
  }, []);

  const jumpTo = useCallback((page: number) => {
    const clamped = Math.max(1, Math.min(page, pageRefs.current.length));
    const el = pageRefs.current[clamped - 1];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Push the observer-tracked page into the uncontrolled input — but only
  // when the user isn't actively editing it, so backspaces aren't
  // overwritten between observer ticks.
  useEffect(() => {
    const el = jumpInputRef.current;
    if (el && document.activeElement !== el) {
      el.value = String(currentPage);
    }
  }, [currentPage]);

  // Compute the effective page width given scale (or fitWidth).
  const pageWidth = useMemo(() => {
    const usable = Math.max(200, containerWidth - 32);
    return fitWidth ? usable : usable * scale;
  }, [containerWidth, scale, fitWidth]);

  const effectiveScalePct = useMemo(() => {
    // What "100%" means is the fit-to-width width; show the ratio so the
    // user knows what they're at even when they fit-clicked.
    const usable = Math.max(200, containerWidth - 32);
    return Math.round((pageWidth / usable) * 100);
  }, [containerWidth, pageWidth]);

  function applyManualScale(next: number) {
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)));
    setFitWidth(false);
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
              // Strip non-digits as you type.
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

        <span className="ml-auto text-[10px] text-muted-foreground">
          ⌘/Ctrl + scroll to zoom
        </span>
      </div>

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
          {Array.from({ length: numPages }, (_, i) => (
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
                renderTextLayer
                renderAnnotationLayer={false}
                className={cn("shadow-md bg-white")}
                loading={
                  <div className="flex h-40 w-full items-center justify-center text-xs text-muted-foreground">
                    <Loader2 className="mr-2 size-3.5 animate-spin" />
                    Page {i + 1}…
                  </div>
                }
              />
            </div>
          ))}
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
