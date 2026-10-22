import { getDb, schema } from "@/lib/db";

/** Full data export (her data, her database). Secrets and password hashes are excluded. */
export async function GET() {
  const db = await getDb();
  const tables = Object.entries(schema).filter(([k]) => !["users", "settings"].includes(k));
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString() };
  for (const [name, table] of tables) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out[name] = await db.select().from(table as any);
  }
  const settingsRows = await db.select().from(schema.settings);
  out.settings = settingsRows.filter((r) => !r.encrypted);
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="pamela-os-export-${new Date().toISOString().slice(0, 10)}.json"` },
  });
}
