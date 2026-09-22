import { afterEach, describe, expect, it } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import { createApp } from "./app";

let db: OrgOpsDb | undefined;
afterEach(() => db?.close());

describe("retired Catalog package routes", () => {
  it.each([
    "/api/catalogs/legacy/packages",
    "/api/catalogs/legacy/packages/demo-skill/1.0.0",
  ])("returns framework-default 404 for %s", async path => {
    db = openDb(":memory:");
    const { app } = createApp({ db, adminUser: "owner", adminPass: "password" });
    const response = await app.request(path);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).not.toBe("no-store");
    expect(await response.text()).not.toContain("CATALOG_RESOURCE_RETIRED");
  });
});
