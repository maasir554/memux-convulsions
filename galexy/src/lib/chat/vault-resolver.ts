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
import { and, asc, eq } from "drizzle-orm";

import { getVaultDb } from "@/lib/db/vault-db";
import { indexRuns, items, sections } from "@/lib/db/schema";
import type { ItemType } from "@/lib/mock-notes";

const CAPTURE_URL_RE = /^Captured from (.+)$/m;

export type VaultItemLite = {
  id: string;
  title: string;
  type: ItemType;
  folder: string;
  summary: string;
  blobKey?: string | null;
  src?: string | null;
  sourceUrl?: string | null;
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
            sourceUrl: items.sourceUrl,
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

/**
 * Given a section-note item id, resolve the source CAPTURE image that the
 * section was indexed from (if any). Returns null for non-section notes,
 * sections sourced from non-image origins (PDF/CSV/code/md), and for
 * sections from images that don't have a sourceUrl (old captures + manual
 * image uploads).
 *
 * Used by VaultCitation to render an inline "source" affordance under a
 * citation chip whenever the note traces back to a webpage capture.
 */
export type SectionCapture = VaultItemLite & {
  blobKey: string | null;
  sourceUrl: string | null;
};

const captureCache = new Map<string, SectionCapture | null>();

export function useSectionSourceCapture(noteItemId: string | null | undefined): {
  capture: SectionCapture | null;
  loading: boolean;
} {
  const [state, setState] = useState<{
    forId: string | null | undefined;
    capture: SectionCapture | null;
    loading: boolean;
  }>(() => {
    if (!noteItemId) return { forId: noteItemId, capture: null, loading: false };
    if (captureCache.has(noteItemId))
      return { forId: noteItemId, capture: captureCache.get(noteItemId) ?? null, loading: false };
    return { forId: noteItemId, capture: null, loading: true };
  });

  if (state.forId !== noteItemId) {
    if (!noteItemId) {
      setState({ forId: noteItemId, capture: null, loading: false });
    } else if (captureCache.has(noteItemId)) {
      setState({ forId: noteItemId, capture: captureCache.get(noteItemId) ?? null, loading: false });
    } else {
      setState({ forId: noteItemId, capture: null, loading: true });
    }
  }

  useEffect(() => {
    if (!noteItemId) return;
    if (captureCache.has(noteItemId)) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await getVaultDb();
        // sections row → sourceItemId → load the capture item if it's an image
        const [section] = await db
          .select({
            sourceItemId: sections.sourceItemId,
            runId: sections.runId,
            ordinal: sections.ordinal,
          })
          .from(sections)
          .where(eq(sections.noteItemId, noteItemId));
        if (!section) {
          captureCache.set(noteItemId, null);
          if (!cancelled) setState({ forId: noteItemId, capture: null, loading: false });
          return;
        }
        let row = section.sourceItemId
          ? (
              await db
                .select({
                  id: items.id,
                  title: items.title,
                  type: items.type,
                  folder: items.folder,
                  summary: items.summary,
                  blobKey: items.blobKey,
                  src: items.src,
                  sourceUrl: items.sourceUrl,
                })
                .from(items)
                .where(eq(items.id, section.sourceItemId))
            )[0]
          : undefined;
        // Backfill for sections indexed before the orchestrator started
        // populating sourceItemId on the row (the column existed but was
        // hardcoded to ""). Look up any image item in the run's captures
        // folder, sorted by title — cap-NN-MM titles sort naturally to
        // page order, so the section's ordinal-th picks the closest
        // match. Best-effort: for multi-page sections it may not be the
        // exact one, but the favicon / page-screenshot story still
        // reads. NOT persisted back since the choice is a heuristic.
        if (!row || row.type !== "image") {
          const [run] = await db
            .select({ groupName: indexRuns.groupName })
            .from(indexRuns)
            .where(eq(indexRuns.id, section.runId));
          if (run?.groupName) {
            const captureFolder = `_Indexes/${run.groupName}/captures`;
            const candidates = await db
              .select({
                id: items.id,
                title: items.title,
                type: items.type,
                folder: items.folder,
                summary: items.summary,
                blobKey: items.blobKey,
                src: items.src,
                sourceUrl: items.sourceUrl,
              })
              .from(items)
              .where(and(eq(items.folder, captureFolder), eq(items.type, "image")))
              .orderBy(asc(items.title));
            if (candidates.length > 0) {
              const idx = Math.min(Math.max(0, section.ordinal - 1), candidates.length - 1);
              row = candidates[idx];
            }
          }
        }
        if (!row || row.type !== "image") {
          captureCache.set(noteItemId, null);
          if (!cancelled) setState({ forId: noteItemId, capture: null, loading: false });
          return;
        }
        // Lazy backfill: captures indexed before sourceUrl existed don't
        // have it persisted. Fish it out of the run's prompt and write
        // back so subsequent reads (and any other UI that reads the row)
        // see it without re-parsing.
        let sourceUrl = row.sourceUrl;
        if (!sourceUrl) {
          const [run] = await db
            .select({ prompt: indexRuns.prompt })
            .from(indexRuns)
            .where(eq(indexRuns.id, section.runId));
          const url = run?.prompt ? CAPTURE_URL_RE.exec(run.prompt)?.[1]?.trim() : undefined;
          if (url) {
            sourceUrl = url;
            await db.update(items).set({ sourceUrl: url }).where(eq(items.id, row.id));
          }
        }
        const value: SectionCapture = {
          ...row,
          type: row.type as ItemType,
          sourceUrl,
        };
        captureCache.set(noteItemId, value);
        if (!cancelled) setState({ forId: noteItemId, capture: value, loading: false });
      } catch (err) {
        console.warn("[vault-resolver] section capture lookup failed for", noteItemId, err);
        if (!cancelled) setState({ forId: noteItemId, capture: null, loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteItemId]);

  return { capture: state.capture, loading: state.loading };
}
