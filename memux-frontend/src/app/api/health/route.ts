import { getCloudProvider } from "@/lib/memux/backend/registry";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const provider = getCloudProvider();
  const result = await provider.health();
  // Don't leak key count or other infra details — `ok` is enough for the
  // frontend's health pill.
  return Response.json({
    provider: provider.id,
    ok: result.ok,
  });
}
