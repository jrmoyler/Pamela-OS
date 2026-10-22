import { readFile } from "@/lib/storage";
import { rangeResponse } from "@/lib/http";

/** Authenticated file access (middleware guards /api/files). Supports range requests for audio/video. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await readFile(id);
  if (!f) return new Response("Not found", { status: 404 });
  return rangeResponse(req, f.data, f.mime, f.name);
}
