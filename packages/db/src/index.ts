import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { schema } from "./schema";
export { CHANNEL_KINDS, isChannelKind, type ChannelKind } from "./channel-kinds";

export type OrgOpsDb = Database;
export type OrgOpsDrizzleDb = ReturnType<typeof createDrizzleDb>;

export const DEFAULT_DB_PATH = ".orgops-data/orgops.sqlite";

export function openDb(path = DEFAULT_DB_PATH): OrgOpsDb {
  if (path !== ":memory:") {
    // Ensure parent directory exists for file-based SQLite paths.
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  configureDb(db);
  return db;
}

export function configureDb(db: OrgOpsDb) {
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=NORMAL;");
  db.exec("PRAGMA busy_timeout=5000;");
  db.exec("PRAGMA foreign_keys=ON;");
}

export function createDrizzleDb(db: OrgOpsDb) {
  return drizzle(db, { schema });
}

export function migrate(db: OrgOpsDb, migrationsDir = join(import.meta.dir, "..", "migrations")) {
  if (!existsSync(migrationsDir)) {
    return;
  }
  db.exec(
    "CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)"
  );

  const applied = new Set(
    db
      .query("SELECT id FROM migrations")
      .all()
      .map((row) => (row as { id: string }).id)
  );

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const now = Date.now();
  const insert = db.prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)");

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    db.exec(sql);
    insert.run(file, now);
  }
}

export { schema };
