import "server-only";

/**
 * Round-robin API-key rotator for the cloud provider.
 *
 * Loading
 * -------
 * Reads `NUM_KEYS_GOOGLE` from the environment, then collects keys named
 * `GOOGLE_AI_1` … `GOOGLE_AI_<NUM_KEYS_GOOGLE>`. Missing slots are skipped
 * with a warning. If `NUM_KEYS_GOOGLE` is unset/0 the rotator is empty and
 * callers fail fast with a clear error.
 *
 * Rotation
 * --------
 * `each()` yields every key once starting from the current cursor; the cursor
 * advances by one after each call so successive `runWithRotation` invocations
 * don't hammer the same key first every time.
 *
 * Failover
 * --------
 * `runWithRotation(fn)` tries `fn(key)` and retries with the next key on
 * `RetryWithNextKey`. Any other thrown error is treated as terminal.
 */

const MASK_VISIBLE = 4;

export function maskKey(key: string): string {
  if (key.length <= MASK_VISIBLE * 2) return "•".repeat(key.length);
  return `${key.slice(0, MASK_VISIBLE)}…${key.slice(-MASK_VISIBLE)}`;
}

export class RetryWithNextKey extends Error {
  constructor(public readonly cause: unknown) {
    super(
      `retry-with-next-key: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}

export class KeyRotator {
  private cursor = 0;

  constructor(private readonly keys: ReadonlyArray<string>) {}

  size(): number {
    return this.keys.length;
  }

  next(): string | undefined {
    if (this.keys.length === 0) return undefined;
    const key = this.keys[this.cursor];
    this.cursor = (this.cursor + 1) % this.keys.length;
    return key;
  }

  *each(): Iterable<string> {
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[(this.cursor + i) % this.keys.length];
      if (k) yield k;
    }
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

export async function runWithRotation<T>(
  rotator: KeyRotator,
  fn: (key: string, attempt: number) => Promise<T>,
): Promise<T> {
  if (rotator.size() === 0) {
    throw new Error(
      "No Google AI keys configured. Set NUM_KEYS_GOOGLE and GOOGLE_AI_* in .env.local",
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
          `[keys] attempt ${attempt + 1}/${rotator.size()} key=${maskKey(
            key,
          )} retrying: ${(err.cause as Error)?.message ?? err.cause}`,
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
