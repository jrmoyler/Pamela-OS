import { NextResponse } from "next/server";
import { cleanupDictation } from "@/lib/dictation";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { text?: unknown; ai?: boolean } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  return NextResponse.json(await cleanupDictation(typeof body.text === "string" ? body.text : "", body.ai !== false));
}
