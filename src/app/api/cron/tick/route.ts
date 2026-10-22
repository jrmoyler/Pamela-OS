import { NextResponse, type NextRequest } from "next/server";
import { tick } from "@/lib/scheduler";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const maxDuration = 300;

/** Scheduler entrypoint: Vercel cron / VPS crontab (Bearer CRON_SECRET) or the open app's heartbeat (session). */
async function handle(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "");
  const cronOk = !!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET;
  const sessionOk = !!(await verifySession(req.cookies.get(SESSION_COOKIE)?.value));
  if (!cronOk && !sessionOk) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await tick());
}

export const GET = handle;
export const POST = handle;
