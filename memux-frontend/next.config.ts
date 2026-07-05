import type { NextConfig } from "next";
import path from "node:path";

// memux-backend Worker URL. Identical value used:
//   - here, to proxy /api/auth, /api/me, /api/teams (HTTP), /api/attachments
//   - at runtime by the WebSocket client (use-team-room) for the direct
//     wss:// connection
//
// Defaults to local dev. In Vercel, set NEXT_PUBLIC_MEMUX_API_URL to the
// production workers.dev URL.
const memuxApi =
  process.env.NEXT_PUBLIC_MEMUX_API_URL ?? "http://localhost:8787";

const nextConfig: NextConfig = {
  // Pin the workspace root to this app. A root-level package.json (from the
  // shadcn MCP install) otherwise makes Next infer the monorepo root.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Univer owns its own React root; dev Strict Mode's double-mount makes the
  // heavy initialisation run twice and races the unmount, freezing the page.
  // Single-mount in dev avoids that without affecting production behaviour.
  reactStrictMode: false,

  /**
   * Same-origin proxy to memux-backend.
   *
   * Why: the browser session cookie set by Better-Auth has to be first-party
   * for the OAuth + session flow to survive third-party cookie restrictions
   * (Chrome's tracking protection, Safari ITP, .vercel.app being a public
   * suffix). Proxying /api/auth/* + /api/me + /api/teams/* + /api/attachments/*
   * through Next means the browser only ever sees vercel.app for HTTP, and
   * the session cookie lives on vercel.app.
   *
   * The WebSocket (`/api/teams/:id/ws`) deliberately stays OUT of these
   * rewrites — Vercel doesn't proxy WebSocket upgrades. It connects directly
   * to workers.dev with a short-lived signed `?ws_token=` minted by the
   * proxied `/api/teams/:id/ws-token` endpoint.
   */
  async rewrites() {
    return [
      { source: "/api/auth/:path*", destination: `${memuxApi}/api/auth/:path*` },
      { source: "/api/me", destination: `${memuxApi}/api/me` },
      { source: "/api/teams", destination: `${memuxApi}/api/teams` },
      { source: "/api/teams/:path*", destination: `${memuxApi}/api/teams/:path*` },
      { source: "/api/attachments/:path*", destination: `${memuxApi}/api/attachments/:path*` },
    ];
  },
};

export default nextConfig;
