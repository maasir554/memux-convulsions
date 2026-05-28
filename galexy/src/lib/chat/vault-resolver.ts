"use client";

/**
 * Hook for the chat to resolve a citation's itemId → vault Note. Used by
 * VaultCitation (icon + title) and VaultImageEmbed (bytes + alt).
 *
 * We don't pre-load all vault items because the chat sits in its own
 * tree from /memux/chat/, separate from the vault. Each citation queries
 * directly by id; PGlite makes this near-free for small batches.
 */

import { useEffect, useState } from "react";
import { eq } from "drizzle-orm";

import { getVaultDb } from "@/lib/db/vault-db";
import { items } from "@/lib/db/schema";
import type { ItemType } from "@/lib/mock-notes";

export type VaultItemLite = {
  id: string;
  title: string;
  type: ItemType;
  folder: string;
  summary: string;
  blobKey?: string | null;
  src?: string | null;
};

const cache = new Map<string, VaultItemLite | null>();

export function useVaultItem(itemId: string | null | undefined): {
  item: VaultItemLite | null;
  loading: boolean;
} {
  // State is driven entirely by itemId; cache hits resolve synchronously
  // via the useState initialisers, so the effect only fires for genuine
  // cache misses. This avoids the react-hooks/set-state-in-effect lint —
  // we never call setState as a synchronous "redirect" inside the effect.
  const [state, setState] = useState<{
    forId: string | null | undefined;
    item: VaultItemLite | null;
    loading: boolean;
  }>(() => {
    if (!itemId) return { forId: itemId, item: null, loading: false };
    if (cache.has(itemId))
      return { forId: itemId, item: cache.get(itemId) ?? null, loading: false };
    return { forId: itemId, item: null, loading: true };
  });

  // Reset when itemId changes — also synchronous, so the new render
  // already shows the cached value (or loading=true) without a flash.
  if (state.forId !== itemId) {
    if (!itemId) {
      setState({ forId: itemId, item: null, loading: false });
    } else if (cache.has(itemId)) {
      setState({ forId: itemId, item: cache.get(itemId) ?? null, loading: false });
    } else {
      setState({ forId: itemId, item: null, loading: true });
    }
  }

  useEffect(() => {
    if (!itemId) return;
    if (cache.has(itemId)) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await getVaultDb();
        const [row] = await db
          .select({
            id: items.id,
            title: items.title,
            type: items.type,
            folder: items.folder,
            summary: items.summary,
            blobKey: items.blobKey,
            src: items.src,
          })
          .from(items)
          .where(eq(items.id, itemId));
        const value = (row as VaultItemLite | undefined) ?? null;
        cache.set(itemId, value);
        if (!cancelled) {
          setState({ forId: itemId, item: value, loading: false });
        }
      } catch (err) {
        console.warn("[vault-resolver] failed for", itemId, err);
        if (!cancelled) {
          setState({ forId: itemId, item: null, loading: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  return { item: state.item, loading: state.loading };
}
