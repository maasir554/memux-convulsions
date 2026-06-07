"use client";

import { useEffect, useState } from "react";

import { readBlobUrl } from "@/lib/blob-store";
import { fetchBytes, renderPdfPageToDataUrl } from "@/lib/pdf-render";

type PdfPageState = {
  /** PNG data URL of the rendered page, once ready. */
  dataUrl: string | null;
  loading: boolean;
  error: boolean;
};

/**
 * Renders a single page of a PDF item to a PNG data URL on demand. Bytes come
 * from the OPFS blob (`blobKey`) or a public `src`; the result is memoised in
 * pdf-render's cache keyed by the source, so multiple figures on the same page
 * (or a re-mount) don't re-rasterise.
 */
export function usePdfPageDataUrl(opts: {
  blobKey?: string;
  src?: string;
  page: number;
}): PdfPageState {
  const { blobKey, src, page } = opts;
  // Key the resolved result by its inputs so `loading` can be derived (the
  // result is stale until its key matches the current inputs) — avoids a
  // synchronous setState reset inside the effect.
  const key = `${blobKey ?? src ?? ""}:${page}`;
  const [result, setResult] = useState<{
    key: string;
    dataUrl: string | null;
    error: boolean;
  }>({ key: "", dataUrl: null, error: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let url: string | null = null;
        let revoke = false;
        if (blobKey) {
          url = await readBlobUrl(blobKey);
          revoke = true;
        } else if (src) {
          url = src;
        }
        if (!url) throw new Error("PDF item has no blob or src");
        const bytes = await fetchBytes(url);
        if (revoke) URL.revokeObjectURL(url);
        const dataUrl = await renderPdfPageToDataUrl(bytes, page, {
          cacheKey: blobKey ?? src,
        });
        if (!cancelled) setResult({ key, dataUrl, error: false });
      } catch (err) {
        console.warn("[pdf-page] render failed", err);
        if (!cancelled) setResult({ key, dataUrl: null, error: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, blobKey, src, page]);

  const loading = result.key !== key;
  return {
    dataUrl: loading ? null : result.dataUrl,
    loading,
    error: loading ? false : result.error,
  };
}
