import { Hono } from "hono";
import { stream } from "hono/streaming";
import { getProvider } from "../providers/registry.js";
import type { ChatRequest } from "../providers/types.js";

export const chatRoute = new Hono();

chatRoute.post("/v1/chat/completions", async (c) => {
  const body = (await c.req.json()) as ChatRequest;
  const hasImages = body.messages?.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((p) => p.type === "image_url"),
  );
  console.log(
    `[chat] model=${body.model} stream=${body.stream} ` +
      `messages=${body.messages?.length} images=${hasImages} think=${body.think}`,
  );

  const provider = await getProvider();

  if (body.stream) {
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    return stream(c, async (s) => {
      const ctl = new AbortController();
      s.onAbort(() => ctl.abort());
      try {
        for await (const chunk of provider.streamChat(body, ctl.signal)) {
          await s.write(chunk);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[chat] stream error:", message);
        await s.write(
          `data: ${JSON.stringify({ error: { message } })}\n\n`,
        );
      }
    });
  }

  const ctl = new AbortController();
  try {
    const result = await provider.chat(body, ctl.signal);
    return c.json(result as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[chat] non-stream error:", message);
    return c.json({ error: { message } }, 502);
  }
});
