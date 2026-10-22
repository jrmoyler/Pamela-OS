import { readFile } from "@/lib/storage";
import { verifyMediaSig } from "@/lib/outbound";
import { rangeResponse } from "@/lib/http";

/** Signed, expiring media links for Twilio MMS and Meta publishing. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  if (!verifyMediaSig(id, url.searchParams.get("exp") ?? "0", url.searchParams.get("sig") ?? "")) return new Response("Forbidden", { status: 403 });
  const f = await readFile(id);
  if (!f) return new Response("Not found", { status: 404 });
  return rangeResponse(req, f.data, f.mime, f.name);
}
