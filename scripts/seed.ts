// `npm run db:seed` — ensures structural defaults (pipelines, boards, booking types, starter automations). Never inserts people.
import { getDb } from "../src/lib/db";
import { ensureSeed } from "../src/lib/db/seed";

async function main() {
  const db = await getDb();
  await ensureSeed(db);
  console.log("seed ensured");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
