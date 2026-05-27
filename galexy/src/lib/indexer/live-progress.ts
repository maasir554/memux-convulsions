"use client";

import { create } from "zustand";

/**
 * In-memory live progress for the currently-running indexer run. The
 * orchestrator writes to this at every checkpoint; the live-view panel
 * subscribes. Nothing here is persisted — it's purely UI state.
 *
 * One run at a time per tab (the supervisor guarantees this), so the store
 * holds a single run's state. `phase: "idle"` means nothing is running and
 * the live panel hides.
 */

export type LivePhase =
  | "idle"
  | "preparing"
  | "walking"
  | "summarising"
  | "embedding"
  | "naming"
  | "finalising"
  | "done"
  | "failed";

export type LiveThumbnail = {
  /** Unique within the run — "${fileIndex}:${ordinal}". */
  key: string;
  fileIndex: number;
  ordinal: number;
  thumbDataUrl: string;
  status: "pending" | "active" | "done";
};

export type LiveProgress = {
  runId: string | null;
  groupName: string;
  phase: LivePhase;

  activeFileName: string | null;
  activeFileIndex: number;
  totalFiles: number;

  activePageOrdinal: number | null;
  activePageDataUrl: string | null;
  /**
   * Accumulates across files: each (fileIndex, ordinal) pair becomes a
   * thumbnail. For PDFs that's pages; for multi-image worksmith groups it's
   * the files themselves. Active highlights the current one; older ones
   * stay visible as "done".
   */
  thumbnails: LiveThumbnail[];

  currentTopic: string;
  sectionsClosed: number;
  conceptsFound: number;
  /** True when the group's prompt carries an a11y tree (worksmith captures). */
  treeUsed: boolean;

  recentActions: string[];
};

type Actions = {
  startRun: (runId: string, groupName: string, totalFiles: number, treeUsed: boolean) => void;
  setPhase: (phase: LivePhase) => void;
  startFile: (name: string, indexInGroup: number) => void;
  setActivePage: (ordinal: number, fullDataUrl: string, thumbDataUrl?: string) => void;
  markPageDone: (ordinal: number) => void;
  setCurrentTopic: (topic: string) => void;
  bumpSection: (conceptsAdded: number) => void;
  pushAction: (text: string) => void;
  finish: (success: boolean) => void;
  reset: () => void;
};

const initial: LiveProgress = {
  runId: null,
  groupName: "",
  phase: "idle",
  activeFileName: null,
  activeFileIndex: 0,
  totalFiles: 0,
  activePageOrdinal: null,
  activePageDataUrl: null,
  thumbnails: [],
  currentTopic: "",
  sectionsClosed: 0,
  conceptsFound: 0,
  treeUsed: false,
  recentActions: [],
};

export const useLiveProgress = create<LiveProgress & Actions>((set) => ({
  ...initial,

  startRun(runId, groupName, totalFiles, treeUsed) {
    set({
      ...initial,
      runId,
      groupName,
      totalFiles,
      treeUsed,
      phase: "preparing",
    });
  },
  setPhase(phase) {
    set({ phase });
  },
  startFile(name, indexInGroup) {
    // Don't clear `thumbnails` — they accumulate across files so the strip
    // shows progress through the whole group. Only file-active state resets.
    set({
      activeFileName: name,
      activeFileIndex: indexInGroup,
      activePageOrdinal: null,
      activePageDataUrl: null,
    });
  },
  setActivePage(ordinal, fullDataUrl, thumbDataUrl) {
    set((s) => {
      const key = `${s.activeFileIndex}:${ordinal}`;
      const promoted = s.thumbnails.map((t) =>
        t.status === "active" ? { ...t, status: "done" as const } : t,
      );
      const idx = promoted.findIndex((t) => t.key === key);
      if (idx === -1) {
        promoted.push({
          key,
          fileIndex: s.activeFileIndex,
          ordinal,
          thumbDataUrl: thumbDataUrl ?? fullDataUrl,
          status: "active",
        });
      } else {
        promoted[idx] = {
          ...promoted[idx],
          thumbDataUrl: thumbDataUrl ?? promoted[idx].thumbDataUrl,
          status: "active",
        };
      }
      // Stable order: by fileIndex, then ordinal.
      promoted.sort((a, b) =>
        a.fileIndex - b.fileIndex || a.ordinal - b.ordinal,
      );
      return {
        activePageOrdinal: ordinal,
        activePageDataUrl: fullDataUrl,
        thumbnails: promoted,
      };
    });
  },
  markPageDone(ordinal) {
    set((s) => {
      const key = `${s.activeFileIndex}:${ordinal}`;
      return {
        thumbnails: s.thumbnails.map((t) =>
          t.key === key ? { ...t, status: "done" as const } : t,
        ),
      };
    });
  },
  setCurrentTopic(topic) {
    set({ currentTopic: topic });
  },
  bumpSection(conceptsAdded) {
    set((s) => ({
      sectionsClosed: s.sectionsClosed + 1,
      conceptsFound: s.conceptsFound + conceptsAdded,
    }));
  },
  pushAction(text) {
    set((s) => ({
      recentActions: [text, ...s.recentActions].slice(0, 6),
    }));
  },
  finish(success) {
    set({ phase: success ? "done" : "failed" });
  },
  reset() {
    set({ ...initial });
  },
}));
