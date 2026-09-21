import { afterEach, describe, expect, it } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import { createApp } from "../app";

let db: OrgOpsDb | undefined;
afterEach(() => db?.close());

describe("Catalog namespace after the completed compatibility window", () => {
  it.each([
    ["GET", "/api/catalogs"],
    ["POST", "/api/catalogs"],
    ["PATCH", "/api/catalogs"],
    ["DELETE", "/api/catalogs"],
    ["GET", "/api/catalogs/legacy"],
    ["POST", "/api/catalogs/legacy/sync"],
    ["PATCH", "/api/catalogs/legacy/sync"],
    ["DELETE", "/api/catalogs/legacy/sync"],
    ["GET", "/api/catalogs/legacy/deep/path?query=one"],
    ["GET", "/api/catalogs/"],
    ["GET", "/api/not-a-registered-endpoint"],
    ["PATCH", "/api/auth/login"],
  ])("returns principal-independent framework 404 for %s %s", async (method, path) => {
    db = openDb(":memory:");
    const { app } = createApp({ db, adminUser: "owner", adminPass: "password", runnerToken: "runner-token" });
    const login = await app.request("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "owner", password: "password" }),
    });
    const adminCookie = (login.headers.get("set-cookie") ?? "").split(";", 1)[0];
    expect(adminCookie).toMatch(/^orgops_session=.+/);
    for (const headers of [{}, { cookie: "orgops_session=not-a-session" }, { cookie: adminCookie }, { "x-orgops-runner-token": "runner-token" }, { "x-orgops-runner-token": "bad", cookie: adminCookie }]) {
      const response = await app.request(path, { method, headers });
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toBe("text/plain; charset=UTF-8");
      expect(await response.text()).toBe("404 Not Found");
      expect(response.headers.get("cache-control")).not.toBe("no-store");
      expect(response.headers.has("x-orgops-catalog-retired")).toBe(false);
    }
  });
});
