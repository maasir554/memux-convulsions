/**
 * Round-robin API-key rotator for the cloud provider.
 *
 * Loading
 * -------
 * Reads `NUM_KEYS_GOOGLE` from the environment, then collects the keys named
 * `GOOGLE_AI_1` … `GOOGLE_AI_<NUM_KEYS_GOOGLE>`. Missing slots or blanks are
 * skipped with a warning. If `NUM_KEYS_GOOGLE` is unset/0, the rotator
 * contains no keys and callers should fail fast with a clear error.
 *
 * Rotation
 * --------
 * `next()` advances a cursor mod-`size()`, so consecutive calls cycle through
 * the keys evenly. Concurrent callers are fine: cursor increments are atomic
 * enough for our purposes (we don't care about a 1-key drift).
 *
 * Failover
 * --------
 * `runWithRotation(fn)` calls `fn(key)` and, if it throws `RetryWithNextKey`,
 * tries the next key. It will visit *every* key once before giving up so a
 * single dead key can't take down the whole backend.
 */

const MASK_VISIBLE = 4;

export function maskKey(key: string): string {
  if (key.length <= MASK_VISIBLE * 2) return "•".repeat(key.length);
  return `${key.slice(0, MASK_VISIBLE)}…${key.slice(-MASK_VISIBLE)}`;
}

export class RetryWithNextKey extends Error {
  constructor(public readonly cause: unknown) {
    super(`retry-with-next-key: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export class KeyRotator {
  private cursor = 0;

  constructor(private readonly keys: ReadonlyArray<string>) {}

  size(): number {
    return this.keys.length;
  }

  /** Next key, or undefined if none are configured. */
  next(): string | undefined {
    if (this.keys.length === 0) return undefined;
    const key = this.keys[this.cursor];
    this.cursor = (this.cursor + 1) % this.keys.length;
    return key;
  }

  /** Visit every key in order starting from current cursor. */
  *each(): Iterable<string> {
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[(this.cursor + i) % this.keys.length];
      if (k) yield k;
    }
    // advance cursor by one so successive `runWithRotation` calls don't
    // hammer the same key on every invocation
    if (this.keys.length > 0) {
      this.cursor = (this.cursor + 1) % this.keys.length;
    }
  }
}

export function loadGoogleKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const rawNum = env.NUM_KEYS_GOOGLE;
  const num = Number.parseInt(rawNum ?? "", 10);
  if (!Number.isFinite(num) || num <= 0) {
    return [];
  }
  const keys: string[] = [];
  const missing: number[] = [];
  for (let i = 1; i <= num; i++) {
    const v = env[`GOOGLE_AI_${i}`]?.trim();
    if (v) {
      keys.push(v);
    } else {
      missing.push(i);
    }
  }
  if (missing.length) {
    console.warn(
      `[keys] NUM_KEYS_GOOGLE=${num} but GOOGLE_AI_{${missing.join(",")}} ` +
        `are missing/blank. Loaded ${keys.length} of ${num}.`,
    );
  } else {
    console.log(`[keys] loaded ${keys.length} Google AI keys`);
  }
  return keys;
}

/**
 * Try `fn` with each key in the rotator (starting from the current cursor)
 * until one succeeds. Wrap a retryable failure in `RetryWithNextKey` to opt
 * into rotation; any other thrown error is treated as terminal.
 */
export async function runWithRotation<T>(
  rotator: KeyRotator,
  fn: (key: string, attempt: number) => Promise<T>,
): Promise<T> {
  if (rotator.size() === 0) {
    throw new Error(
      "No Google AI keys configured. Set NUM_KEYS_GOOGLE and GOOGLE_AI_* in backend/.env",
    );
  }
  let attempt = 0;
  let lastErr: unknown;
  for (const key of rotator.each()) {
    try {
      return await fn(key, attempt);
    } catch (err) {
      if (err instanceof RetryWithNextKey) {
        console.warn(
          `[keys] attempt ${attempt + 1}/${rotator.size()} key=${maskKey(key)} retrying: ${
            (err.cause as Error)?.message ?? err.cause
          }`,
        );
        lastErr = err.cause;
        attempt++;
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `All ${rotator.size()} Google AI keys failed. Last error: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}
