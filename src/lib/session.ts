import { SignJWT, jwtVerify } from "jose";

/** Edge-safe session helpers (used by middleware and server code). */
export const SESSION_COOKIE = "pamela_session";
const DEV_SECRET = "pamela-os-dev-only-secret-change-me";

/**
 * Secret used to sign sessions and media links. The dev fallback is public, so a
 * production server refuses to run on it rather than accept forged sessions.
 */
export function authSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be set in production (see .env.example).");
  return DEV_SECRET;
}

const secret = () => new TextEncoder().encode(authSecret());

export type Session = { uid: string; email: string; name: string };

export async function signSession(s: Session) {
  return new SignJWT(s)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { uid: String(payload.uid), email: String(payload.email), name: String(payload.name) };
  } catch {
    return null;
  }
}
