import { getCloudProvider } from "@/lib/memux/backend/registry";

export const runtime = "nodejs";

/**
 * Settings on the cloud backend are read-only: everything is configured via
 * env. We still expose GET /api/settings so the frontend can render a status
 * row in Cloud mode without 404-spamming.
 */
export async function GET(): Promise<Response> {
  const provider = getCloudProvider();
  // Only surface whether the backend is *ready*, not the key count or any
  // other infrastructure detail. End-users / browser devtools shouldn't be
  // able to fingerprint our key rotation.
  return Response.json({
    provider: provider.id,
    ready: provider.keyCount() > 0,
    configurable: false,
  });
}

export async function PUT(): Promise<Response> {
  return Response.json(
    {
      error: {
        message:
          "Backend settings are read-only. Configure keys via .env.local (NUM_KEYS_GOOGLE, GOOGLE_AI_*).",
      },
    },
    { status: 405 },
  );
}
