import { getProvider } from "@/lib/memux/backend/registry";
import type { EmbedRequest } from "@/lib/memux/backend/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  /** OpenAI-shape alias. Also accepts `texts`. */
  input?: string | string[];
  texts?: string[];
  model?: string;
  task_type?: EmbedRequest["taskType"];
  taskType?: EmbedRequest["taskType"];
  output_dimensionality?: number;
  outputDimensionality?: number;
};

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json(
      { error: { message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const raw = body.texts ?? body.input;
  const input: string[] =
    raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];

  if (input.length === 0) {
    return Response.json(
      { error: { message: "input must be a non-empty string or string[]" } },
      { status: 400 },
    );
  }
  // Sanity cap so a runaway client can't ship a 10k-text batch.
  if (input.length > 100) {
    return Response.json(
      { error: { message: "input length capped at 100 per request" } },
      { status: 400 },
    );
  }

  const provider = await getProvider();
  try {
    const out = await provider.embed(
      {
        model: body.model,
        input,
        taskType: body.taskType ?? body.task_type,
        outputDimensionality:
          body.outputDimensionality ?? body.output_dimensionality,
      },
      req.signal,
    );
    return Response.json({
      object: "list",
      model: out.model,
      data: out.embeddings.map((embedding, index) => ({
        object: "embedding",
        index,
        embedding,
      })),
      usage: out.usage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[embed] error:", message);
    return Response.json({ error: { message } }, { status: 502 });
  }
}
