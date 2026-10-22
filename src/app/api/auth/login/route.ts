import { NextResponse, type NextRequest } from "next/server";
import { count, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { SESSION_COOKIE, signSession } from "@/lib/session";

function back(req: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, req.url), { status: 303 });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const db = await getDb();

  let user: typeof schema.users.$inferSelect | undefined;
  if (req.nextUrl.searchParams.get("setup") === "1") {
    const [{ value }] = await db.select({ value: count() }).from(schema.users);
    if (Number(value) > 0) return back(req, "/login");
    if (password.length < 10) return back(req, "/setup?error=" + encodeURIComponent("Password must be at least 10 characters."));
    [user] = await db
      .insert(schema.users)
      .values({ email, name: String(form.get("name") || "Pamela"), passwordHash: hashPassword(password) })
      .returning();
  } else {
    [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    if (!user || !verifyPassword(password, user.passwordHash)) return back(req, "/login?error=1");
  }

  const next = String(form.get("next") || "/");
  const res = back(req, next.startsWith("/") && !next.startsWith("//") ? next : "/");
  res.cookies.set(SESSION_COOKIE, await signSession({ uid: user.id, email: user.email, name: user.name }), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 30 * 86400,
  });
  return res;
}
