import path from "node:path";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { localDir } from "../localdir";

export type DB = PostgresJsDatabase<typeof schema>;

type Holder = { db?: DB; ready?: Promise<DB> };
const g = globalThis as unknown as { __pamelaDb?: Holder };
const holder: Holder = (g.__pamelaDb ??= {});

const migrationsFolder = path.join(process.cwd(), "drizzle");

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    // prepare:false keeps us compatible with Supabase's transaction pooler.
    const client = postgres(url, { prepare: false, max: Number(process.env.DATABASE_POOL_MAX ?? 5) });
    const db = drizzle(client, { schema });
    if (process.env.SKIP_AUTO_MIGRATE !== "1") await migrate(db, { migrationsFolder });
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
      throw e;
    });
  return holder.ready;
}

export { schema };
