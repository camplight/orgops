import { CatalogLibraryErrorCodeSchema, type CatalogLibraryErrorCode } from "@orgops/schemas";

export type UnifiedSkillsError = Readonly<{ code: CatalogLibraryErrorCode; status: number; message: string }>;

const responses: Record<CatalogLibraryErrorCode, Omit<UnifiedSkillsError, "code">> = {
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

export function unifiedSkillsErrorResponse(value: unknown): UnifiedSkillsError {
  const candidate = value && typeof value === "object" && "code" in value ? (value as { code?: unknown }).code : value instanceof Error ? value.message : value;
  const parsed = CatalogLibraryErrorCodeSchema.safeParse(candidate);
  const code = parsed.success ? parsed.data : "STORAGE_FAILURE";
  return { code, ...responses[code] };
}
