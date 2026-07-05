"use client";

import { useEffect, useState } from "react";

import { readBlobUrl } from "@/lib/blob-store";

/**
 * Resolves an OPFS blob key to an object URL with full lifecycle: revokes the
 * URL on unmount and on key change, and bails on race conditions if the key
 * changes mid-flight.
 */
export function useBlobUrl(blobKey: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    (async () => {
      if (!blobKey) {
        if (!cancelled) setUrl(null);
        return;
      }
      try {
        const next = await readBlobUrl(blobKey);
        if (cancelled) {
          URL.revokeObjectURL(next);
          return;
        }
        created = next;
        setUrl(next);
      } catch (err) {
        console.warn("[blob] failed to load", blobKey, err);
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [blobKey]);

  return url;
}
