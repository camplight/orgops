import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, migrate } from "./index";

describe("db", () => {
  it("runs migrations and creates tables", () => {
    const dir = join(
      fileURLToPath(new URL(".", import.meta.url)),
      "..",
      "..",
      "..",
      "..",
      "data",
      "tmp-tests",
    );
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "test.sqlite");
    const db = openDb(dbPath);
    migrate(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'")
      .get();
    expect(row).toBeTruthy();
    const keysRow = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='integration_keys'",
      )
      .get();
    expect(keysRow).toBeTruthy();
    const embedRow = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='embed_conversations'",
      )
      .get();
    expect(embedRow).toBeTruthy();
    db.close();
    rmSync(dbPath);
  });

  it("repairs partially migrated federation schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "orgops-db-migrations-"));
    const db = openDb(":memory:");
    db.exec(`
      CREATE TABLE federation_instances (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        base_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX uidx_federation_instances_base_url
        ON federation_instances (base_url);
    `);

    migrate(db, dir);

    const columns = db
      .prepare("PRAGMA table_info(federation_instances)")
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    expect(columnNames.has("last_seen_at")).toBe(true);
    expect(columnNames.has("outbound_token")).toBe(true);
    const obsoleteIndex = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='uidx_federation_instances_base_url'")
      .get();
    expect(obsoleteIndex).toBeUndefined();

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
