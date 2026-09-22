import { afterEach, describe, expect, it } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import { createApp } from "./app";

let db: OrgOpsDb | undefined;
afterEach(() => db?.close());

describe("retired Catalog import preview route", () => {
  it("returns framework-default 404 without preparing an import", async () => {
    db = openDb(":memory:");
    const { app } = createApp({ db, adminUser: "owner", adminPass: "password" });
    const response = await app.request("/api/catalogs/legacy/import-preview", { method: "POST" });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).not.toBe("no-store");
    expect(await response.text()).not.toContain("CATALOG_RESOURCE_RETIRED");
  });
});
