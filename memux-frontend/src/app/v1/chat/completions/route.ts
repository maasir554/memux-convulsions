import { getProvider } from "@/lib/memux/backend/registry";
import type { ChatRequest } from "@/lib/memux/backend/types";

// Force the Node runtime (not Edge) because the rotator + dev console.log
// helpers expect a Node environment and the Google fetch keeps a long-lived
// SSE connection — Node handles that more predictably than Edge runtimes.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Encode an async iterable of strings into a Web ReadableStream<Uint8Array>. */
function asyncIterableToStream(
  it: AsyncIterable<string>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of it) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[chat] stream error:", message);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: { message } })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json(
      { error: { message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

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
    const stream = asyncIterableToStream(provider.streamChat(body, req.signal));
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  try {
    const result = await provider.chat(body, req.signal);
    return Response.json(result as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[chat] non-stream error:", message);
    return Response.json({ error: { message } }, { status: 502 });
  }
}
