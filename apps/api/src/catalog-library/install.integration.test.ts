import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { CatalogAuthority, PackageInstallation } from "@orgops/schemas";
import { registerCatalogSourceRoutes } from "../routes/catalog-library";

const jsonHeaders = { "content-type": "application/json" };
type Principal = "admin" | "human" | "runner-global" | "runner-scoped" | "anonymous";

function routeFixture(principal: Principal, result: Awaited<ReturnType<PackageInstallation["installExact"]>> = {
  ok: true, packages: [{ packageReleaseId: "release-skill", action: "installed" }], activated: false,
}) {
  const app = new Hono<{ Variables: { user: { id?: string; username: string; runnerScope?: unknown } } }>();
  const installExact = vi.fn(async () => result);
  const installation: PackageInstallation = {
    installExact,
    inspectAvailability: () => ({ installed: false, state: "ABSENT" }),
  };
  const authority = { execute: vi.fn(), query: vi.fn() } as unknown as CatalogAuthority;
  const requireAuth = async (c: any, next: () => Promise<void>) => {
    if (principal === "anonymous") return c.json({ error: "Unauthorized" }, 401);
    c.set("user", principal.startsWith("runner")
      ? { username: "runner", runnerScope: principal === "runner-scoped" ? ["agent-a"] : [] }
      : { id: principal === "admin" ? "admin-a" : "human-a", username: principal });
    await next();
  };
  const requireAdmin = async (c: any, next: () => Promise<void>) => {
    const user = c.get("user");
    if (principal !== "admin" || !user.id) return c.json({ error: "Administrator access required" }, 403);
    await next();
  };
  registerCatalogSourceRoutes(app as any, { authority, installation, requireAuth, requireAdmin });
  const headers: Record<string, string> = principal === "anonymous" ? {} : { authorization: `fixture ${principal}` };
  return { app, installation, installExact, authority, headers };
}

async function install(principal: Principal, body: unknown = { dependencyReleaseIds: [] }) {
  const fixture = routeFixture(principal);
  const response = await fixture.app.request("/api/catalog-releases/release-skill/install", {
    method: "POST", headers: { ...fixture.headers, ...jsonHeaders }, body: JSON.stringify(body),
  });
  return { ...fixture, response };
}

describe("administrator exact installation route", () => {
  it("installs an exact immutable closure inertly for a freshly authorized administrator", async () => {
    const { response, installExact } = await install("admin", { dependencyReleaseIds: ["release-dependency"] });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true, packages: [{ packageReleaseId: "release-skill", action: "installed" }], activated: false,
    });
    expect(installExact).toHaveBeenCalledWith({
      packageReleaseId: "release-skill", dependencyReleaseIds: ["release-dependency"],
    }, { kind: "HUMAN_ADMIN", id: "admin-a" });
  });

  it.each([
    ["human", 403, { error: "Administrator access required" }],
    ["runner-global", 403, { error: "Administrator access required" }],
    ["runner-scoped", 403, { error: "Administrator access required" }],
    ["anonymous", 401, { error: "Unauthorized" }],
  ] as const)("denies %s before reading or invoking installation", async (principal, status, envelope) => {
    const fixture = routeFixture(principal);
    const response = await fixture.app.request("/api/catalog-releases/release-skill/install", {
      method: "POST", headers: { ...fixture.headers, ...jsonHeaders }, body: "{",
    });
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(envelope);
    expect(fixture.installExact).not.toHaveBeenCalled();
  });

  it("rejects unknown fields, malformed release IDs, duplicate closure IDs, invalid UTF-8, and streamed overflow", async () => {
    for (const [path, body] of [
      ["/api/catalog-releases/release-skill/install", { dependencyReleaseIds: [], activate: true }],
      ["/api/catalog-releases/INVALID!/install", { dependencyReleaseIds: [] }],
      ["/api/catalog-releases/release-skill/install", { dependencyReleaseIds: ["release-dependency", "release-dependency"] }],
    ] as const) {
      const fixture = routeFixture("admin");
      const response = await fixture.app.request(path, { method: "POST", headers: { ...fixture.headers, ...jsonHeaders }, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid catalog library request", code: "INVALID_REQUEST" });
      expect(fixture.installExact).not.toHaveBeenCalled();
    }

    const invalidUtf8 = routeFixture("admin");
    const invalidResponse = await invalidUtf8.app.fetch(new Request("http://localhost/api/catalog-releases/release-skill/install", {
      method: "POST", headers: { ...invalidUtf8.headers, ...jsonHeaders }, body: new Uint8Array([0xff]),
    }));
    expect(invalidResponse.status).toBe(400);

    const oversized = routeFixture("admin");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(16 * 1024 + 1)); controller.close(); },
    });
    const oversizedResponse = await oversized.app.fetch(new Request("http://localhost/api/catalog-releases/release-skill/install", {
      method: "POST", headers: { ...oversized.headers, ...jsonHeaders }, body: stream, duplex: "half",
    } as RequestInit & { duplex: "half" }));
    expect(oversizedResponse.status).toBe(413);
    expect(await oversizedResponse.json()).toEqual({ error: "Catalog library request too large", code: "PAYLOAD_TOO_LARGE" });
  });

  it.each([
    ["RELEASE_NOT_APPROVED", 409, "Package release is not approved"],
    ["STATE_CONFLICT", 409, "Catalog library operation conflicts with current state"],
    ["INSPECTION_FAILED", 422, "Package inspection failed; last-known-good content is unchanged"],
    ["STORAGE_FAILURE", 500, "Catalog library operation failed"],
  ] as const)("translates %s to a fixed redacted envelope", async (code, status, message) => {
    const fixture = routeFixture("admin", { ok: false, code });
    const response = await fixture.app.request("/api/catalog-releases/release-skill/install", {
      method: "POST", headers: { ...fixture.headers, ...jsonHeaders }, body: JSON.stringify({ dependencyReleaseIds: [] }),
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message, code });
  });
});
