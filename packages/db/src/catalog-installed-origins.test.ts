import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { openDb, migrate, schema } from "./index";

const THIS_DIR = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS = join(THIS_DIR, "..", "migrations");
const EXPECTED_COLUMNS = [
  ["name", 1], ["catalog_id", 1], ["source_id", 1], ["catalog_commit", 1],
  ["package_commit", 1], ["path", 1], ["kind", 1], ["version", 1], ["digest", 1],
  ["local_path", 1], ["installed_by_human_id", 0], ["installed_at", 1],
] as const;

describe("migration 033 catalog_installed_origins", () => {
  it("applies cleanly on a fresh DB, in order, with SQL matching schema.ts by hand", () => {
    const dir = mkdtempSync(join(tmpdir(), "orgops-db-033-"));
    try {
      const db = openDb(join(dir, "fresh.sqlite"));
      migrate(db);
      const applied = (db.prepare("SELECT id FROM migrations ORDER BY id").all() as { id: string }[]).map(r => r.id);
      expect(applied.filter(id => id.startsWith("033_"))).toEqual(["033_catalog_installed_origins.sql"]);
      expect(applied.indexOf("033_catalog_installed_origins.sql")).toBeLessThan(applied.indexOf("034_catalog_source_library.sql"));
      const info = db.prepare("PRAGMA table_info(catalog_installed_origins)").all() as { name: string; notnull: number; pk: number }[];
      // Hand-agreement check: column names/order/notnull match schema.ts catalogInstalledOrigins.
      expect(info.map(c => [c.name, c.notnull])).toEqual(EXPECTED_COLUMNS.map(([name, notnull]) => [name, notnull]));
      expect(info.find(c => c.name === "name")?.pk).toBe(1);
      expect(schema.catalogInstalledOrigins).toBeDefined();
      const indexes = db.prepare("PRAGMA index_list(catalog_installed_origins)").all() as { name: string }[];
      expect(indexes.map(i => i.name)).toContain("idx_catalog_installed_origins_catalog");
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("applies on an existing pre-033 DB and is idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "orgops-db-033-"));
    try {
      const db = openDb(join(dir, "existing.sqlite"));
      db.exec("CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
      const prior = readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql") && f < "033").sort();
      expect(prior.length).toBe(32);
      for (const file of prior) {
        db.exec(readFileSync(join(MIGRATIONS, file), "utf-8"));
        db.prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)").run(file, 1);
      }
      migrate(db); // applies exactly 033
      const rows = db.prepare("SELECT id FROM migrations WHERE id LIKE '033_%'").all();
      expect(rows).toEqual([{ id: "033_catalog_installed_origins.sql" }]);
      migrate(db); // idempotent: no error, still exactly one 033 row
      expect(db.prepare("SELECT count(*) AS n FROM migrations WHERE id LIKE '033_%'").get()).toEqual({ n: 1 });
      // CHECK constraint: only skill kind is recordable.
      expect(() => db.prepare("INSERT INTO catalog_installed_origins (name, catalog_id, source_id, catalog_commit, package_commit, path, kind, version, digest, local_path, installed_at) VALUES ('x','c','s','a','b','p','native-agent','1.0.0','d','/tmp/x',1)").run()).toThrow();
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
