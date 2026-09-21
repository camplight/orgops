import { afterEach, describe, expect, it } from "vitest";
import { openDb, type OrgOpsDb } from "@orgops/db";
import { createApp } from "./app";

let db: OrgOpsDb | undefined;
afterEach(() => db?.close());

describe("retired Catalog installation route", () => {
  it("returns framework-default 404 without inspecting or installing content", async () => {
    db = openDb(":memory:");
    const { app } = createApp({ db, adminUser: "owner", adminPass: "password" });
    const response = await app.request("/api/catalogs/legacy/install", { method: "POST" });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).not.toBe("no-store");
    expect(await response.text()).not.toContain("CATALOG_RESOURCE_RETIRED");
  });
});
