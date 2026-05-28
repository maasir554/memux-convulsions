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
  /** Total nodes in the pruned tree, or 0 if no tree. */
  treeNodes: number;
  /** Headings extracted into the document outline. */
  outlineHeadings: number;
  /** Markdown links produced from tree {text→href} enrichment so far. */
  linksEnriched: number;
  /** DOM images materialised as vault items so far. */
  domImages: number;

  recentActions: string[];
  /**
   * Transient "this is happening RIGHT NOW" marker the orchestrator sets
   * before each agent call / write step and clears immediately after.
   * Rendered in the agent timeline as a shimmering row at the bottom.
   */
  currentAction: CurrentAction;
};

/**
 * Live action label rendered with a shimmer below the timeline tail. Verb
 * is rendered as `verb…` and animated; subject sits in front as a tiny
 * mono prefix ("p7", "§3", "the group", etc.).
 */
export type CurrentAction =
  | {
      verb:
        | "reading"
        | "viewing"
        | "scanning"
        | "summarising"
        | "naming"
        | "writing"
        | "saving"
        | "embedding"
        | "preparing";
      subject?: string;
    }
  | null;

type Actions = {
  startRun: (runId: string, groupName: string, totalFiles: number, treeUsed: boolean) => void;
  setPhase: (phase: LivePhase) => void;
  /**
   * Populate the thumbnail strip up-front with every slot we know about
   * (one per image file, one per PDF page) as `status: "pending"`. The
   * orchestrator promotes them to `active` / `done` as it processes.
   */
  seedPendingThumbnails: (
    items: Array<{ fileIndex: number; ordinal: number; thumbDataUrl: string }>,
  ) => void;
  startFile: (name: string, indexInGroup: number) => void;
  setActivePage: (ordinal: number, fullDataUrl: string, thumbDataUrl?: string) => void;
  markPageDone: (ordinal: number) => void;
  setCurrentTopic: (topic: string) => void;
  bumpSection: (conceptsAdded: number) => void;
  pushAction: (text: string) => void;
  setTreeNodes: (n: number) => void;
  setOutlineHeadings: (n: number) => void;
  bumpLinksEnriched: (n: number) => void;
  bumpDomImages: (n: number) => void;
  setCurrentAction: (action: CurrentAction) => void;
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
  treeNodes: 0,
  outlineHeadings: 0,
  linksEnriched: 0,
  domImages: 0,
  recentActions: [],
  currentAction: null,
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
  seedPendingThumbnails(items) {
    set((s) => {
      // Index existing thumbs by key so we don't overwrite ones that have
      // already been promoted to active/done if seedPendingThumbnails is
      // called late (defensive).
      const byKey = new Map(s.thumbnails.map((t) => [t.key, t] as const));
      for (const item of items) {
        const key = `${item.fileIndex}:${item.ordinal}`;
        if (byKey.has(key)) continue;
        byKey.set(key, {
          key,
          fileIndex: item.fileIndex,
          ordinal: item.ordinal,
          thumbDataUrl: item.thumbDataUrl,
          status: "pending",
        });
      }
      const next = Array.from(byKey.values()).sort(
        (a, b) => a.fileIndex - b.fileIndex || a.ordinal - b.ordinal,
      );
      return { thumbnails: next };
    });
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
  setTreeNodes(n) {
    set({ treeNodes: n });
  },
  setOutlineHeadings(n) {
    set({ outlineHeadings: n });
  },
  bumpLinksEnriched(n) {
    set((s) => ({ linksEnriched: s.linksEnriched + n }));
  },
  bumpDomImages(n) {
    set((s) => ({ domImages: s.domImages + n }));
  },
  setCurrentAction(action) {
    set({ currentAction: action });
  },
  finish(success) {
    set({ phase: success ? "done" : "failed" });
  },
  reset() {
    set({ ...initial });
  },
}));
