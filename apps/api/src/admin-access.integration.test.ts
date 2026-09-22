import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migrate, openDb } from "@orgops/db";
import { createApp } from "./app";

const adminMigration = "031_human_admin.sql";

describe("administrator designation", () => {
  it("marks only the fresh installation's seeded human as administrator", () => {
    const db = openDb(":memory:");
    try {
      createApp({ db, adminUser: "bootstrap-owner", adminPass: "password" });
      expect(db.prepare("SELECT username, is_admin FROM humans").all()).toEqual([
        { username: "bootstrap-owner", is_admin: 1 },
      ]);
    } finally {
      db.close();
    }
  });

  it("does not promote an existing human even when its name matches adminUser", () => {
    const db = openDb(":memory:");
    try {
      migrate(db);
      db.prepare(`INSERT INTO humans
        (id, username, password_hash, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, 0, 1, 1)`).run("human-existing", "admin", "not-a-login-hash");
      createApp({ db, adminUser: "admin", adminPass: "password" });
      expect(db.prepare("SELECT id, is_admin FROM humans").all()).toEqual([
        { id: "human-existing", is_admin: 0 },
      ]);
    } finally {
      db.close();
    }
  });

  it("upgrades pre-designation humans as non-admin and applies the migration only once", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "orgops-admin-migrations-"));
    const db = openDb(":memory:");
    try {
      const migrationsDirectory = fileURLToPath(new URL("../../../packages/db/migrations/", import.meta.url));
      for (const file of readdirSync(migrationsDirectory).filter(
        (file) => file.endsWith(".sql") && file < adminMigration,
      )) {
        copyFileSync(join(migrationsDirectory, file), join(temporaryDirectory, file));
      }
      migrate(db, temporaryDirectory);
      expect(db.prepare("SELECT name FROM pragma_table_info('humans') WHERE name = 'is_admin'").all()).toEqual([]);
      db.prepare(`INSERT INTO humans
        (id, username, password_hash, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, 0, 1, 1)`).run("human-upgraded", "admin", "not-a-login-hash");

      migrate(db);
      expect(db.prepare("SELECT id, is_admin FROM humans").all()).toEqual([
        { id: "human-upgraded", is_admin: 0 },
      ]);
      migrate(db);
      expect(db.prepare("SELECT id FROM migrations WHERE id = ?").all(adminMigration)).toEqual([
        { id: adminMigration },
      ]);
      createApp({ db, adminUser: "admin", adminPass: "password" });
      expect(db.prepare("SELECT id, is_admin FROM humans").all()).toEqual([
        { id: "human-upgraded", is_admin: 0 },
      ]);
    } finally {
      db.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("allows only non-null binary administrator designations", () => {
    const db = openDb(":memory:");
    try {
      migrate(db);
      db.prepare(`INSERT INTO humans
        (id, username, password_hash, created_at, updated_at)
        VALUES ('human-role', 'ordinary', 'not-a-login-hash', 1, 1)`).run();
      const update = db.prepare("UPDATE humans SET is_admin = ? WHERE id = 'human-role'");
      for (const value of [-1, 2, null]) {
        expect(() => update.run(value)).toThrow(/constraint failed/i);
      }
      update.run(1);
      expect(db.prepare("SELECT is_admin FROM humans").get()).toEqual({ is_admin: 1 });
      update.run(0);
      expect(db.prepare("SELECT is_admin FROM humans").get()).toEqual({ is_admin: 0 });
    } finally {
      db.close();
    }
  });
});

describe("current administrator capability", () => {
  async function login(app: ReturnType<typeof createApp>["app"], username: string) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "test-owner-password" }),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")?.match(/orgops_session=[^;]+/)?.[0];
    expect(cookie).toBeTruthy();
    return cookie!;
  }

  async function capability(app: ReturnType<typeof createApp>["app"], headers: Record<string, string>) {
    const response = await app.request("/api/auth/me", { headers });
    expect(response.status).toBe(200);
    return (await response.json()).isAdmin;
  }

  it("reports the fresh administrator and reflects demotion with the same session", async () => {
    const db = openDb(":memory:");
    try {
      const { app } = createApp({ db, adminUser: "bootstrap-owner", adminPass: "test-owner-password" });
      const cookie = await login(app, "bootstrap-owner");
      expect(await capability(app, { cookie })).toBe(true);
      const human = db.prepare("SELECT id FROM humans WHERE username = ?").get("bootstrap-owner") as { id: string };
      db.prepare("UPDATE humans SET is_admin = 0 WHERE id = ?").run(human.id);
      expect(await capability(app, { cookie })).toBe(false);
    } finally {
      db.close();
    }
  });

  it("uses live password requirements and retains authority after a rename", async () => {
    const db = openDb(":memory:");
    try {
      const { app } = createApp({ db, adminUser: "bootstrap-owner", adminPass: "test-owner-password" });
      const cookie = await login(app, "bootstrap-owner");
      const human = db.prepare("SELECT id FROM humans WHERE username = ?").get("bootstrap-owner") as { id: string };
      db.prepare("UPDATE humans SET username = 'renamed-owner' WHERE id = ?").run(human.id);
      expect(await capability(app, { cookie })).toBe(true);
      db.prepare("UPDATE humans SET must_change_password = 1 WHERE id = ?").run(human.id);
      expect(await capability(app, { cookie })).toBe(false);
      db.prepare("UPDATE humans SET must_change_password = 0 WHERE id = ?").run(human.id);
      expect(await capability(app, { cookie })).toBe(true);
    } finally {
      db.close();
    }
  });

  it("denies runner-header capability even with an administrator cookie", async () => {
    const db = openDb(":memory:");
    try {
      const { app } = createApp({ db, adminUser: "bootstrap-owner", adminPass: "test-owner-password", runnerToken: "test-runner-token" });
      const headers = { "x-orgops-runner-token": "test-runner-token" };
      expect(await capability(app, headers)).toBe(false);
      const cookie = await login(app, "bootstrap-owner");
      expect(await capability(app, { ...headers, cookie })).toBe(false);
    } finally {
      db.close();
    }
  });

  it("denies a regular human named admin", async () => {
    const db = openDb(":memory:");
    try {
      const { app } = createApp({ db, adminUser: "bootstrap-owner", adminPass: "test-owner-password" });
      db.prepare(`INSERT INTO humans (id, username, password_hash, must_change_password, created_at, updated_at)
        SELECT 'ordinary-human', 'admin', password_hash, 0, 1, 1 FROM humans WHERE username = ?`).run("bootstrap-owner");
      const cookie = await login(app, "admin");
      expect(await capability(app, { cookie })).toBe(false);
    } finally {
      db.close();
    }
  });
});
