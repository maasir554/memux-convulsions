import { getProvider } from "@/lib/memux/backend/registry";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const provider = await getProvider();
  const models = await provider.listModels();
  return Response.json({ object: "list", data: models });
}
