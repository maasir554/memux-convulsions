import {
  DEFAULT_LOCOMO_MODEL,
  runLocomoEvaluation,
  type LocomoEvent,
  type LocomoItemResult,
} from "@/lib/evals/locomo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby validates every App Router function at build time and caps
// execution at 300 seconds, even when this evaluation route is never called.
export const maxDuration = 300;

type RequestBody = {
  model?: string;
  concurrency?: number;
  previousResults?: LocomoItemResult[];
};

export async function POST(request: Request): Promise<Response> {
  let body: RequestBody = {};
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    // An empty body is valid and uses the pinned defaults.
  }

  const encoder = new TextEncoder();
  const runController = new AbortController();
  request.signal.addEventListener("abort", () => runController.abort(), { once: true });
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15_000);
      const emit = (event: LocomoEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      void runLocomoEvaluation({
        model: body.model || DEFAULT_LOCOMO_MODEL,
        concurrency: body.concurrency,
        existingResults: body.previousResults,
        signal: runController.signal,
        onEvent: emit,
      })
        .catch((error) => {
          if (runController.signal.aborted || closed) return;
          emit({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          clearInterval(heartbeat);
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
    },
    cancel() {
      closed = true;
      runController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
