import { Hono } from "hono";
import { expect, it } from "vitest";
import { canManageCatalogs, createRequireAdmin, type AdminHuman, type AdminPrincipal } from "./admin-access";

it.each<[AdminPrincipal | undefined, boolean]>([
  [undefined, false],
  [{}, false],
  [{ id: "", username: "admin" }, false],
  [{ username: "runner" }, false],
  [{ id: "missing" }, false],
  [{ id: "ordinary", username: "admin" }, false],
  [{ id: "owner", username: "renamed-owner" }, true],
  [{ id: "owner", username: "runner" }, true],
  [{ id: "rotate-password" }, false],
  [{ id: "owner", runnerScope: { mode: "GLOBAL" } }, false],
  [{ id: "owner", runnerScope: { mode: "SCOPED", agentName: "agent" } }, false],
  [{ id: "owner", runnerScope: null }, false],
  [{ id: "owner", runnerScope: false }, false],
])("checks persisted human authority for %j", (principal, expected) => {
  const humans: Record<string, AdminHuman> = {
    owner: { isAdmin: true, mustChangePassword: false },
    ordinary: { isAdmin: false, mustChangePassword: false },
    "rotate-password": { isAdmin: true, mustChangePassword: true },
  };
  expect(canManageCatalogs(principal, { findHuman: (id) => humans[id] })).toBe(expected);
});

it("rechecks live authority for an existing principal and stops the handler after demotion", async () => {
  const principal = { id: "owner", username: "admin", isAdmin: true };
  let human: AdminHuman = { isAdmin: true, mustChangePassword: false };
  let handlerCalls = 0;
  const app = new Hono<{ Variables: { user: AdminPrincipal } }>();
  app.use("*", async (c, next) => {
    c.set("user", principal);
    await next();
  });
  app.get("/protected", createRequireAdmin({ findHuman: (id) => id === "owner" ? human : undefined }), (c) => {
    handlerCalls++;
    return c.json({ ok: true });
  });

  const allowed = await app.request("/protected");
  expect(allowed.status).toBe(200);
  expect(await allowed.json()).toEqual({ ok: true });
  expect(handlerCalls).toBe(1);

  human = { isAdmin: false, mustChangePassword: false };
  const denied = await app.request("/protected", { headers: { "x-orgops-runner-token": "test-token" } });
  expect(denied.status).toBe(403);
  expect(await denied.json()).toEqual({ error: "Administrator access required" });
  expect(handlerCalls).toBe(1);
});

it("does not run the protected handler when the human lookup throws", async () => {
  const failure = new Error("Human lookup unavailable");
  let observedError: Error | undefined;
  let handlerCalls = 0;
  const app = new Hono<{ Variables: { user: AdminPrincipal } }>();
  app.use("*", async (c, next) => {
    c.set("user", { id: "owner" });
    await next();
  });
  app.onError((error, c) => {
    observedError = error;
    return c.json({ error: "Internal error" }, 500);
  });
  app.get("/protected", createRequireAdmin({ findHuman: () => { throw failure; } }), (c) => {
    handlerCalls++;
    return c.json({ ok: true });
  });

  const response = await app.request("/protected");
  expect(response.status).toBe(500);
  expect(observedError).toBe(failure);
  expect(handlerCalls).toBe(0);
});
