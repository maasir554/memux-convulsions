import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Quiet capability check for optional auth/team services. The frontend is a
 * complete local workspace without the Worker, so an offline backend is a
 * normal state rather than a proxy error worth flooding the dev console with.
 */
export async function GET() {
  const backend =
    process.env.NEXT_PUBLIC_MEMUX_API_URL ?? "http://localhost:8787";

  try {
    const response = await fetch(`${backend.replace(/\/$/, "")}/healthz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(800),
    });
    return NextResponse.json({ available: response.ok });
  } catch {
    return NextResponse.json({ available: false });
  }
}
