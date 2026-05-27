"use client";

import dynamic from "next/dynamic";

import { ViewerFallback } from "@/components/galexy/viewers/viewer-fallback";
import type { Note, PdfAnnotation } from "@/lib/mock-notes";

// The full viewer pulls in pdfjs (which can't be SSR'd), so defer the heavy
// implementation to a client-only dynamic import.
const PdfViewerImpl = dynamic(
  () => import("@/components/galexy/viewers/pdf-viewer-impl"),
  {
    ssr: false,
    loading: () => <ViewerFallback label="Loading PDF viewer…" />,
  },
);

export function PdfViewer({
  item,
  onAnnotationsChange,
}: {
  item: Note;
  onAnnotationsChange?: (annotations: PdfAnnotation[]) => void;
}) {
  return (
    <PdfViewerImpl item={item} onAnnotationsChange={onAnnotationsChange} />
  );
}
