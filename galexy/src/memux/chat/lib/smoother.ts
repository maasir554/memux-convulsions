/**
 * Steady-cadence buffer between a bursty stream source (SSE chunks) and a UI
 * sink. SSE deltas arrive in lumps of 20–200 characters at unpredictable
 * intervals, which makes the message text jitter as it grows. The smoother
 * absorbs each delta into a queue and a requestAnimationFrame loop drains it
 * at ~60 chars/second, so the user sees a clean typewriter-like flow
 * regardless of how the upstream server happens to chunk things.
 *
 * Catch-up: if the queue grows large the drain rate scales proportionally,
 * so a fast model doesn't fall arbitrarily far behind real-time.
 */

export type Smoother = {
  /** Append more text to the drain queue. */
  push(text: string): void;
  /** Resolve once the queue is fully drained at the smoothed rate. */
  end(): Promise<void>;
  /** Stop immediately and discard whatever's left in the queue. */
  abort(): void;
};

export type SmootherOptions = {
  /** Steady-state drain rate when the queue is short, characters/second. */
  baseRate?: number;
  /** Queue length above which we start accelerating to catch up. */
  catchupThreshold?: number;
};

export function makeSmoother(
  onChars: (text: string) => void,
  options: SmootherOptions = {},
): Smoother {
  const baseRate = options.baseRate ?? 60;
  const catchupThreshold = options.catchupThreshold ?? 80;

  let queue = "";
  let rafHandle: number | null = null;
  let lastTick = 0;
  let endResolve: (() => void) | null = null;
  let aborted = false;

  function tick(now: number) {
    if (aborted) return;
    if (lastTick === 0) lastTick = now;
    const elapsedSec = (now - lastTick) / 1000;

    // Rate scales linearly above the catch-up threshold.
    const rate = Math.max(
      baseRate,
      (queue.length / catchupThreshold) * baseRate,
    );
    const toEmit = Math.max(1, Math.floor(elapsedSec * rate));

    if (queue.length > 0 && toEmit > 0) {
      const slice = queue.slice(0, toEmit);
      queue = queue.slice(toEmit);
      lastTick = now;
      try {
        onChars(slice);
      } catch (e) {
        // Don't let an exception in the sink break the loop.
        console.error("[smoother] sink threw:", e);
      }
    }

    if (queue.length > 0) {
      rafHandle = requestAnimationFrame(tick);
    } else {
      rafHandle = null;
      lastTick = 0;
      if (endResolve) {
        const resolve = endResolve;
        endResolve = null;
        resolve();
      }
    }
  }

  return {
    push(text) {
      if (!text || aborted) return;
      queue += text;
      if (rafHandle === null) {
        rafHandle = requestAnimationFrame(tick);
      }
    },

    end() {
      if (aborted) return Promise.resolve();
      if (queue.length === 0 && rafHandle === null) return Promise.resolve();
      return new Promise<void>((resolve) => {
        endResolve = resolve;
        // Kick the loop if it isn't running for some reason.
        if (rafHandle === null && queue.length > 0) {
          rafHandle = requestAnimationFrame(tick);
        }
      });
    },

    abort() {
      aborted = true;
      queue = "";
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
      if (endResolve) {
        const resolve = endResolve;
        endResolve = null;
        resolve();
      }
    },
  };
}
