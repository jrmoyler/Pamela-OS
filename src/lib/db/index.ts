import path from "node:path";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { localDir } from "../localdir";
import { DatabaseUnavailableError, diagnoseDbError, type DbDiagnosis } from "./diagnose";
import { normalizeDatabaseUrl } from "./url";

export type DB = PostgresJsDatabase<typeof schema>;

type Holder = { db?: DB; ready?: Promise<DB> };
const g = globalThis as unknown as { __pamelaDb?: Holder };
const holder: Holder = (g.__pamelaDb ??= {});

const migrationsFolder = path.join(process.cwd(), "drizzle");

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL ? normalizeDatabaseUrl(process.env.DATABASE_URL) : "";
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    // prepare:false keeps us compatible with Supabase's transaction pooler.
    // connect_timeout keeps a dead database from hanging the page until the function times out.
    const client = postgres(url, { prepare: false, max: Number(process.env.DATABASE_POOL_MAX ?? 5), connect_timeout: 10 });
    const db = drizzle(client, { schema });
    try {
      if (process.env.SKIP_AUTO_MIGRATE !== "1") await migrate(db, { migrationsFolder });
      else await client`select 1`;
    } catch (e) {
      // Free the pool so a retry after the fix doesn't pile up dead connections.
      await client.end({ timeout: 1 }).catch(() => {});
      throw e;
    }
    return db;
  }
  // Zero-config local mode: embedded Postgres (PGlite) persisted to ./.data (temp dir on read-only hosts)
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = localDir(path.join(".data", "pglite"), process.env.PGLITE_DIR);
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as DB;
}

/** Lazily connects + migrates once per process. */
export async function getDb(): Promise<DB> {
  if (holder.db) return holder.db;
  holder.ready ??= connect()
    .then(async (db) => {
      holder.db = db;
      const { ensureSeed } = await import("./seed");
      await ensureSeed(db);
      return db;
    })
    .catch((e) => {
      // Don't cache a failed connect/migrate forever — let the next call retry.
      holder.ready = undefined;
      const err = e instanceof DatabaseUnavailableError ? e : new DatabaseUnavailableError(e);
      console.error(`[pamela-os] ${err.message}`, e);
      throw err;
    });
  return holder.ready;
}

/** Health probe for /api/health and the error pages: never throws, never reveals DATABASE_URL. */
export async function checkDb(): Promise<{ ok: true } | ({ ok: false } & DbDiagnosis)> {
  try {
    await getDb();
    return { ok: true };
  } catch (e) {
    const d = e instanceof DatabaseUnavailableError ? e.diagnosis : diagnoseDbError(e);
    return { ok: false, ...d };
  }
}

export { schema };
