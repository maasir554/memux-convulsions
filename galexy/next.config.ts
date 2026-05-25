import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this app. A root-level package.json (from the
  // shadcn MCP install) otherwise makes Next infer the monorepo root.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
