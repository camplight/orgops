import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "@orgops/db";
import { createApp } from "./app";

describe("administrator-target temporary password reset", () => {
  let db: ReturnType<typeof openDb>;
  let app: ReturnType<typeof createApp>["app"];
  let dataDir: string;
  let targetId: string;
  let adminCookie: string;
  let ordinaryCookie: string;
  const originalPassword = "original-test-password";
  const replacementPassword = "replacement-test-password";

  function login(username: string, password = originalPassword) {
    return app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  }

  async function session(username: string, password = originalPassword) {
    const response = await login(username, password);
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")?.match(/orgops_session=[^;]+/)?.[0];
    if (!cookie) throw new Error("Login did not set a session cookie");
    return cookie;
  }

  function reset(headers: Record<string, string>, tempPassword: string | undefined = replacementPassword) {
    return app.request(`/api/humans/${targetId}/reset-temp-password`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ tempPassword }),
    });
  }

  function targetState() {
    return db.prepare<[string], {
      password_hash: string; must_change_password: number; is_admin: number; updated_at: number;
    }>("SELECT password_hash, must_change_password, is_admin, updated_at FROM humans WHERE id = ?").get(targetId);
  }

  async function expectDenied(headers: Record<string, string>, generated = false) {
    const before = targetState();
    // Empty input exercises the generated-password branch without disclosing it.
    const response = await reset(headers, generated ? "" : replacementPassword);
    expect.soft(response.status).toBe(403);
    expect.soft(await response.json()).toEqual({ error: "Administrator access required" });
    expect.soft(targetState()).toEqual(before);
    expect.soft((await login("target-owner")).status).toBe(200);
    expect.soft((await login("target-owner", replacementPassword)).status).toBe(401);
  }

  async function scopedRunnerToken() {
    // Use the real invite/redeem fixture path, not a forged principal.
    const channelResponse = await app.request("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ name: "reset-test-channel", kind: "GROUP" }),
    });
    expect(channelResponse.status).toBe(201);
    const channel = await channelResponse.json();
    const inviteResponse = await app.request("/api/agent-invites", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ name: "reset-test-invite", agentName: "reset-test-agent", channelIds: [channel.id] }),
    });
    expect(inviteResponse.status).toBe(201);
    const invite = await inviteResponse.json();
    const token = decodeURIComponent(invite.inviteLink.split("/public/")[1]);
    const redeemed = await app.request(`/api/agent-invites/public/${encodeURIComponent(token)}/redeem`, { method: "POST" });
    expect(redeemed.status).toBe(200);
    return (await redeemed.json()).runner.token;
  }

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "orgops-admin-reset-"));
    db = openDb(":memory:");
    ({ app } = createApp({ db, dataDir, adminUser: "target-owner", adminPass: originalPassword, runnerToken: "reset-test-global-token" }));
    const target = db.prepare<[], { id: string }>("SELECT id FROM humans WHERE username = 'target-owner'").get();
    if (!target) throw new Error("Seeded target missing");
    targetId = target.id;
    const insertHuman = db.prepare(`INSERT INTO humans
      (id, username, password_hash, must_change_password, is_admin, created_at, updated_at)
      SELECT ?, ?, password_hash, 0, ?, 1, 1 FROM humans WHERE id = ?`);
    insertHuman.run("admin-caller", "other-owner", 1, targetId);
    insertHuman.run("ordinary-caller", "admin", 0, targetId);
    adminCookie = await session("other-owner");
    ordinaryCookie = await session("admin");
  });

  afterEach(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("denies an ordinary human named admin without changing or disclosing credentials", async () => {
    await expectDenied({ cookie: ordinaryCookie });
  });

  it("does not disclose a generated password to an ordinary human", async () => {
    await expectDenied({ cookie: ordinaryCookie }, true);
  });

  it.each([false, true])("denies a global runner with administrator cookie=%s", async (withCookie) => {
    await expectDenied({ "x-orgops-runner-token": "reset-test-global-token", ...(withCookie ? { cookie: adminCookie } : {}) });
  });

  it.each([false, true])("denies a scoped runner with administrator cookie=%s", async (withCookie) => {
    const token = await scopedRunnerToken();
    await expectDenied({ "x-orgops-runner-token": token, ...(withCookie ? { cookie: adminCookie } : {}) });
  });

  it("denies a live-demoted caller without requiring another login", async () => {
    db.prepare("UPDATE humans SET is_admin = 0 WHERE id = 'admin-caller'").run();
    await expectDenied({ cookie: adminCookie });
  });

  it("denies a caller with a live password-change requirement despite its old session", async () => {
    db.prepare("UPDATE humans SET must_change_password = 1 WHERE id = 'admin-caller'").run();
    await expectDenied({ cookie: adminCookie });
  });

  it("checks the current target role even when the target must change its password", async () => {
    db.prepare("UPDATE humans SET is_admin = 0 WHERE id = ?").run(targetId);
    const targetCookie = await session("target-owner");
    db.prepare("UPDATE humans SET is_admin = 1, must_change_password = 1 WHERE id = ?").run(targetId);
    // The target's pre-promotion session must not determine target protection.
    expect((await app.request("/api/auth/me", { headers: { cookie: targetCookie } })).status).toBe(200);
    await expectDenied({ cookie: ordinaryCookie });
  });

  it("allows a current human administrator to reset another administrator and enforces rotation", async () => {
    const oldTargetCookie = await session("target-owner");
    const before = targetState();
    const response = await reset({ cookie: adminCookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: targetId, username: "target-owner", mustChangePassword: true, temporaryPassword: replacementPassword });
    expect(targetState()).toMatchObject({ is_admin: 1, must_change_password: 1 });
    expect(targetState()?.password_hash).not.toBe(before?.password_hash);
    expect((await login("target-owner")).status).toBe(401);
    // Even a session from before the reset loses live administrator authority.
    const oldCapability = await app.request("/api/auth/me", { headers: { cookie: oldTargetCookie } });
    expect((await oldCapability.json()).isAdmin).toBe(false);
    const cookie = await session("target-owner", replacementPassword);
    const me = await app.request("/api/auth/me", { headers: { cookie } });
    expect(await me.json()).toMatchObject({ isAdmin: false, mustChangePassword: true });
    expect((await reset({ cookie })).status).toBe(403);
    expect((await app.request("/api/humans", { headers: { cookie } })).status).toBe(403);
    const rotated = await app.request("/api/auth/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ newPassword: "rotated-test-password" }),
    });
    expect(rotated.status).toBe(200);
    expect(targetState()).toMatchObject({ is_admin: 1, must_change_password: 0 });
    const afterRotation = await app.request("/api/auth/me", { headers: { cookie } });
    expect((await afterRotation.json()).isAdmin).toBe(true);
  });

  it.each(["ordinary", "global", "scoped"])("preserves non-admin-target reset policy for %s callers", async (caller) => {
    const headers: Record<string, string> = caller === "ordinary"
      ? { cookie: ordinaryCookie }
      : { "x-orgops-runner-token": caller === "global" ? "reset-test-global-token" : await scopedRunnerToken() };
    // Demote a previously designated target; protection follows the live row.
    db.prepare("UPDATE humans SET is_admin = 0 WHERE id = ?").run(targetId);
    const response = await reset(headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ temporaryPassword: replacementPassword, mustChangePassword: true });
    expect(targetState()).toMatchObject({ is_admin: 0, must_change_password: 1 });
    expect((await login("target-owner")).status).toBe(401);
    expect((await login("target-owner", replacementPassword)).status).toBe(200);
  });
});
