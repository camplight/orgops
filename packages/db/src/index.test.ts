import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openDb, migrate } from "./index";

describe("db", () => {
  it("runs migrations and creates tables", () => {
    const dir = join(import.meta.dir, "..", "..", "..", "..", "data", "tmp-tests");
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "test.sqlite");
    const db = openDb(dbPath);
    migrate(db);
    const row = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").get();
    expect(row).toBeTruthy();
    db.close();
    rmSync(dbPath);
  });
});
