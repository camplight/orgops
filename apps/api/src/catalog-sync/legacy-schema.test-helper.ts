import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, type OrgOpsDb } from "@orgops/db";

const migrationsDir = fileURLToPath(new URL("../../../../packages/db/migrations/", import.meta.url));

/** Keeps dormant pre-cutover service tests meaningful against their migration-033 schema. */
export function migrateLegacyCatalogFixture(db: OrgOpsDb): void {
  const fixtureDir = mkdtempSync(join(tmpdir(), "orgops-legacy-catalog-migrations-"));
  try {
    for (const file of readdirSync(migrationsDir).filter(file => file.endsWith(".sql") && file < "034_")) {
      cpSync(join(migrationsDir, file), join(fixtureDir, basename(file)));
    }
    migrate(db, fixtureDir);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}
