import type { NextConfig } from "next";
import path from "node:path";

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
};

export default nextConfig;
