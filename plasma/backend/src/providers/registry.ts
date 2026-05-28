import { google } from "../cloud/google.js";
import type { Provider } from "./types.js";

/**
 * Backend currently serves a single cloud provider: Google AI Studio with
 * round-robin key rotation. Local providers (Lemonade, Ollama) are accessed
 * directly from the frontend in "Local" mode and don't pass through here.
 *
 * A singleton instance is kept so the KeyRotator's cursor persists across
 * requests (otherwise every request would start from key #1).
 */

let cached: ReturnType<typeof google> | null = null;

export async function getProvider(): Promise<Provider> {
  if (!cached) cached = google();
  return cached;
}

export function getCloudProvider(): ReturnType<typeof google> {
  if (!cached) cached = google();
  return cached;
}
