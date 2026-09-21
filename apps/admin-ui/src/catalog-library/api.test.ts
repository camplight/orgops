import { describe, expect, it } from "vitest";
import { createSourceLibraryApi } from "./api";

const digest = `sha256:${"a".repeat(64)}`;
const source = { sourceId: "source-team", displayName: "Team", canonicalUrl: "https://example.test/team.git", repositoryIdentity: "https://example.test/team.git", ref: "main", enabled: true, allowPackages: true, revision: 2, removedAt: null, currentSnapshotId: "snap-1", hasReadCredential: false };
const release = {
  packageReleaseId: "release-team", authoritySourceId: "source-team", contentSourceId: "source-team", kind: "skill", name: "demo", version: "1.0.0", digest,
  catalogCommit: "a".repeat(40), packageCommit: "b".repeat(40), packagePath: "skills/demo",
  manifest: { formatVersion: 1, kind: "skill", name: "demo", version: "1.0.0", digest, description: "demo", author: "author", license: "MIT", compatibility: { orgops: { min: "1.0.0" }, platforms: ["linux"], tools: [] }, dependencies: [], secrets: [], files: [{ path: "SKILL.md", size: 10, digest, executable: false }], executables: [], skill: { entrypoint: "SKILL.md" } },
  executionPreview: { apiEventShapes: [], runnerScripts: [], wrappedCommands: [], externalSources: [] }, warnings: [], files: [], reviewState: "PENDING", reviewDigest: null, reviewer: null, installationState: "ABSENT",
  apiActivation: { approvalState: "AWAITING_APPROVAL", runtimeState: "INACTIVE", revision: 1, failureCode: null }, revision: 1,
};
const attempt = { attemptId: "attempt-1", sourceId: source.sourceId, state: "SUCCEEDED", snapshotId: "snap-1", failureCode: null, revision: 1 };
const snapshot = { snapshotId: "snap-1", sourceId: source.sourceId, sourceCommit: "c".repeat(40), indexDigest: digest, observedRef: "main", createdAt: 1 };
const grant = { grantId: "grant-1", releaseId: release.packageReleaseId, subject: { kind: "HUMAN", humanId: "human-a" }, revision: 1, revokedAt: null };
const activation = { releaseId: release.packageReleaseId, approvalState: "APPROVED", runtimeState: "ACTIVE", revision: 3, failureCode: null };
const rollout = { id: "rollout-1", releaseId: release.packageReleaseId, operation: "SET_PRELOAD", preload: true, state: "QUEUED", revision: 1, targetIds: ["agent-a"], targets: [{ agentId: "agent-a", state: "QUEUED", attempts: 0, reasonCode: null }] };
const sourceMutationResult = { kind: "source", source };
const syncMutationResult = { kind: "sync", source, syncAttempt: attempt };
const reviewMutationResult = { kind: "review", release };
const grantMutationResult = { kind: "grant", grant };
const plan = { planDigest: digest, releaseId: release.packageReleaseId, operation: "SET_PRELOAD", preload: true, targets: [{ agentId: "agent-a", assignmentRevision: 1, runnerId: "runner-a", plannedPreload: true, blocker: null }] };

function response(body: unknown, status = 200) { return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function recording(bodyFor: (path: string, method: string) => unknown = () => ({})) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => { const url = String(input); const request = { url, init: init ?? {} }; calls.push(request); return response(bodyFor(new URL(url, "https://example.test").pathname, init?.method ?? "GET")); };
  return { api: createSourceLibraryApi(fetchImpl as typeof fetch), calls };
}

type SourceLibraryApiClient = ReturnType<typeof createSourceLibraryApi>;
type ExactCase = readonly [
  name: string,
  invoke: (api: SourceLibraryApiClient) => Promise<unknown>,
  method: string,
  path: string,
  body: unknown,
  decoded: unknown,
];

const reviewCases = (["approve", "reject", "withdraw", "reopen"] as const).map(action => [
  `reviewRelease:${action}`, (api: SourceLibraryApiClient) => api.reviewRelease("release/team", action, { expectedRevision: 1, digest, reviewDigest: digest }), "POST", `/api/catalog-releases/release%2Fteam/${action}`, { expectedRevision: 1, digest, reviewDigest: digest }, { release },
] as const satisfies ExactCase);

const exactCases = [
  ["listSources", (api: ReturnType<typeof createSourceLibraryApi>) => api.listSources(), "GET", "/api/catalog-sources", undefined, [source]],
  ["getSource", (api: ReturnType<typeof createSourceLibraryApi>) => api.getSource("source/team"), "GET", "/api/catalog-sources/source%2Fteam", undefined, source],
  ["createSource", (api: ReturnType<typeof createSourceLibraryApi>) => api.createSource({ sourceId: "source/team", displayName: "Team", repository: { url: "https://example.test/team.git" }, ref: "main", enabled: true, allowPackages: false, credential: "must-not-send" }), "POST", "/api/catalog-sources", { sourceId: "source/team", displayName: "Team", repository: { url: "https://example.test/team.git" }, ref: "main", enabled: true, allowPackages: false }, source],
  ["patchSource", (api: ReturnType<typeof createSourceLibraryApi>) => api.patchSource("source/team", { expectedRevision: 2, displayName: "Renamed", enabled: false, allowPackages: true, repository: "must-not-send", ref: "must-not-send" }), "PATCH", "/api/catalog-sources/source%2Fteam", { expectedRevision: 2, displayName: "Renamed", enabled: false, allowPackages: true }, source],
  ["removeSource", (api: ReturnType<typeof createSourceLibraryApi>) => api.removeSource("source/team", { expectedRevision: 2 }), "DELETE", "/api/catalog-sources/source%2Fteam", { expectedRevision: 2 }, undefined],
  ["restoreSource", (api: ReturnType<typeof createSourceLibraryApi>) => api.restoreSource("source/team", { expectedRevision: 2 }), "POST", "/api/catalog-sources/source%2Fteam/restore", { expectedRevision: 2 }, source],
  ["putReadCredential", (api: ReturnType<typeof createSourceLibraryApi>) => api.putReadCredential("source/team", { expectedRevision: 2, kind: "https-basic", username: "reader", password: "secret" }), "PUT", "/api/catalog-sources/source%2Fteam/read-credential", { expectedRevision: 2, kind: "https-basic", username: "reader", password: "secret" }, undefined],
  ["deleteReadCredential", (api: ReturnType<typeof createSourceLibraryApi>) => api.deleteReadCredential("source/team", { expectedRevision: 2 }), "DELETE", "/api/catalog-sources/source%2Fteam/read-credential", { expectedRevision: 2 }, undefined],
  ["syncSource", (api: ReturnType<typeof createSourceLibraryApi>) => api.syncSource("source/team", { expectedRevision: 2 }), "POST", "/api/catalog-sources/source%2Fteam/sync", { expectedRevision: 2 }, undefined],
  ["listAttempts", (api: ReturnType<typeof createSourceLibraryApi>) => api.listAttempts("source/team"), "GET", "/api/catalog-sources/source%2Fteam/sync-attempts", undefined, [attempt]],
  ["listSnapshots", (api: ReturnType<typeof createSourceLibraryApi>) => api.listSnapshots("source/team"), "GET", "/api/catalog-sources/source%2Fteam/snapshots", undefined, [snapshot]],
  ["listReleases", (api: ReturnType<typeof createSourceLibraryApi>) => api.listReleases(), "GET", "/api/catalog-releases", undefined, [release]],
  ["getRelease", (api: ReturnType<typeof createSourceLibraryApi>) => api.getRelease("release/team"), "GET", "/api/catalog-releases/release%2Fteam", undefined, release],
  ...reviewCases,
  ["installRelease", (api: ReturnType<typeof createSourceLibraryApi>) => api.installRelease("release/team", { dependencyReleaseIds: ["release/dep"] }), "POST", "/api/catalog-releases/release%2Fteam/install", { dependencyReleaseIds: ["release/dep"] }, undefined],
  ["listGrants", (api: ReturnType<typeof createSourceLibraryApi>) => api.listGrants("release/team"), "GET", "/api/catalog-releases/release%2Fteam/grants", undefined, [grant]],
  ["grantOrganization", (api: ReturnType<typeof createSourceLibraryApi>) => api.grantOrganization("release/team", { expectedRevision: 1 }), "PUT", "/api/catalog-releases/release%2Fteam/grants/organization", { expectedRevision: 1 }, { grant }],
  ["revokeOrganization", (api: ReturnType<typeof createSourceLibraryApi>) => api.revokeOrganization("release/team", { expectedRevision: 1 }), "DELETE", "/api/catalog-releases/release%2Fteam/grants/organization", { expectedRevision: 1 }, undefined],
  ["grantHuman", (api: ReturnType<typeof createSourceLibraryApi>) => api.grantHuman("release/team", "human/a", { expectedRevision: 1 }), "PUT", "/api/catalog-releases/release%2Fteam/grants/humans/human%2Fa", { expectedRevision: 1 }, { grant }],
  ["revokeHuman", (api: ReturnType<typeof createSourceLibraryApi>) => api.revokeHuman("release/team", "human/a", { expectedRevision: 1 }), "DELETE", "/api/catalog-releases/release%2Fteam/grants/humans/human%2Fa", { expectedRevision: 1 }, undefined],
  ["approveApiExecution", (api: ReturnType<typeof createSourceLibraryApi>) => api.approveApiExecution({ releaseId: "release-team", expectedRevision: 1, digest }), "POST", "/api/catalog-releases/release-team/api-execution/approve", { expectedRevision: 1, digest }, activation],
  ["activateApiExecution", (api: ReturnType<typeof createSourceLibraryApi>) => api.activateApiExecution({ releaseId: "release-team", expectedRevision: 2 }), "POST", "/api/catalog-releases/release-team/api-execution/activate", { expectedRevision: 2 }, activation],
  ["deactivateApiExecution", (api: ReturnType<typeof createSourceLibraryApi>) => api.deactivateApiExecution({ releaseId: "release-team", expectedRevision: 3 }), "POST", "/api/catalog-releases/release-team/api-execution/deactivate", { expectedRevision: 3 }, activation],
  ["planRollout", (api: ReturnType<typeof createSourceLibraryApi>) => api.planRollout({ releaseId: "release/team", agentIds: ["agent/a"], operation: "SET_PRELOAD", preload: true }), "POST", "/api/catalog-rollouts/plan", { releaseId: "release/team", agentIds: ["agent/a"], operation: "SET_PRELOAD", preload: true }, rollout],
  ["confirmRollout", (api: ReturnType<typeof createSourceLibraryApi>) => api.confirmRollout({ planDigest: digest, agentIds: ["agent/a"] }), "POST", "/api/catalog-rollouts", { planDigest: digest, agentIds: ["agent/a"] }, rollout],
  ["getRollout", (api: ReturnType<typeof createSourceLibraryApi>) => api.getRollout("rollout/1"), "GET", "/api/catalog-rollouts/rollout%2F1", undefined, rollout],
  ["cancelRollout", (api: ReturnType<typeof createSourceLibraryApi>) => api.cancelRollout({ rolloutId: "rollout/1", expectedRevision: 1 }), "POST", "/api/catalog-rollouts/rollout%2F1/cancel", { rolloutId: "rollout/1", expectedRevision: 1 }, { rollout, skippedTargetIds: [] }],
  ["retryRollout", (api: ReturnType<typeof createSourceLibraryApi>) => api.retryRollout({ rolloutId: "rollout/1", expectedRevision: 1 }), "POST", "/api/catalog-rollouts/rollout%2F1/retry-failed", { rolloutId: "rollout/1", expectedRevision: 1 }, { rollout, targetIds: ["agent/a"], deploymentIds: [] }],
] satisfies readonly ExactCase[];

describe("Source Library API", () => {
  it.each(exactCases)("maps %s to one exact request", async (_name, invoke, method, path, body, _decoded) => {
    const { api, calls } = recording(currentPath => currentPath.includes("sync-attempts") ? { attempts: [attempt] } : currentPath.endsWith("/snapshots") ? { snapshots: [snapshot] } : currentPath === "/api/catalog-sources" && method === "GET" ? { sources: [source] } : currentPath === "/api/catalog-releases" ? { releases: [release] } : currentPath.includes("/api/catalog-releases/") && currentPath.includes("/grants") ? (currentPath.endsWith("/grants") ? { grants: [grant] } : grantMutationResult) : currentPath.includes("/api-execution/") ? activation : currentPath.includes("/api/catalog-releases/") ? (currentPath.includes("/install") ? { ok: true, packages: [{ packageReleaseId: release.packageReleaseId, action: "installed" }], activated: false } : (currentPath.endsWith("/approve") || currentPath.endsWith("/reject") || currentPath.endsWith("/withdraw") || currentPath.endsWith("/reopen") ? reviewMutationResult : release)) : currentPath === "/api/catalog-rollouts/plan" ? plan : currentPath === "/api/catalog-rollouts" || currentPath.includes("/cancel") || currentPath.includes("/retry-failed") ? (currentPath.includes("/cancel") ? { rollout, skippedTargetIds: [] } : currentPath.includes("retry-failed") ? { rollout, targetIds: ["agent-a"], deploymentIds: ["deployment-1"] } : rollout) : currentPath.startsWith("/api/catalog-rollouts/") ? rollout : currentPath.includes("/install") ? { ok: true, packages: [{ packageReleaseId: release.packageReleaseId, action: "installed" }], activated: false } : currentPath.endsWith("/read-credential") ? sourceMutationResult : currentPath.endsWith("/sync") ? syncMutationResult : currentPath.startsWith("/api/catalog-sources/") && method === "GET" ? source : sourceMutationResult);
    const result = await invoke(api);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(path);
    expect(calls[0].init.method).toBe(method);
    expect(calls[0].init.credentials).toBe("include");
    expect(calls[0].init.cache).toBe("no-store");
    if (body === undefined) expect(calls[0].init.body).toBeUndefined();
    else expect(JSON.parse(String(calls[0].init.body))).toEqual(body);
  });

  it("rejects bare and malformed mutation envelopes", async () => {
    const cases = [
      ["source", (api: SourceLibraryApiClient) => api.patchSource("source", { expectedRevision: 1 }), source, { kind: "wrong", source }, { kind: "source", source, extra: true }, { kind: "source", source, syncAttempt: { ...attempt, revision: "bad" } }],
      ["sync", (api: SourceLibraryApiClient) => api.syncSource("source", { expectedRevision: 1 }), { source, syncAttempt: attempt }, { kind: "wrong", source, syncAttempt: attempt }, { kind: "sync", source, syncAttempt: attempt, extra: true }, { kind: "sync", source, syncAttempt: { ...attempt, revision: "bad" } }],
      ["review", (api: SourceLibraryApiClient) => api.reviewRelease("release", "approve", { expectedRevision: 1, digest, reviewDigest: digest }), release, { kind: "review", release: source }, { kind: "review", release, extra: true }, { kind: "grant", release }],
      ["grant", (api: SourceLibraryApiClient) => api.grantOrganization("release", { expectedRevision: 1 }), grant, { grant }, { kind: "grant", grant, extra: true }, { kind: "review", grant }],
    ] as const;
    for (const [_name, invoke, ...payloads] of cases) {
      for (const payload of payloads) {
        const api = createSourceLibraryApi(async () => response(payload));
        await expect(invoke(api)).resolves.toMatchObject({ ok: false, error: { code: "PROTOCOL" } });
      }
    }
    const malformedOptionalAttempt = createSourceLibraryApi(async () => response({ kind: "source", source, syncAttempt: { ...attempt, failureCode: 7 } }));
    await expect(malformedOptionalAttempt.patchSource("source", { expectedRevision: 1 })).resolves.toMatchObject({ ok: false, error: { code: "PROTOCOL" } });
  });

  it("rejects cross-field activation states and unknown dependency keys", async () => {
    const malformedActivation = createSourceLibraryApi(async () => response({ ...release, apiActivation: { ...release.apiActivation, approvalState: "AWAITING_APPROVAL", runtimeState: "ACTIVE" } }));
    await expect(malformedActivation.getRelease(release.packageReleaseId)).resolves.toMatchObject({ ok: false, error: { code: "PROTOCOL" } });

    const malformedDependency = createSourceLibraryApi(async () => response({ ...release, manifest: { ...release.manifest, dependencies: [{ catalogId: "catalog", sourceId: "source/team", name: "dep", version: "1.0.0", digest, revision: { type: "exact", commit: "commit" }, unexpected: true }] } }));
    await expect(malformedDependency.getRelease(release.packageReleaseId)).resolves.toMatchObject({ ok: false, error: { code: "PROTOCOL" } });
  });

  it("forwards the caller AbortSignal and accepts a 204 mutation response", async () => {
    const calls: RequestInit[] = [];
    const controller = new AbortController();
    const api = createSourceLibraryApi(async (_input, init) => { calls.push(init ?? {}); return response(null, 204); });
    const result = await api.removeSource("source", { expectedRevision: 4 }, controller.signal);
    expect(result).toEqual({ ok: true, value: undefined });
    expect(calls[0].signal).toBe(controller.signal);
  });

  it("maps fixed server errors without exposing response metadata", async () => {
    const api = createSourceLibraryApi(async () => response({ code: "REVISION_CONFLICT", error: "url=https://secret.invalid/path", path: "/tmp/private", credential: "plaintext" }, 409));
    await expect(api.patchSource("source", { expectedRevision: 1 })).resolves.toEqual({ ok: false, error: { code: "REVISION_CONFLICT", message: "Source Library changed; reload before writing." } });
  });

  it("fails closed on unknown source keys and non-canonical release fields", async () => {
    const unknownSource = createSourceLibraryApi(async () => response({ ...source, unexpected: true }));
    await expect(unknownSource.getSource(source.sourceId)).resolves.toMatchObject({ ok: false, error: { code: "PROTOCOL" } });

    const unknownWarning = createSourceLibraryApi(async () => response({ ...release, warnings: [{ code: "RUNNER_SCRIPT", at: "runner.ts" }] }));
    await expect(unknownWarning.getRelease(release.packageReleaseId)).resolves.toMatchObject({ ok: false, error: { code: "PROTOCOL" } });

    const malformedFile = createSourceLibraryApi(async () => response({ ...release, files: [{ path: "SKILL.md", mode: 0o600, size: -1, digest: "not-a-digest" }] }));
    await expect(malformedFile.getRelease(release.packageReleaseId)).resolves.toMatchObject({ ok: false, error: { code: "PROTOCOL" } });

    const malformedInstall = createSourceLibraryApi(async () => response({ ok: true, packages: [{ packageReleaseId: release.packageReleaseId, action: "verified" }], activated: false }));
    await expect(malformedInstall.installRelease(release.packageReleaseId, { dependencyReleaseIds: [] })).resolves.toMatchObject({ ok: false, error: { code: "PROTOCOL" } });
  });

  it("preserves terminal failed sync receipts for controller failure handling", async () => {
    const failed = { ...attempt, state: "FAILED" as const, snapshotId: null, failureCode: "SOURCE_UNAVAILABLE" };
    const api = createSourceLibraryApi(async () => response({ kind: "sync", source, syncAttempt: failed }));
    await expect(api.syncSource(source.sourceId, { expectedRevision: 2 })).resolves.toEqual({ ok: true, value: { source, syncAttempt: failed } });
  });

  it("fails closed on malformed nested release, activation, sync, and rollout payloads", async () => {
    const malformed = createSourceLibraryApi(async input => { const path = new URL(String(input), "https://example.test").pathname; if (path.includes("catalog-releases")) return response({ ...release, manifest: { ...release.manifest, compatibility: { orgops: { min: "1" }, platforms: "linux", tools: [] } } }); if (path.endsWith("/sync")) return response({ source, syncAttempt: { ...attempt, state: "UNKNOWN" } }); return response({ ...rollout, targetIds: ["agent/a"], targets: [] }); });
    await expect(malformed.getRelease(release.packageReleaseId)).resolves.toMatchObject({ ok: false, error: { code: "PROTOCOL" } });
    await expect(malformed.syncSource(source.sourceId, { expectedRevision: 2 })).resolves.toMatchObject({ ok: false, error: { code: "PROTOCOL" } });
    await expect(malformed.getRollout("rollout/1")).resolves.toMatchObject({ ok: false, error: { code: "PROTOCOL" } });
  });

  it.each([null, [], { sourceId: "source" }, { planDigest: 1 }])("fails closed on malformed successful payload %j", async payload => {
    const api = createSourceLibraryApi(async () => response(payload));
    const result = payload && typeof payload === "object" && !Array.isArray(payload) && "planDigest" in payload ? await api.planRollout({ releaseId: "r", agentIds: ["a"], operation: "ENABLE" }) : await api.getSource("source");
    expect(result).toEqual({ ok: false, error: { code: "PROTOCOL", message: "The Source Library response could not be confirmed." } });
  });
});
