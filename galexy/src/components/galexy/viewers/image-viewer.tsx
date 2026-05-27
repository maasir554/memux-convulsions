"use client";

import { ViewerFallback } from "@/components/galexy/viewers/viewer-fallback";
import { useBlobUrl } from "@/components/galexy/use-blob-url";
import type { Note } from "@/lib/mock-notes";

export function ImageViewer({ item }: { item: Note }) {
  const blobUrl = useBlobUrl(item.blobKey);
  const src = item.blobKey ? blobUrl : item.src;

  if (item.blobKey && !blobUrl) {
    return <ViewerFallback label="Loading image…" />;
  }
  if (!src) {
    return <ViewerFallback label="No image source set for this file." />;
  }
  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-muted/20 p-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={item.title}
        className="max-h-full max-w-full rounded-md object-contain shadow-sm"
      />
    </div>
  );
}
