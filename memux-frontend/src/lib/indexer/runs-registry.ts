"use client";

/**
 * In-flight indexer runs — module-scoped registry that lets external callers
 * (the queue sidebar's cancel button, future programmatic stops) abort the
 * orchestrator's fetch chain for a specific runId.
 *
 * The supervisor registers an AbortController when a run starts and removes
 * it when the run finishes (success or failure). `cancelRun(runId)` aborts
 * the controller with a structured reason the orchestrator recognises and
 * marks the run as 'cancelled' instead of 'failed'.
 */

const inflight = new Map<string, AbortController>();

/** Sentinel string used as the abort reason for user-initiated cancellation. */
export const USER_CANCELLED = "user-cancelled";

export function register(runId: string, ac: AbortController): void {
  inflight.set(runId, ac);
}

export function unregister(runId: string): void {
  inflight.delete(runId);
}

/** Abort the run's orchestrator if it's still in flight. Returns true if a controller was hit. */
export function cancelRun(runId: string, reason: string = USER_CANCELLED): boolean {
  const ac = inflight.get(runId);
  if (!ac) return false;
  try {
    ac.abort(reason);
  } catch {
    // Older browsers throw if reason is provided; fall back to no-arg.
    ac.abort();
  }
  inflight.delete(runId);
  return true;
}

export function isCancelReason(value: unknown): boolean {
  return value === USER_CANCELLED || (value instanceof Error && /cancelled|aborted/i.test(value.message));
}
