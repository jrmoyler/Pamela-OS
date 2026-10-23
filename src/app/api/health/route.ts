import { NextResponse } from "next/server";
import { checkDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Public status probe: tells the error page (and uptime checks) why the app can't load, without exposing secrets. */
export async function GET() {
  const db = await checkDb();
  return NextResponse.json({ ok: db.ok, db }, { status: db.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
