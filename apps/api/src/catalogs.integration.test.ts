import { afterEach, describe, expect, it } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import { createApp } from "./app";

let db: OrgOpsDb | undefined;
afterEach(() => db?.close());

describe("retired Catalog configuration routes", () => {
  it.each([
    ["GET", "/api/catalogs"],
    ["POST", "/api/catalogs"],
    ["GET", "/api/catalogs/legacy"],
    ["PATCH", "/api/catalogs/legacy"],
    ["DELETE", "/api/catalogs/legacy"],
    ["POST", "/api/catalogs/legacy/restore"],
  ])("returns framework-default 404 for %s %s", async (method, path) => {
    db = openDb(":memory:");
    const { app } = createApp({ db, adminUser: "owner", adminPass: "password" });
    const response = await app.request(path, { method });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).not.toBe("no-store");
    expect(await response.text()).not.toContain("CATALOG_RESOURCE_RETIRED");
  });
});
