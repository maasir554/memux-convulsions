"use client";

import { ViewerFallback } from "@/components/galexy/viewers/viewer-fallback";
import type { Note } from "@/lib/mock-notes";

export function PdfViewer({ item }: { item: Note }) {
  if (!item.src) {
    return <ViewerFallback label="No PDF source set for this file." />;
  }
  return (
    <iframe
      src={item.src}
      title={item.title}
      className="h-full w-full border-0 bg-white"
    />
  );
}
