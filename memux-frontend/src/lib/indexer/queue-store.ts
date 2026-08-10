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
import type { IndexerFileRef } from "@/lib/db/schema";

let pendingDraftWrites: Promise<void> = Promise.resolve();

function textSourceName(heading: string, fallbackIndex: number): string {
  const base = heading.trim() || `Pasted text ${fallbackIndex}`;
  const safe = base.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
  return `${safe || `Pasted text ${fallbackIndex}`}.md`;
}

function persistSources(id: string, files: IndexerFileRef[]): Promise<void> {
  pendingDraftWrites = pendingDraftWrites
    .catch(() => undefined)
    .then(() => updateDraft(id, { files }));
  return pendingDraftWrites;
}

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
  addTextToActive: () => Promise<void>;
  updateTextInActive: (
    sourceId: string,
    patch: { heading?: string; inlineText?: string },
  ) => Promise<void>;
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
    await pendingDraftWrites;
    await attachFiles(id, files);
    await get().refreshOne(id);
  },

  async addTextToActive() {
    const state = get();
    const id = state.activeId;
    const group = state.groups?.find((candidate) => candidate.id === id);
    if (!id || !group) return;
    const textIndex =
      group.files.filter((source) => source.sourceKind === "text").length + 1;
    const source: IndexerFileRef = {
      id: `t-${crypto.randomUUID()}`,
      sourceKind: "text",
      name: textSourceName("", textIndex),
      size: 0,
      mimeType: "text/markdown",
      heading: "",
      inlineText: "",
    };
    const files = [...group.files, source];
    set((current) => ({
      groups: (current.groups ?? []).map((candidate) =>
        candidate.id === id ? { ...candidate, files } : candidate,
      ),
    }));
    await persistSources(id, files);
  },

  async updateTextInActive(sourceId, patch) {
    const state = get();
    const id = state.activeId;
    const group = state.groups?.find((candidate) => candidate.id === id);
    if (!id || !group) return;
    const sourceIndex = group.files.findIndex((source) => source.id === sourceId);
    if (sourceIndex < 0) return;
    const currentSource = group.files[sourceIndex];
    if (currentSource.sourceKind !== "text") return;
    const heading = patch.heading ?? currentSource.heading ?? "";
    const inlineText = patch.inlineText ?? currentSource.inlineText ?? "";
    const textOrdinal =
      group.files
        .slice(0, sourceIndex + 1)
        .filter((source) => source.sourceKind === "text").length || 1;
    const nextSource: IndexerFileRef = {
      ...currentSource,
      ...patch,
      heading,
      inlineText,
      name: textSourceName(heading, textOrdinal),
      size: new Blob([inlineText]).size,
    };
    const files = group.files.map((source) =>
      source.id === sourceId ? nextSource : source,
    );
    set((current) => ({
      groups: (current.groups ?? []).map((candidate) =>
        candidate.id === id ? { ...candidate, files } : candidate,
      ),
    }));
    await persistSources(id, files);
  },

  async removeFromActive(fileRefId) {
    const id = get().activeId;
    if (!id) return;
    await pendingDraftWrites;
    await removeFile(id, fileRefId);
    await get().refreshOne(id);
  },

  async enqueueActive() {
    const id = get().activeId;
    if (!id) return;
    await pendingDraftWrites;
    await enqueue(id);
    await get().refreshOne(id);
  },

  async dequeueGroup(id) {
    await dequeue(id);
    await get().refreshOne(id);
  },

  async deleteGroupById(id) {
    await pendingDraftWrites;
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
