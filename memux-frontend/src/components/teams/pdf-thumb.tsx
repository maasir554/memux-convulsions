/**
 * First-page thumbnail for a chat PDF attachment.
 *
 * Dynamic-imported by attachment-modal.tsx and team-room.tsx via next/dynamic
 * so the react-pdf chunk only ships when a chat actually contains a PDF.
 *
 * Rendering strategy:
 *   - Fixed-width box (~14rem) at a chosen aspect ratio (4:5, paperish).
 *   - <Page width={...}> sized to fit the box; overflow:hidden clips the
 *     bottom of A4-tall pages without distorting the render.
 *   - Filename + size sit BELOW the thumbnail, so the bubble looks like a
 *     file card with a poster, not like an oversized image.
 */

"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { File as FileIcon, Loader2 } from "lucide-react";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

// Reusing the same options object across renders keeps react-pdf from
// re-fetching every time something else re-renders the parent.
const DOC_OPTIONS = {
  cMapUrl: "https://unpkg.com/pdfjs-dist/cmaps/",
  cMapPacked: true,
} as const;

const THUMB_WIDTH = 224; // px — matches a w-56 box, fits nicely in bubbles

export function PdfThumb({
  url,
  filename,
  sizeLabel,
  onClick,
}: {
  url: string;
  filename: string;
  sizeLabel: string;
  onClick: () => void;
}) {
  const [pageLoaded, setPageLoaded] = useState(false);
  const [error, setError] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${filename} — open preview`}
      className="block w-56 overflow-hidden rounded-lg border bg-card text-left transition hover:ring-2 hover:ring-primary/40"
    >
      {/* Fixed-aspect frame — bottom of tall pages clips, which is fine
          for a poster. */}
      <div
        className="relative w-full overflow-hidden bg-muted"
        style={{ aspectRatio: "4 / 5" }}
      >
        {!pageLoaded && !error && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground">
            <FileIcon className="size-5" />
            PDF
          </div>
        )}
        <Document
          file={url}
          onLoadError={() => setError(true)}
          options={DOC_OPTIONS}
          loading={null}
          error={null}
          className="absolute inset-0"
        >
          <Page
            pageNumber={1}
            width={THUMB_WIDTH}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            onRenderSuccess={() => setPageLoaded(true)}
            loading={null}
            error={null}
            className="bg-white"
          />
        </Document>
      </div>
      {/* Metadata row below the thumbnail */}
      <div className="flex items-center gap-2 px-3 py-2">
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{filename}</div>
          <div className="text-[10px] text-muted-foreground">{sizeLabel}</div>
        </div>
      </div>
    </button>
  );
}
