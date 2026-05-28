import { Hono } from "hono";
import { getCloudProvider } from "../providers/registry.js";

/**
 * Settings on the cloud backend are read-only: everything is configured
 * via env. We still expose `/api/settings` so the frontend can render a
 * status row in Cloud mode without 404-spamming.
 */
export const settingsRoute = new Hono();

settingsRoute.get("/api/settings", async (c) => {
  const provider = getCloudProvider();
  // Only surface whether the backend is *ready*, not the key count or any
  // other infrastructure detail. End-users / browser devtools shouldn't be
  // able to fingerprint our key rotation.
  return c.json({
    provider: provider.id,
    ready: provider.keyCount() > 0,
    configurable: false,
  });
});

settingsRoute.put("/api/settings", async (c) => {
  return c.json(
    {
      error: {
        message:
          "Backend settings are read-only. Configure keys via backend/.env (NUM_KEYS_GOOGLE, GOOGLE_AI_*).",
      },
    },
    405,
  );
});
