import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/session";

/** Public surfaces: her funnels, booking, payment pages, webhooks and the PWA assets. */
const PUBLIC = [
  /^\/login/,
  /^\/setup/,
  /^\/p\//,
  /^\/book(\/|$)/,
  /^\/pay\//,
  /^\/api\/auth\//,
  /^\/api\/public\//,
  /^\/api\/webhooks\//,
  /^\/api\/worker\//,
  /^\/api\/cron\/tick/,
  /^\/manifest\.webmanifest$/,
  /^\/sw\.js$/,
  /^\/offline\.html$/,
  /^\/icons\//,
  /^\/favicon/,
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
