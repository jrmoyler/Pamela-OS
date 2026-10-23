import { NextResponse } from "next/server";
import { putFile } from "@/lib/storage";
import { mimeFromName } from "@/lib/hub/sources";

export const maxDuration = 300;

/** Adds files to the Library from her device (session-protected by middleware). */
export async function POST(req: Request) {
  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  const description = String(form.get("description") ?? "").trim() || null;
  const tags = String(form.get("tags") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const saved = [];
  for (const f of files) saved.push(await putFile(Buffer.from(await f.arrayBuffer()), f.name, f.type && f.type !== "application/octet-stream" ? f.type : mimeFromName(f.name), { source: "upload", description, tags }));
  return NextResponse.json({ ids: saved.map((s) => s.id) });
}
