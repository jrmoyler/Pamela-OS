// `npm run db:migrate` — applies pending drizzle migrations (and structural seed) against DATABASE_URL or ./.data.
delete process.env.SKIP_AUTO_MIGRATE;

async function main() {
  const { getDb } = await import("../src/lib/db");
  await getDb();
  console.log("migrations applied");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
