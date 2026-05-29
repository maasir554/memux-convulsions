"use client";

/**
 * Micro PDF preview — first page only, ~76px wide, intended for the
 * 1:1 thumbnail tiles in the activity stream. Dynamic-imported by
 * VaultItemThumb so the react-pdf chunk only loads when needed.
 *
 * Distinct from src/components/teams/pdf-thumb.tsx which is a chunkier
 * 224px chat-attachment preview with filename + size — different size
 * budget, different surrounding chrome.
 */

import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { FileBox } from "lucide-react";

import { useBlobUrl } from "@/components/galexy/use-blob-url";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

const DOC_OPTIONS = {
  cMapUrl: "https://unpkg.com/pdfjs-dist/cmaps/",
  cMapPacked: true,
} as const;

const PAGE_WIDTH = 76; // a touch smaller than the 84px tile to leave a margin

export function PdfMicroThumb({
  blobKey,
  src,
}: {
  blobKey: string | null;
  src: string | null;
}) {
  // OPFS-backed blob URLs come from the shared hook; src is the
  // already-public path for pre-shipped PDFs. Whichever resolves first wins.
  const blobUrl = useBlobUrl(blobKey ?? undefined);
  const url = blobUrl ?? src ?? null;

  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted/30">
        <FileBox className="size-4 text-rose-400/70" />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-start justify-center overflow-hidden bg-white">
      <Document
        file={url}
        options={DOC_OPTIONS}
        loading={null}
        error={
          <div className="flex h-full w-full items-center justify-center">
            <FileBox className="size-4 text-rose-400/70" />
          </div>
        }
      >
        <Page
          pageNumber={1}
          width={PAGE_WIDTH}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          loading={null}
          error={null}
        />
      </Document>
    </div>
  );
}
