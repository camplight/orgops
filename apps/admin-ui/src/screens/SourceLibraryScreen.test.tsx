import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceLibraryScreen, type SourceLibraryScreenState } from "./SourceLibraryScreen";

const digest = "sha256:" + "b".repeat(64);
const selectedRelease = { packageReleaseId: "release-skill", authoritySourceId: "source-a", contentSourceId: "source-a", kind: "skill", name: "<script>alert(1)</script>", version: "1.0.0", digest, catalogCommit: "c", packageCommit: "d", packagePath: "SKILL.md", manifest: { description: "description", author: "author", license: "MIT", compatibility: { orgops: { min: "1" }, platforms: [], tools: [] }, dependencies: [], secrets: [] }, executionPreview: { apiEventShapes: ["event-shapes.ts"], runnerScripts: ["runner.ts"], wrappedCommands: [{ at: "setup", command: "echo", args: ["safe"] }], externalSources: [{ type: "github", repo: "example/repo", ref: "main" }] }, warnings: [{ code: "RUNNER_SCRIPT", at: "runner.ts" }], files: [{ path: "SKILL.md", mode: 0o644, size: 1, digest }], reviewState: "APPROVED", reviewDigest: digest, reviewer: { humanId: "human-a", reviewedAt: 1 }, installationState: "INSTALLED", apiActivation: { approvalState: "AWAITING_APPROVAL", runtimeState: "INACTIVE", revision: 1, failureCode: null }, revision: 1 };
const source = { sourceId: "source-a", displayName: "<img src=x onerror=alert(1)>", canonicalUrl: "https://example.test/repo", repositoryIdentity: '["github","example","repo"]', ref: "main", enabled: true, allowPackages: true, revision: 2, removedAt: null, currentSnapshotId: "snap-1", hasReadCredential: false };
const state = { phase: "ready", busy: false, principalGeneration: 0, sources: [source], releases: [selectedRelease], selectedSource: source, selectedRelease, attempts: [], snapshots: [], grants: [{ grantId: "grant-1", releaseId: "release-skill", subject: { kind: "ORGANIZATION" }, revision: 1, revokedAt: null }], humans: [{ id: "human-b", displayName: "Future user" }], rolloutPlan: { planDigest: digest, releaseId: "release-skill", operation: "SET_PRELOAD", preload: false, targets: [{ agentId: "agent-a", assignmentRevision: 1, runnerId: "runner-a", plannedPreload: false, blocker: null }] }, rollout: { id: "rollout-1", releaseId: "release-skill", operation: "SET_PRELOAD", preload: false, state: "PARTIAL", revision: 2, targetIds: ["agent-a"], targets: [{ agentId: "agent-a", state: "WAITING_FOR_IDLE", attempts: 1, reasonCode: null }] }, credentialDraft: { username: "", password: "" }, writesBlocked: false, lastGoodSnapshot: null, lastGoodReleases: [selectedRelease], message: null, error: null } as unknown as SourceLibraryScreenState;

const actions = {} as never;

describe("SourceLibraryScreen", () => {
  it("renders the canonical source URL instead of the repository identity", () => {
    const html = renderToStaticMarkup(<SourceLibraryScreen state={state} actions={actions} />);
    expect(html).toContain("https://example.test/repo");
    expect(html).not.toContain('["github","example","repo"]');
  });

  it("renders fixed source/release safety copy and escapes untrusted text", () => {
    const html = renderToStaticMarkup(<SourceLibraryScreen state={state} actions={actions} />);
    expect(html).toContain("catalog/index.json");
    expect(html).toContain("External package permission");
    expect(html).toContain("It does not give packages permission to run or give OrgOps another repository credential.");
    expect(html).toContain("API event shapes");
    expect(html).toContain("0644");
    expect(html).toContain("Waiting for agent to become idle");
    expect(html).toContain("current and future users");
    expect(html).toContain("PARTIAL");
    expect(html).toContain("SET_PRELOAD");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
  });

  it("exposes busy, alert, disabled-write, confirmation, grant, and restore accessibility states", () => {
    const html = renderToStaticMarkup(<SourceLibraryScreen state={{ ...state, busy: true, writesBlocked: true, error: { code: "STATE_CONFLICT", message: "fixed conflict" }, selectedSource: { ...source, removedAt: 10, enabled: false, allowPackages: false } } as SourceLibraryScreenState} actions={actions} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Writes are blocked");
    expect(html).toContain("Restore Source");
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("API execution is separate from release review/install");
  });

  it("renders tab relationships and distinct selected panels", () => {
    const html = renderToStaticMarkup(<SourceLibraryScreen state={state} actions={actions} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-controls="source-library-panel-overview"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('id="source-library-panel-overview"');
  });

  it("renders a bounded unavailable state without stale detail", () => {
    const html = renderToStaticMarkup(<SourceLibraryScreen state={{ ...state, selectedSource: null, selectedRelease: null, selectedSourceId: null, selectedReleaseId: null, attempts: [], snapshots: [], error: { code: "NOT_FOUND", message: "The requested Source Library selection is unavailable." } } as SourceLibraryScreenState} actions={actions} />);
    expect(html).toContain("The requested Source Library selection is unavailable.");
    expect(html).not.toContain("Release detail");
    expect(html).not.toContain("Selected Source");
  });

  it("renders an identical installation error only once", () => {
    const message = "Inspection failed; last-good content is unchanged.";
    const html = renderToStaticMarkup(<SourceLibraryScreen state={{ ...state, message, error: { code: "INSPECTION_FAILED", message } } as SourceLibraryScreenState} actions={actions} />);
    expect(html.match(new RegExp(message.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"), "g"))).toHaveLength(1);
  });

  it("renders complete rollout target blocker and status text without optimistic completion", () => {
    const html = renderToStaticMarkup(<SourceLibraryScreen state={{ ...state, rolloutPlan: { ...state.rolloutPlan!, targets: [{ ...state.rolloutPlan!.targets[0], blocker: { code: "INSTALLATION_REQUIRED" } }] } } as SourceLibraryScreenState} actions={actions} />);
    expect(html).toContain("Blocked (INSTALLATION_REQUIRED)");
    expect(html).toContain("WAITING_FOR_IDLE");
    expect(html).not.toContain("Rollout status: SUCCEEDED");
  });
});
