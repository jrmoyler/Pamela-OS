import { NextResponse, type NextRequest } from "next/server";
import { submitForm } from "@/lib/modules/funnels";

/** Public form submissions from pages built in Pages & Forms. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isJson = req.headers.get("content-type")?.includes("application/json");
  let raw: Record<string, string> = {};
  try {
    if (isJson) raw = Object.fromEntries(Object.entries(((await req.json()) ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]));
    else for (const [k, v] of (await req.formData()).entries()) if (typeof v === "string") raw[k] = v;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid submission" }, { status: 400 });
  }

  const result = /^[0-9a-f-]{36}$/i.test(id) ? await submitForm(id, raw) : ({ ok: false, error: "Form not found" } as const);
  if (isJson) return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  if (!result.ok) {
    const page = raw._page && /^[a-z0-9-]+$/.test(raw._page) ? `/p/${raw._page}` : "/p/thanks/" + id;
    return NextResponse.redirect(new URL(`${page}?error=${encodeURIComponent(result.error)}#form`, req.url), 303);
  }
  return NextResponse.redirect(new URL(result.redirect, req.url), 303);
}
