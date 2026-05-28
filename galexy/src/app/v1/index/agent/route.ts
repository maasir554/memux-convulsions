import {
  imageReader,
  namer,
  regionFinder,
  summariser,
  treeQuery,
  visioner,
  type ImageReaderInput,
  type NamerInput,
  type RegionFinderInput,
  type SummariserInput,
  type TreeQueryInput,
  type VisionerInput,
} from "@/lib/indexer/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AgentBody =
  | { kind: "visioner"; input: VisionerInput }
  | { kind: "summariser"; input: SummariserInput }
  | { kind: "namer"; input: NamerInput }
  | { kind: "imageReader"; input: ImageReaderInput }
  | { kind: "regionFinder"; input: RegionFinderInput }
  | { kind: "treeQuery"; input: TreeQueryInput };

export async function POST(req: Request): Promise<Response> {
  let body: AgentBody;
  try {
    body = (await req.json()) as AgentBody;
  } catch {
    return Response.json(
      { error: { message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  try {
    let result: unknown;
    switch (body.kind) {
      case "visioner":
        result = await visioner(body.input, req.signal);
        break;
      case "summariser":
        result = await summariser(body.input, req.signal);
        break;
      case "namer":
        result = await namer(body.input, req.signal);
        break;
      case "imageReader":
        result = await imageReader(body.input, req.signal);
        break;
      case "regionFinder":
        result = await regionFinder(body.input, req.signal);
        break;
      case "treeQuery":
        result = await treeQuery(body.input, req.signal);
        break;
      default: {
        const _exhaustive: never = body;
        void _exhaustive;
        return Response.json(
          { error: { message: "Unknown agent kind" } },
          { status: 400 },
        );
      }
    }
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent] ${body.kind} error:`, message);
    return Response.json({ error: { message } }, { status: 502 });
  }
}
