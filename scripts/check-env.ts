// Runs before `next build`. On a Vercel production build it refuses to ship a deploy whose settings
// can't work (missing AUTH_SECRET / DATABASE_URL, wrong database password or user). A failed build
// leaves the last good deployment live, so Pamela never lands on a crash page because of a typo.
// Set SKIP_ENV_CHECK=1 to bypass in an emergency.
import { diagnoseDbError } from "../src/lib/db/diagnose";
import { normalizeDatabaseUrl } from "../src/lib/db/url";

const onVercel = process.env.VERCEL === "1";
const production = process.env.VERCEL_ENV === "production";

function fail(lines: string[]): never {
  console.error(["", "✖ Pamela OS deploy check failed", ...lines.map((l) => `  ${l}`), ""].join("\n"));
  process.exit(1);
}

async function main() {
  if (process.env.SKIP_ENV_CHECK === "1" || !onVercel) return;

  const problems: string[] = [];
  if (production && !process.env.AUTH_SECRET) problems.push("AUTH_SECRET is not set. Sign-in cannot work without it.");
  if (production && !process.env.DATABASE_URL)
    problems.push("DATABASE_URL is not set. Vercel can't keep a local database, so every account and record would vanish.");
  if (problems.length) fail([...problems, "Add them in Vercel → Settings → Environment Variables, then redeploy."]);

  const url = process.env.DATABASE_URL ? normalizeDatabaseUrl(process.env.DATABASE_URL) : "";
  if (!url) return;

  const { default: postgres } = await import("postgres");
  let sql: ReturnType<typeof postgres> | undefined;
  try {
    sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15 });
    await sql`select 1`;
    console.log("✓ Pamela OS deploy check: database connection OK");
  } catch (e) {
    const d = diagnoseDbError(e);
    // Only settings mistakes block the deploy; a briefly unreachable database shouldn't.
    if (d.config) fail([`${d.title}.`, d.fix]);
    console.warn(`⚠ Pamela OS deploy check: ${d.title}. ${d.fix}`);
  } finally {
    await sql?.end({ timeout: 1 }).catch(() => {});
  }
}

main().catch((e) => {
  console.warn("⚠ Pamela OS deploy check could not run:", e);
});
