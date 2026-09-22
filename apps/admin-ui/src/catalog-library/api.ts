import { apiUrl } from "../config";
import {
  ActivationPlanSchema,
  ApiActivationResultSchema,
  ApiActivationStateViewSchema,
  CancelRolloutResultSchema,
  GrantViewSchema,
  PackageReleaseViewSchema,
  RequirementReasonSchema,
  RetryFailedRolloutResultSchema,
  RolloutViewSchema,
  SnapshotViewSchema,
  SourceViewSchema,
  SyncAttemptViewSchema,
  type ActivationPlan as SchemaActivationPlan,
  type GrantView as SchemaGrantView,
  type PackageReleaseView as SchemaPackageReleaseView,
  type RolloutView as SchemaRolloutView,
  type SnapshotView as SchemaSnapshotView,
  type SourceView as SchemaSourceView,
  type SyncAttemptView as SchemaSyncAttemptView,
} from "@orgops/schemas";
import type {
  ActivationPlan, ApiActivationResult, ApiExecutionApprovalCommand, ApiExecutionActivationCommand, ApiExecutionDeactivationCommand,
  GrantView, ReleaseView, Result, RolloutView, SnapshotView, SourceLibraryApi as SourceLibraryApiContract, SourceView, SyncAttemptView,
} from "./api-types";

export type { ActivationPlanCommand, ApiActivationResult, ApiExecutionApprovalCommand, ApiExecutionActivationCommand, ApiExecutionDeactivationCommand, ActivationPlan, GrantView, ReleaseView, Result, RolloutView, SnapshotView, SourceView, SyncAttemptView } from "./api-types";
export type LibraryErrorCode = "INVALID_REQUEST" | "PAYLOAD_TOO_LARGE" | "FORBIDDEN" | "NOT_FOUND" | "REMOVED" | "REVISION_CONFLICT" | "STATE_CONFLICT" | "IDENTITY_CONFLICT" | "SOURCE_UNAVAILABLE" | "SOURCE_NOT_ALLOWED" | "RELEASE_NOT_APPROVED" | "GRANT_REQUIRED" | "INSTALLATION_REQUIRED" | "API_ACTIVATION_REQUIRED" | "REQUIREMENTS_UNSATISFIED" | "OPERATION_IN_PROGRESS" | "DEPLOYMENT_SUPERSEDED" | "INSPECTION_FAILED" | "STORAGE_FAILURE" | "SYNC_FAILED" | "CATALOG_RESOURCE_RETIRED" | "NETWORK" | "PROTOCOL";
export type LibraryError = { code: LibraryErrorCode; message: string };

const messages: Record<LibraryErrorCode, string> = { INVALID_REQUEST: "Invalid Source Library request.", PAYLOAD_TOO_LARGE: "Source Library request is too large.", FORBIDDEN: "Administrator access is required.", NOT_FOUND: "Source Library resource was not found.", REMOVED: "Source Library resource was removed.", REVISION_CONFLICT: "Source Library changed; reload before writing.", STATE_CONFLICT: "This Source Library action conflicts with current state.", IDENTITY_CONFLICT: "The Source Library identity is already reserved.", SOURCE_UNAVAILABLE: "The source is unavailable.", SOURCE_NOT_ALLOWED: "The source is not allowed.", RELEASE_NOT_APPROVED: "The release is not approved.", GRANT_REQUIRED: "A current grant is required.", INSTALLATION_REQUIRED: "Installation is required.", API_ACTIVATION_REQUIRED: "API execution approval is required.", REQUIREMENTS_UNSATISFIED: "Agent requirements are not satisfied.", OPERATION_IN_PROGRESS: "An operation is already in progress.", DEPLOYMENT_SUPERSEDED: "The runner deployment was superseded.", INSPECTION_FAILED: "Inspection failed; last-good content is unchanged.", STORAGE_FAILURE: "Source Library storage failed.", SYNC_FAILED: "Synchronization failed; last-good content is unchanged.", CATALOG_RESOURCE_RETIRED: "Catalog resource retired; use Source Library.", NETWORK: "The request outcome could not be confirmed.", PROTOCOL: "The Source Library response could not be confirmed." };

function protocol(): never { throw new Error("protocol"); }
function record(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) return protocol(); return Object.fromEntries(Object.entries(value)); }
function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T { const result = schema.safeParse(value); return result.success ? result.data : protocol(); }
function source(value: unknown): SourceView {
  const parsed: SchemaSourceView = parse(SourceViewSchema, value);
  return parsed;
}
function exactWrapper(value: unknown, key: string): unknown { const candidate = record(value); if (Object.keys(candidate).length !== 1 || !(key in candidate)) return protocol(); return candidate[key]; }
function mutationEnvelope(value: unknown, kind: string, requiredKey: string, optionalKeys: readonly string[] = []): Record<string, unknown> {
  const candidate = record(value); const keys = Object.keys(candidate);
  if (candidate.kind !== kind || keys.length < 2 || keys.length > 2 + optionalKeys.length || !keys.includes(requiredKey) || keys.some(key => key !== "kind" && key !== requiredKey && !optionalKeys.includes(key))) return protocol();
  return candidate;
}
function sourceMutation(value: unknown): SourceView {
  const candidate = mutationEnvelope(value, "source", "source", ["syncAttempt"]);
  if ("syncAttempt" in candidate) syncAttempt(candidate.syncAttempt);
  return source(candidate.source);
}
function sourceCreate(value: unknown): { source: SourceView; syncAttempt?: SyncAttemptView } {
  const candidate = mutationEnvelope(value, "source", "source", ["syncAttempt"]);
  return { source: source(candidate.source), ...(candidate.syncAttempt === undefined ? {} : { syncAttempt: syncAttempt(candidate.syncAttempt) }) };
}
function sourceList(value: unknown): SourceView[] { const candidate = Array.isArray(value) ? value : exactWrapper(value, "sources"); if (!Array.isArray(candidate)) return protocol(); return candidate.map(source); }
function syncAttempt(value: unknown): SyncAttemptView { const parsed: SchemaSyncAttemptView = parse(SyncAttemptViewSchema, value); if ((parsed.state === "RUNNING" && (parsed.snapshotId !== null || parsed.failureCode !== null)) || (parsed.state === "SUCCEEDED" && (parsed.snapshotId === null || parsed.failureCode !== null)) || ((parsed.state === "FAILED" || parsed.state === "ABANDONED") && parsed.failureCode === null)) return protocol(); return parsed; }
function syncResult(value: unknown): { source: SourceView; syncAttempt: SyncAttemptView } { const v = mutationEnvelope(value, "sync", "source", ["syncAttempt"]); if (!("syncAttempt" in v)) return protocol(); return { source: source(v.source), syncAttempt: syncAttempt(v.syncAttempt) }; }
function snapshot(value: unknown): SnapshotView { const parsed: SchemaSnapshotView = parse(SnapshotViewSchema, value); return parsed; }
function snapshotList(value: unknown): SnapshotView[] { const candidate = Array.isArray(value) ? value : exactWrapper(value, "snapshots"); if (!Array.isArray(candidate)) return protocol(); return candidate.map(snapshot); }
function attemptList(value: unknown): SyncAttemptView[] { const candidate = Array.isArray(value) ? value : exactWrapper(value, "attempts"); if (!Array.isArray(candidate)) return protocol(); return candidate.map(syncAttempt); }
function release(value: unknown): ReleaseView {
  const parsed: SchemaPackageReleaseView = parse(PackageReleaseViewSchema, value);
  const activation = parse(ApiActivationStateViewSchema, parsed.apiActivation);
  if ((activation.approvalState === "NOT_REQUIRED" || activation.approvalState === "AWAITING_APPROVAL" || activation.approvalState === "REVOKED") && activation.runtimeState !== "INACTIVE") return protocol();
  if (activation.runtimeState !== "INACTIVE" && activation.approvalState !== "APPROVED") return protocol();
  if ((activation.runtimeState === "FAILED") !== (activation.failureCode !== null)) return protocol();
  return { ...parsed, manifest: { ...parsed.manifest }, executionPreview: { ...parsed.executionPreview, apiEventShapes: [...parsed.executionPreview.apiEventShapes], runnerScripts: [...parsed.executionPreview.runnerScripts], wrappedCommands: parsed.executionPreview.wrappedCommands.map(command => ({ ...command, args: [...command.args] })), externalSources: parsed.executionPreview.externalSources.map(item => ({ ...item })) }, warnings: parsed.warnings.map(warning => ({ ...warning })), files: parsed.files.map(file => ({ ...file })), apiActivation: activation };
}
function releaseList(value: unknown): ReleaseView[] { const candidate = Array.isArray(value) ? value : exactWrapper(value, "releases"); if (!Array.isArray(candidate)) return protocol(); return candidate.map(release); }
function releaseMutation(value: unknown): ReleaseView { return release(mutationEnvelope(value, "review", "release").release); }
function activation(value: unknown, releaseId: string): ApiActivationResult { const parsed = parse(ApiActivationResultSchema, value); if (parsed.releaseId !== releaseId) return protocol(); if ((parsed.approvalState === "NOT_REQUIRED" || parsed.approvalState === "AWAITING_APPROVAL" || parsed.approvalState === "REVOKED") && parsed.runtimeState !== "INACTIVE") return protocol(); if (parsed.runtimeState !== "INACTIVE" && parsed.approvalState !== "APPROVED") return protocol(); if ((parsed.runtimeState === "FAILED") !== (parsed.failureCode !== null)) return protocol(); return parsed; }
function grant(value: unknown): GrantView { return parse(GrantViewSchema, mutationEnvelope(value, "grant", "grant").grant); }
function grants(value: unknown): GrantView[] { const candidate = Array.isArray(value) ? value : exactWrapper(value, "grants"); if (!Array.isArray(candidate)) return protocol(); return candidate.map(item => parse(GrantViewSchema, item)); }
function plan(value: unknown): ActivationPlan { const parsed: SchemaActivationPlan = parse(ActivationPlanSchema, value); parsed.targets.forEach(target => { parse(RequirementReasonSchema.nullable(), target.blocker); }); return { planDigest: parsed.planDigest, releaseId: parsed.releaseId, operation: parsed.operation, ...(parsed.operation === "SET_PRELOAD" ? { preload: parsed.preload } : {}), targets: parsed.targets.map(target => ({ ...target })) }; }
function rollout(value: unknown): RolloutView { const parsed: SchemaRolloutView = parse(RolloutViewSchema, value); return { id: parsed.id, releaseId: parsed.releaseId, operation: parsed.operation, ...(parsed.operation === "SET_PRELOAD" ? { preload: parsed.preload } : {}), state: parsed.state, revision: parsed.revision, targetIds: [...parsed.targetIds], targets: parsed.targets.map(target => ({ ...target })) }; }
function rolloutResult(value: unknown) { const parsed = parse(CancelRolloutResultSchema, value); return { rollout: rollout(parsed.rollout), skippedTargetIds: [...parsed.skippedTargetIds] }; }
function retryResult(value: unknown) { const parsed = parse(RetryFailedRolloutResultSchema, value); return { rollout: rollout(parsed.rollout), targetIds: [...parsed.targetIds], deploymentIds: [...parsed.deploymentIds] }; }
const installResultSchema = {
  safeParse(value: unknown) {
    try {
      const v = record(value); const packages = v.packages;
      if (v.ok !== true || v.activated !== false || !Array.isArray(packages) || packages.length === 0) return { success: false as const };
      const parsed = packages.map(item => { const p = record(item); if (typeof p.packageReleaseId !== "string" || (p.action !== "installed" && p.action !== "reused") || Object.keys(p).length !== 2) throw new Error(); return { packageReleaseId: p.packageReleaseId, action: p.action }; });
      if (Object.keys(v).length !== 3) return { success: false as const }; return { success: true as const, data: { ok: true as const, packages: parsed, activated: false as const } };
    } catch { return { success: false as const }; }
  },
};
function installResult(value: unknown) { return parse(installResultSchema, value); }

export type SourceLibraryApi = SourceLibraryApiContract;
export function createSourceLibraryApi(fetchImpl: typeof fetch = fetch): SourceLibraryApi {
  async function request<T>(path: string, method: string, decode: (body: unknown) => T, body?: unknown, signal?: AbortSignal): Promise<Result<T>> {
    try {
      const response = await fetchImpl(apiUrl(path), { method, credentials: "include", cache: "no-store", signal, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
      if (response.status === 204) return { ok: true, value: undefined as T };
      const payload = await response.json().catch(() => null);
      if (!response.ok) { const candidate = payload !== null && typeof payload === "object" && !Array.isArray(payload) ? record(payload) : {}; const rawCode = candidate.code; const code: LibraryErrorCode = typeof rawCode === "string" && rawCode in messages ? rawCode as LibraryErrorCode : response.status === 401 || response.status === 403 ? "FORBIDDEN" : response.status === 409 ? "STATE_CONFLICT" : response.status === 404 ? "NOT_FOUND" : "PROTOCOL"; return { ok: false, error: { code, message: messages[code] } }; }
      return { ok: true, value: decode(payload) };
    } catch (error) { return { ok: false, error: { code: error instanceof Error && error.message === "protocol" ? "PROTOCOL" : "NETWORK", message: error instanceof Error && error.message === "protocol" ? messages.PROTOCOL : messages.NETWORK } }; }
  }
  const path = (id: string, suffix = "") => `/api/catalog-sources/${encodeURIComponent(id)}${suffix}`;
  const releasePath = (id: string, suffix = "") => `/api/catalog-releases/${encodeURIComponent(id)}${suffix}`;
  const json = (method: string, route: string, body: unknown, signal?: AbortSignal) => request(route, method, route.includes("/install") ? installResult : route.includes("/sync") ? syncResult : route.startsWith("/api/catalog-sources") ? sourceMutation : record, body, signal);
  return {
    listSources: signal => request("/api/catalog-sources", "GET", sourceList, undefined, signal), getSource: (id, signal) => request(path(id), "GET", source, undefined, signal), createSource: (input, signal) => request("/api/catalog-sources", "POST", sourceCreate, { sourceId: input.sourceId, displayName: input.displayName, repository: input.repository, ref: input.ref, enabled: input.enabled, allowPackages: input.allowPackages }, signal), patchSource: (id, input, signal) => json("PATCH", path(id), { expectedRevision: input.expectedRevision, ...(input.displayName === undefined ? {} : { displayName: input.displayName }), ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...(input.allowPackages === undefined ? {} : { allowPackages: input.allowPackages }) }, signal), removeSource: (id, input, signal) => json("DELETE", path(id), { expectedRevision: input.expectedRevision }, signal), restoreSource: (id, input, signal) => json("POST", path(id, "/restore"), { expectedRevision: input.expectedRevision }, signal), putReadCredential: (id, input, signal) => json("PUT", path(id, "/read-credential"), { expectedRevision: input.expectedRevision, kind: "https-basic", username: input.username, password: input.password }, signal), deleteReadCredential: (id, input, signal) => json("DELETE", path(id, "/read-credential"), { expectedRevision: input.expectedRevision }, signal), syncSource: (id, input, signal) => request(path(id, "/sync"), "POST", syncResult, { expectedRevision: input.expectedRevision }, signal), listAttempts: (id, signal) => request(path(id, "/sync-attempts"), "GET", attemptList, undefined, signal), listSnapshots: (id, signal) => request(path(id, "/snapshots"), "GET", snapshotList, undefined, signal),
    listReleases: signal => request("/api/catalog-releases", "GET", releaseList, undefined, signal), getRelease: (id, signal) => request(releasePath(id), "GET", release, undefined, signal), reviewRelease: (id, action, input, signal) => request(releasePath(id, `/${action}`), "POST", releaseMutation, { expectedRevision: input.expectedRevision, digest: input.digest, reviewDigest: input.reviewDigest }, signal), installRelease: (id, input, signal) => json("POST", releasePath(id, "/install"), input, signal), listGrants: (id, signal) => request(releasePath(id, "/grants"), "GET", grants, undefined, signal), grantOrganization: (id, input, signal) => request(releasePath(id, "/grants/organization"), "PUT", grant, { expectedRevision: input.expectedRevision }, signal), revokeOrganization: (id, input, signal) => request(releasePath(id, "/grants/organization"), "DELETE", grant, input, signal), grantHuman: (id, humanId, input, signal) => request(releasePath(id, `/grants/humans/${encodeURIComponent(humanId)}`), "PUT", grant, { expectedRevision: input.expectedRevision }, signal), revokeHuman: (id, humanId, input, signal) => request(releasePath(id, `/grants/humans/${encodeURIComponent(humanId)}`), "DELETE", grant, input, signal), listHumans: signal => request("/api/humans", "GET", value => { const candidate = Array.isArray(value) ? value : record(value).humans; if (!Array.isArray(candidate)) return protocol(); return candidate.map(item => { const v = record(item); if (typeof v.id !== "string" || Object.keys(v).some(key => !["id", "username", "displayName"].includes(key)) || (v.username !== undefined && typeof v.username !== "string") || (v.displayName !== undefined && typeof v.displayName !== "string")) return protocol(); return { id: v.id, ...(v.username === undefined ? {} : { username: v.username }), ...(v.displayName === undefined ? {} : { displayName: v.displayName }) }; }); }, undefined, signal),
    approveApiExecution: (input, signal) => request(releasePath(input.releaseId, "/api-execution/approve"), "POST", value => activation(value, input.releaseId), { expectedRevision: input.expectedRevision, digest: input.digest }, signal), activateApiExecution: (input, signal) => request(releasePath(input.releaseId, "/api-execution/activate"), "POST", value => activation(value, input.releaseId), { expectedRevision: input.expectedRevision }, signal), deactivateApiExecution: (input, signal) => request(releasePath(input.releaseId, "/api-execution/deactivate"), "POST", value => activation(value, input.releaseId), { expectedRevision: input.expectedRevision }, signal), planRollout: (input, signal) => request("/api/catalog-rollouts/plan", "POST", plan, input, signal), confirmRollout: (input, signal) => request("/api/catalog-rollouts", "POST", rollout, input, signal), getRollout: (id, signal) => request(`/api/catalog-rollouts/${encodeURIComponent(id)}`, "GET", rollout, undefined, signal), cancelRollout: (input, signal) => request(`/api/catalog-rollouts/${encodeURIComponent(input.rolloutId)}/cancel`, "POST", rolloutResult, input, signal), retryRollout: (input, signal) => request(`/api/catalog-rollouts/${encodeURIComponent(input.rolloutId)}/retry-failed`, "POST", retryResult, input, signal),
  };
}
