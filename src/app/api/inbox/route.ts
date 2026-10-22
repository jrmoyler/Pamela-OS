import { NextResponse } from "next/server";
import { bearer, hasScope, verifyAgentKey } from "@/lib/hub/keys";
import { addInboxItem, pushFile } from "@/lib/hub/inbox";

export const maxDuration = 300;

/**
 * Plain REST door into the Command Center inbox, for anything that can't speak
 * MCP (Meta Muse actions, phone shortcuts, Zapier, scripts). Bearer agent key
 * with the "write" scope.
 *
 *   multipart/form-data: file=<file> [description] [tags=a,b]
 *   application/json:    { title, body?, url? }                      → a note or link
 *                        { name, base64 | text | url, description? } → a file
 */
export async function POST(req: Request) {
  const key = await verifyAgentKey(bearer(req));
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasScope(key, "write")) return NextResponse.json({ error: "This key can't push. Give it the write scope." }, { status: 403 });
  const source = key.client;
  try {
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Attach a file in the file field." }, { status: 400 });
      const { file: saved, item } = await pushFile({
        source,
        agentKeyId: key.id,
        name: String(form.get("name") || file.name || "file"),
        mime: file.type || undefined,
        base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
        description: String(form.get("description") ?? "") || null,
        tags: String(form.get("tags") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      });
      return NextResponse.json({ fileId: saved.id, inboxItemId: item.id });
    }
    const b = (await req.json()) as Record<string, string | undefined>;
    if (b.base64 != null || b.text != null || (b.url && b.name)) {
      const { file, item } = await pushFile({ source, agentKeyId: key.id, name: b.name, mime: b.mime, base64: b.base64, text: b.text, url: b.url, description: b.description ?? null });
      return NextResponse.json({ fileId: file.id, inboxItemId: item.id });
    }
    if (!b.title) return NextResponse.json({ error: "Send a title (note), or name + base64/text/url (file)." }, { status: 400 });
    const item = await addInboxItem({ kind: b.url ? "link" : "note", source, agentKeyId: key.id, title: b.title, body: b.body ?? null, url: b.url ?? null });
    return NextResponse.json({ inboxItemId: item.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
