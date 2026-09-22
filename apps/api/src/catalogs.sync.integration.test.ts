import { afterEach, describe, expect, it } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import { createApp } from "./app";

let db: OrgOpsDb | undefined;
afterEach(() => db?.close());

describe("retired Catalog synchronization routes", () => {
  it.each(["GET", "POST"])("returns framework-default 404 for %s /api/catalogs/legacy/sync", async method => {
    db = openDb(":memory:");
    const { app } = createApp({ db, adminUser: "owner", adminPass: "password" });
    const response = await app.request("/api/catalogs/legacy/sync", { method });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).not.toBe("no-store");
    expect(await response.text()).not.toContain("CATALOG_RESOURCE_RETIRED");
  });
});
