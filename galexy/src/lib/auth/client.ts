/**
 * Better-Auth client for memux-backend.
 *
 * Talks to the backend via SAME-ORIGIN paths (/api/auth/*). next.config.ts
 * rewrites those to the Worker. This is what makes the session cookie
 * first-party to the frontend origin in production — without it, vercel.app
 * fetching workers.dev would set a third-party cookie that modern browsers
 * routinely drop (Chrome tracking protection, Safari ITP, public-suffix
 * rules on .vercel.app).
 *
 * `credentials: "include"` is still useful: with an absolute baseURL, fetch
 * defaults to omitting cookies in some setups. We force-include and rely on
 * the browser treating them as first-party because the URL's host is the
 * page's own host.
 */

"use client";

import { createAuthClient } from "better-auth/react";

// Use the current origin as baseURL in the browser. During SSR (window
// undefined) we fall back to a placeholder; the auth client is only
// invoked from client code so the SSR value is never actually used.
const baseURL =
  typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:3000";

export const authClient = createAuthClient({
  baseURL,
  fetchOptions: { credentials: "include" },
});

export const { signIn, signOut, useSession } = authClient;
