/**
 * Better-Auth client for memux-backend.
 *
 * Reads NEXT_PUBLIC_MEMUX_API_URL from the env (set in .env.local). All
 * requests go cross-origin to the Worker; the client forwards credentials
 * so the session cookie flows both directions.
 *
 * Locally, localhost:3000 ↔ localhost:8787 are same-site (just different
 * ports), so SameSite=Lax cookies set by the Worker reach the browser on
 * cross-origin fetches. In production (Vercel ↔ workers.dev / custom),
 * the Worker switches to SameSite=None; Secure automatically.
 */

"use client";

import { createAuthClient } from "better-auth/react";

const baseURL =
  process.env.NEXT_PUBLIC_MEMUX_API_URL ?? "http://localhost:8787";

export const authClient = createAuthClient({
  baseURL,
  fetchOptions: { credentials: "include" },
});

export const { signIn, signOut, useSession } = authClient;
