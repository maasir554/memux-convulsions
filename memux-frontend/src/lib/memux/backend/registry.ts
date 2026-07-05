import "server-only";

import { google } from "@/lib/memux/backend/google";
import type { Provider } from "@/lib/memux/backend/types";

/**
 * Backend currently serves a single cloud provider: Google AI Studio with
 * round-robin key rotation. Local providers (Lemonade, Ollama) are accessed
 * directly from the browser in "Direct" mode and don't pass through here.
 *
 * The provider instance is cached on `globalThis` so the KeyRotator's cursor
 * survives Next.js dev HMR cycles (a fresh module per reload would otherwise
 * reset the rotator to key #1 on every code change).
 */

type Cached = ReturnType<typeof google>;

declare global {
  var __memuxCloudProvider: Cached | undefined;
}

function getCached(): Cached {
  if (!globalThis.__memuxCloudProvider) {
    globalThis.__memuxCloudProvider = google();
  }
  return globalThis.__memuxCloudProvider;
}

export async function getProvider(): Promise<Provider> {
  return getCached();
}

export function getCloudProvider(): Cached {
  return getCached();
}
