import { Hono } from "hono";
import { getProvider } from "../providers/registry.js";

export const modelsRoute = new Hono();

modelsRoute.get("/v1/models", async (c) => {
  const provider = await getProvider();
  const models = await provider.listModels();
  return c.json({ object: "list", data: models });
});
