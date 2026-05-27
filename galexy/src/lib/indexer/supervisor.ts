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

export function useIndexerSupervisor(): void {
  const groups = useIndexerStore((s) => s.groups);
  const inflightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Unmount-only abort. Kept in its own effect with empty deps — useEffect
  // cleanups also fire on every dependency change, so attaching the abort
  // to the [groups]-effect below would kill the active run the moment the
  // orchestrator's first status update mutated `groups`.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Pickup loop: when groups change, see if there's work to start. The
  // cleanup is intentionally empty — runs must survive the constant
  // groups-array churn the orchestrator generates as it narrates progress.
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
    const ac = new AbortController();
    abortRef.current = ac;

    (async () => {
      try {
        const next = await popNextForRun();
        if (!next) return;
        await useIndexerStore.getState().refreshOne(next.id);
        await runOne(next, { signal: ac.signal });
      } catch (err) {
        console.error("[supervisor] run failed:", err);
      } finally {
        inflightRef.current = false;
        // Re-load so the supervisor effect re-runs and can pick the next item.
        await useIndexerStore.getState().load();
      }
    })();
  }, [groups]);
}
