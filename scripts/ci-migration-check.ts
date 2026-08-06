import { unlinkSync, existsSync } from "node:fs";
import { openDb, migrate } from "@orgops/db";

const CHECK_DB_PATH = process.env.ORGOPS_CI_MIGRATION_CHECK_DB_PATH ?? "/tmp/ci-migration-check.sqlite";

function removeIfExists(path: string) {
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

async function main() {
  removeIfExists(CHECK_DB_PATH);
  removeIfExists(`${CHECK_DB_PATH}-wal`);
  removeIfExists(`${CHECK_DB_PATH}-shm`);

  const db = openDb(CHECK_DB_PATH);
  migrate(db);
  db.close();

  process.stdout.write(
    `[ci-migration-check] all migrations in packages/db/migrations applied cleanly to a fresh database\n`,
  );

  removeIfExists(CHECK_DB_PATH);
  removeIfExists(`${CHECK_DB_PATH}-wal`);
  removeIfExists(`${CHECK_DB_PATH}-shm`);
}

main().catch((error) => {
  process.stderr.write(`[ci-migration-check] migration dry-run failed: ${error?.stack ?? error}\n`);
  process.exit(1);
});
