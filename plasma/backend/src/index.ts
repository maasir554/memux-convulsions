import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { chatRoute } from "./routes/chat.js";
import { modelsRoute } from "./routes/models.js";
import { healthRoute } from "./routes/health.js";
import { settingsRoute } from "./routes/settings.js";
import { getCloudProvider } from "./providers/registry.js";

const app = new Hono();
app.use("*", logger());
app.use("*", cors());

app.route("/", chatRoute);
app.route("/", modelsRoute);
app.route("/", healthRoute);
app.route("/", settingsRoute);

app.get("/", (c) => c.text("plasma backend ok"));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  const provider = getCloudProvider();
  console.log(
    `plasma backend listening on http://localhost:${info.port} · ` +
      `provider=${provider.id} · keys=${provider.keyCount()}`,
  );
  if (provider.keyCount() === 0) {
    console.warn(
      "  ⚠  NUM_KEYS_GOOGLE is 0 — set keys in backend/.env to enable Cloud mode.",
    );
  }
});
