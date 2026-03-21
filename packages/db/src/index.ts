import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { schema } from "./schema";
export { CHANNEL_KINDS, isChannelKind, type ChannelKind } from "./channel-kinds";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));

export type OrgOpsDb = InstanceType<typeof Database>;
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

export function migrate(db: OrgOpsDb, migrationsDir = join(THIS_DIR, "..", "migrations")) {
  if (!existsSync(migrationsDir)) {
    return;
  }
  db.exec(
    "CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)"
  );

  const applied = db.prepare("SELECT id FROM migrations").all() as Array<{ id: string }>;
  const appliedIds = new Set(applied.map((row) => row.id));

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const now = Date.now();
  const insert = db.prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)");

  for (const file of files) {
    if (appliedIds.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    db.exec(sql);
    insert.run(file, now);
  }
}

export { schema };
