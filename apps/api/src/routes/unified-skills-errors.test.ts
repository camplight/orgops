import { describe, expect, it, vi } from "vitest";
import { CatalogLibraryErrorCodeSchema, type CatalogLibraryErrorCode } from "@orgops/schemas";
import { Hono } from "hono";
import { unifiedSkillsErrorResponse } from "./unified-skills-errors";
import { registerUnifiedSkillRoutes } from "./unified-skills";

const expected: Record<CatalogLibraryErrorCode, { status: number; message: string }> = {
  INVALID_REQUEST: { status: 400, message: "Invalid request" },
  PAYLOAD_TOO_LARGE: { status: 413, message: "Request payload is too large" },
  FORBIDDEN: { status: 403, message: "Request is forbidden" },
  NOT_FOUND: { status: 404, message: "Resource not found" },
  REMOVED: { status: 409, message: "Resource was removed" },
  REVISION_CONFLICT: { status: 409, message: "Resource changed; reload before retrying" },
  STATE_CONFLICT: { status: 409, message: "Resource state conflicts with this request" },
  IDENTITY_CONFLICT: { status: 409, message: "Package identity conflicts with the immutable release" },
  SOURCE_NOT_ALLOWED: { status: 403, message: "Source policy does not allow this package" },
  SOURCE_UNAVAILABLE: { status: 503, message: "The Source is unavailable; last-good data remains selected" },
  RELEASE_NOT_APPROVED: { status: 409, message: "Package release is not approved" },
  GRANT_REQUIRED: { status: 403, message: "A current grant is required" },
  INSTALLATION_REQUIRED: { status: 409, message: "Package release is not installed" },
  API_ACTIVATION_REQUIRED: { status: 409, message: "API execution approval and activation are required" },
  REQUIREMENTS_UNSATISFIED: { status: 409, message: "Agent requirements are not satisfied" },
  OPERATION_IN_PROGRESS: { status: 409, message: "Another operation is in progress" },
  DEPLOYMENT_SUPERSEDED: { status: 409, message: "A newer deployment replaced this request" },
  INSPECTION_FAILED: { status: 422, message: "Package inspection failed" },
  STORAGE_FAILURE: { status: 500, message: "OrgOps could not save this change" },
  SYNC_FAILED: { status: 502, message: "Source synchronization failed; last-good data remains selected" },
  CATALOG_RESOURCE_RETIRED: { status: 404, message: "Catalog resource is retired" },
};

describe("unified skills fixed error contract", () => {
  it("maps every code to the exact shared status and fixed message", () => {
    expect(Object.keys(expected).sort()).toEqual([...CatalogLibraryErrorCodeSchema.options].sort());
    for (const code of CatalogLibraryErrorCodeSchema.options) expect(unifiedSkillsErrorResponse(code)).toEqual({ code, ...expected[code] });
    expect(unifiedSkillsErrorResponse("private sqlite failure")).toEqual({ code: "STORAGE_FAILURE", ...expected.STORAGE_FAILURE });
  });

  it.each(["REMOVED", "SOURCE_UNAVAILABLE", "SYNC_FAILED"] as const)("routes %s through the shared canonical inventory adapter", async code => {
    const app = new Hono();
    registerUnifiedSkillRoutes(app, {
      requireAuth: async (c: any, next: any) => { c.set("user", { id: "human-a", username: "admin" }); await next(); },
      actor: () => ({ kind: "HUMAN_ADMIN", id: "human-a" }),
      inventory: { list: vi.fn(async () => { throw new Error(code); }), listForAgent: vi.fn() },
    });
    const response = await app.request("http://localhost/api/skills/inventory");
    expect(response.status).toBe(expected[code].status);
    expect(await response.json()).toEqual({ error: expected[code].message, code });
  });
});
