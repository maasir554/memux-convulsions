"use client";

import { create } from "zustand";

import {
  appendScratch,
  attachFiles,
  createDraft,
  dequeue,
  deleteGroup,
  enqueue,
  loadGroup,
  loadGroups,
  removeFile,
  reorder,
  setStatus,
  updateDraft,
  type Group,
} from "@/lib/indexer/queue-db";
import { cancelRun } from "@/lib/indexer/runs-registry";
import type { RunStatus } from "@/lib/db/schema";

type IndexerStore = {
  /** null while the DB is loading. */
  groups: Group[] | null;
  /** The group currently shown in the editor pane. null = empty editor. */
  activeId: string | null;
  /** Re-entrancy guard for load(). */
  loading: boolean;

  load: () => Promise<void>;
  /** Re-read a single group from the DB and splice it into state. */
  refreshOne: (id: string) => Promise<void>;

  newDraft: () => Promise<string>;
  setActive: (id: string | null) => void;

  patchActive: (patch: {
    groupName?: string;
    prompt?: string;
  }) => Promise<void>;
  attachToActive: (files: File[]) => Promise<void>;
  removeFromActive: (fileRefId: string) => Promise<void>;
  enqueueActive: () => Promise<void>;
  dequeueGroup: (id: string) => Promise<void>;
  deleteGroupById: (id: string) => Promise<void>;
  cancelAndDelete: (id: string) => Promise<void>;
  reorderGroup: (id: string, newPos: number) => Promise<void>;

  /** Orchestrator-side helpers (Phase 2+). */
  applyStatus: (
    id: string,
    status: RunStatus,
    extra?: { scratchpadMd?: string; folderName?: string; error?: string },
  ) => Promise<void>;
  scratch: (id: string, line: string) => Promise<void>;
};

export const useIndexerStore = create<IndexerStore>((set, get) => ({
  groups: null,
  activeId: null,
  loading: false,

  async load() {
    if (get().loading) return;
    set({ loading: true });
    try {
      const groups = await loadGroups();
      set({ groups, loading: false });
      // If no active is selected, pick the first draft or running one.
      if (!get().activeId && groups.length > 0) {
        const running = groups.find(
          (g) => g.status !== "draft" && g.status !== "queued",
        );
        const draft = groups.find((g) => g.status === "draft");
        set({ activeId: (running ?? draft ?? groups[0]).id });
      }
    } catch (err) {
      console.warn("[indexer] load failed:", err);
      set({ loading: false });
    }
  },

  async refreshOne(id) {
    const updated = await loadGroup(id);
    set((s) => ({
      groups: (s.groups ?? []).map((g) =>
        g.id === id ? (updated ?? g) : g,
      ),
    }));
  },

  async newDraft() {
    const id = await createDraft();
    const fresh = await loadGroup(id);
    set((s) => ({
      groups: [fresh!, ...(s.groups ?? [])],
      activeId: id,
    }));
    return id;
  },

  setActive(id) {
    set({ activeId: id });
  },

  async patchActive(patch) {
    const id = get().activeId;
    if (!id) return;
    await updateDraft(id, patch);
    await get().refreshOne(id);
  },

  async attachToActive(files) {
    const id = get().activeId;
    if (!id || files.length === 0) return;
    await attachFiles(id, files);
    await get().refreshOne(id);
  },

  async removeFromActive(fileRefId) {
    const id = get().activeId;
    if (!id) return;
    await removeFile(id, fileRefId);
    await get().refreshOne(id);
  },

  async enqueueActive() {
    const id = get().activeId;
    if (!id) return;
    await enqueue(id);
    await get().refreshOne(id);
  },

  async dequeueGroup(id) {
    await dequeue(id);
    await get().refreshOne(id);
  },

  async deleteGroupById(id) {
    await deleteGroup(id);
    set((s) => ({
      groups: (s.groups ?? []).filter((g) => g.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    }));
  },

  async cancelAndDelete(id) {
    // 1. Mark cancelled in the DB first so any in-flight orchestrator writes
    //    that race the deletion update a "cancelled" row instead of trying
    //    to set "failed" on a row we're about to remove.
    try {
      await setStatus(id, "cancelled");
    } catch {
      // Status set may fail if the row's already gone — tolerable.
    }
    // 2. Abort the orchestrator's AbortController via the registry. Its
    //    next signal.aborted check throws "Cancelled" and the catch block
    //    marks the run cancelled (already done above as a backstop).
    cancelRun(id);
    // 3. Now safe to forcefully delete — the gate in deleteGroup is relaxed,
    //    and the orchestrator's subsequent writes hit a missing row (no-op).
    await deleteGroup(id);
    set((s) => ({
      groups: (s.groups ?? []).filter((g) => g.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    }));
  },

  async reorderGroup(id, newPos) {
    await reorder(id, newPos);
    await get().load();
  },

  async applyStatus(id, status, extra) {
    await setStatus(id, status, extra);
    await get().refreshOne(id);
  },

  async scratch(id, line) {
    await appendScratch(id, line);
    await get().refreshOne(id);
  },
}));

/** Convenience selector: the currently-active group. */
export function useActiveGroup(): Group | null {
  return useIndexerStore((s) => {
    if (!s.activeId || !s.groups) return null;
    return s.groups.find((g) => g.id === s.activeId) ?? null;
  });
}

// Stable empty-array reference. Returning `s.groups ?? []` directly from a
// zustand selector returns a fresh `[]` on every getSnapshot call, which
// React 19's useSyncExternalStore treats as a changing value and loops on.
const EMPTY_GROUPS: Group[] = [];

/** Convenience selector: the queue (draft + queued + running) for the sidebar. */
export function useQueuedGroups(): Group[] {
  return useIndexerStore((s) => s.groups ?? EMPTY_GROUPS);
}
