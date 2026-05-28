import { Hono } from "hono";
import { getCloudProvider } from "../providers/registry.js";

export const healthRoute = new Hono();

healthRoute.get("/api/health", async (c) => {
  const provider = getCloudProvider();
  const result = await provider.health();
  // Don't leak key count or other infra details — `ok` is enough for the
  // frontend's health pill.
  return c.json({
    provider: provider.id,
    ok: result.ok,
  });
});
