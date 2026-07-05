"use client";

/**
 * Indexer supervisor — a React hook that auto-runs queued groups.
 *
 * Lives in the browser tab. While the user keeps the indexer page (or any
 * page that mounts this hook) open, queued groups are picked up FIFO and
 * processed. Closing the tab pauses things — the scratchpad survives in
 * PGlite and resumption picks up on next open.
 *
 * Only one run is in-flight per tab. The supervisor refuses to start a
 * second run while one is running.
 */

import { useEffect, useRef } from "react";

import { popNextForRun } from "@/lib/indexer/queue-db";
import { runOne } from "@/lib/indexer/orchestrator";
import { useIndexerStore } from "@/lib/indexer/queue-store";
import { register, unregister } from "@/lib/indexer/runs-registry";

export function useIndexerSupervisor(): void {
  const groups = useIndexerStore((s) => s.groups);
  const inflightRef = useRef(false);

  // No abort on unmount. An in-flight run should complete silently if the
  // user navigates away — its state lives in PGlite, and the live-progress
  // store repopulates from emit calls the moment the indexer page re-mounts.
  //
  // The previous abort-on-unmount caused intermittent "signal is aborted
  // without reason" failures: any brief remount (HMR, parent reconciliation,
  // React 19 reactivity quirks in dev) fired the cleanup mid-run, which
  // aborted the active Visioner fetch. Better to let the run finish — the
  // worst case is some wasted LLM tokens if the user never returns.
  useEffect(() => {
    if (!groups) return;
    if (inflightRef.current) return;
    const hasQueued = groups.some((g) => g.status === "queued");
    const hasRunning = groups.some(
      (g) =>
        g.status !== "draft" &&
        g.status !== "queued" &&
        g.status !== "done" &&
        g.status !== "failed" &&
        g.status !== "cancelled",
    );
    if (!hasQueued || hasRunning) return;

    inflightRef.current = true;
    // Signal is threaded through for future use (a user-initiated cancel
    // button, say) but is never aborted from this hook.
    const ac = new AbortController();

    (async () => {
      let registeredRunId: string | null = null;
      try {
        const next = await popNextForRun();
        if (!next) return;
        await useIndexerStore.getState().refreshOne(next.id);
        // Make the AbortController externally addressable so the queue
        // sidebar's cancel button (and any future programmatic stop) can
        // hit it.
        register(next.id, ac);
        registeredRunId = next.id;
        await runOne(next, { signal: ac.signal });
      } catch (err) {
        console.error("[supervisor] run failed:", err);
      } finally {
        if (registeredRunId) unregister(registeredRunId);
        inflightRef.current = false;
        // Re-load so the supervisor effect re-runs and can pick the next item.
        await useIndexerStore.getState().load();
      }
    })();
  }, [groups]);
}
