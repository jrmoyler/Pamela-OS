/**
 * Turns a database connect/migrate failure into a plain-language reason and fix.
 * Shared by the app (error pages, /api/health) and the pre-build check, so a bad
 * DATABASE_URL is reported the same way everywhere and never leaks the URL itself.
 */

export type DbProblem =
  | "bad_password"
  | "unknown_user"
  | "missing_database"
  | "bad_url"
  | "host_not_found"
  | "unreachable"
  | "unknown";

export type DbDiagnosis = { problem: DbProblem; title: string; fix: string; config: boolean };

const SETTINGS_HINT = "In Vercel, open the project → Settings → Environment Variables, update DATABASE_URL, then redeploy.";

const DIAGNOSES: Record<DbProblem, Omit<DbDiagnosis, "problem">> = {
  bad_password: {
    title: "The database password is wrong",
    fix: `The password inside DATABASE_URL doesn't match the database. Copy the connection string again from Supabase (Project Settings → Database → Connection string, “Transaction pooler”), put the real password in place of [YOUR-PASSWORD], and URL-encode any special characters (@ # / ? : %). ${SETTINGS_HINT}`,
    config: true,
  },
  unknown_user: {
    title: "The database user name is wrong",
    fix: `The user in DATABASE_URL isn't recognised. With Supabase's pooler (port 6543) the user must be postgres.<project-ref>, not just postgres. Copy the connection string again from Supabase. ${SETTINGS_HINT}`,
    config: true,
  },
  missing_database: {
    title: "The database name doesn't exist",
    fix: `The database named at the end of DATABASE_URL doesn't exist. For Supabase it should end in /postgres. ${SETTINGS_HINT}`,
    config: true,
  },
  bad_url: {
    title: "DATABASE_URL isn't a valid connection string",
    fix: `DATABASE_URL must look like postgres://user:password@host:6543/postgres. Special characters in the password must be URL-encoded. ${SETTINGS_HINT}`,
    config: true,
  },
  host_not_found: {
    title: "The database server address is wrong",
    fix: `The host in DATABASE_URL can't be found. Copy the connection string again from Supabase. ${SETTINGS_HINT}`,
    config: true,
  },
  unreachable: {
    title: "The database isn't answering",
    fix: "The database server didn't respond. If it's a Supabase project, check that it isn't paused (free projects pause after a week idle) and restore it from the Supabase dashboard. This usually clears up on its own once the database is back.",
    config: false,
  },
  unknown: {
    title: "Pamela OS can't open its database",
    fix: "Something went wrong while connecting to the database. Check DATABASE_URL and that the database is running, then try again.",
    config: false,
  },
};

type ErrLike = { code?: unknown; message?: unknown; cause?: unknown };

/** Walks error.cause chains (drizzle wraps the driver error) collecting codes and messages. */
function chain(e: unknown): ErrLike[] {
  const out: ErrLike[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur && typeof cur === "object"; i++) {
    out.push(cur as ErrLike);
    cur = (cur as ErrLike).cause;
  }
  return out;
}

export function diagnoseDbError(e: unknown): DbDiagnosis {
  const links = chain(e);
  const codes = links.map((l) => String(l.code ?? ""));
  const text = links.map((l) => String(l.message ?? "")).join(" | ").toLowerCase();
  const has = (c: string) => codes.includes(c);

  let problem: DbProblem = "unknown";
  if (has("28P01") || text.includes("password authentication failed")) problem = "bad_password";
  else if (has("28000") || text.includes("tenant or user not found") || text.includes("role \"")) problem = "unknown_user";
  else if (has("3D000")) problem = "missing_database";
  else if (has("ERR_INVALID_URL") || text.includes("invalid url")) problem = "bad_url";
  else if (has("ENOTFOUND") || has("EAI_AGAIN")) problem = "host_not_found";
  else if (["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "CONNECT_TIMEOUT", "EHOSTUNREACH", "57P01", "57P03"].some(has))
    problem = "unreachable";

  return { problem, ...DIAGNOSES[problem] };
}

/** Thrown by getDb() so callers (and logs) carry the diagnosis alongside the driver error. */
export class DatabaseUnavailableError extends Error {
  readonly diagnosis: DbDiagnosis;
  constructor(cause: unknown) {
    const diagnosis = diagnoseDbError(cause);
    super(`Database unavailable: ${diagnosis.title}. ${diagnosis.fix}`, { cause });
    this.name = "DatabaseUnavailableError";
    this.diagnosis = diagnosis;
  }
}
