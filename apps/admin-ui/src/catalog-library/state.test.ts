import { describe, expect, it, vi } from "vitest";
import { createSourceLibraryController, type SourceLibraryApi } from "./state";
import type { LibraryErrorCode, ReleaseView, Result, SyncAttemptView } from "./api";

const digest = "sha256:" + "a".repeat(64);
const activation = { approvalState: "AWAITING_APPROVAL" as const, runtimeState: "INACTIVE" as const, revision: 1, failureCode: null };
const release = { packageReleaseId: "release-skill", digest, revision: 1, reviewState: "APPROVED" as const, apiActivation: activation } satisfies Pick<ReleaseView, "packageReleaseId" | "digest" | "revision" | "reviewState" | "apiActivation">;
const source = { sourceId: "source-team", displayName: "Team", canonicalUrl: "https://example.test/team.git", repositoryIdentity: "https://example.test/team.git", ref: "main", enabled: true, allowPackages: true, revision: 3, removedAt: null, currentSnapshotId: "snapshot-1", hasReadCredential: false };
const snapshot = { snapshotId: "snapshot-1", sourceId: "source-team", sourceCommit: "commit-1", indexDigest: digest, observedRef: "main", createdAt: 1 };
const attempt = { attemptId: "attempt-1", sourceId: "source-team", state: "SUCCEEDED" as const, snapshotId: "snapshot-1", failureCode: null, revision: 1 };
const auth = { authChecked: true, authenticated: true, username: "admin", isAdmin: true, mustChangePassword: false, userId: "human-a" };
const forbidden = { ...auth, isAdmin: false };
const ok = <T>(value: T) => ({ ok: true as const, value });
const err = (code: LibraryErrorCode): Result<never> => ({ ok: false, error: { code, message: `${code} message` } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function apiFixture(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const api = {
    listSources: async () => ok([source]), listReleases: async () => ok([release]), listHumans: async () => ok([]),
    getSource: async () => ok(source), listAttempts: async () => ok([attempt]), listSnapshots: async () => ok([snapshot]),
    getRelease: async () => ok(release), listGrants: async () => ok([]),
    createSource: async () => { calls.push("create"); return ok({}); }, patchSource: async () => { calls.push("patch"); return ok({}); }, removeSource: async () => { calls.push("remove"); return ok({}); }, restoreSource: async () => { calls.push("restore"); return ok({}); },
    putReadCredential: async () => { calls.push("putCredential"); return ok({}); }, deleteReadCredential: async () => { calls.push("deleteCredential"); return ok({}); }, syncSource: async () => { calls.push("sync"); return ok({}); },
    reviewRelease: async () => { calls.push("review"); return ok(release); }, installRelease: async () => { calls.push("install"); return ok({}); },
    grantOrganization: async () => { calls.push("grantOrganization"); return ok({}); }, revokeOrganization: async () => { calls.push("revokeOrganization"); return ok({}); }, grantHuman: async () => { calls.push("grantHuman"); return ok({}); }, revokeHuman: async () => { calls.push("revokeHuman"); return ok({}); },
    approveApiExecution: async () => { calls.push("approveApi"); return ok({ ...activation, releaseId: release.packageReleaseId, approvalState: "APPROVED", revision: 2 }); }, activateApiExecution: async () => { calls.push("activateApi"); return ok({ ...activation, releaseId: release.packageReleaseId, approvalState: "APPROVED", runtimeState: "ACTIVE", revision: 3 }); }, deactivateApiExecution: async () => { calls.push("deactivateApi"); return ok({ ...activation, releaseId: release.packageReleaseId, approvalState: "APPROVED", runtimeState: "INACTIVE", revision: 4 }); },
    planRollout: async () => { calls.push("plan"); return ok({ planDigest: digest, releaseId: release.packageReleaseId, operation: "ENABLE", targets: [] }); }, confirmRollout: async () => { calls.push("confirm"); return ok({ id: "rollout-1", releaseId: release.packageReleaseId, operation: "ENABLE", state: "QUEUED", revision: 1, targetIds: [], targets: [] }); }, getRollout: async () => { calls.push("getRollout"); return ok({ id: "rollout-1", releaseId: release.packageReleaseId, operation: "ENABLE", state: "FAILED", revision: 1, targetIds: [], targets: [] }); }, cancelRollout: async () => { calls.push("cancel"); return ok({ rollout: { id: "rollout-1", releaseId: release.packageReleaseId, operation: "ENABLE", state: "CANCELLED", revision: 2, targetIds: [], targets: [] }, skippedTargetIds: [] }); }, retryRollout: async () => { calls.push("retry"); return ok({ rollout: { id: "rollout-1", releaseId: release.packageReleaseId, operation: "ENABLE", state: "RUNNING", revision: 3, targetIds: [], targets: [] }, targetIds: [], deploymentIds: [] }); },
    ...overrides,
  } as unknown as SourceLibraryApi;
  return { api, calls };
}
function controllerFixture(overrides: Record<string, unknown> = {}, options: { refreshAuth?: () => Promise<typeof auth | null>; invalidate?: () => void } = {}) {
  const f = apiFixture(overrides); const refreshAuth = options.refreshAuth ?? (async () => auth); const invalidate = options.invalidate ?? vi.fn();
  return { ...f, controller: createSourceLibraryController({ api: f.api, expectedUserId: "human-a", refreshAuth, invalidateAuthority: invalidate }) };
}
function confirmation(action: "APPROVE" | "ACTIVATE" | "DEACTIVATE", patch: Record<string, unknown> = {}) { return { action, releaseId: "release-skill", digest, acknowledged: true as const, ...patch }; }

 describe("Source Library controller", () => {
  it("starts with no selection and restores valid URL source, release, and tab", async () => {
    const location = { href: "http://localhost/?screen=source-library" };
    vi.stubGlobal("window", { location, history: { replaceState: (_state: unknown, _title: string, next: string | URL) => { location.href = new URL(String(next), location.href).toString(); }, pushState: (_state: unknown, _title: string, next: string | URL) => { location.href = new URL(String(next), location.href).toString(); } } });
    window.history.replaceState({}, "", "/?screen=source-library");
    const f = controllerFixture();
    await f.controller.load();
    expect(f.controller.snapshot()).toMatchObject({ selectedSource: null, selectedRelease: null, detailTab: "OVERVIEW", addDrawerOpen: false });
    window.history.replaceState({}, "", "/?screen=source-library&source=source-team&release=release-skill&tab=SECURITY");
    await f.controller.restoreUrlSelection();
    expect(f.controller.snapshot()).toMatchObject({ selectedSource: source, selectedRelease: release, detailTab: "SECURITY", selectedSourceId: "source-team", selectedReleaseId: "release-skill" });
  });

  it("keeps a deferred detail selection alive while switching tabs and settles busy", async () => {
    const location = { href: "http://localhost/?screen=source-library" };
    vi.stubGlobal("window", { location, history: { replaceState: (_state: unknown, _title: string, next: string | URL) => { location.href = new URL(String(next), location.href).toString(); }, pushState: (_state: unknown, _title: string, next: string | URL) => { location.href = new URL(String(next), location.href).toString(); } } });
    const detail = deferred<ReturnType<typeof ok<typeof source>>>();
    const f = controllerFixture({ getSource: async () => detail.promise });
    await f.controller.load();
    const pending = f.controller.selectSource(source.sourceId);
    await vi.waitFor(() => expect(f.controller.snapshot().busy).toBe(true));
    f.controller.selectTab("SECURITY");
    detail.resolve(ok(source));
    await pending;
    expect(f.controller.snapshot()).toMatchObject({ busy: false, detailTab: "SECURITY", selectedSource: source });
  });

  it("bounds invalid URL selection without exposing the requested identifier", async () => {
    const location = { href: "http://localhost/?screen=source-library&source=missing&release=missing&tab=SECURITY" };
    vi.stubGlobal("window", { location, history: { replaceState: (_state: unknown, _title: string, next: string | URL) => { location.href = new URL(String(next), location.href).toString(); }, pushState: (_state: unknown, _title: string, next: string | URL) => { location.href = new URL(String(next), location.href).toString(); } } });
    window.history.replaceState({}, "", "/?screen=source-library&source=missing&release=missing&tab=SECURITY");
    const f = controllerFixture();
    await f.controller.load();
    expect(f.controller.snapshot()).toMatchObject({ selectedSource: null, selectedRelease: null, attempts: [], snapshots: [], error: { code: "NOT_FOUND", message: "The requested Source Library selection is unavailable." } });
    expect(new URL(window.location.href).search).toBe("?screen=source-library");
    window.history.replaceState({}, "", "/?screen=source-library");
  });

  it("keeps last-good data after sync failure and deduplicates contextual errors", async () => {
    const f = controllerFixture({ syncSource: async () => err("SOURCE_UNAVAILABLE") });
    await f.controller.load();
    await f.controller.selectSource(source.sourceId);
    await f.controller.sync(source.sourceId);
    await f.controller.sync(source.sourceId);
    expect(f.controller.snapshot().lastGoodSnapshot?.snapshotId).toBe("snapshot-1");
    expect(f.controller.snapshot().contextErrors).toEqual([{ target: "source-team", code: "SOURCE_UNAVAILABLE", message: "SOURCE_UNAVAILABLE message" }]);
    expect(f.controller.snapshot().selectedSource?.sourceId).toBe("source-team");
  });

  it("loads sources/releases and preserves selected source last-good state", async () => {
    const f = controllerFixture();
    await f.controller.load();
    expect(f.controller.snapshot()).toMatchObject({ phase: "ready", sources: [source], releases: [release], lastGoodReleases: [release] });
    await f.controller.selectSource(source.sourceId);
    expect(f.controller.snapshot()).toMatchObject({ selectedSource: source, attempts: [attempt], snapshots: [snapshot], lastGoodSnapshot: snapshot });
    await f.controller.selectRelease(release.packageReleaseId);
    expect(f.controller.snapshot().selectedRelease).toBe(release);
  });

  it("invokes every source/review/grant mutation once without retrying fixed errors", async () => {
    const f = controllerFixture(); await f.controller.load(); await f.controller.selectSource(source.sourceId);
    await f.controller.createSource({}); await f.controller.patchSource(source.sourceId, { expectedRevision: 3 }); await f.controller.removeSource(source.sourceId, 3); await f.controller.restoreSource(source.sourceId, 4);
    f.controller.setCredentialDraft({ username: "reader", password: "secret" }); await f.controller.putCredential(source.sourceId, { expectedRevision: 5 }); await f.controller.deleteCredential(source.sourceId, 6); await f.controller.sync(source.sourceId);
    await f.controller.selectRelease(release.packageReleaseId); await f.controller.approve(release.packageReleaseId); await f.controller.install(release.packageReleaseId);
    await f.controller.grant({ releaseId: release.packageReleaseId });
    expect(f.calls).toEqual(["create", "patch", "remove", "restore", "putCredential", "deleteCredential", "sync", "review", "install", "grantOrganization"]);
  });

  it("projects source mutation envelopes with each revision and state transition", async () => {
    const revisions = [4, 5, 6, 7, 8, 9];
    const f = controllerFixture({
      patchSource: async () => ok({ kind: "source", source: { ...source, displayName: "Renamed", revision: revisions[0] } }),
      removeSource: async () => ok({ kind: "source", source: { ...source, revision: revisions[1], removedAt: 10, enabled: false, allowPackages: false } }),
      restoreSource: async () => ok({ kind: "source", source: { ...source, revision: revisions[2], removedAt: null, enabled: false, allowPackages: false } }),
      putReadCredential: async () => ok({ kind: "source", source: { ...source, revision: revisions[3], hasReadCredential: true } }),
      deleteReadCredential: async () => ok({ kind: "source", source: { ...source, revision: revisions[4], hasReadCredential: false } }),
      syncSource: async () => ok({ kind: "sync", source: { ...source, revision: revisions[5], currentSnapshotId: "snapshot-2" }, syncAttempt: { ...attempt, attemptId: "attempt-2", revision: 2, snapshotId: "snapshot-2" } }),
    });
    await f.controller.load(); await f.controller.selectSource(source.sourceId);
    await f.controller.patchSource(source.sourceId, { expectedRevision: 3 });
    expect(f.controller.snapshot().selectedSource).toMatchObject({ displayName: "Renamed", revision: 4 });
    await f.controller.removeSource(source.sourceId, 4);
    expect(f.controller.snapshot().selectedSource).toMatchObject({ removedAt: 10, revision: 5 });
    await f.controller.restoreSource(source.sourceId, 5);
    expect(f.controller.snapshot().selectedSource).toMatchObject({ removedAt: null, revision: 6 });
    f.controller.setCredentialDraft({ username: "reader", password: "secret" }); await f.controller.putCredential(source.sourceId, { expectedRevision: 6 });
    expect(f.controller.snapshot().selectedSource).toMatchObject({ hasReadCredential: true, revision: 7 });
    await f.controller.deleteCredential(source.sourceId, 7);
    expect(f.controller.snapshot().selectedSource).toMatchObject({ hasReadCredential: false, revision: 8 });
    await f.controller.sync(source.sourceId);
    expect(f.controller.snapshot().selectedSource).toMatchObject({ currentSnapshotId: "snapshot-2", revision: 9 });
    expect(f.controller.snapshot().attempts).toContainEqual({ ...attempt, attemptId: "attempt-2", revision: 2, snapshotId: "snapshot-2" });
  });

  it("projects both installed and reused install results to INSTALLED", async () => {
    let calls = 0;
    const f = controllerFixture({ installRelease: async () => { calls += 1; return ok({ ok: true, packages: [{ packageReleaseId: release.packageReleaseId, action: calls === 1 ? "installed" : "reused" }], activated: false }); } });
    await f.controller.load();
    await f.controller.selectRelease(release.packageReleaseId);
    await f.controller.install(release.packageReleaseId);
    expect(f.controller.snapshot().selectedRelease?.installationState).toBe("INSTALLED");
    const revisionAfterFirstInstall = f.controller.snapshot().selectedRelease?.revision;
    await f.controller.install(release.packageReleaseId);
    expect(f.controller.snapshot().selectedRelease).toMatchObject({ installationState: "INSTALLED", revision: revisionAfterFirstInstall });
    expect(f.controller.snapshot().releases.find(item => item.packageReleaseId === release.packageReleaseId)?.installationState).toBe("INSTALLED");
  });

  it("shows a fixed mutation error without latching writes when it is not a conflict", async () => {
    const f = controllerFixture({ patchSource: async () => err("STORAGE_FAILURE") });
    await f.controller.patchSource(source.sourceId, { expectedRevision: 3 });
    expect(f.controller.snapshot()).toMatchObject({ writesBlocked: false, error: { code: "STORAGE_FAILURE", message: "STORAGE_FAILURE message" }, message: "STORAGE_FAILURE message" });
  });

  it.each([
    ["action", confirmation("ACTIVATE", { action: "APPROVE" })],
    ["release", confirmation("ACTIVATE", { releaseId: "other" })],
    ["digest", confirmation("ACTIVATE", { digest: "sha256:" + "b".repeat(64) })],
    ["acknowledgement", confirmation("ACTIVATE", { acknowledged: false })],
    ["precondition", confirmation("DEACTIVATE")],
  ] as const)("rejects independent API confirmation %s mismatch before any request", async (_kind, value) => {
    const f = controllerFixture(); await f.controller.selectRelease(release.packageReleaseId);
    await expect(f.controller.activateApiExecution({ releaseId: "release-skill", expectedRevision: 1 }, value as never)).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expect(f.calls).toEqual([]);
  });

  it("runs API approve, activate, and deactivate as distinct guarded operations", async () => {
    const f = controllerFixture(); await f.controller.selectRelease(release.packageReleaseId);
    await f.controller.approveApiExecution({ releaseId: "release-skill", expectedRevision: 1, digest }, confirmation("APPROVE"));
    await f.controller.activateApiExecution({ releaseId: "release-skill", expectedRevision: 2 }, confirmation("ACTIVATE"));
    await f.controller.deactivateApiExecution({ releaseId: "release-skill", expectedRevision: 3 }, confirmation("DEACTIVATE"));
    expect(f.calls).toEqual(["approveApi", "activateApi", "deactivateApi"]);
  });

  it("flushes the cleared credential state before invoking the credential API", async () => {
    const ordering: string[] = [];
    const f = controllerFixture({ putReadCredential: async () => { ordering.push("api"); return ok({}); } });
    f.controller.setCredentialDraft({ username: "reader", password: "secret" });
    const controller = createSourceLibraryController({ api: f.api, expectedUserId: "human-a", refreshAuth: async () => auth, invalidateAuthority: vi.fn(), flushSensitiveUpdate: (notify: () => void) => { ordering.push("flush"); notify(); } } as never);
    controller.setCredentialDraft({ username: "reader", password: "secret" });
    await controller.putCredential(source.sourceId, { expectedRevision: 1 });
    expect(ordering).toEqual(["flush", "api"]);
    expect(controller.snapshot().credentialDraft).toEqual({ username: "", password: "" });
  });

  it("authorizes before copying the latest credential draft and clears before request settles", async () => {
    const authGate = deferred<typeof auth | null>();
    const requestGate = deferred<ReturnType<typeof ok<unknown>>>();
    const seen: string[] = [];
    const f = controllerFixture({ putReadCredential: async (_id: string, input: { username: string; password: string }) => { seen.push(`${input.username}:${input.password}`); return requestGate.promise; } }, { refreshAuth: () => authGate.promise });
    const request = f.controller.putCredential(source.sourceId, { expectedRevision: 1 });
    f.controller.setCredentialDraft({ username: "final-reader", password: "final-secret" });
    expect(seen).toEqual([]);
    authGate.resolve(auth);
    await vi.waitFor(() => expect(seen).toEqual(["final-reader:final-secret"]));
    expect(f.controller.snapshot().credentialDraft).toEqual({ username: "", password: "" });
    requestGate.resolve(ok({}));
    await request;
  });

  it("uses grant revisions and gates grant/revoke against exact current subjects", async () => {
    const f = controllerFixture();
    await f.controller.selectRelease(release.packageReleaseId);
    const callsBefore = f.calls.length;
    await f.controller.grant({ releaseId: release.packageReleaseId });
    expect(f.calls.at(-1)).toBe("grantOrganization");
    await f.controller.grant({ releaseId: release.packageReleaseId, humanId: "human-b" });
    expect(f.calls.at(-1)).toBe("grantHuman");
    expect(f.calls.length).toBe(callsBefore + 2);
  });

  it.each([50, 256])("accepts %s rollout targets", async count => {
    const f = controllerFixture();
    await f.controller.selectRelease(release.packageReleaseId);
    await expect(f.controller.planRollout({ releaseId: release.packageReleaseId, agentIds: Array.from({ length: count }, (_, index) => `agent-${index}`), operation: "ENABLE" })).resolves.toBeDefined();
  });

  it("rejects empty, duplicate, and over-cap rollout targets before API calls", async () => {
    const f = controllerFixture();
    await f.controller.selectRelease(release.packageReleaseId);
    for (const agentIds of [[], ["agent-a", "agent-a"], Array.from({ length: 257 }, (_, index) => `agent-${index}`)]) {
      await expect(f.controller.planRollout({ releaseId: release.packageReleaseId, agentIds, operation: "ENABLE" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }
    expect(f.calls).toEqual([]);
  });

  it("clears credential drafts on disposal", () => {
    const f = controllerFixture();
    f.controller.setCredentialDraft({ username: "reader", password: "secret" });
    f.controller.dispose();
    expect(f.controller.snapshot().credentialDraft).toEqual({ username: "", password: "" });
  });

  it("clears credential drafts before deferred PUT success and failure, with no retained plaintext", async () => {
    const pending = deferred<ReturnType<typeof ok<unknown>> | ReturnType<typeof err>>();
    const f = controllerFixture({ putReadCredential: async () => { f.calls.push("putCredential"); return pending.promise; } });
    f.controller.setCredentialDraft({ username: "reader", password: "secret" });
    const request = f.controller.putCredential(source.sourceId, { expectedRevision: 1 });
    await vi.waitFor(() => expect(f.controller.snapshot().credentialDraft).toEqual({ username: "", password: "" }));
    pending.resolve(err("FORBIDDEN")); await request;
    expect(JSON.stringify(f.controller.snapshot())).not.toContain("secret");
    expect(f.controller.snapshot().error?.code).toBe("FORBIDDEN");
  });

  it("treats a terminal failed sync receipt as a blocked failure and clears it after retry", async () => {
    let failed = true;
    const failedAttempt = { ...attempt, state: "FAILED" as const, snapshotId: null, failureCode: "SOURCE_UNAVAILABLE" };
    const f = controllerFixture({ syncSource: async () => { f.calls.push("sync"); return failed ? ok({ kind: "sync", source, syncAttempt: failedAttempt }) : ok({ kind: "sync", source, syncAttempt: attempt }); } });
    await f.controller.load();
    await f.controller.selectSource(source.sourceId);
    await f.controller.sync(source.sourceId);
    expect(f.controller.snapshot()).toMatchObject({ writesBlocked: true, selectedSource: source, lastGoodSnapshot: snapshot, error: { code: "SOURCE_UNAVAILABLE" }, contextErrors: [{ target: source.sourceId, code: "SOURCE_UNAVAILABLE" }] });
    expect(f.controller.snapshot().attempts).toContainEqual(failedAttempt);
    failed = false;
    await f.controller.sync(source.sourceId);
    expect(f.controller.snapshot()).toMatchObject({ writesBlocked: false, error: null, contextErrors: [] });
    expect(f.controller.snapshot().attempts).toContainEqual(attempt);
  });

  it("preserves distinct sync failure codes while deduplicating repeats", async () => {
    const failures = ["SOURCE_UNAVAILABLE", "SOURCE_UNAVAILABLE", "SYNC_FAILED"];
    const f = controllerFixture({ syncSource: async () => ok({ kind: "sync", source, syncAttempt: { ...attempt, state: "FAILED" as const, snapshotId: null, failureCode: failures.shift()! } }) });
    await f.controller.load();
    await f.controller.selectSource(source.sourceId);
    await f.controller.sync(source.sourceId);
    await f.controller.sync(source.sourceId);
    await f.controller.sync(source.sourceId);
    expect(f.controller.snapshot().contextErrors.map(error => error.code)).toEqual(["SOURCE_UNAVAILABLE", "SYNC_FAILED"]);
  });

  it("keeps a newly created Source selected when its immediate sync receipt fails", async () => {
    if (typeof window !== "undefined") window.history.replaceState({}, "", "/?screen=source-library");
    const failedAttempt = { ...attempt, sourceId: "new-source", attemptId: "attempt-new", state: "FAILED" as const, snapshotId: null, failureCode: "SOURCE_UNAVAILABLE" };
    const created = { ...source, sourceId: "new-source", displayName: "New Source", revision: 1, currentSnapshotId: null };
    const f = controllerFixture({ createSource: async () => ok({ source: created, syncAttempt: failedAttempt }) });
    await f.controller.load();
    await f.controller.selectSource(source.sourceId);
    f.controller.setAddDrawerOpen(true);
    await f.controller.createSource({ sourceId: created.sourceId });
    expect(f.controller.snapshot()).toMatchObject({ addDrawerOpen: false, selectedSource: created, selectedSourceId: created.sourceId, writesBlocked: true, error: { code: "SOURCE_UNAVAILABLE" }, contextErrors: [{ target: created.sourceId, code: "SOURCE_UNAVAILABLE" }] });
    expect(f.controller.snapshot().contextErrors).not.toContainEqual(expect.objectContaining({ target: source.sourceId }));
    expect(f.controller.snapshot().attempts).toContainEqual(failedAttempt);
  });

  it("clears stale detail when a direct selection is unavailable", async () => {
    const f = controllerFixture({ getSource: async () => err("NOT_FOUND") });
    await f.controller.load();
    await f.controller.selectSource(source.sourceId);
    await f.controller.selectSource("missing-source");
    expect(f.controller.snapshot()).toMatchObject({ selectedSource: null, selectedRelease: null, selectedSourceId: null, selectedReleaseId: null, attempts: [], snapshots: [], grants: [], error: { code: "NOT_FOUND", message: "The requested Source Library selection is unavailable." } });
  });

  it("does not let an older source detail response overwrite the newer selection", async () => {
    const sourceB = { ...source, sourceId: "source-b", displayName: "B" };
    const pendingAttempts = deferred<ReturnType<typeof ok<SyncAttemptView[]>>>();
    const f = controllerFixture({ listSources: async () => ok([source, sourceB]), getSource: async (id: string) => ok(id === source.sourceId ? source : sourceB), listAttempts: async (id: string) => id === source.sourceId ? pendingAttempts.promise : ok([]) });
    await f.controller.load();
    const first = f.controller.selectSource(source.sourceId);
    await f.controller.selectSource(sourceB.sourceId);
    pendingAttempts.resolve(ok([attempt]));
    await first;
    expect(f.controller.snapshot()).toMatchObject({ selectedSource: sourceB, selectedSourceId: sourceB.sourceId, attempts: [] });
  });

  it("allows an explicit sync retry while keeping writes blocked after failure", async () => {
    let failed = true;
    const f = controllerFixture({ syncSource: async () => { f.calls.push("sync"); return failed ? err("SOURCE_UNAVAILABLE") : ok({ source, syncAttempt: attempt }); } });
    await f.controller.load();
    await f.controller.selectSource(source.sourceId);
    await f.controller.sync(source.sourceId);
    failed = false;
    await f.controller.sync(source.sourceId);
    expect(f.calls).toEqual(["sync", "sync"]);
  });

  it("preserves last-good snapshot/releases and blocks writes after sync failure until explicit reload", async () => {
    if (typeof window !== "undefined") window.history.replaceState({}, "", "/?screen=source-library");
    let syncFailed = true;
    const f = controllerFixture(); f.api.syncSource = async () => { f.calls.push("sync"); return syncFailed ? err("SYNC_FAILED") : ok({}); }; await f.controller.load(); await f.controller.selectSource(source.sourceId);
    await f.controller.sync();
    expect(f.controller.snapshot()).toMatchObject({ writesBlocked: true, lastGoodSnapshot: snapshot, lastGoodReleases: [release] });
    await f.controller.patchSource(source.sourceId, { expectedRevision: 3 });
    expect(f.calls).toEqual(["sync"]);
    syncFailed = false; await f.controller.load();
    expect(f.controller.snapshot()).toMatchObject({ phase: "ready", writesBlocked: false, lastGoodReleases: [release] });
  });

  it("demotes on a user swap while a mutation is held and ignores its stale completion", async () => {
    const response = deferred<ReturnType<typeof ok<unknown>>>(); let checks = 0; const invalidate = vi.fn();
    const f = controllerFixture({ patchSource: async () => { f.calls.push("patch"); return response.promise; } }, { refreshAuth: async () => { checks++; return checks < 3 ? auth : { ...auth, userId: "human-b" }; }, invalidate });
    await f.controller.load(); const before = f.controller.snapshot(); const request = f.controller.patchSource(source.sourceId, { expectedRevision: 3 }); await vi.waitFor(() => expect(f.calls).toEqual(["patch"]));
    response.resolve(ok({ source })); await request;
    expect(f.controller.snapshot()).not.toBe(before);
    expect(f.controller.snapshot()).toMatchObject({ phase: "forbidden", busy: false, writesBlocked: false, credentialDraft: { username: "", password: "" } });
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("supersedes a pending load and dispose prevents stale selection updates", async () => {
    const first = deferred<ReturnType<typeof ok<typeof source[]>>>(); const f = controllerFixture({ listSources: async () => first.promise });
    const loading = f.controller.load(); f.controller.dispose(); first.resolve(ok([source])); await loading;
    expect(f.controller.snapshot()).toMatchObject({ phase: "loading", busy: true, sources: [] });
  });

  it("requires and persists rollout plan confirmation, status, cancellation and retry methods", async () => {
    const f = controllerFixture(); await f.controller.selectRelease(release.packageReleaseId);
    await f.controller.planRollout({ releaseId: release.packageReleaseId, agentIds: ["agent-a"], operation: "ENABLE" });
    expect(f.controller.snapshot().rolloutPlan).not.toBeNull();
    await f.controller.confirmRollout({ planDigest: digest, agentIds: [] }); await f.controller.getRollout("rollout-1");
    await f.controller.retry({ rolloutId: "rollout-1", expectedRevision: 1 });
    await f.controller.cancelRollout({ rolloutId: "rollout-1", expectedRevision: 1 });
    expect(f.calls).toEqual(["plan", "confirm", "getRollout", "retry", "cancel"]);
  });
});
