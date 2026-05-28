/**
 * Lightweight PDF preview for the chat attachment modal.
 *
 * Distinct from the vault's pdf-viewer (src/components/galexy/viewers/) —
 * that one carries annotation editing, bbox tracking and Note coupling. The
 * chat modal just wants "render every page top-to-bottom, let the user
 * scroll". So we skip the framework around it and call react-pdf directly.
 *
 * Worker setup matches the vault viewer's: force the bundled worker URL so
 * we don't depend on Next's public/ routing.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Loader2, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.2;
const DEFAULT_SCALE = 1.0;

export function PdfPreview({ url }: { url: string }) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [containerWidth, setContainerWidth] = useState(800);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Track the container width so a page is sized to the modal, not the
  // viewport. Re-measures on container resize.
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

  const onLoad = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Tiny toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-background/80 px-3 text-xs">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP))}
          aria-label="Zoom out"
          disabled={scale <= MIN_SCALE}
        >
          <Minus className="size-3.5" />
        </Button>
        <span className="w-12 text-center tabular-nums text-muted-foreground">
          {Math.round(scale * 100)}%
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP))}
          aria-label="Zoom in"
          disabled={scale >= MAX_SCALE}
        >
          <Plus className="size-3.5" />
        </Button>
        {numPages > 0 && (
          <span className="ml-auto text-muted-foreground">
            {numPages} page{numPages === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Pages */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-muted/30 px-4 py-4"
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
            <Page
              key={i}
              pageNumber={i + 1}
              width={Math.max(200, (containerWidth - 32) * scale)}
              renderTextLayer
              renderAnnotationLayer={false}
              className={cn("shadow-md", "bg-white")}
              loading={
                <div className="flex h-40 w-full items-center justify-center text-xs text-muted-foreground">
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                  Page {i + 1}…
                </div>
              }
            />
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
