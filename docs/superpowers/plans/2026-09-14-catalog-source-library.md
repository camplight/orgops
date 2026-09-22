# Source-backed package library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split Catalog lifecycle with immutable Source-backed releases, reviewed inert installation, delegated library consumption, verified runner delivery, and finite skill rollouts.

**Architecture:** The API owns one deep `CatalogAuthority` module for Source, snapshot, release, review, and grant state; `PackageInstallation`, `CatalogPolicy`, `ActivationCoordinator`, and `RunnerArtifactDelivery` are separate deep modules at explicit seams. Hono routes and React screens translate requests and render state without reproducing domain policy. Runner deployment is durable and bound to an assigned runner, and `AgentRuntimeGeneration` makes a generation swap atomic across every channel of one agent.

**Tech Stack:** TypeScript, Hono, SQLite/better-sqlite3 with numbered SQL migrations and hand-maintained Drizzle declarations, Zod, existing format-v1 package inspection/import adapters, React/Tailwind/Vite, Vitest, and the Node test runner for opscli.

**Spec:** `docs/superpowers/specs/2026-09-14-catalog-source-library-design.md`

## Global Constraints

- The API is the sole SQLite owner; route modules receive dependencies from `app.ts`.
- Source, review, installation, grant, API activation, and reconciliation mutations require a fresh live human administrator; runners and ordinary humans never acquire that authority.
- Configuration bodies are strict, UTF-8, bounded by an actual streamed 16 KiB limit, and optimistic-revision guarded.
- Source IDs and repository identities are reserved after removal; restore returns a disabled Source with permission off and no credential.
- Read credentials are Source-scoped, encrypted, API-private, metadata-only on reads, and separate from publication or agent secrets.
- Source authority does not grant permission to fetch an external content Source; every external dependency needs that Source's enabled `allowPackages` policy.
- Failed fetch, inspection, identity, promotion, transaction, or cleanup work preserves the last-known-good snapshot and installed/active content.
- `(authoritySourceId, name, version)` and installed provenance are immutable; changed bytes are an `IDENTITY_CONFLICT`.
- Discovery, inspection, staging, and inert installation execute no package code; API event-shapes and wrapped commands require separate explicit activation/start controls.
- Template instances are positive-field local copies, always stopped, and never synchronized replicas.
- Missing bindings fail closed at start; secret values never enter manifests, provenance, previews, audits, logs, or runner metadata.
- Native skill selection uses one coherent runtime generation; no turn observes mixed markdown, event shapes, or filesystem roots.
- Runners remain assigned-host workers; there is no scheduler or future-agent rollout policy.
- Audit events are channel-less `audit.*`, `system`, `DELIVERED` bookkeeping events and never wake agents.
- V1 has no automatic updates, conflicting side-by-side skill names, automatic dependency source registration, autonomous publication, package sandbox, or general RBAC.
- Format-v1 package/index documents remain externally compatible; the Source Library adapter maps `catalogId` to `authoritySourceId` and format-v1 `sourceId` to `contentSourceId`.
- Every task changing a schema, API, event, or runtime behavior updates `docs/SPEC.md` in that same task.
- The implementation worker writes each task's failing test and runs it before production changes; no task is accepted from a passing-before-RED test.

## File and interface map

The following map is the complete planned surface. Existing Catalog files are only compatibility adapters until Task 17 removes them after the one-release retirement window.

**Create:**
- `packages/db/migrations/034_catalog_source_library.sql` — archive 032 tables and create canonical Source/release/grant/install/activation/assignment/rollout/deployment tables.
- `packages/schemas/src/catalogs/source-library.ts` — strict identifiers, DTOs, command/query unions, state unions, fixed errors, artifact envelopes, and typed audit payloads.
- `apps/api/src/catalog-library/test-fixtures.ts` — test-only deterministic DB, actors, release, source, grant, artifact, and runner fixtures used by API module tests.
- `apps/api/src/catalog-library/authority.ts` — Source lifecycle, sync attempts, snapshots, immutable releases, review, grants, and transaction-coupled audit writing.
- `apps/api/src/catalog-library/source-fetch.ts` — Source-scoped composition of the existing Git transport/mirror and offline inspectors.
- `apps/api/src/routes/catalog-library.ts` — capability-specific route registration functions added in dependency order.
- `apps/api/src/catalog-library/installation.ts` — exact closure verification and content-addressed inert installation.
- `apps/api/src/catalog-library/policy.ts` — centralized authorization decisions.
- `apps/api/src/catalog-library/consumption.ts` — delegated/admin assignment commands with grant and agent-management checks.
- `apps/api/src/catalog-library/start-gate.ts` — one package-aware validator for API and runner lifecycle paths.
- `apps/api/src/catalog-library/activation.ts` — API activation, finite rollout state, and target capture.
- `apps/api/src/catalog-library/runner-delivery.ts` — deployment-bound artifact poll/claim/artifact/report domain adapter.
- `apps/api/src/catalog-library/templates.ts` — stopped native/wrapped template instantiation.
- `apps/api/src/catalog-library/reconciliation.ts` — exact migration-033 origin reconciliation.
- `apps/agent-runner/src/package-delivery.ts` — runner artifact verification, staging, activation, and reports.
- `apps/agent-runner/src/runtime-generation.ts` — agent-wide turn leases and coherent generation pointers.
- `apps/admin-ui/src/catalog-library/api.ts`, `apps/admin-ui/src/catalog-library/state.ts` — typed admin client and principal-bound controller.
- `apps/admin-ui/src/screens/SourceLibraryScreen.tsx` — responsive Source/release/grant/install/rollout admin journey.
- `apps/user-ui/src/library/api.ts`, `apps/user-ui/src/library/state.ts`, `apps/user-ui/src/LibraryScreen.tsx` — user library client, principal-bound controller, and template/assignment/finite-rollout journey.
- `scenarios/catalog-source-library/` — isolated public/private two-instance fixtures and scenario harness.

**Modify:**
- `packages/db/src/schema.ts` — declarations matching migration 034 exactly.
- `packages/schemas/src/index.ts`, `packages/schemas/src/catalogs/index.ts`, `packages/schemas/src/event-shapes.ts` — exports, format-v1 aliases, and redacted audit shapes.
- `apps/api/src/app.ts` — construct modules, register capability routes, and publish audits only after transaction commit.
- `apps/api/src/routes/catalogs.ts` — fixed one-release `410 CATALOG_RESOURCE_RETIRED` response.
- `apps/api/src/routes/agents.ts` — route every catalog-aware start/restart/create transition through one start validator.
- `apps/api/src/routes/runners.ts` and `apps/agent-runner/src/runner/api.ts` — deployment protocol methods.
- `apps/agent-runner/src/runner.ts`, `channel-loop.ts`, `turn-executor.ts` — poll delivery, acquire/release generation leases, and capture one generation per turn.
- `apps/admin-ui/src/App.tsx`, `components/layout/Sidebar.tsx`, `components/layout/AppLayout.tsx`, `screens/index.ts` — Source Library navigation and admin gating.
- `apps/user-ui/src/App.tsx`, `types.ts`, `styles.css` — Library navigation and responsive layout.
- `docs/SPEC.md` — same-task API/event/schema/runtime contract updates.
- `docs/catalog-package-contract.md` — only the final compatibility terminology adapter note.

**No task modifies or stages `docs/research/pi-developer-powerups.md`.**

## Shared exact interfaces and test fixtures

Task 1 exports these types for all later tasks. The aliases below are the contract; implementations may add private fields but may not widen these caller inputs:

```ts
import type { PackageKind, PackageManifest, ReviewWarning } from "@orgops/schemas";

export type HumanAdmin = { kind: "HUMAN_ADMIN"; id: string };
export type DelegatedHuman = { kind: "AUTHENTICATED_HUMAN"; id: string };
export type ConsumptionActor = HumanAdmin | DelegatedHuman;
export type AuthenticatedHuman = ConsumptionActor;
export type RunnerPrincipal = { kind: "RUNNER"; runnerId: string };
export type AgentPrincipal = { kind: "AGENT"; agentName: string };
export type AuthenticatedPrincipal = AuthenticatedHuman | RunnerPrincipal | AgentPrincipal;

export type SourceCreate = { sourceId: string; displayName: string; repository: { url: string }; ref: string; enabled: boolean; allowPackages: boolean };
export type SourcePatch = { expectedRevision: number; displayName?: string; enabled?: boolean; allowPackages?: boolean };
export type SourceView = { sourceId: string; displayName: string; repositoryIdentity: string; ref: string; enabled: boolean; allowPackages: boolean; revision: number; removedAt: number | null; currentSnapshotId: string | null; hasReadCredential: boolean };
export type SyncFailureCode = "SOURCE_UNAVAILABLE" | "SOURCE_NOT_ALLOWED" | "IDENTITY_CONFLICT" | "INSPECTION_FAILED" | "STORAGE_FAILURE" | "SYNC_FAILED";
export type InstallFailureCode = "RELEASE_NOT_APPROVED" | "SOURCE_NOT_ALLOWED" | "SOURCE_UNAVAILABLE" | "IDENTITY_CONFLICT" | "INSPECTION_FAILED" | "STORAGE_FAILURE";
export type ApiActivationFailureCode = "INSTALLATION_REQUIRED" | "API_ACTIVATION_REQUIRED" | "INSPECTION_FAILED" | "STORAGE_FAILURE";
export type DeploymentFailureCode = "DEPLOYMENT_SUPERSEDED" | "INSPECTION_FAILED" | "STORAGE_FAILURE";
export type SyncAttemptView = { attemptId: string; sourceId: string; state: "RUNNING" | "SUCCEEDED" | "FAILED" | "ABANDONED"; snapshotId: string | null; failureCode: SyncFailureCode | null; revision: number };
export type ReviewAction = "APPROVE" | "REJECT" | "WITHDRAW" | "REOPEN";
export type CatalogLibraryErrorCode = "INVALID_REQUEST" | "PAYLOAD_TOO_LARGE" | "FORBIDDEN" | "NOT_FOUND" | "REMOVED" | "REVISION_CONFLICT" | "STATE_CONFLICT" | "IDENTITY_CONFLICT" | "SOURCE_NOT_ALLOWED" | "SOURCE_UNAVAILABLE" | "RELEASE_NOT_APPROVED" | "GRANT_REQUIRED" | "INSTALLATION_REQUIRED" | "API_ACTIVATION_REQUIRED" | "REQUIREMENTS_UNSATISFIED" | "OPERATION_IN_PROGRESS" | "DEPLOYMENT_SUPERSEDED" | "INSPECTION_FAILED" | "STORAGE_FAILURE" | "SYNC_FAILED" | "CATALOG_RESOURCE_RETIRED";
export type SnapshotView = { snapshotId: string; sourceId: string; sourceCommit: string; indexDigest: string; observedRef: string; createdAt: number };
export type ReleaseExecutionPreview = { apiEventShapes: readonly string[]; runnerScripts: readonly string[]; wrappedCommands: readonly { at: string; command: string; args: readonly string[] }[]; externalSources: readonly { type: "github"; repo: string; ref?: string }[] };
export type ReleaseFileView = { path: string; mode: 0o644 | 0o755; size: number; digest: string };
export type ApiActivationStateView = { approvalState: "NOT_REQUIRED" | "AWAITING_APPROVAL" | "APPROVED" | "REVOKED"; runtimeState: "INACTIVE" | "ACTIVATING" | "ACTIVE" | "DEACTIVATING" | "FAILED"; revision: number; failureCode: ApiActivationFailureCode | null };
export type PackageReleaseView = { packageReleaseId: string; authoritySourceId: string; contentSourceId: string; kind: PackageKind; name: string; version: string; digest: string; catalogCommit: string; packageCommit: string; packagePath: string; manifest: PackageManifest; executionPreview: ReleaseExecutionPreview; warnings: readonly ReviewWarning[]; files: readonly ReleaseFileView[]; reviewState: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN"; reviewDigest: string | null; reviewer: { humanId: string; reviewedAt: number } | null; installationState: "ABSENT" | "INSTALLED" | "QUARANTINED"; apiActivation: ApiActivationStateView; revision: number };
export type GrantView = { grantId: string; releaseId: string; subject: { kind: "ORGANIZATION" } | { kind: "HUMAN"; humanId: string }; revision: number; revokedAt: number | null };
export type AgentView = { id: string; name: string; ownerHumanId: string | null; assignedRunnerId: string | null; revision: number };
export type RunnerView = { id: string };
export type CatalogAuditEvent = { type: "audit.catalog.source.changed" | "audit.catalog.sync.completed" | "audit.catalog.sync.failed" | "audit.catalog.release.reviewed" | "audit.catalog.grant.changed" | "audit.catalog.installation.changed" | "audit.catalog.api_activation.changed" | "audit.catalog.template.instantiated" | "audit.catalog.assignment.changed" | "audit.catalog.rollout.changed" | "audit.catalog.deployment.reported"; source: "system"; status: "DELIVERED"; channelId: null; payload: { actorKind: "HUMAN_ADMIN" | "AUTHENTICATED_HUMAN" | "RUNNER"; actorId: string; action: string; outcome: "SUCCEEDED" | "FAILED"; revision: number; sourceId?: string; releaseId?: string; operationId?: string; agentId?: string; runnerId?: string; digest?: string; failureCode?: CatalogLibraryErrorCode } };
export type CatalogAuthorityCommand =
  | { kind: "source.create"; source: SourceCreate }
  | { kind: "source.patch"; sourceId: string; patch: SourcePatch }
  | { kind: "source.remove" | "source.restore"; sourceId: string; expectedRevision: number }
  | { kind: "source.credential.put"; sourceId: string; expectedRevision: number; username: string; password: string }
  | { kind: "source.credential.delete"; sourceId: string; expectedRevision: number }
  | { kind: "source.sync"; sourceId: string; expectedRevision: number }
  | { kind: "release.review"; releaseId: string; action: ReviewAction; expectedRevision: number; digest: string; reviewDigest: string }
  | { kind: "grant.organization"; releaseId: string; expectedRevision: number }
  | { kind: "grant.human"; releaseId: string; humanId: string; expectedRevision: number }
  | { kind: "grant.revoke"; grantId: string; expectedRevision: number };
export type CatalogAuthorityResult =
  | { kind: "source"; source: SourceView; syncAttempt?: SyncAttemptView }
  | { kind: "sync"; source: SourceView; syncAttempt: SyncAttemptView }
  | { kind: "review"; release: PackageReleaseView }
  | { kind: "grant"; grant: GrantView };
export type CatalogAuthorityQuery =
  | { kind: "source.list" | "release.list" }
  | { kind: "source.detail"; sourceId: string }
  | { kind: "source.sync-attempts" | "source.snapshots"; sourceId: string }
  | { kind: "release.detail"; packageReleaseId: string }
  | { kind: "release.grants"; packageReleaseId: string }
  | { kind: "library.list" }
  | { kind: "library.detail"; packageReleaseId: string };
export type CatalogAuthorityQueryResult = SourceView | PackageReleaseView | readonly SourceView[] | readonly PackageReleaseView[] | readonly SyncAttemptView[] | readonly SnapshotView[] | readonly GrantView[];
export type CatalogAuthority = {
  execute(command: CatalogAuthorityCommand, actor: HumanAdmin): Promise<CatalogAuthorityResult>;
  query(query: CatalogAuthorityQuery, actor: AuthenticatedHuman): Promise<CatalogAuthorityQueryResult>;
};

export type AssignmentCommand = { kind: "assignment.enable" | "assignment.disable"; agentId: string; releaseId: string; expectedAgentRevision: number; expectedAssignmentRevision: number; preload: boolean };
export type AssignmentMutationResult = { assignmentId: string; desiredState: "DISABLED" | "ENABLED"; effectiveState: "DISABLED" | "ENABLED"; deploymentState: "STABLE" | "REQUESTED" | "DEPLOYING" | "FAILED"; activeGeneration: string | null; desiredGeneration: string; revision: number };
export type CatalogConsumption = { assignSkill(command: AssignmentCommand, actor: ConsumptionActor): Promise<AssignmentMutationResult> };

export type InstallExactCommand = { packageReleaseId: string; dependencyReleaseIds: readonly string[] };
export type InstallResult = { ok: true; packages: readonly { packageReleaseId: string; action: "installed" | "reused" }[]; activated: false } | { ok: false; code: CatalogLibraryErrorCode };
export type Availability = { installed: boolean; state: "ABSENT" | "INSTALLED" | "QUARANTINED" };
export type PackageInstallation = { installExact(command: InstallExactCommand, actor: HumanAdmin): Promise<InstallResult>; inspectAvailability(packageReleaseId: string): Availability };

export type PolicyDecision = { allow: true } | { allow: false; reasonCode: CatalogLibraryErrorCode };
export type PolicyDecisionInput = { action: PolicyAction; actor: AuthenticatedPrincipal; release?: PackageReleaseView; grant?: GrantView; agent?: AgentView; runner?: RunnerView };
export type PolicyAction = "SOURCE_MANAGE" | "RELEASE_REVIEW" | "RELEASE_INSTALL" | "GRANT_MANAGE" | "API_EXECUTION_APPROVE" | "LIBRARY_VIEW" | "TEMPLATE_INSTANTIATE" | "SKILL_ASSIGN" | "ROLLOUT_CREATE" | "RUNNER_DEPLOY";
export type CatalogPolicy = { decide(input: PolicyDecisionInput): PolicyDecision };

export type ActivationOperation =
  | { operation: "ENABLE" }
  | { operation: "DISABLE" }
  | { operation: "SET_PRELOAD"; preload: boolean };
export type ActivationPlanCommand = { releaseId: string; agentIds: readonly string[] } & ActivationOperation;
export type ActivationTargetPlan = { agentId: string; assignmentRevision: number; runnerId: string; blocker: RequirementReason | null };
export type ActivationPlan = { planDigest: string; releaseId: string; targets: readonly ActivationTargetPlan[] } & ActivationOperation;
export type ConfirmActivationCommand = { planDigest: string; agentIds: readonly string[] };
export type CancelRolloutCommand = { rolloutId: string; expectedRevision: number };
export type RetryFailedRolloutCommand = { rolloutId: string; expectedRevision: number };
export type RolloutTargetState = "QUEUED" | "BLOCKED" | "STAGING" | "VERIFYING" | "WAITING_FOR_IDLE" | "ACTIVATING" | "SUCCEEDED" | "FAILED" | "SKIPPED" | "SUPERSEDED";
export type RolloutReasonCode = "FORBIDDEN" | "REVISION_CONFLICT" | "STATE_CONFLICT" | "GRANT_REQUIRED" | "INSTALLATION_REQUIRED" | "DEPLOYMENT_REQUIRED" | "API_ACTIVATION_REQUIRED" | "SECRET_BINDING_MISSING" | "RUNNER_BINDING_MISSING" | "MODEL_BINDING_MISSING" | "WORKSPACE_BINDING_MISSING" | "WRAPPED_WIRING_MISSING" | "QUARANTINED" | "REQUIREMENTS_UNSATISFIED" | "DEPLOYMENT_SUPERSEDED" | "INSPECTION_FAILED" | "STORAGE_FAILURE";
export type RolloutTargetView = { agentId: string; state: RolloutTargetState; attempts: number; reasonCode: RolloutReasonCode | null };
export type RolloutView = { id: string; state: "DRAFT" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED" | "CANCELLED"; revision: number; targetIds: readonly string[]; targets: readonly RolloutTargetView[] } & ActivationOperation;
export type CancelRolloutResult = { rollout: RolloutView; skippedTargetIds: readonly string[] };
export type RetryFailedRolloutResult = { rollout: RolloutView; targetIds: readonly string[]; deploymentIds: readonly string[] };
export type ApiExecutionApprovalCommand = { releaseId: string; expectedRevision: number; digest: string };
export type ApiExecutionActivationCommand = { releaseId: string; expectedRevision: number };
export type ApiExecutionDeactivationCommand = { releaseId: string; expectedRevision: number };
export type ApiActivationResult = { releaseId: string } & ApiActivationStateView;
export type RolloutCoordinator = {
  plan(command: ActivationPlanCommand, actor: ConsumptionActor): Promise<ActivationPlan>;
  confirm(command: ConfirmActivationCommand, actor: ConsumptionActor): Promise<RolloutView>;
  getRollout(id: string, actor: ConsumptionActor): Promise<RolloutView>;
  cancel(command: CancelRolloutCommand, actor: ConsumptionActor): Promise<CancelRolloutResult>;
  retryFailed(command: RetryFailedRolloutCommand, actor: ConsumptionActor): Promise<RetryFailedRolloutResult>;
};
export type ApiExecutionCoordinator = {
  approveApiExecution(command: ApiExecutionApprovalCommand, actor: HumanAdmin): Promise<ApiActivationResult>;
  activateApiExecution(command: ApiExecutionActivationCommand, actor: HumanAdmin): Promise<ApiActivationResult>;
  deactivateApiExecution(command: ApiExecutionDeactivationCommand, actor: HumanAdmin): Promise<ApiActivationResult>;
};
export type ActivationCoordinator = RolloutCoordinator & ApiExecutionCoordinator;

export type ReleaseIdentity = { packageReleaseId: string; authoritySourceId: string; contentSourceId: string; kind: PackageKind; name: string; version: string; catalogCommit: string; packageCommit: string; packagePath: string; digest: string };
export type ArtifactDependency = { release: ReleaseIdentity; direct: boolean };
export type VerifiedArtifactEnvelope = { deploymentId: string; agentId: string; generation: string; release: ReleaseIdentity; manifest: PackageManifest; dependencies: readonly ArtifactDependency[]; semanticDigest: string; files: readonly { path: string; mode: 0o644 | 0o755; bytesBase64: string }[] };
export type DeploymentCommand = { deploymentId: string; agentId: string; agentName: string; assignedRunnerId: string; releaseId: string; desiredGeneration: string };
export type RunnerContext = { runnerId: string };
export type DeploymentClaimContext = RunnerContext & { deploymentId: string };
export type DeploymentContext = DeploymentClaimContext & { attemptToken: string };
export type DeploymentClaim = { deploymentId: string; attemptToken: string; leaseExpiresAt: number };
export type DeploymentReport = { state: "STAGED" | "WAITING_FOR_IDLE" | "ACTIVE" | "FAILED"; generation: string; failureCode?: DeploymentFailureCode };
export type DeploymentReceipt = { deploymentId: string; state: "STAGED" | "WAITING_FOR_IDLE" | "ACTIVE" | "FAILED" | "SUPERSEDED"; revision: number };
export type RequirementReasonCode = "INSTALLATION_REQUIRED" | "DEPLOYMENT_REQUIRED" | "API_ACTIVATION_REQUIRED" | "SECRET_BINDING_MISSING" | "RUNNER_BINDING_MISSING" | "MODEL_BINDING_MISSING" | "WORKSPACE_BINDING_MISSING" | "WRAPPED_WIRING_MISSING" | "QUARANTINED";
export type RequirementReason = { code: RequirementReasonCode; packageReleaseId?: string; requirementName?: string };
export type StartRequirementsResult = { ok: true } | { ok: false; code: "REQUIREMENTS_UNSATISFIED"; reasons: readonly RequirementReason[] };
export type RunnerStartRequirementsContext = RunnerContext & { agentName: string };
export type RunnerArtifactDelivery = {
  poll(context: RunnerContext): Promise<DeploymentCommand[]>;
  claim(context: DeploymentClaimContext): Promise<DeploymentClaim>;
  getArtifact(context: DeploymentContext): Promise<VerifiedArtifactEnvelope>;
  report(context: DeploymentContext, report: DeploymentReport): Promise<DeploymentReceipt>;
};
export type RunnerStartGateDelivery = { getStartRequirements(context: RunnerStartRequirementsContext): Promise<StartRequirementsResult> };
export type RunnerCatalogClient = {
  listPackageDeployments(): Promise<DeploymentCommand[]>;
  claimPackageDeployment(id: string): Promise<DeploymentClaim>;
  getPackageArtifact(id: string, attemptToken: string): Promise<VerifiedArtifactEnvelope>;
  reportPackageDeployment(id: string, attemptToken: string, report: DeploymentReport): Promise<DeploymentReceipt>;
  getAgentStartRequirements(agentName: string): Promise<StartRequirementsResult>;
};

export type RuntimeGeneration = { generation: string; skillRoot: string; promptRoot: string; eventShapeRoot: string };
export type TurnLease = { agentId: string; generation: RuntimeGeneration; release(): void };
export type StagedGeneration = { agentId: string; deploymentId: string; generation: RuntimeGeneration; stagedRoot: string };
export type ActivationResult = { agentId: string; deploymentId: string; generation: string };
export type AgentRuntimeGeneration = {
  captureForTurn(agentId: string): Promise<TurnLease>;
  stage(deployment: DeploymentCommand, artifact: VerifiedArtifactEnvelope): Promise<StagedGeneration>;
  activateWhenIdle(staged: StagedGeneration): Promise<ActivationResult>;
};
export type CatalogStartGate = { validateCatalogStart(agentId: string, actor: AuthenticatedPrincipal): Promise<StartRequirementsResult>; setDesiredAgentState(agentId: string, desired: "RUNNING" | "STOPPED", actor: AuthenticatedPrincipal): Promise<StartRequirementsResult> };
```

`PackageReleaseView`, `GrantView`, `AgentView`, `RunnerView`, `CatalogLibraryErrorCode`, and `CatalogAuditEvent` are schema-inferred DTOs defined and exported in Task 1 alongside these contracts. Their strict schemas, not handwritten route shapes, are the single wire definition. `PackageKind` and `PackageManifest` are the already-exported format-v1 types from `@orgops/schemas`.


`apps/api/src/catalog-library/test-fixtures.ts` exports `openCatalogFixture(): { db: OrgOpsDb; close(): void }`, `adminActor(id?: string): HumanAdmin`, `humanActor(id?: string): AuthenticatedHuman`, `runnerActor(id: string): RunnerContext`, `sourceCommand(): CatalogAuthorityCommand`, `approvedRelease(kind?: PackageKind): PackageReleaseView`, `grantFor(subject: GrantSubject): GrantView`, `catalogArtifact(releaseId: string): VerifiedArtifactEnvelope`, and `seedLegacy032(db): void`. Each fixture uses IDs `source-team`, `release-skill`, `release-native-rlm`, `release-wrapped`, human `human-a`, runner `runner-a`, and an in-memory SQLite database; it never calls network, crypto, Git, or package code. Test snippets below use only these named exports or define their local values in the same snippet.

---

### Task 1: Contracts, migration 034, and safe application cutover

**Files:**
- Create: `packages/schemas/src/catalogs/source-library.ts`, `apps/api/src/catalog-library/test-fixtures.ts`, `packages/db/migrations/034_catalog_source_library.sql`
- Modify: `packages/schemas/src/index.ts`, `packages/schemas/src/catalogs/index.ts`, `packages/db/src/schema.ts`, `apps/api/src/app.ts`, `apps/api/src/routes/catalogs.ts`
- Retire active callers: `apps/api/src/catalog-configuration.ts`, `apps/api/src/catalog-sync/sync.ts`, `apps/api/src/catalog-installed.ts` become unused compatibility modules and are removed in Task 17, not called after this task
- Create tests: `packages/schemas/src/catalogs/source-library.test.ts`, `packages/db/src/catalog-source-library-migration.test.ts`
- Modify tests: `apps/api/src/catalogs.integration.test.ts`, `apps/api/src/catalogs.sync.integration.test.ts`, `apps/api/src/catalogs.packages.integration.test.ts`, `apps/api/src/catalogs.install.integration.test.ts`, `apps/api/src/catalogs.import-preview.integration.test.ts`, `apps/api/src/catalog-configuration.test.ts`
- Modify: `docs/SPEC.md`

**Interfaces produced:** Every type in **Shared exact interfaces and test fixtures**, including the separated `CatalogAuthority`/`CatalogConsumption` actor contracts, complete activation cancellation/retry/API-execution methods, agent-bound generation values, strict `VerifiedArtifactEnvelope`, separated deployment/start-gate runner interfaces, all state unions, fixed `CatalogLibraryErrorCode`, `CatalogAuditEvent`, and the exact table/column names in this task's SQL.

- [ ] **Step 1: RED — add these failing tests before the SQL/types.**

```ts
it("rejects repository and ref on SourcePatch while accepting only bounded mutable fields", () => {
  expect(SourcePatchSchema.safeParse({ expectedRevision: 1, ref: "main" }).success).toBe(false);
  expect(SourcePatchSchema.safeParse({ expectedRevision: 1, enabled: false, allowPackages: true }).success).toBe(true);
});
it("archives migration-032 rows, backfills Catalog rows, and does not invent a ref for source-only rows", () => {
  const { db } = openLegacy032();
  migrate(db);
  expect(db.prepare("SELECT source_id,ref FROM catalog_sources WHERE source_id='legacy-catalog'").get()).toEqual({ source_id: "legacy-catalog", ref: "main" });
  expect(db.prepare("SELECT source_id FROM catalog_sources_legacy_032 WHERE source_id='orphan-source'").get()).toEqual({ source_id: "orphan-source" });
  expect(db.prepare("SELECT source_id FROM catalog_sources WHERE source_id='orphan-source'").get()).toBeUndefined();
});
it("copies encrypted credential bytes without decrypting and keeps migration archives", () => {
  const { db, masterKeyCalls } = openLegacy032WithCredential();
  migrate(db);
  expect(masterKeyCalls()).toBe(0);
  expect(db.prepare("SELECT ciphertext_b64,legacy_binding_source_id,legacy_credential_ref FROM catalog_source_read_credentials").get()).toEqual({ ciphertext_b64: "ciphertext-fixture", legacy_binding_source_id: "legacy-source", legacy_credential_ref: "legacy-credential" });
});
it("boots after migration and returns the fixed retirement envelope for every old Catalog route", async () => {
  const app = await createMigratedTestApp();
  for (const path of ["/api/catalogs", "/api/catalogs/legacy", "/api/catalogs/legacy/sync"]) {
    expect((await app.request(path)).status).toBe(410);
  }
});
it.each([
  ["catalog_sources", "source_id", "source-team"],
  ["catalog_source_read_credentials", "source_id", "source-team"],
  ["catalog_sync_attempts", "attempt_id", "attempt-a"],
  ["catalog_release_controls", "package_release_id", "release-skill"],
  ["catalog_grants", "grant_id", "grant-human-a"],
  ["catalog_install_operations", "operation_id", "install-a"],
  ["catalog_installations", "release_id", "release-skill"],
  ["catalog_api_activations", "release_id", "release-skill"],
  ["agent_package_secret_bindings", "agent_id", "agent-a"],
  ["agent_skill_assignments", "assignment_id", "assignment-a"],
  ["catalog_rollouts", "rollout_id", "rollout-a"],
  ["catalog_rollout_targets", "agent_id", "agent-a"],
  ["runner_package_deployments", "deployment_id", "deployment-a"],
] as const)("rejects an out-of-range revision in mutable %s", (table, key, id) => {
  const { db } = openCanonical034WithMutableRows();
  expect(() => db.prepare(`UPDATE ${table} SET revision=0 WHERE ${key}=?`).run(id)).toThrow(/CHECK constraint failed/);
  expect(() => db.prepare(`UPDATE ${table} SET revision=2147483648 WHERE ${key}=?`).run(id)).toThrow(/CHECK constraint failed/);
});
it.each([
  ["catalog_sync_attempts", "failure_code"],
  ["catalog_install_operations", "failure_code"],
  ["catalog_api_activations", "failure_code"],
  ["catalog_rollout_targets", "reason_code"],
  ["runner_package_deployments", "failure_code"],
  ["agent_template_origins", "consumed_by_kind"],
  ["agent_skill_assignments", "actor_kind"],
  ["catalog_rollouts", "actor_kind"],
] as const)("rejects an arbitrary fixed code in %s.%s", (table, column) => {
  const { db, primaryKeyWhere } = openCanonical034WithMutableRows();
  expect(() => db.prepare(`UPDATE ${table} SET ${column}='UNBOUNDED_TEXT' WHERE ${primaryKeyWhere(table)}`).run()).toThrow(/CHECK constraint failed/);
});
it("requires grant provenance to name its grant", () => {
  const { db } = openCanonical034WithMutableRows();
  expect(() => db.prepare("UPDATE agent_skill_assignments SET actor_kind='GRANT',grant_id=NULL WHERE assignment_id='assignment-a'").run()).toThrow(/CHECK constraint failed/);
});
```

The test file defines `openLegacy032`, `openLegacy032WithCredential`, and `createMigratedTestApp` by using the repository's existing `openDb`/`migrate` fixture and a fixed `masterKeyCalls` counter; no undeclared network fixture is allowed. It also defines `openCanonical034WithMutableRows`, which migrates with `PRAGMA foreign_keys=ON`, seeds one valid row and all referenced parents for each mutable table named above, and returns a `primaryKeyWhere(table)` mapping made only from fixed test constants (never caller input). Existing Catalog integration tests are changed from mutable success expectations to the 410 contract in this task.

- [ ] **Step 2: Verify RED.** Run `npx vitest run packages/schemas/src/catalogs/source-library.test.ts packages/db/src/catalog-source-library-migration.test.ts apps/api/src/catalogs.integration.test.ts apps/api/src/catalogs.sync.integration.test.ts apps/api/src/catalogs.packages.integration.test.ts apps/api/src/catalogs.install.integration.test.ts apps/api/src/catalogs.import-preview.integration.test.ts apps/api/src/catalog-configuration.test.ts`. Expected: failure naming missing schemas, migration 034, or retirement behavior.

- [ ] **Step 3: GREEN — implement the minimum cutover.** Add strict Zod objects, fixed unions/checks, and the SQL-only migration: rename 032 tables to `catalog_sources_legacy_032`, `catalogs_legacy_032`, and `catalog_read_credentials_legacy_032`; create canonical tables/indexes/checks; backfill only joined Catalog rows; copy ciphertext and `legacy_binding_source_id`; retain migration-033 origins unchanged; perform no filesystem/network/crypto work. Use this transaction shape:

```sql
BEGIN IMMEDIATE;
ALTER TABLE catalog_sources RENAME TO catalog_sources_legacy_032;
ALTER TABLE catalogs RENAME TO catalogs_legacy_032;
ALTER TABLE catalog_read_credentials RENAME TO catalog_read_credentials_legacy_032;

CREATE TABLE catalog_sources (
  source_id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 200),
  canonical_url TEXT NOT NULL,
  ssh_user TEXT,
  repository_identity TEXT NOT NULL UNIQUE,
  ref TEXT NOT NULL CHECK(length(ref) BETWEEN 1 AND 1024),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  allow_packages INTEGER NOT NULL CHECK(allow_packages IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  removed_at INTEGER,
  current_snapshot_id TEXT REFERENCES catalog_snapshots(snapshot_id) DEFERRABLE INITIALLY DEFERRED,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(removed_at IS NULL OR (enabled=0 AND allow_packages=0))
);
CREATE INDEX idx_catalog_sources_current_snapshot ON catalog_sources(current_snapshot_id);

CREATE TABLE catalog_source_read_credentials (
  source_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_sources(source_id),
  credential_ref TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind='https-basic'),
  ciphertext_b64 TEXT NOT NULL,
  legacy_binding_source_id TEXT,
  legacy_credential_ref TEXT,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((legacy_binding_source_id IS NULL)=(legacy_credential_ref IS NULL))
);

CREATE TABLE catalog_sync_attempts (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES catalog_sources(source_id),
  source_revision INTEGER NOT NULL CHECK(source_revision BETWEEN 1 AND 2147483647),
  state TEXT NOT NULL CHECK(state IN ('RUNNING','SUCCEEDED','FAILED','ABANDONED')),
  resolved_commit TEXT,
  snapshot_id TEXT REFERENCES catalog_snapshots(snapshot_id) DEFERRABLE INITIALLY DEFERRED,
  failure_code TEXT CHECK(failure_code IS NULL OR failure_code IN ('SOURCE_UNAVAILABLE','SOURCE_NOT_ALLOWED','IDENTITY_CONFLICT','INSPECTION_FAILED','STORAGE_FAILURE','SYNC_FAILED')),
  actor_human_id TEXT NOT NULL REFERENCES humans(id),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK((state='RUNNING' AND completed_at IS NULL) OR (state<>'RUNNING' AND completed_at IS NOT NULL)),
  CHECK((state='FAILED' AND failure_code IS NOT NULL) OR state<>'FAILED')
);
CREATE UNIQUE INDEX uidx_catalog_sync_attempts_running ON catalog_sync_attempts(source_id) WHERE state='RUNNING';
CREATE INDEX idx_catalog_sync_attempts_source_created ON catalog_sync_attempts(source_id,created_at);

CREATE TABLE catalog_snapshots (
  snapshot_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES catalog_sources(source_id),
  source_commit TEXT NOT NULL,
  index_digest TEXT NOT NULL,
  index_json TEXT NOT NULL CHECK(json_valid(index_json) AND length(CAST(index_json AS BLOB))<=2097152),
  observed_ref TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES catalog_sync_attempts(attempt_id),
  created_at INTEGER NOT NULL,
  UNIQUE(source_id,source_commit),
  UNIQUE(source_id,source_commit,index_digest,index_json)
);
CREATE INDEX idx_catalog_snapshots_source_created ON catalog_snapshots(source_id,created_at);

CREATE TABLE catalog_package_releases (
  package_release_id TEXT PRIMARY KEY NOT NULL,
  authority_source_id TEXT NOT NULL REFERENCES catalog_sources(source_id),
  content_source_id TEXT NOT NULL REFERENCES catalog_sources(source_id),
  kind TEXT NOT NULL CHECK(kind IN ('skill','native-agent','wrapped-agent')),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  digest TEXT NOT NULL,
  catalog_commit TEXT NOT NULL,
  package_commit TEXT NOT NULL,
  package_path TEXT NOT NULL,
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND length(CAST(manifest_json AS BLOB))<=262144),
  execution_preview_json TEXT NOT NULL CHECK(json_valid(execution_preview_json) AND length(CAST(execution_preview_json AS BLOB))<=262144),
  warnings_json TEXT NOT NULL CHECK(json_valid(warnings_json) AND length(CAST(warnings_json AS BLOB))<=262144),
  created_at INTEGER NOT NULL,
  UNIQUE(authority_source_id,name,version)
);
CREATE INDEX idx_catalog_package_releases_content_source ON catalog_package_releases(content_source_id);
CREATE INDEX idx_catalog_package_releases_kind_name ON catalog_package_releases(kind,name,version);

CREATE TABLE catalog_snapshot_entries (
  snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(snapshot_id),
  package_release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  PRIMARY KEY(snapshot_id,package_release_id),
  UNIQUE(snapshot_id,ordinal)
);
CREATE INDEX idx_catalog_snapshot_entries_release ON catalog_snapshot_entries(package_release_id);

CREATE TABLE catalog_release_controls (
  package_release_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_package_releases(package_release_id),
  review_state TEXT NOT NULL CHECK(review_state IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
  review_digest TEXT,
  reviewed_by_human_id TEXT REFERENCES humans(id),
  reviewed_at INTEGER,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((review_state='PENDING' AND review_digest IS NULL) OR (review_state<>'PENDING' AND review_digest IS NOT NULL))
);
CREATE INDEX idx_catalog_release_controls_state ON catalog_release_controls(review_state,updated_at);

CREATE TABLE catalog_grants (
  grant_id TEXT PRIMARY KEY NOT NULL,
  release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  subject_type TEXT NOT NULL CHECK(subject_type IN ('ORGANIZATION','HUMAN')),
  human_id TEXT REFERENCES humans(id),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  revoked_at INTEGER,
  created_by_human_id TEXT NOT NULL REFERENCES humans(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((subject_type='ORGANIZATION' AND human_id IS NULL) OR (subject_type='HUMAN' AND human_id IS NOT NULL))
);
CREATE UNIQUE INDEX uidx_catalog_grants_live_subject ON catalog_grants(release_id,subject_type,COALESCE(human_id,'')) WHERE revoked_at IS NULL;
CREATE INDEX idx_catalog_grants_human ON catalog_grants(human_id,release_id) WHERE revoked_at IS NULL;

CREATE TABLE catalog_install_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  root_release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  closure_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PENDING','INSTALLING','INSTALLED','FAILED')),
  actor_human_id TEXT NOT NULL REFERENCES humans(id),
  failure_code TEXT CHECK(failure_code IS NULL OR failure_code IN ('RELEASE_NOT_APPROVED','SOURCE_NOT_ALLOWED','SOURCE_UNAVAILABLE','IDENTITY_CONFLICT','INSPECTION_FAILED','STORAGE_FAILURE')),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK((state='FAILED' AND failure_code IS NOT NULL) OR state<>'FAILED')
);
CREATE INDEX idx_catalog_install_operations_release ON catalog_install_operations(root_release_id,created_at);

CREATE TABLE catalog_installations (
  release_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_package_releases(package_release_id),
  artifact_digest TEXT NOT NULL,
  artifact_path TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('INSTALLED','QUARANTINED')),
  installed_by_human_id TEXT NOT NULL REFERENCES humans(id),
  installed_at INTEGER NOT NULL,
  last_verified_at INTEGER NOT NULL,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647)
);
CREATE INDEX idx_catalog_installations_state ON catalog_installations(state,last_verified_at);

CREATE TABLE catalog_api_activations (
  release_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_package_releases(package_release_id),
  approval_state TEXT NOT NULL CHECK(approval_state IN ('NOT_REQUIRED','AWAITING_APPROVAL','APPROVED','REVOKED')),
  runtime_state TEXT NOT NULL CHECK(runtime_state IN ('INACTIVE','ACTIVATING','ACTIVE','DEACTIVATING','FAILED')),
  failure_code TEXT CHECK(failure_code IS NULL OR failure_code IN ('INSTALLATION_REQUIRED','API_ACTIVATION_REQUIRED','INSPECTION_FAILED','STORAGE_FAILURE')),
  approved_by_human_id TEXT REFERENCES humans(id),
  approved_at INTEGER,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((runtime_state='FAILED' AND failure_code IS NOT NULL) OR runtime_state<>'FAILED')
);
CREATE INDEX idx_catalog_api_activations_runtime ON catalog_api_activations(runtime_state,approval_state);

CREATE TABLE agent_template_origins (
  agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents(id),
  release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  mode TEXT NOT NULL CHECK(mode IN ('CLASSIC','RLM_REPL','WRAPPED')),
  consumed_by_kind TEXT NOT NULL CHECK(consumed_by_kind IN ('ADMIN','GRANT')),
  consumed_by_human_id TEXT NOT NULL REFERENCES humans(id),
  authority_source_id TEXT NOT NULL,
  content_source_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  package_version TEXT NOT NULL,
  package_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_agent_template_origins_release ON agent_template_origins(release_id);

CREATE TABLE agent_package_secret_bindings (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  requirement_name TEXT NOT NULL,
  secret_id TEXT NOT NULL REFERENCES secrets(id),
  created_by_human_id TEXT NOT NULL REFERENCES humans(id),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(agent_id,release_id,requirement_name)
);
CREATE INDEX idx_agent_package_secret_bindings_secret ON agent_package_secret_bindings(secret_id);

CREATE TABLE agent_skill_assignments (
  assignment_id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  local_skill_name TEXT NOT NULL,
  desired_state TEXT NOT NULL CHECK(desired_state IN ('DISABLED','ENABLED')),
  effective_state TEXT NOT NULL CHECK(effective_state IN ('DISABLED','ENABLED')),
  deployment_state TEXT NOT NULL CHECK(deployment_state IN ('STABLE','REQUESTED','DEPLOYING','FAILED')),
  preload INTEGER NOT NULL CHECK(preload IN (0,1)),
  active_generation TEXT,
  desired_generation TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('ADMIN','GRANT')),
  actor_human_id TEXT NOT NULL REFERENCES humans(id),
  grant_id TEXT REFERENCES catalog_grants(grant_id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(agent_id,local_skill_name),
  CHECK((actor_kind='ADMIN' AND grant_id IS NULL) OR (actor_kind='GRANT' AND grant_id IS NOT NULL)),
  CHECK((deployment_state='STABLE' AND active_generation=desired_generation) OR deployment_state<>'STABLE')
);
CREATE INDEX idx_agent_skill_assignments_release ON agent_skill_assignments(release_id);
CREATE INDEX idx_agent_skill_assignments_deployment ON agent_skill_assignments(agent_id,deployment_state);

CREATE TABLE catalog_rollouts (
  rollout_id TEXT PRIMARY KEY NOT NULL,
  release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  operation TEXT NOT NULL CHECK(operation IN ('ENABLE','DISABLE','SET_PRELOAD')),
  preload INTEGER CHECK(preload IN (0,1)),
  plan_digest TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('DRAFT','QUEUED','RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED')),
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('ADMIN','GRANT')),
  actor_human_id TEXT NOT NULL REFERENCES humans(id),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK((operation='SET_PRELOAD' AND preload IS NOT NULL) OR (operation<>'SET_PRELOAD' AND preload IS NULL))
);
CREATE INDEX idx_catalog_rollouts_release_created ON catalog_rollouts(release_id,created_at);

CREATE TABLE catalog_rollout_targets (
  rollout_id TEXT NOT NULL REFERENCES catalog_rollouts(rollout_id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  captured_runner_id TEXT NOT NULL REFERENCES runner_nodes(id),
  expected_assignment_revision INTEGER NOT NULL CHECK(expected_assignment_revision BETWEEN 0 AND 2147483647),
  state TEXT NOT NULL CHECK(state IN ('QUEUED','BLOCKED','STAGING','VERIFYING','WAITING_FOR_IDLE','ACTIVATING','SUCCEEDED','FAILED','SKIPPED','SUPERSEDED')),
  attempts INTEGER NOT NULL CHECK(attempts BETWEEN 0 AND 2147483647),
  reason_code TEXT CHECK(reason_code IS NULL OR reason_code IN ('FORBIDDEN','REVISION_CONFLICT','STATE_CONFLICT','GRANT_REQUIRED','INSTALLATION_REQUIRED','DEPLOYMENT_REQUIRED','API_ACTIVATION_REQUIRED','SECRET_BINDING_MISSING','RUNNER_BINDING_MISSING','MODEL_BINDING_MISSING','WORKSPACE_BINDING_MISSING','WRAPPED_WIRING_MISSING','QUARANTINED','REQUIREMENTS_UNSATISFIED','DEPLOYMENT_SUPERSEDED','INSPECTION_FAILED','STORAGE_FAILURE')),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY(rollout_id,agent_id)
);
CREATE INDEX idx_catalog_rollout_targets_runner_state ON catalog_rollout_targets(captured_runner_id,state);
CREATE INDEX idx_catalog_rollout_targets_agent ON catalog_rollout_targets(agent_id,updated_at);

CREATE TABLE runner_package_deployments (
  deployment_id TEXT PRIMARY KEY NOT NULL,
  rollout_id TEXT REFERENCES catalog_rollouts(rollout_id),
  target_agent_id TEXT NOT NULL REFERENCES agents(id),
  release_id TEXT NOT NULL REFERENCES catalog_package_releases(package_release_id),
  bound_runner_id TEXT NOT NULL REFERENCES runner_nodes(id),
  desired_generation TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('QUEUED','CLAIMED','STAGED','WAITING_FOR_IDLE','ACTIVE','FAILED','SUPERSEDED')),
  attempt_token TEXT,
  lease_expires_at INTEGER,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  failure_code TEXT CHECK(failure_code IS NULL OR failure_code IN ('DEPLOYMENT_SUPERSEDED','INSPECTION_FAILED','STORAGE_FAILURE')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(target_agent_id,desired_generation),
  CHECK((state IN ('CLAIMED','STAGED','WAITING_FOR_IDLE') AND attempt_token IS NOT NULL) OR state NOT IN ('CLAIMED','STAGED','WAITING_FOR_IDLE')),
  CHECK((state='FAILED' AND failure_code IS NOT NULL) OR state<>'FAILED')
);
CREATE INDEX idx_runner_package_deployments_poll ON runner_package_deployments(bound_runner_id,state,created_at);
CREATE INDEX idx_runner_package_deployments_agent ON runner_package_deployments(target_agent_id,updated_at);
CREATE UNIQUE INDEX uidx_runner_package_deployments_live_agent ON runner_package_deployments(target_agent_id) WHERE state IN ('QUEUED','CLAIMED','STAGED','WAITING_FOR_IDLE');

INSERT INTO catalog_sources (
  source_id,display_name,canonical_url,ssh_user,repository_identity,ref,
  enabled,allow_packages,revision,removed_at,current_snapshot_id,created_at,updated_at
)
SELECT c.catalog_id,c.display_name,s.canonical_url,s.ssh_user,s.repository_identity,c.ref,
       CASE WHEN s.removed_at IS NULL AND c.removed_at IS NULL THEN c.enabled ELSE 0 END,
       CASE WHEN s.removed_at IS NULL AND c.removed_at IS NULL THEN s.allow_packages ELSE 0 END,
       MAX(s.revision,c.revision),COALESCE(c.removed_at,s.removed_at),NULL,
       MIN(s.created_at,c.created_at),MAX(s.updated_at,c.updated_at)
FROM catalogs_legacy_032 c
JOIN catalog_sources_legacy_032 s ON s.source_id=c.source_id;

INSERT INTO catalog_source_read_credentials (
  source_id,credential_ref,kind,ciphertext_b64,legacy_binding_source_id,
  legacy_credential_ref,revision,created_at,updated_at
)
SELECT c.catalog_id,'migrated:' || c.catalog_id || ':' || rc.credential_ref,
       rc.kind,rc.ciphertext_b64,rc.source_id,rc.credential_ref,1,rc.created_at,rc.updated_at
FROM catalogs_legacy_032 c
JOIN catalog_read_credentials_legacy_032 rc ON rc.source_id=c.source_id;

COMMIT;
```

The SQL above is copied verbatim into migration 034; the Drizzle declarations must expose every table, column, check, foreign key, partial/unique index, and state literal with the same spelling. The migration test runs with `PRAGMA foreign_keys=ON`, checks all 17 canonical tables and named indexes in `sqlite_master`, validates fresh and 032+033 upgrade paths, proves duplicate release identity/live grant/live deployment, invalid fixed failure/reason/provenance codes, null `GRANT` provenance, and invalid revisions in every mutable table fail, and proves `catalog_installed_origins` plus all three archives remain. Remove old route registration and register `registerRetiredCatalogRoutes`, whose every descendant returns `{error:"Catalog resource retired; use Source Library",code:"CATALOG_RESOURCE_RETIRED"}` with status 410. The app must not instantiate the old configuration/sync services after this migration.

- [ ] **Step 4: Verify GREEN.** Run the RED command plus `npm run lint --workspace @orgops/db` and `npm run lint --workspace @orgops/schemas`; expected fresh/upgraded migration fixtures, existing Catalog retirement tests, and declarations pass. Update `docs/SPEC.md` migration and compatibility sections with the archive/backfill facts.

- [ ] **Step 5: Commit the implementation task.** `git add packages/schemas/src/catalogs/source-library.ts packages/schemas/src/index.ts packages/schemas/src/catalogs/index.ts packages/db/migrations/034_catalog_source_library.sql packages/db/src/schema.ts apps/api/src/catalog-library/test-fixtures.ts apps/api/src/app.ts apps/api/src/routes/catalogs.ts packages/schemas/src/catalogs/source-library.test.ts packages/db/src/catalog-source-library-migration.test.ts apps/api/src/catalogs.integration.test.ts apps/api/src/catalogs.sync.integration.test.ts apps/api/src/catalogs.packages.integration.test.ts apps/api/src/catalogs.install.integration.test.ts apps/api/src/catalogs.import-preview.integration.test.ts apps/api/src/catalog-configuration.test.ts docs/SPEC.md && git commit -m "feat(catalogs): add source library contracts and migration"`.

### Task 2: Source authority, transactional audits, and sync implementation

**Files:**
- Create: `apps/api/src/catalog-library/authority.ts`, `apps/api/src/catalog-library/source-fetch.ts`, `apps/api/src/catalog-library/authority.test.ts`, `apps/api/src/catalog-library/authority.integration.test.ts`
- Reuse unchanged: `apps/api/src/catalog-sync/git-fetch.ts`, `apps/api/src/catalog-sync/github-destination.ts`, `apps/api/src/catalog-sync/mirror.ts`
- Modify: `apps/api/src/app.ts`, `docs/SPEC.md`

**Interfaces:** `createCatalogAuthority({ db, fetchSource, inspectIndex, inspectRelease, writeAudit, publishAudit }): CatalogAuthority`; `writeAudit(tx, event): void` executes inside the active transaction and `publishAudit(event): void` executes only after commit. `execute({kind:"source.create",...}, admin)` returns `{ kind:"source", source, syncAttempt }` and runs Git outside SQLite transactions.

- [ ] **Step 1: RED — exercise transaction ownership and last-known-good sync.**

```ts
it("commits a successful Source mutation and its audit in one transaction", async () => {
  const { authority, db, auditEvents } = makeAuthorityFixture();
  await authority.execute(sourceCommand(), adminActor());
  expect(db.prepare("SELECT count(*) AS n FROM catalog_sources").get()).toEqual({ n: 1 });
  expect(auditEvents()).toHaveLength(1);
});
it("rolls back the control mutation when audit insertion fails", async () => {
  const { authority, db } = makeAuthorityFixture({ writeAudit: () => { throw new Error("audit failure"); } });
  await expect(authority.execute(sourceCommand(), adminActor())).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  expect(db.prepare("SELECT count(*) AS n FROM catalog_sources").get()).toEqual({ n: 0 });
});
it.each(["fetch", "inspection", "identity", "promotion", "transaction", "cleanup"] as const)("keeps a non-null last-known-good snapshot after %s failure", async (failureMode) => {
  const fixture = makeAuthorityFixture();
  const success = await fixture.authority.execute({ kind: "source.sync", sourceId: "source-team", expectedRevision: 1 }, adminActor());
  expect(success).toMatchObject({ kind: "sync", syncAttempt: { state: "SUCCEEDED" } });
  const first = fixture.currentSnapshotId();
  expect(first).toEqual(expect.any(String));
  fixture.failNextSync(failureMode);
  const failed = await fixture.authority.execute({ kind: "source.sync", sourceId: "source-team", expectedRevision: 1 }, adminActor());
  expect(failed).toMatchObject({ kind: "sync", syncAttempt: { state: "FAILED" } });
  expect(fixture.currentSnapshotId()).toBe(first);
  expect(fixture.snapshotCount()).toBe(1);
});
```

`makeAuthorityFixture` is defined in the test file as `makeAuthorityFixture(options?: { fetchSource?: FetchSource; writeAudit?: AuditWriter })`. It exposes `failNextSync(mode)`, which switches exactly one injected fetch/inspect/identity/promote/transaction/cleanup seam after the successful first call, plus `currentSnapshotId()` and `snapshotCount()`. It uses `catalogIndexFixture("good-commit")`, records `publishAudit` calls, and never uses live GitHub. The explicit non-null and row-count assertions make preservation non-vacuous.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/api/src/catalog-library/authority.test.ts apps/api/src/catalog-library/authority.integration.test.ts`. Expected: failure because the authority and transaction-aware audit writer do not exist.

- [ ] **Step 3: GREEN — implement the Source domain.** Persist Source create/patch/remove/restore/read-credential changes in short SQLite transactions. Persist `RUNNING` before bounded Git work, inspect fixed `catalog/index.json` and reached packages offline, compare every known `(authoritySourceId,name,version)` identity, promote only the exact commit, then recheck admin authority, Source revision, and immutable binding in one transaction. The commit seam has this shape:

```ts
const attempt = db.transaction(() => insertRunningAttempt(command, actor));
const observation = await fetchAndInspectOutsideTransaction(source, attempt.id);
const result = db.transaction(() => {
  assertCurrentAdmin(actor); assertRevision(source.sourceId, command.expectedRevision);
  const event = persistObservationAndBuildAudit(observation, actor);
  writeAudit(db, event); // before COMMIT
  return finishAttempt(event);
})();
publishAudit(result.audit); // after COMMIT only
```

On every failure complete a redacted failed attempt and leave `current_snapshot_id` unchanged. Never pass credential material to a query result or runner.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/api/src/catalog-library/authority.test.ts apps/api/src/catalog-library/authority.integration.test.ts apps/api/src/catalog-sync/github-destination.test.ts apps/api/src/catalog-sync/git-fetch.test.ts apps/api/src/catalog-sync/mirror.test.ts`; expected stale revision, source lock, source-scoped credential, identity conflict, no execution, and audit rollback tests pass. Update `docs/SPEC.md` Source authority and sync transaction semantics.

- [ ] **Step 5: Commit.** `git add apps/api/src/catalog-library/authority.ts apps/api/src/catalog-library/source-fetch.ts apps/api/src/catalog-library/authority.test.ts apps/api/src/catalog-library/authority.integration.test.ts apps/api/src/app.ts docs/SPEC.md && git commit -m "feat(catalogs): persist immutable source snapshots"`.

### Task 3: Source HTTP routes, sync queries, and complete authorization matrix

**Files:**
- Create/modify: `apps/api/src/routes/catalog-library.ts`, `apps/api/src/routes/catalog-library.source.integration.test.ts`
- Modify: `apps/api/src/app.ts`, `docs/SPEC.md`

**Interfaces:** Add `registerCatalogSourceRoutes(app, { authority, requireAuth, requireAdmin })`. It registers `GET/POST/PATCH/DELETE /api/catalog-sources`, `GET /api/catalog-sources/:sourceId`, restore, credential PUT/DELETE, `POST /:sourceId/sync` with body `{expectedRevision}`, `GET /:sourceId/sync-attempts`, and `GET /:sourceId/snapshots`. Every response is `Cache-Control: no-store`; body parsing is strict and actual-stream bounded.

- [ ] **Step 1: RED — write real Hono requests for all principals and canonical sync paths.**

```ts
it.each([
  ["admin", 201], ["human", 403], ["runner-global", 403], ["runner-scoped", 403], ["anonymous", 401],
] as const)("applies the Source-management matrix to %s", async (principal, status) => {
  expect((await sourceApp(principal).request("/api/catalog-sources", { method: "POST", body: JSON.stringify(sourceBody()), headers: { "content-type": "application/json" } })).status).toBe(status);
});
it("uses fixed index path and exposes sync attempts/snapshots without exposing credentials", async () => {
  const app = sourceApp("admin");
  const response = await app.request("/api/catalog-sources/source-team/sync", { method: "POST", body: JSON.stringify({ expectedRevision: 1 }), headers: { "content-type": "application/json" } });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await app.request("/api/catalog-sources/source-team/snapshots")).status).toBe(200);
  expect(JSON.stringify(await (await app.request("/api/catalog-sources/source-team")).json())).not.toContain("ciphertext");
});
it("rejects unknown fields, invalid UTF-8, and a 16 KiB streamed body before domain work", async () => {
  expect((await sourceApp("admin").request("/api/catalog-sources", { method: "POST", body: JSON.stringify({ ...sourceBody(), extra: true }), headers: { "content-type": "application/json" } })).status).toBe(400);
  expect((await sourceApp("admin").request("/api/catalog-sources", { method: "POST", body: new Uint8Array(16385), headers: { "content-type": "application/json" } })).status).toBe(413);
});
```

`sourceApp(principal)` is defined in the test file by `createMigratedTestApp({ principal, catalogAuthority: authorityFixture })`; `sourceBody()` returns `{sourceId:"source-new",displayName:"Team",repository:{url:"https://github.com/acme/catalog.git"},ref:"main",enabled:true,allowPackages:false}`. Add separate requests for create, patch, remove, restore, credential, sync, attempts, and snapshots for the same five principals; admin succeeds and the four other rows fail with their specified status.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/api/src/routes/catalog-library.source.integration.test.ts`; expected missing registration/routes and missing canonical sync query responses.

- [ ] **Step 3: GREEN — add only Source route translation.** Parse a strict body before calling authority, map fixed domain errors to `{error,code}` messages, run `requireAuth` followed by a fresh `requireAdmin` for mutations, and derive the authenticated human from the session. The sync handler passes only `expectedRevision`; it never accepts an index path. Implement handlers with this translation shape:

```ts
app.post("/api/catalog-sources/:sourceId/sync", requireAuth, requireAdmin, async (c) => {
  const body = await readStrictBody(c, SyncSourceSchema);
  if (!body.ok) return catalogError(c, body.code);
  return commandResponse(c, await authority.execute({ kind: "source.sync", sourceId: c.req.param("sourceId"), expectedRevision: body.value.expectedRevision }, c.get("user")));
});
```

Add fixed 410 old-route coverage from Task 1 without reading legacy Catalog tables.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/api/src/routes/catalog-library.source.integration.test.ts apps/api/src/admin-access.integration.test.ts apps/api/src/catalogs.integration.test.ts`; expected all Source routes, auth matrix rows, stale revision, fixed errors, no-store, stream bound, last-good snapshot, and no credential fields pass. Update `docs/SPEC.md` route and error tables.

- [ ] **Step 5: Commit.** `git add apps/api/src/routes/catalog-library.ts apps/api/src/routes/catalog-library.source.integration.test.ts apps/api/src/app.ts docs/SPEC.md && git commit -m "feat(catalogs): expose source synchronization routes"`.

### Task 4: Release discovery, review controls, and administrator release routes

**Files:**
- Modify: `apps/api/src/catalog-library/authority.ts`, `apps/api/src/routes/catalog-library.ts`, `apps/api/src/app.ts`
- Create: `apps/api/src/catalog-library/review.test.ts`, `apps/api/src/routes/catalog-library.release.integration.test.ts`
- Modify: `docs/SPEC.md`

**Interfaces:** `execute({kind:"release.review", releaseId, action:"APPROVE"|"REJECT"|"WITHDRAW"|"REOPEN", expectedRevision, digest, reviewDigest}, admin)`; queries `release.list` and `release.detail`; handlers cover `GET /api/catalog-releases`, `GET /api/catalog-releases/:id`, and review action routes. Release detail returns the complete shared `PackageReleaseView`, including execution preview, warnings, file path/mode/size/digest inventory, review digest/reviewer, and API activation state.

- [ ] **Step 1: RED — prove hidden pending releases and exact review binding.**

```ts
it("starts releases pending and requires matching release and review digests", async () => {
  const { authority } = makeAuthorityFixture();
  const pending = await authority.query({ kind: "release.detail", packageReleaseId: "release-skill" }, adminActor());
  expect(pending.reviewState).toBe("PENDING");
  await expect(authority.execute({ kind: "release.review", releaseId: "release-skill", action: "APPROVE", expectedRevision: 1, digest: "sha256:" + "b".repeat(64), reviewDigest: "sha256:" + "c".repeat(64) }, adminActor())).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
});
it("returns the complete immutable review and execution projection", async () => {
  const detail = await makeAuthorityFixture().authority.query({ kind: "release.detail", packageReleaseId: "release-skill" }, adminActor());
  expect(detail).toMatchObject({
    executionPreview: { apiEventShapes: ["event-shapes.ts"], runnerScripts: [], wrappedCommands: [], externalSources: [] },
    warnings: expect.any(Array),
    files: [{ path: "SKILL.md", mode: 0o644, size: expect.any(Number), digest: expect.stringMatching(/^sha256:/) }],
    reviewDigest: null,
    reviewer: null,
    apiActivation: { approvalState: "AWAITING_APPROVAL", runtimeState: "INACTIVE", revision: 1, failureCode: null },
  });
});
it("does not let a regular human query hidden release detail or review it", async () => {
  const app = releaseApp("human");
  expect((await app.request("/api/catalog-releases/release-skill")).status).toBe(403);
  expect((await app.request("/api/catalog-releases/release-skill/approve", { method: "POST", body: JSON.stringify(reviewBody()), headers: { "content-type": "application/json" } })).status).toBe(403);
});
```

`reviewBody()` is `{ expectedRevision: 1, digest: "sha256:" + "a".repeat(64), reviewDigest: "sha256:" + "d".repeat(64) }`, and `releaseApp(principal)` is the same real app fixture as Task 3 with a seeded pending release.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/api/src/catalog-library/review.test.ts apps/api/src/routes/catalog-library.release.integration.test.ts`; expected absent controls/routes fail.

- [ ] **Step 3: GREEN — persist the review state machine.** Store one `catalog_release_controls` row per immutable release; enforce `PENDING -> APPROVED|REJECTED`, `APPROVED -> WITHDRAWN`, and reopen transitions with expected revision, exact release digest, and exact review digest. The transition function is:

```ts
function review(current: ReleaseControl, input: ReviewCommand): ReleaseControl {
  if (current.revision !== input.expectedRevision || input.digest !== current.releaseDigest) throw conflict("REVISION_CONFLICT");
  if (input.action === "APPROVE" && current.state !== "PENDING") throw conflict("STATE_CONFLICT");
  if (input.action === "WITHDRAW" && current.state !== "APPROVED") throw conflict("STATE_CONFLICT");
  return { ...current, state: nextReviewState(current.state, input.action), reviewDigest: input.reviewDigest, revision: current.revision + 1 };
}
```

Build release detail from the immutable inspection snapshot plus release control, installation, and activation rows, returning the complete schema-inferred `PackageReleaseView` without raw file bytes. Keep release detail admin-only and prevent approval from implying installation or API activation. Add route registration only for release read/review capability now available.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/api/src/catalog-library/review.test.ts apps/api/src/routes/catalog-library.release.integration.test.ts`; expected review transitions, hidden metadata, fixed conflict errors, and typed audit insertion pass. Update `docs/SPEC.md` review API/schema.

- [ ] **Step 5: Commit.** `git add apps/api/src/catalog-library/authority.ts apps/api/src/routes/catalog-library.ts apps/api/src/app.ts apps/api/src/catalog-library/review.test.ts apps/api/src/routes/catalog-library.release.integration.test.ts docs/SPEC.md && git commit -m "feat(catalogs): add immutable release review"`.

### Task 5: Exact all-kind inert installation

**Files:**
- Create: `apps/api/src/catalog-library/installation.ts`, `apps/api/src/catalog-library/installation.test.ts`, `apps/api/src/catalog-library/install.integration.test.ts`
- Modify: `apps/api/src/routes/catalog-library.ts`, `apps/api/src/app.ts`, `docs/SPEC.md`

**Interfaces:** `createPackageInstallation({ db, inspectGitPackage, readLocalSkillEvidence, prepareImport, artifactRoot, writeAudit }): PackageInstallation`; `InstallExactCommand` contains `packageReleaseId` and exact closure release IDs only. Installation returns `{ ok:true, packages: Array<{packageReleaseId:string; action:"installed"|"reused"}>, activated:false }` or a fixed failure code.

- [ ] **Step 1: RED — test all package kinds, exact reuse, no-overwrite, and no execution.**

```ts
it("installs skill, native CLASSIC, native RLM_REPL, and WRAPPED artifacts without execution", async () => {
  const { installation, executionCalls } = installationFixture();
  const result = await installation.installExact({ packageReleaseId: "release-native-rlm", dependencyReleaseIds: ["release-skill"] }, adminActor());
  expect(result).toMatchObject({ ok: true, activated: false });
  expect(result.packages.map((entry) => entry.action)).toEqual(["installed", "installed"]);
  expect(executionCalls()).toEqual([]);
});
it("rejects occupied names or a mid-population failure without overwriting or writing origins", async () => {
  const { installation, listArtifactNames, listOrigins } = installationFixture({ occupiedName: "native-rlm", failAfterFile: 1 });
  const result = await installation.installExact({ packageReleaseId: "release-native-rlm", dependencyReleaseIds: [] }, adminActor());
  expect(result).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
  expect(listArtifactNames()).toEqual(["native-rlm"]);
  expect(listOrigins()).toEqual([]);
});
it("remeasures every byte before reuse and refuses a mutated artifact", async () => {
  const { installation, mutateArtifact } = installationFixture({ installedExact: true });
  expect(await installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor())).toMatchObject({ packages: [{ action: "reused" }] });
  mutateArtifact();
  expect(await installation.installExact({ packageReleaseId: "release-skill", dependencyReleaseIds: [] }, adminActor())).toMatchObject({ ok: false, code: "INSPECTION_FAILED" });
});
```

`installationFixture(options)` returns the named values and injects pure fixture adapters; its `executionCalls` spies on dynamic import and wrapper execution functions, not on policy. It writes only a temporary test artifact root.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/api/src/catalog-library/installation.test.ts apps/api/src/catalog-library/install.integration.test.ts`; expected absent installation and content-addressed provenance fail.

- [ ] **Step 3: GREEN — implement inert installation.** Verify release approval, exact dependency closure, package modes/paths/limits/digest and namespace occupancy; stage under an operation-owned temporary directory; populate with exclusive creation and no replacement; promote to an immutable digest path; remeasure before reuse; write origins last in one transaction; clean only this operation's staging/claimed targets. Use this operation order:

```ts
const op = beginInstall(command, actor);
try {
  const closure = verifyExactClosure(command);
  const staged = await stageWithExclusiveCreate(op.id, closure, artifactRoot);
  await verifyDigestAndModes(staged, closure);
  const finalRoot = await promoteWithoutReplacement(staged, closure);
  db.transaction(() => { persistInstallations(closure, finalRoot); persistOrigins(closure, actor); writeAudit(db, installAudit(op)); });
  return installedResult(closure);
} catch (error) { cleanupOwnedTargets(op.id); return fixedInstallFailure(error); }
```

Do not call network, `getMasterKey`, dynamic imports, or wrapped setup/runtime.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/api/src/catalog-library/installation.test.ts apps/api/src/catalog-library/install.integration.test.ts apps/api/src/catalog-sync/import-preview.test.ts apps/api/src/catalog-sync/install.test.ts`; expected all-kind inert install, exact reuse, narrow cleanup, no-overwrite, and format-v1 tests pass. Update `docs/SPEC.md` install/execution boundary.

- [ ] **Step 5: Commit.** `git add apps/api/src/catalog-library/installation.ts apps/api/src/catalog-library/installation.test.ts apps/api/src/catalog-library/install.integration.test.ts apps/api/src/routes/catalog-library.ts apps/api/src/app.ts docs/SPEC.md && git commit -m "feat(catalogs): install reviewed packages inertly"`.

### Task 6: Central policy and grant state

**Files:**
- Create: `apps/api/src/catalog-library/policy.ts`, `apps/api/src/catalog-library/policy.test.ts`, `apps/api/src/catalog-library/grants.test.ts`, `apps/api/src/catalog-library/grants.integration.test.ts`
- Modify: `apps/api/src/catalog-library/authority.ts`, `apps/api/src/routes/catalog-library.ts`, `apps/api/src/app.ts`, `docs/SPEC.md`

**Interfaces:** `createCatalogPolicy({ canManageAgent, readRelease, readGrant }): CatalogPolicy`; grant commands are `grant.organization`, `grant.human`, and `grant.revoke`, each carrying the current grant revision. `decide` returns `{allow:true}` or `{allow:false, reasonCode: CatalogLibraryErrorCode}`.

- [ ] **Step 1: RED — test independent capabilities and revocation.**

```ts
it("does not interchange source enablement, approval, installation, grant, and API activation", () => {
  const { policy } = policyFixture();
  expect(policy.decide({ action: "RELEASE_INSTALL", actor: adminActor(), release: pendingRelease() })).toEqual({ allow: false, reasonCode: "RELEASE_NOT_APPROVED" });
  expect(policy.decide({ action: "TEMPLATE_INSTANTIATE", actor: humanActor(), release: installedApprovedRelease() })).toEqual({ allow: false, reasonCode: "GRANT_REQUIRED" });
});
it("limits organization grants to current/future humans and keeps local agents after revocation", async () => {
  const { authority, policy, existingAgent } = grantFixture();
  await authority.execute({ kind: "grant.organization", releaseId: "release-skill", expectedRevision: 0 }, adminActor());
  expect(policy.decide({ action: "LIBRARY_VIEW", actor: humanActor("future-human"), release: installedApprovedRelease() })).toEqual({ allow: true });
  await authority.execute({ kind: "grant.revoke", grantId: "grant-org", expectedRevision: 1 }, adminActor());
  expect(policy.decide({ action: "TEMPLATE_INSTANTIATE", actor: humanActor(), release: installedApprovedRelease() })).toMatchObject({ allow: false, reasonCode: "GRANT_REQUIRED" });
  expect(existingAgent()).toBe(true);
});
```

`policyFixture` and `grantFixture` are local factories that seed the IDs from Task 1, approved/install rows, and one existing origin; they return real policy/authority modules.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/api/src/catalog-library/policy.test.ts apps/api/src/catalog-library/grants.test.ts apps/api/src/catalog-library/grants.integration.test.ts`; expected no central decisions or grant rows fail.

- [ ] **Step 3: GREEN — implement the authorization seam and grants.** Check admin authority for grant mutations, constrained organization/human subjects, approval and installation before grant creation, revision/tombstone revocation, and effective grant evaluation at read/action time. Use one decision switch rather than route-local checks:

```ts
function decide(input: PolicyDecisionInput): PolicyDecision {
  if (adminOnly.has(input.action) && input.actor.kind !== "HUMAN_ADMIN") return { allow: false, reasonCode: "FORBIDDEN" };
  if (consumption.has(input.action) && !hasCurrentGrant(input.actor, input.release)) return { allow: false, reasonCode: "GRANT_REQUIRED" };
  if (input.action !== "LIBRARY_VIEW" && input.release && !isApprovedInstalled(input.release)) return { allow: false, reasonCode: "INSTALLATION_REQUIRED" };
  return { allow: true };
}
```

Keep removal/withdrawal/revocation from deleting or stopping consumed local agents. Register admin grant routes: release grants list, organization PUT/DELETE, human PUT/DELETE, revision guarded.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/api/src/catalog-library/policy.test.ts apps/api/src/catalog-library/grants.test.ts apps/api/src/catalog-library/grants.integration.test.ts apps/api/src/routes/catalog-library.release.integration.test.ts`; expected matrix decisions, future-user scope, revocation, and redacted audits pass. Update `docs/SPEC.md` authorization/grant matrix.

- [ ] **Step 5: Commit.** `git add apps/api/src/catalog-library/policy.ts apps/api/src/catalog-library/policy.test.ts apps/api/src/catalog-library/grants.test.ts apps/api/src/catalog-library/grants.integration.test.ts apps/api/src/catalog-library/authority.ts apps/api/src/routes/catalog-library.ts apps/api/src/app.ts docs/SPEC.md && git commit -m "feat(catalogs): add grant authorization"`.

### Task 7: User library queries and delegated HTTP authorization

**Files:**
- Create: `apps/api/src/catalog-library/library.integration.test.ts`
- Modify: `apps/api/src/routes/catalog-library.ts`, `apps/api/src/app.ts`, `docs/SPEC.md`

**Interfaces:** Register `GET /api/library/packages` and `GET /api/library/packages/:packageReleaseId`; authenticated principal is server-derived. The route never accepts `humanId`, source credential, installation command, or raw bytes. It returns only approved, installed, effectively granted release summaries.

- [ ] **Step 1: RED — exercise only the library routes owned by this task.**

```ts
it.each([
  ["admin", "/api/library/packages", 200],
  ["human-with-grant", "/api/library/packages", 200],
  ["human-without-grant", "/api/library/packages", 200],
  ["agent", "/api/library/packages", 403],
  ["runner-global", "/api/library/packages", 403],
  ["runner-scoped", "/api/library/packages", 403],
  ["anonymous", "/api/library/packages", 401],
] as const)("applies library list authorization to %s", async (principal, path, status) => {
  expect((await libraryApp(principal).request(path)).status).toBe(status);
});
it("returns no hidden metadata without an effective grant", async () => {
  const app = libraryApp("human-without-grant");
  expect(await (await app.request("/api/library/packages")).json()).toEqual({ packages: [], emptyReason: "NO_GRANTS" });
  expect((await app.request("/api/library/packages/release-skill")).status).toBe(404);
});
```

`libraryApp` is a local fixture creating sessions for admin, granted human, ungranted human, agent, global/scoped runner, and anonymous. This task loops only over `GET /api/library/packages` and `GET /api/library/packages/release-skill`: admin and granted human receive the filtered 200 projection, an ungranted human receives an empty list or 404 detail without hidden metadata, agent/global runner/scoped runner receive 403, and anonymous receives 401. Source/review/install/grant matrices remain in Tasks 3–6; template, assignment, API activation, and rollout route matrices are added RED-first in their owning Tasks 8, 9, 13, and 14. Task 18 runs the aggregate matrix only after all route families exist.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/api/src/catalog-library/library.integration.test.ts`; expected missing library routes and per-family authorization failures.

- [ ] **Step 3: GREEN — add the read projection and guards.** Require `requireAuth`; allow only an authenticated human for library reads; invoke policy with the server-derived principal; filter by approval, installed state, and effective current grant; return distinct bounded empty-state reason IDs (`NO_GRANTS`, `NOT_INSTALLED`, `NO_COMPATIBLE_RELEASES`). The projection query is:

```sql
SELECT r.package_release_id, r.kind, r.name, r.version, r.digest
FROM catalog_package_releases r
JOIN catalog_release_controls c ON c.package_release_id=r.package_release_id AND c.review_state='APPROVED'
JOIN catalog_installations i ON i.package_release_id=r.package_release_id AND i.state='INSTALLED'
WHERE EXISTS (SELECT 1 FROM catalog_grants g WHERE g.release_id=r.package_release_id AND g.revoked_at IS NULL AND (g.subject_type='ORGANIZATION' OR g.human_id=:humanId));
```

Keep all source/review/install/grant/API-activation routes admin-only and all runner identities denied.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/api/src/catalog-library/library.integration.test.ts apps/api/src/routes/catalog-library.source.integration.test.ts apps/api/src/admin-access.integration.test.ts`; expected admin, granted, ungranted, runner, and anonymous HTTP results pass with no hidden metadata. Update `docs/SPEC.md` library routes and authorization matrix.

- [ ] **Step 5: Commit.** `git add apps/api/src/catalog-library/library.integration.test.ts apps/api/src/routes/catalog-library.ts apps/api/src/app.ts docs/SPEC.md && git commit -m "feat(catalogs): expose grant-filtered library"`.

### Task 8: Stopped native and wrapped template instantiation

**Files:**
- Create: `apps/api/src/catalog-library/templates.ts`, `apps/api/src/catalog-library/templates.test.ts`, `apps/api/src/catalog-library/templates.integration.test.ts`
- Modify: `apps/api/src/routes/catalog-library.ts`, `apps/api/src/routes/agents.ts`, `apps/api/src/app.ts`, `docs/SPEC.md`

**Interfaces:** `instantiateTemplate({ packageReleaseId, ownerHumanId, name, visibility, runnerId, workspacePath, modelId, secretBindings }, actor)` returns `{ agent, origin, requirements }`; `ownerHumanId` is always the session owner for user routes. It copies only portable manifest fields and creates `desiredState:"STOPPED"`, `runtimeState:"STOPPED"`, and no channels.

- [ ] **Step 1: RED — test all three modes and secret-reference-only persistence.**

```ts
it.each(["CLASSIC", "RLM_REPL", "WRAPPED"] as const)("creates an independent stopped %s instance", async (mode) => {
  const result = await templateFixture().instantiateTemplate(templateInput(mode), humanActor());
  expect(result.agent).toMatchObject({ desiredState: "STOPPED", runtimeState: "STOPPED", channelIds: [] });
  expect(result.origin.packageReleaseId).toBe(templateInput(mode).packageReleaseId);
});
it("stores references, not secret values, and does not invoke wrapped setup", async () => {
  const fixture = templateFixture();
  const result = await fixture.instantiateTemplate({ ...templateInput("WRAPPED"), secretBindings: [{ requirementName: "API_KEY", secretId: "secret-1" }] }, humanActor());
  expect(result.requirements).toContainEqual({ name: "API_KEY", state: "MISSING" });
  expect(fixture.databaseText()).not.toContain("secret-value");
  expect(fixture.wrapperCalls()).toEqual([]);
});
it("persists catalog template skill pins only as normalized assignments", async () => {
  const fixture = templateFixture({ nativeEnabledSkills: ["catalog"], nativeAlwaysPreloadedSkills: ["catalog"] });
  await fixture.instantiateTemplate(templateInput("CLASSIC"), humanActor());
  expect(fixture.legacySkillJson("agent-from-template")).toEqual({ enabledSkills: [], alwaysPreloadedSkills: [] });
  expect(fixture.normalizedAssignments("agent-from-template")).toEqual([
    { releaseId: "release-skill", localSkillName: "catalog", desiredState: "ENABLED", effectiveState: "DISABLED", deploymentState: "REQUESTED", preload: true },
  ]);
});
```

`templateInput(mode)` and `templateFixture(options?: { nativeEnabledSkills?: string[]; nativeAlwaysPreloadedSkills?: string[] })` are defined in `templates.test.ts`; they seed one approved, installed, granted template release plus exact installed skill-pin releases and use a fixed runner/workspace/model binding. The fixture exposes `legacySkillJson(agentName)` and `normalizedAssignments(agentName)` as direct database projections. `templates.integration.test.ts` also sends `POST /api/library/templates/release-native-rlm/instances` as admin, granted owner, ungranted human, unmanageable human, agent, global/scoped runner, and anonymous: only admin-with-management and granted owner receive 201; human policy failures are 403, nonhuman authenticated principals are 403, and anonymous is 401.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/api/src/catalog-library/templates.test.ts apps/api/src/catalog-library/templates.integration.test.ts`; expected current agent creation lacks origin, grant, installation, and stopped-template behavior.

- [ ] **Step 3: GREEN — implement positive selection and creation.** Validate effective grant, exact installed closure, local name, runner assignment, workspace/model binding, and secret-reference shape. Build the row from an allowlist:

```ts
const agent = { name: input.name, ownerHumanId: actor.id, assignedRunnerId: input.runnerId, workspacePath: input.workspacePath, modelId: input.modelId, desiredState: "STOPPED", runtimeState: "STOPPED", enabledSkills: [], alwaysPreloadedSkills: [], wrappedConfig: reviewedWrappedWiring(manifest) };
const skillPins = resolveExactInstalledTemplateSkillPins(manifest);
const provenance = resolveConsumptionProvenance(actor, releaseIdentity); // ADMIN has grantId:null; GRANT has the effective grant ID
db.transaction(() => {
  insertAgent(agent);
  insertTemplateOrigin(agent.name, releaseIdentity, actor.id);
  for (const pin of skillPins) insertSkillAssignment({ agentId: agent.name, releaseId: pin.releaseId, localSkillName: pin.name, desiredState: "ENABLED", effectiveState: "DISABLED", deploymentState: "REQUESTED", preload: pin.preloaded, actorKind: provenance.actorKind, grantId: provenance.grantId, actorHumanId: actor.id });
  insertBindings(agent.name, input.secretBindings);
  writeAudit(db, templateAudit(agent, actor));
});
```

Copy only native instructions/soul/portable tuning/model suggestion/skill pins or reviewed wrapped resource wiring; never copy DB rows, channels, events, memory, absolute paths, local secret values, or lifecycle state. Catalog pins never enter `enabled_skills_json` or `always_preloaded_skills_json`; those legacy arrays remain empty for package templates (and remain reserved for separately selected built-in/local skills). Insert the stopped agent, origin, normalized assignments, and binding references in one transaction and emit one audit.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/api/src/catalog-library/templates.test.ts apps/api/src/catalog-library/templates.integration.test.ts apps/api/src/routes/agents.test.ts apps/api/src/app.test.ts`; expected CLASSIC/RLM_REPL/WRAPPED, field exclusion, grant/install gates, and no wrapper execution pass. Update `docs/SPEC.md` template contract.

- [ ] **Step 5: Commit.** `git add apps/api/src/catalog-library/templates.ts apps/api/src/catalog-library/templates.test.ts apps/api/src/catalog-library/templates.integration.test.ts apps/api/src/routes/catalog-library.ts apps/api/src/routes/agents.ts apps/api/src/app.ts docs/SPEC.md && git commit -m "feat(catalogs): create stopped package templates"`.

### Task 9: Normalized assignments and policy-safe agent skill routes

**Files:**
- Create: `apps/api/src/catalog-library/consumption.ts`, `apps/api/src/catalog-library/assignments.test.ts`, `apps/api/src/catalog-library/assignments.integration.test.ts`
- Modify: `apps/api/src/catalog-library/policy.ts`, `apps/api/src/routes/catalog-library.ts`
- Modify: `docs/SPEC.md`

**Interfaces:** `PUT/DELETE /api/agents/:name/catalog-skills/:packageReleaseId` accepts `{ expectedAgentRevision, expectedAssignmentRevision, preload }`; `CatalogConsumption.assignSkill(AssignmentCommand, ConsumptionActor)` is the only assignment command seam. `CatalogAuthority` remains administrator-only and never accepts assignment commands. Runner projection combines only effective normalized assignments with legacy `enabled_skills_json` and `always_preloaded_skills_json` and rejects duplicate local skill names.

- [ ] **Step 1: RED — test exact pinning, revision conflicts, and name collision.**

```ts
it("pins one installed digest and rejects a local-name collision with legacy JSON", async () => {
  const fixture = assignmentFixture({ enabledSkillsJson: ["catalog"], assignmentLocalNames: ["catalog"] });
  await expect(fixture.enable("agent-a", "release-skill", { expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: false })).resolves.toMatchObject({ code: "STATE_CONFLICT" });
});
it("keeps the old effective generation until the requested deployment reports ACTIVE", async () => {
  const fixture = assignmentFixture({ effectiveState: "DISABLED", activeGeneration: "gen-1" });
  await fixture.enable("agent-a", "release-skill", { expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: false });
  expect(await fixture.currentAssignment()).toMatchObject({ desiredState: "ENABLED", effectiveState: "DISABLED", deploymentState: "REQUESTED", activeGeneration: "gen-1" });
  await fixture.reportDeployment("FAILED");
  expect(await fixture.currentAssignment()).toMatchObject({ desiredState: "ENABLED", effectiveState: "DISABLED", deploymentState: "FAILED", activeGeneration: "gen-1" });
  await fixture.retryAndReportActive("gen-2");
  expect(await fixture.currentAssignment()).toMatchObject({ desiredState: "ENABLED", effectiveState: "ENABLED", deploymentState: "STABLE", activeGeneration: "gen-2" });
});
it("records the exact grant for delegated assignment provenance", async () => {
  const fixture = assignmentFixture();
  await fixture.enableAs(humanActor("human-a"), "agent-a", "release-skill", { expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: false });
  expect(await fixture.currentAssignment()).toMatchObject({ actorKind: "GRANT", actorHumanId: "human-a", grantId: "grant-human-a" });
});
it("does not change an existing effective assignment when its grant is revoked", async () => {
  const fixture = assignmentFixture({ effectiveState: "ENABLED", activeGeneration: "gen-1" });
  await fixture.revokeGrant();
  expect(await fixture.currentAssignment()).toMatchObject({ effectiveState: "ENABLED", activeGeneration: "gen-1" });
});
```

`assignmentFixture(options)` seeds an agent, exact installed release, assignment row, and legacy JSON in the same in-memory DB; it exposes only the named methods above. The integration test sends PUT and DELETE as admin, granted owner, ungranted human, unmanageable human, agent, global/scoped runner, and anonymous. Admin still needs `canManageAgent`; an ordinary human needs both it and a current grant; all nonhuman principals are denied.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/api/src/catalog-library/assignments.test.ts apps/api/src/catalog-library/assignments.integration.test.ts`; expected no normalized assignment decisions.

- [ ] **Step 3: GREEN — persist normalized assignments.** Require effective grant for ordinary humans, `canManageAgent` for target ownership, exact approved/install release, expected revisions, and one local-name uniqueness constraint. Implement the mutation as:

```ts
const provenance = requireAssignmentProvenance(actor, releaseId); // resolves ADMIN/null or GRANT/exact-current-grant ID
db.transaction(() => {
  assertAgentRevision(agentId, expectedAgentRevision);
  assertAssignmentRevision(agentId, expectedAssignmentRevision);
  assertNoLegacyOrCatalogNameConflict(agentId, release.localSkillName);
  upsertAssignment({ agentId, releaseId, desiredState: "ENABLED", effectiveState: current?.effectiveState ?? "DISABLED", deploymentState: "REQUESTED", activeGeneration: current?.activeGeneration ?? null, desiredGeneration: nextGeneration(), preload, revision: expectedAssignmentRevision + 1, actorKind: provenance.actorKind, actorHumanId: actor.id, grantId: provenance.grantId });
  enqueueBoundDeployment({ agentId, releaseId, desiredGeneration });
  writeAudit(db, assignmentAudit(agentId, releaseId, actor));
});
```

A disable request likewise changes desired state and queues a generation while retaining the current effective state. Only Task 10's matching `ACTIVE` receipt atomically copies desired to effective, sets `STABLE`, and advances `activeGeneration`; `FAILED` sets only deployment state. Preserve existing assignment on later grant revocation. Keep built-in/local JSON skills unchanged and reject only collisions in the effective combined projection.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/api/src/catalog-library/assignments.test.ts apps/api/src/catalog-library/assignments.integration.test.ts apps/api/src/routes/agents.test.ts`; expected assignment state, bounded revision, exact admin/grant provenance, ownership, collision, and legacy projection pass. Update `docs/SPEC.md` assignment semantics.

- [ ] **Step 5: Commit.** `git add apps/api/src/catalog-library/consumption.ts apps/api/src/catalog-library/policy.ts apps/api/src/routes/catalog-library.ts apps/api/src/catalog-library/assignments.test.ts apps/api/src/catalog-library/assignments.integration.test.ts docs/SPEC.md && git commit -m "feat(catalogs): normalize skill assignments"`.

### Task 10: Runner delivery protocol and queued-to-active invocation

**Files:**
- Create: `apps/api/src/catalog-library/runner-delivery.ts`, `apps/api/src/catalog-library/runner-delivery.test.ts`, `apps/agent-runner/src/package-delivery.ts`, `apps/agent-runner/src/package-delivery.test.ts`, `apps/agent-runner/src/runtime-generation.ts`, `apps/agent-runner/src/runtime-generation.test.ts`
- Modify: `apps/api/src/routes/catalog-library.ts`, `apps/api/src/routes/runners.ts`, `apps/api/src/app.ts`, `apps/agent-runner/src/runner/api.ts`, `apps/agent-runner/src/runner.ts`, `docs/SPEC.md`

**Interfaces:** API `RunnerArtifactDelivery.poll({ runnerId })` returns only rows bound to that authenticated runner; `claim({runnerId,deploymentId})`, `getArtifact({runnerId,deploymentId,attemptToken})`, and `report({runnerId,deploymentId,attemptToken}, report)` use the exact shared types. Runner API implements the four matching `RunnerCatalogClient` deployment methods. An `ACTIVE` report atomically updates the deployment, rollout target, and assignment effective generation; a failed report preserves assignment effective state and active generation. The runner loop calls `processPackageDeployments()` immediately after runner heartbeat and before `listAgents()`; each command includes `agentName`, `assignedRunnerId`, and desired generation.

- [ ] **Step 1: RED — prove binding, tamper rejection, and loop progression.**

```ts
it("denies artifact access to a different runner or agent binding", async () => {
  const app = deliveryApp({ deploymentRunner: "runner-a", agentRunner: "runner-a" });
  const response = await app.request("/api/runner-package-deployments/deploy-1/artifact", { headers: { "x-orgops-runner-token": tokenFor("runner-b") } });
  expect(response.status).toBe(403);
});
it("reports STAGED, WAITING_FOR_IDLE, and ACTIVE and projects every rollout phase", async () => {
  const fixture = deliveryFixture();
  await fixture.processPackageDeployments();
  expect(fixture.deploymentStates()).toEqual(["CLAIMED", "STAGED", "WAITING_FOR_IDLE", "ACTIVE"]);
  expect(fixture.rolloutTargetStates()).toEqual(["STAGING", "WAITING_FOR_IDLE", "SUCCEEDED"]);
  expect(fixture.apiCalls()).toEqual(["list", "claim", "artifact", "report:STAGED", "report:WAITING_FOR_IDLE", "report:ACTIVE"]);
});
it.each(["wrong-release", "wrong-digest", "symlink", "oversized"] as const)("rejects %s before staging", async (variant) => {
  expect(await verifyArtifact(catalogArtifact("release-skill", variant))).toMatchObject({ ok: false, code: "INSPECTION_FAILED" });
});
```

`deliveryFixture()` uses the Task 1 artifact fixture and a fake `RunnerApi` whose ordered calls are asserted; its real API-side report adapter records `rolloutTargetStates()` from the persisted target projection. No HTTP or filesystem outside a temporary root is used.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/api/src/catalog-library/runner-delivery.test.ts apps/agent-runner/src/package-delivery.test.ts apps/agent-runner/src/runtime-generation.test.ts`; expected missing methods and the absent `WAITING_FOR_IDLE` deployment/rollout transition.

- [ ] **Step 3: GREEN — implement both protocol adapters.** Claim with an attempt token and lease. Return the strict shared `VerifiedArtifactEnvelope`: deployment/agent/generation; complete immutable `ReleaseIdentity`; canonical `PackageManifest`; ordered complete dependency identities; semantic digest; and every package file as package-relative path, `0o644|0o755`, and base64 bytes. Enforce 256 files, 1 MiB per file, 8 MiB decoded total, manifest 256 KiB, unique case-folded paths, canonical base64, and no extra fields. Never include Source URL/ref, credential/ref, API host/mirror/artifact path, grant, secret/ref, setup output, or commands outside the reviewed manifest. The runner loop is explicit:

```ts
async function processPackageDeployments() {
  for (const deployment of await api.listPackageDeployments()) {
    const claim = await api.claimPackageDeployment(deployment.deploymentId);
    const artifact = await api.getPackageArtifact(deployment.deploymentId, claim.attemptToken);
    const staged = await stageArtifact(verifyArtifact(artifact));
    await api.reportPackageDeployment(deployment.deploymentId, claim.attemptToken, { state: "STAGED", generation: staged.generation });
    await api.reportPackageDeployment(deployment.deploymentId, claim.attemptToken, { state: "WAITING_FOR_IDLE", generation: staged.generation });
    await activateDeploymentWhenIdle(deployment.agentName, staged);
    await api.reportPackageDeployment(deployment.deploymentId, claim.attemptToken, { state: "ACTIVE", generation: staged.generation });
  }
}
```

Re-inspect and digest-check, reject links/modes/overflow/drift, stage an exclusive versioned directory, report `STAGED`, then report `WAITING_FOR_IDLE` before awaiting the agent-wide idle gate, and finally report `ACTIVE` after the pointer swap in the same `processPackageDeployments` call. The API report transaction maps `STAGED -> STAGING`, `WAITING_FOR_IDLE -> WAITING_FOR_IDLE`, and `ACTIVE -> SUCCEEDED` on the bound rollout target; `getRollout` returns those target views for both admin and user status UIs. This task creates the minimal agent-bound `AgentRuntimeGeneration` pointer/lease implementation used by the loop; Task 11 first drives its all-channel concurrency behavior RED, then modifies it without changing the interface. Reassignment supersedes old deployment; restart reconciliation is idempotent by deployment ID and attempt token.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/api/src/catalog-library/runner-delivery.test.ts apps/agent-runner/src/package-delivery.test.ts apps/agent-runner/src/runtime-generation.test.ts apps/api/src/routes/catalog-library.source.integration.test.ts apps/agent-runner/src/runner.test.ts`; expected scope, lease, tamper, no-leakage, full `STAGED -> WAITING_FOR_IDLE -> ACTIVE` reporting, rollout projection, and queued-to-active integration pass. Update `docs/SPEC.md` runner protocol.

- [ ] **Step 5: Commit.** `git add apps/api/src/catalog-library/runner-delivery.ts apps/api/src/catalog-library/runner-delivery.test.ts apps/agent-runner/src/package-delivery.ts apps/agent-runner/src/package-delivery.test.ts apps/agent-runner/src/runtime-generation.ts apps/agent-runner/src/runtime-generation.test.ts apps/api/src/routes/catalog-library.ts apps/api/src/routes/runners.ts apps/api/src/app.ts apps/agent-runner/src/runner/api.ts apps/agent-runner/src/runner.ts docs/SPEC.md && git commit -m "feat(runner): deliver verified catalog artifacts"`.

### Task 11: Agent-wide runtime generations and multi-channel activation

**Files:**
- Create: `apps/agent-runner/src/channel-generation.integration.test.ts`
- Modify: `apps/agent-runner/src/runtime-generation.ts`, `apps/agent-runner/src/runtime-generation.test.ts`, `apps/agent-runner/src/channel-loop.ts`, `apps/agent-runner/src/turn-executor.ts`, `apps/agent-runner/src/runner.ts`, `docs/SPEC.md`

**Interfaces:** `createAgentRuntimeGeneration({ root, onPointerChange }): AgentRuntimeGeneration`; `captureForTurn(agentId)` returns the shared `TurnLease`; `stage` returns a `StagedGeneration` containing the deployment's exact `agentId` and `deploymentId`; `activateWhenIdle(staged)` can swap only that agent and blocks until every lease for that agent releases.

- [ ] **Step 1: RED — test all-channel idle and no mixed generation.**

```ts
it("waits for every channel lease before swapping the generation pointer", async () => {
  const fixture = generationFixture();
  const leaseA = await fixture.generation.captureForTurn("agent-a");
  const leaseB = await fixture.generation.captureForTurn("agent-a");
  const activation = fixture.generation.activateWhenIdle(fixture.staged("gen-2"));
  await Promise.resolve();
  expect(fixture.pointer()).toBe("gen-1");
  leaseA.release();
  expect(fixture.pointer()).toBe("gen-1");
  leaseB.release();
  await expect(activation).resolves.toMatchObject({ generation: "gen-2" });
});
it("captures one generation for prompt, event-shape, and skill-root reads in two concurrent channels", async () => {
  const observations = await runTwoChannelTurnsDuringActivation();
  expect(observations.every((entry) => entry.skillRoot === entry.promptRoot && entry.promptRoot === entry.eventShapeRoot)).toBe(true);
});
```

`generationFixture()` creates `gen-1` and `gen-2` temporary roots and `runTwoChannelTurnsDuringActivation()` uses the existing channel-loop test harness with two channel IDs; both functions are defined in this test file.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/agent-runner/src/runtime-generation.test.ts apps/agent-runner/src/channel-generation.integration.test.ts`; expected current per-channel-only behavior fails.

- [ ] **Step 3: GREEN — add the agent-wide lease seam.** Retain per-channel batching but add an agent-keyed lease registry, capture one immutable pointer before prompt composition and event-shape loading, wait for zero leases before pointer swap, and retain the previous generation on failed activation. A turn uses the shared lease value:

```ts
const lease = await runtime.captureForTurn(agent.id);
try {
  const generation = lease.generation;
  return executeTurn({ ...input, skillRoot: generation.skillRoot, promptRoot: generation.promptRoot, eventShapeRoot: generation.eventShapeRoot });
} finally { lease.release(); }
```

`stage` verifies `deployment.agentId === artifact.agentId`, `deployment.deploymentId === artifact.deploymentId`, and matching desired generation before returning the bound token. `activateWhenIdle` rejects an unrecognized/stale token. Ensure deployment activation calls this seam and never mutates a skill tree in place.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/agent-runner/src/runtime-generation.test.ts apps/agent-runner/src/channel-generation.integration.test.ts apps/agent-runner/src/channel-loop.test.ts apps/agent-runner/src/turn-executor.test.ts`; expected existing CLASSIC/RLM behavior and multi-channel coherence pass. Update `docs/SPEC.md` generation/runtime section.

- [ ] **Step 5: Commit.** `git add apps/agent-runner/src/runtime-generation.ts apps/agent-runner/src/runtime-generation.test.ts apps/agent-runner/src/channel-generation.integration.test.ts apps/agent-runner/src/channel-loop.ts apps/agent-runner/src/turn-executor.ts apps/agent-runner/src/runner.ts docs/SPEC.md && git commit -m "feat(runner): atomically swap agent generations"`.

### Task 12: Package-aware start validator on every lifecycle path

**Files:**
- Create: `apps/api/src/catalog-library/start-gate.ts`, `apps/api/src/catalog-library/start-gate.test.ts`, `apps/api/src/catalog-library/start-gate.integration.test.ts`
- Modify: `apps/api/src/catalog-library/runner-delivery.ts`, `apps/api/src/routes/catalog-library.ts`, `apps/api/src/routes/agents.ts`, `apps/api/src/routes/agent-invites.ts`, `apps/api/src/app.ts`, `apps/agent-runner/src/runner.ts`, `apps/agent-runner/src/runner/api.ts`, `docs/SPEC.md`

**Interfaces:** `CatalogStartGate` has the exact shared async methods and `StartRequirementsResult`. `setDesiredAgentState` is the only API writer for lifecycle transitions. `GET /api/runners/:runnerId/agents/:agentName/start-requirements`, implemented by `RunnerStartGateDelivery.getStartRequirements`, authenticates/binds the runner then invokes the same `validateCatalogStart`; `RunnerCatalogClient.getAgentStartRequirements(agentName)` calls it using the registered runner ID. Template defaults, `POST /api/agents/:name/start`, restart, internal desired-state transitions, and runner reconciliation before process creation all use this gate; ordinary non-catalog agents return `{ok:true}`.

- [ ] **Step 1: RED — test each entry point and each prerequisite.**

```ts
it("returns bounded reasons for missing install, deployment, API activation, secret, and runner bindings", async () => {
  const result = await validateCatalogStart("agent-a", humanActor());
  expect(result).toMatchObject({ code: "REQUIREMENTS_UNSATISFIED" });
  expect(result.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(["INSTALLATION_REQUIRED", "DEPLOYMENT_REQUIRED", "API_ACTIVATION_REQUIRED", "SECRET_BINDING_MISSING", "RUNNER_BINDING_MISSING"]));
});
it.each(["/api/agents/agent-a/start", "/api/agents/agent-a/restart"])("does not set desired RUNNING when %s fails the gate", async (path) => {
  const app = startGateApp("owner");
  const response = await app.request(path, { method: "POST" });
  expect(response.status).toBe(409);
  expect(app.desiredState("agent-a")).toBe("STOPPED");
});
it("serves the same gate through the assigned-runner endpoint and runner client before spawn", async () => {
  const fixture = runnerStartFixture({ requirements: { ok: false, code: "REQUIREMENTS_UNSATISFIED", reasons: [{ code: "SECRET_BINDING_MISSING" }] } });
  expect(await fixture.api.getAgentStartRequirements("agent-a")).toEqual({ ok: false, code: "REQUIREMENTS_UNSATISFIED", reasons: [{ code: "SECRET_BINDING_MISSING" }] });
  await fixture.reconcile();
  expect(fixture.requestPaths()).toContain("/api/runners/runner-a/agents/agent-a/start-requirements");
  expect(fixture.spawnCalls()).toBe(0);
});
it("denies a start-requirements request from a runner other than the agent assignment", async () => {
  expect((await startGateApp("runner-b").request("/api/runners/runner-b/agents/agent-a/start-requirements")).status).toBe(403);
});
```

`startGateApp`, `runnerStartFixture`, and the seeded catalog agent are local factories in `start-gate.integration.test.ts`; `startGateApp("owner")` returns the same app instance for both requests via a variable, so the desired-state assertion reads the mutated database rather than a new fixture.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/api/src/catalog-library/start-gate.test.ts apps/api/src/catalog-library/start-gate.integration.test.ts`; expected direct desired-state writes, create defaults, and runner startup bypass the absent validator.

- [ ] **Step 3: GREEN — centralize and wire the gate.** Check exact installed release/digest, verified deployment generation/digest, active required API event-shapes, valid secret references, model/mode/workspace/wrapped wiring, assigned runner, and quarantine/failed prerequisites. Make all lifecycle callers use one function:

```ts
async function setDesiredAgentState(agentId: string, desired: "RUNNING" | "STOPPED", actor: AuthenticatedPrincipal) {
  if (desired === "RUNNING") {
    const result = await validateCatalogStart(agentId, actor);
    if (!result.ok) return result;
  }
  updateDesiredState(agentId, desired);
  return { ok: true as const };
}
```

Route create so catalog templates are stopped; route start/restart and any internal lifecycle writer through the validator; register the exact runner-only GET route in `catalog-library.ts`; add the client method to `runner/api.ts`; runner reconciliation calls it before every spawn/re-spawn and records only bounded reason codes. Do not recheck historical grant/source credential state for local consumed agents.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/api/src/catalog-library/start-gate.test.ts apps/api/src/catalog-library/start-gate.integration.test.ts apps/api/src/routes/agents.test.ts apps/api/src/app.test.ts apps/agent-runner/src/runner.test.ts`; expected every API/runner path fails closed while ordinary agents retain behavior. Update `docs/SPEC.md` lifecycle/start gate.

- [ ] **Step 5: Commit.** `git add apps/api/src/catalog-library/start-gate.ts apps/api/src/catalog-library/runner-delivery.ts apps/api/src/routes/catalog-library.ts apps/api/src/catalog-library/start-gate.test.ts apps/api/src/catalog-library/start-gate.integration.test.ts apps/api/src/routes/agents.ts apps/api/src/routes/agent-invites.ts apps/api/src/app.ts apps/agent-runner/src/runner.ts apps/agent-runner/src/runner/api.ts docs/SPEC.md && git commit -m "feat(catalogs): enforce package start prerequisites"`.

### Task 13: Explicit API event-shape approval and activation

**Files:**
- Create: `apps/api/src/catalog-library/activation.ts`, `apps/api/src/catalog-library/api-activation.test.ts`, `apps/api/src/catalog-library/api-activation.integration.test.ts`
- Modify: `apps/api/src/routes/catalog-library.ts`, `apps/api/src/app.ts`, `apps/api/src/routes/events.ts`, `packages/schemas/src/event-shapes.ts`, `docs/SPEC.md`

**Interfaces:** `ApiExecutionCoordinator.approveApiExecution(ApiExecutionApprovalCommand, HumanAdmin)`, `activateApiExecution(ApiExecutionActivationCommand, HumanAdmin)`, and `deactivateApiExecution(ApiExecutionDeactivationCommand, HumanAdmin)` are the exact commands/results; Task 14 composes this `ApiExecutionCoordinator` with `RolloutCoordinator` as `ActivationCoordinator`; they are distinct from `CatalogAuthority` review and `PackageInstallation`. Registry composition consumes only `approval_state="APPROVED"`, `runtime_state="ACTIVE"`, installed exact roots.

- [ ] **Step 1: RED — test approval separation and failure preservation.**

```ts
it("does not import event-shape code after release approval or inert installation", async () => {
  const fixture = apiActivationFixture();
  await fixture.approveRelease();
  await fixture.install();
  expect(fixture.importedModules()).toEqual([]);
  expect(fixture.activeTypes()).not.toContain("catalog-authored-event");
});
it.each(["import", "validation", "registry-swap", "active-commit"] as const)("keeps the old registry and a non-ACTIVE row after %s failure", async (failureAt) => {
  const fixture = apiActivationFixture({ failureAt });
  await fixture.approveApiExecution();
  await expect(fixture.activate()).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  expect(fixture.activeTypes()).toEqual(fixture.previousTypes());
  expect(["FAILED", "ACTIVATING"]).toContain(fixture.activationRow().runtimeState);
  expect(fixture.activationRow().runtimeState).not.toBe("ACTIVE");
});
```

`apiActivationFixture` is defined in the test file with an injected module loader and two fixed registry snapshots; it never evaluates authored code. The integration test sends each approve/activate/deactivate route as admin, ordinary human, agent, global/scoped runner, and anonymous; only admin succeeds.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/api/src/catalog-library/api-activation.test.ts apps/api/src/catalog-library/api-activation.integration.test.ts`; expected no persisted activation state or explicit registry gate.

- [ ] **Step 3: GREEN — implement the two-state activation machine.** Enforce `NOT_REQUIRED/AWAITING_APPROVAL/APPROVED/REVOKED` and `INACTIVE/ACTIVATING/ACTIVE/DEACTIVATING/FAILED`; require installed exact artifacts and administrator approval; import only on explicit activation. Compose into a candidate registry before swapping:

```ts
persistActivating(releaseId, actor);
const candidate = await composeBuiltInAndApprovedShapes(installedReleaseRoots);
await validateEventShapeRegistry(candidate);
let swap: { rollback(): void };
try {
  swap = registry.swap(candidate); // synchronous; throws without changing the current registry
} catch (error) {
  persistFailed(releaseId, "STORAGE_FAILURE", actor);
  throw catalogFailure("STORAGE_FAILURE");
}
try {
  db.transaction(() => { persistActivationState(releaseId, "ACTIVE"); writeAudit(db, activationAudit(releaseId, actor)); })();
} catch (error) {
  swap.rollback();
  tryPersistFailedOrLeaveActivating(releaseId, "STORAGE_FAILURE", actor);
  throw catalogFailure("STORAGE_FAILURE");
}
```

Import or validation failure calls `persistFailed` before returning. Registry-swap failure leaves the old registry installed and writes `FAILED`; final SQLite failure rolls the swap back and writes `FAILED`, or leaves the already persisted `ACTIVATING` row if storage is unavailable. Thus no failure path exposes `ACTIVE` with the old registry. Deactivation uses the same reversible protocol for future composition only. Add activation routes and typed audit events; retain built-in shapes.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/api/src/catalog-library/api-activation.test.ts apps/api/src/catalog-library/api-activation.integration.test.ts apps/api/src/app.test.ts apps/agent-runner/src/event-routing.test.ts`; expected dynamic validation, audit routing, and failure preservation pass. Update `docs/SPEC.md` event-shape activation contract.

- [ ] **Step 5: Commit.** `git add apps/api/src/catalog-library/api-activation.test.ts apps/api/src/catalog-library/api-activation.integration.test.ts apps/api/src/catalog-library/activation.ts apps/api/src/routes/catalog-library.ts apps/api/src/app.ts apps/api/src/routes/events.ts packages/schemas/src/event-shapes.ts docs/SPEC.md && git commit -m "feat(catalogs): gate API event shape activation"`.

### Task 14: Finite rollout plan, confirmation, cancellation, retry, and delegated targeting

**Files:**
- Modify: `apps/api/src/catalog-library/activation.ts`, `apps/api/src/catalog-library/policy.ts`, `apps/api/src/catalog-library/runner-delivery.ts`, `apps/api/src/routes/catalog-library.ts`
- Create: `apps/api/src/catalog-library/rollout.test.ts`, `apps/api/src/catalog-library/rollout.integration.test.ts`
- Modify: `docs/SPEC.md`

**Interfaces:** The shared `RolloutCoordinator` methods consume the discriminated `ActivationPlanCommand` (`ENABLE`, `DISABLE`, or `SET_PRELOAD` with required `preload:boolean`), `ConfirmActivationCommand`, `CancelRolloutCommand`, and `RetryFailedRolloutCommand` and return the exact shared plan/view/result types. Confirmation accepts only an exact echoed list and a digest that binds the full operation payload; the implemented retry contract returns target and deployment IDs for persisted `FAILED` targets only, never `SKIPPED` or other terminal targets.

- [ ] **Step 1: RED — test target freeze, partial state, cancellation, and delegation.**

```ts
it("freezes the explicit target IDs and excludes an agent created after confirmation", async () => {
  const fixture = rolloutFixture();
  const plan = await fixture.activation.plan({ releaseId: "release-skill", operation: "ENABLE", agentIds: ["agent-a", "agent-b"] }, humanActor());
  const rollout = await fixture.activation.confirm({ planDigest: plan.planDigest, agentIds: ["agent-a", "agent-b"] }, humanActor());
  await fixture.createAgent("agent-future");
  expect(fixture.targetIds(rollout.id)).toEqual(["agent-a", "agent-b"]);
});
it("reports PARTIAL and retries failed targets without replaying success", async () => {
  const fixture = rolloutFixture({ results: { "agent-a": "SUCCEEDED", "agent-b": "FAILED" } });
  const rollout = await fixture.run();
  expect(rollout.state).toBe("PARTIAL");
  expect((await fixture.activation.retryFailed({ rolloutId: rollout.id, expectedRevision: rollout.revision }, humanActor())).targetIds).toEqual(["agent-b"]);
  expect(fixture.deploymentAttempts("agent-a")).toBe(1);
});
it("cancels only unclaimed targets and preserves success", async () => {
  const fixture = rolloutFixture({ firstTargetSucceeds: true });
  const rollout = await fixture.cancelAfterFirstSuccess();
  expect(rollout.state).toBe("CANCELLED");
  expect(fixture.targetState(rollout.id, "agent-a")).toBe("SUCCEEDED");
  expect(fixture.targetState(rollout.id, "agent-b")).toBe("SKIPPED");
});
it("binds SET_PRELOAD true versus false into the digest, confirmation, and persisted rollout", async () => {
  const fixture = rolloutFixture();
  const setTrue = await fixture.activation.plan({ releaseId: "release-skill", operation: "SET_PRELOAD", preload: true, agentIds: ["agent-a"] }, humanActor());
  const setFalse = await fixture.activation.plan({ releaseId: "release-skill", operation: "SET_PRELOAD", preload: false, agentIds: ["agent-a"] }, humanActor());
  expect(setTrue.planDigest).not.toBe(setFalse.planDigest);
  expect(setTrue).toMatchObject({ operation: "SET_PRELOAD", preload: true });
  const rollout = await fixture.activation.confirm({ planDigest: setTrue.planDigest, agentIds: ["agent-a"] }, humanActor());
  expect(rollout).toMatchObject({ operation: "SET_PRELOAD", preload: true });
  expect(fixture.persistedOperation(rollout.id)).toEqual({ operation: "SET_PRELOAD", preload: 1 });
});
```

`rolloutFixture(options)` seeds two manageable assigned agents, one installed/approved/granted release, and a deterministic delivery adapter; it exposes the methods used in the snippets, including a direct `persistedOperation(rolloutId)` database projection. `rollout.integration.test.ts` exercises plan/confirm/get/cancel/retry routes as admin, granted owner, ungranted human, unmanageable human, agent, global/scoped runner, and anonymous. Add one matrix case with `adminActor()` and no grant row: an administrator may plan and confirm a rollout only for agents returned by `canManageAgent`, while an administrator targeting an unmanageable agent receives `FORBIDDEN`; a delegated human must have an effective grant and ownership for every selected target.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/api/src/catalog-library/rollout.test.ts apps/api/src/catalog-library/rollout.integration.test.ts`; expected no immutable plans or target state machine.

- [ ] **Step 3: GREEN — implement finite operations.** Enforce max 256 unique IDs and strict discriminated parsing (`preload` is required only for `SET_PRELOAD` and forbidden for `ENABLE`/`DISABLE`), recheck manageable-agent/grant authority at plan and confirm, capture runner and assignment revision, compute the plan digest from canonical `{releaseId,operation,preload?,agentIds,targets}`, persist `operation` plus nullable/required `preload` and target rows, create bound deployments only at confirmation, and implement `DRAFT -> QUEUED -> RUNNING -> SUCCEEDED|PARTIAL|FAILED|CANCELLED`. Confirmation uses the frozen digest:

```ts
function confirm(input: ConfirmActivationCommand, plan: ActivationPlan) {
  if (input.planDigest !== plan.planDigest || !sameIds(input.agentIds, plan.targets.map((target) => target.agentId))) throw conflict("REVISION_CONFLICT");
  return db.transaction(() => createRolloutAndBoundTargets(plan, input.actor));
}
```

`createRolloutAndBoundTargets` writes `preload=1|0` for `SET_PRELOAD` and null for the other operations, and assignment updates use that persisted boolean. Cancellation skips unclaimed targets without rollback; retry never recreates success; reassignment supersedes old deployments. No selector or future-agent enrollment is evaluated after confirmation.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/api/src/catalog-library/rollout.test.ts apps/api/src/catalog-library/rollout.integration.test.ts apps/api/src/catalog-library/runner-delivery.test.ts apps/api/src/routes/catalog-library.source.integration.test.ts`; expected cap, discriminated preload validation, digest/persistence binding, conflict, grant/ownership, partial, cancellation, retry, supersession, and audits pass. Update `docs/SPEC.md` rollout routes/state.

- [ ] **Step 5: Commit.** `git add apps/api/src/catalog-library/activation.ts apps/api/src/catalog-library/policy.ts apps/api/src/catalog-library/runner-delivery.ts apps/api/src/routes/catalog-library.ts apps/api/src/catalog-library/rollout.test.ts apps/api/src/catalog-library/rollout.integration.test.ts docs/SPEC.md && git commit -m "feat(catalogs): add finite rollouts"`.

### Task 15: Administrator Source Library UI and phone-width browser journeys

**Files:**
- Create: `apps/admin-ui/src/catalog-library/api.ts`, `apps/admin-ui/src/catalog-library/state.ts`, `apps/admin-ui/src/screens/SourceLibraryScreen.tsx`, `apps/admin-ui/src/catalog-library/api.test.ts`, `apps/admin-ui/src/catalog-library/state.test.ts`, `apps/admin-ui/src/screens/SourceLibraryScreen.test.tsx`, `apps/admin-ui/src/catalog-library/source-library.browser.test.ts`
- Modify: `apps/admin-ui/src/App.tsx`, `apps/admin-ui/src/components/layout/Sidebar.tsx`, `apps/admin-ui/src/components/layout/AppLayout.tsx`, `apps/admin-ui/src/screens/index.ts`, `docs/SPEC.md`

**Interfaces:** `createSourceLibraryApi(fetch)` exposes typed Source/release/grant/install/rollout methods plus separate `approveApiExecution(ApiExecutionApprovalCommand)`, `activateApiExecution(ApiExecutionActivationCommand)`, and `deactivateApiExecution(ApiExecutionDeactivationCommand)` methods. `createSourceLibraryController({ api, expectedUserId, refreshAuth, invalidateAuthority })` exposes `load`, `selectSource`, `selectRelease`, `sync`, `approve`, `install`, `grant`, `approveApiExecution`, `activateApiExecution`, `deactivateApiExecution`, `planRollout`, `confirmRollout`, `retry`, `dispose`. Each API-execution controller method also requires `ApiExecutionConfirmation = { action:"APPROVE"|"ACTIVATE"|"DEACTIVATE"; releaseId:string; digest:string; acknowledged:true }` matching the selected release and action. Mutations never auto-retry and every async result checks the principal generation.

- [ ] **Step 1: RED — define semantic and 390px browser tests for every admin journey.**

```tsx
it("renders fixed index path, independent package permission, and organization future-user copy", () => {
  const html = renderToStaticMarkup(<SourceLibraryScreen state={adminState()} actions={adminActions()} />);
  expect(html).toContain("catalog/index.json");
  expect(html).toContain("External package permission");
  expect(html).toContain("Organization grant includes current and future users");
  expect(html).not.toContain("New catalog");
});
it("renders the complete release review and API activation detail", () => {
  const html = renderToStaticMarkup(<SourceLibraryScreen state={adminState({ selectedRelease: completeReleaseView() })} actions={adminActions()} />);
  for (const text of ["API event shapes", "event-shapes.ts", "Warnings", "SKILL.md", "0644", "Review digest", "sha256:" + "b".repeat(64), "Reviewed by human-a", "API execution: Awaiting approval"]) expect(html).toContain(text);
});
it("keeps last-good data after failed sync and blocks stale writes until reload", async () => {
  const controller = adminController({ syncResult: { ok: false, code: "SYNC_FAILED" } });
  await controller.sync("source-team");
  expect(controller.snapshot().lastGoodSnapshot).toBeTruthy();
  expect(controller.snapshot().writesBlocked).toBe(true);
});
it("uses separate confirmed controller methods for API approval, activation, and deactivation", async () => {
  const digest = "sha256:" + "a".repeat(64);
  const controller = adminController({ selectedRelease: completeReleaseView({ digest }) });
  await expect(controller.activateApiExecution({ releaseId: "release-skill", expectedRevision: 1 }, { action: "APPROVE", releaseId: "release-skill", digest, acknowledged: true })).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  expect(controller.apiCalls()).toEqual([]);
  await controller.approveApiExecution({ releaseId: "release-skill", expectedRevision: 1, digest }, { action: "APPROVE", releaseId: "release-skill", digest, acknowledged: true });
  await controller.activateApiExecution({ releaseId: "release-skill", expectedRevision: 2 }, { action: "ACTIVATE", releaseId: "release-skill", digest, acknowledged: true });
  await controller.deactivateApiExecution({ releaseId: "release-skill", expectedRevision: 3 }, { action: "DEACTIVATE", releaseId: "release-skill", digest, acknowledged: true });
  expect(controller.apiCalls().map(([method]) => method)).toEqual(["approveApiExecution", "activateApiExecution", "deactivateApiExecution"]);
});
it("renders the rollout wait phase from target projection", () => {
  const html = renderToStaticMarkup(<SourceLibraryScreen state={adminState({ rolloutTargetState: "WAITING_FOR_IDLE" })} actions={adminActions()} />);
  expect(html).toContain("Waiting for agent to become idle");
});
it.each(["source", "release", "api-execution", "grant", "rollout"] as const)("fits the %s admin journey at 390px without horizontal overflow", async (screen) => {
  const result = await runAdminBrowserFixture({ screen, viewport: { width: 390, height: 844 } });
  expect(result.overflowX).toBe(false);
  expect(result.keyboardFocusableControls).toBeGreaterThan(0);
  expect(result.ariaBusyTransitions).toContain(true);
  if (screen === "api-execution") expect(result.confirmedActions).toEqual(["APPROVE", "ACTIVATE", "DEACTIVATE"]);
});
```

`adminState`, `completeReleaseView`, `adminActions`, `adminController`, and `runAdminBrowserFixture` are defined in the listed test files; the complete release fixture supplies bounded execution/warning/file/review/API state fields. The browser fixture serves static release/source values containing `<script>` and asserts they render as text, opens a separate digest-bearing confirmation for each API execution action before invoking its matching method, and resolves its mutation promise only after credential inputs have been cleared.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/admin-ui/src/catalog-library/api.test.ts apps/admin-ui/src/catalog-library/state.test.ts apps/admin-ui/src/screens/SourceLibraryScreen.test.tsx apps/admin-ui/src/catalog-library/source-library.browser.test.ts`; expected old Catalog navigation and absent journeys fail.

- [ ] **Step 3: GREEN — implement the admin adapter.** Use the existing admin configuration auth/supersession pattern; render Source editor (fixed read-only index, masked credential, immediate sync status/last-good snapshot, remove/restore warning), complete release detail (manifest, execution preview, warnings, file modes, review digest/reviewer, and API activation state), release review/install, grant revision/revocation, and finite rollout status including `WAITING_FOR_IDLE`. Implement independent API approval/activation/deactivation client and controller methods; each action gets its own confirmation naming the immutable release/digest and is unavailable unless its state-machine precondition holds. The controller's mutation guard has this shape:

```ts
async function runMutation<T>(generation: number, operation: () => Promise<T>) {
  state.credentialDraft = { username: "", password: "" };
  const value = await operation();
  if (generation !== state.principalGeneration) return { ok: false, code: "FORBIDDEN" as const };
  return value;
}
```

Escape untrusted strings; clear credential fields before awaits; use labels, focus restoration, `aria-busy`, status/alert regions, explicit conflict reload, and no mutation retries. Replace Catalog navigation only after Source Library registration and preserve live-admin/password-change gating.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/admin-ui/src/catalog-library apps/admin-ui/src/screens/SourceLibraryScreen.test.tsx apps/admin-ui/src/App.test.tsx apps/admin-ui/src/components/layout/Sidebar.test.tsx` and `npx vitest run apps/admin-ui/src/catalog-library/source-library.browser.test.ts`; expected all five phone-width journeys, complete release detail, three separately confirmed API execution actions, waiting status, auth demotion, last-good failure, credential clearing, and safe rendering pass. Update `docs/SPEC.md` admin/mobile UI contract.

- [ ] **Step 5: Commit.** `git add apps/admin-ui/src/catalog-library apps/admin-ui/src/screens/SourceLibraryScreen.tsx apps/admin-ui/src/App.tsx apps/admin-ui/src/components/layout/Sidebar.tsx apps/admin-ui/src/components/layout/AppLayout.tsx apps/admin-ui/src/screens/index.ts docs/SPEC.md && git commit -m "feat(admin-ui): add source library administration"`.

### Task 16: User Library, template wizard, skill assignment UI, and phone-width journeys

**Files:**
- Create: `apps/user-ui/src/library/api.ts`, `apps/user-ui/src/library/state.ts`, `apps/user-ui/src/LibraryScreen.tsx`, `apps/user-ui/src/library/api.test.ts`, `apps/user-ui/src/library/state.test.ts`, `apps/user-ui/src/LibraryScreen.test.tsx`, `apps/user-ui/src/library/library.browser.test.ts`
- Modify: `apps/user-ui/src/App.tsx`, `apps/user-ui/src/types.ts`, `apps/user-ui/src/styles.css`, `docs/SPEC.md`

**Interfaces:** User client methods are `listLibrary()`, `getLibraryPackage(id)`, `instantiateTemplate(id,binding)`, `assignSkill(agentName,releaseId,input)`, `planRollout(input: ActivationPlanCommand)`, `confirmRollout(input: ConfirmActivationCommand)`, `getRollout(id)`, `cancelRollout(input: CancelRolloutCommand)`, and `retryFailedRollout(input: RetryFailedRolloutCommand)`; none accepts a human ID. `ActivationPlanCommand` is the shared discriminated command, so `SET_PRELOAD` always carries `preload:boolean`. State methods are `load`, `instantiate`, `assign`, `planRollout`, `confirmRollout`, `refreshRollout`, `cancelRollout`, `retryFailedRollout`, and `dispose`, and every async result is bound to the current principal generation.

- [ ] **Step 1: RED — test filtering, stopped-only flow, revocation, explicit assignment authorization, delegated rollout, and 390px library/template/assignment/rollout journeys.**

```tsx
it("shows only approved installed granted releases and hides credentials and URLs", () => {
  const html = renderToStaticMarkup(<LibraryScreen state={libraryState()} actions={libraryActions()} />);
  expect(html).toContain("Create stopped agent");
  expect(html).not.toContain("hidden-unapproved");
  expect(html).not.toContain("https://github.com");
});
it("never offers a start control in the template wizard", () => {
  const html = renderToStaticMarkup(<LibraryScreen state={templateWizardState()} actions={libraryActions()} />);
  expect(html).toContain("Stopped");
  expect(html).not.toContain("Start agent now");
});
it("assigns for a granted manageable user and denies ungranted or unmanageable users", async () => {
  const input = { expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: true };
  const allowed = userController({ hasGrant: true, manageableAgents: ["agent-a"] });
  await expect(allowed.assign("agent-a", "release-skill", input)).resolves.toMatchObject({ desiredState: "ENABLED" });
  expect(allowed.apiCalls()).toContainEqual(["assign", "agent-a", "release-skill", input]);
  await expect(userController({ hasGrant: false, manageableAgents: ["agent-a"] }).assign("agent-a", "release-skill", input)).rejects.toMatchObject({ code: "GRANT_REQUIRED" });
  await expect(userController({ hasGrant: true, manageableAgents: [] }).assign("agent-hidden", "release-skill", input)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it.each(["library", "template", "assignment", "rollout"] as const)("renders %s controls at 390px without horizontal overflow", async (screen) => {
  const result = await runUserBrowserFixture({ screen, viewport: { width: 390, height: 844 } });
  expect(result.overflowX).toBe(false);
  expect(result.focusableControls).toBeGreaterThan(0);
  if (screen === "assignment") expect(result.assignmentOutcomes).toEqual({ grantedManageable: "SUCCEEDED", ungranted: "GRANT_REQUIRED", unmanageable: "FORBIDDEN" });
  if (screen === "rollout") expect(result.visibleStatuses).toContain("Waiting for agent to become idle");
});
it("binds the displayed SET_PRELOAD value into confirmation", async () => {
  const controller = userController({ manageableAgents: ["agent-a"] });
  const plan = await controller.planRollout({ releaseId: "release-skill", operation: "SET_PRELOAD", preload: false, agentIds: ["agent-a"] });
  expect(controller.snapshot().rolloutConfirmation).toEqual({ operation: "SET_PRELOAD", preload: false, planDigest: plan.planDigest, agentIds: ["agent-a"] });
  await controller.confirmRollout({ planDigest: plan.planDigest, agentIds: ["agent-a"] });
  expect(controller.apiCalls()).toContainEqual(["confirm", { planDigest: plan.planDigest, agentIds: ["agent-a"] }]);
});
it("lets a granted human confirm exact manageable targets, observe partial, and retry only failures", async () => {
  const controller = userController({ manageableAgents: ["agent-a", "agent-b"], results: { "agent-a": "SUCCEEDED", "agent-b": "FAILED" } });
  const plan = await controller.planRollout({ releaseId: "release-skill", operation: "ENABLE", agentIds: ["agent-a", "agent-b"] });
  await controller.confirmRollout({ planDigest: plan.planDigest, agentIds: ["agent-a", "agent-b"] });
  await controller.refreshRollout();
  expect(controller.snapshot().rollout?.state).toBe("PARTIAL");
  await controller.retryFailedRollout();
  expect(controller.apiCalls()).toContainEqual(["retry", ["agent-b"]]);
  await expect(controller.planRollout({ releaseId: "release-skill", operation: "ENABLE", agentIds: ["agent-hidden"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
});
```

`libraryState`, `templateWizardState`, `libraryActions`, `userController`, and `runUserBrowserFixture` are defined in the listed test files. `userController` accepts deterministic `hasGrant` and `manageableAgents` policy fixtures and routes `assign` through the real typed client adapter. The browser fixture uses HTTP responses containing an untrusted description and a revoked grant, drives granted-manageable assignment plus ungranted/unmanageable denials, asserts an existing local-agent origin remains visible while a second instantiate is rejected, and drives rollout select -> blocker review -> exact operation/preload/digest/list confirmation -> stage/wait/active status -> cancel/retry. At 390px it asserts stacked targets, labeled controls, focus restoration, `aria-busy`, wait/partial/failure alerts, and no horizontal overflow.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/user-ui/src/library/api.test.ts apps/user-ui/src/library/state.test.ts apps/user-ui/src/LibraryScreen.test.tsx apps/user-ui/src/library/library.browser.test.ts`; expected absent client/navigation/wizard behavior.

- [ ] **Step 3: GREEN — implement the user adapter.** Add Library navigation and responsive stacked cards; show only the API projection, distinct no-grant/not-installed/incompatible states, stopped template wizard with local runner/workspace/model/secret-reference bindings, missing requirement checklist, and manageable-agent skill assignment that surfaces `GRANT_REQUIRED` and `FORBIDDEN` without optimistic success. Implement the complete delegated rollout controller/UI. Rollout selection uses explicit checkboxes from manageable agents, renders per-target blockers, displays the exact discriminated operation (including `preload: true|false`) with the returned digest and IDs before confirmation, projects `WAITING_FOR_IDLE` as a distinct status, polls status only on an explicit/user-visible refresh loop, cancels with `expectedRevision`, and enables retry only for returned failed/skipped targets. The client surface is server-subject-bound:

```ts
function instantiateTemplate(packageReleaseId: string, binding: LocalTemplateBinding) {
  return fetch(`/api/library/templates/${encodeURIComponent(packageReleaseId)}/instances`, { method: "POST", body: JSON.stringify(binding) });
}
```

Escape remote text, expose real labels/status/alerts, clear stale responses on principal change, and show organization grant future-user copy only as read-only explanatory text.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/user-ui/src/library apps/user-ui/src/LibraryScreen.test.tsx apps/admin-ui/src/catalog-library/source-library.browser.test.ts` and `npx vitest run apps/user-ui/src/library/library.browser.test.ts`; expected granted-manageable assignment success, ungranted/unmanageable denial, regular-human auth, revocation, stopped creation, missing requirements, exact operation/preload rollout confirmation, stage/wait/active projection, partial/cancel/retry behavior, focus/status recovery, and all four phone layouts pass.

- [ ] **Step 5: Commit.** `git add apps/user-ui/src/library apps/user-ui/src/LibraryScreen.tsx apps/user-ui/src/App.tsx apps/user-ui/src/types.ts apps/user-ui/src/styles.css docs/SPEC.md && git commit -m "feat(user-ui): add granted package library"`.

### Task 17: Exact legacy-origin reconciliation and Catalog retirement cleanup

**Files:**
- Create: `apps/api/src/catalog-library/reconciliation.ts`, `apps/api/src/catalog-library/reconciliation.test.ts`, `apps/api/src/catalog-library/compatibility.integration.test.ts`
- Delete after the compatibility release: `apps/api/src/routes/catalogs.ts`, `apps/api/src/catalog-configuration.ts`, `apps/api/src/catalog-configuration.test.ts`, `apps/api/src/catalog-sync/sync.ts`, `apps/api/src/catalog-sync/browse.test.ts`, `apps/api/src/catalog-sync/import-preview.test.ts`, `apps/api/src/catalog-sync/install.test.ts`, `apps/api/src/catalog-installed.ts`, `apps/api/src/catalog-installed.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/catalogs.integration.test.ts`, `apps/api/src/catalogs.sync.integration.test.ts`, `apps/api/src/catalogs.packages.integration.test.ts`, `apps/api/src/catalogs.install.integration.test.ts`, `apps/api/src/catalogs.import-preview.integration.test.ts`, `docs/SPEC.md`, `docs/catalog-package-contract.md`

**Interfaces:** `reconcileLegacyOrigin(originId: string, actor: HumanAdmin): Promise<{ status:"RECONCILED" } | { status:"REJECTED"; code:"IDENTITY_CONFLICT" }>` remeasures exact bytes and matches Source/release commit/path/name/version/digest; it never invents review, grant, or approval. The old route shim returns 410 for every Catalog descendant through one compatibility release, then its registration and unused mutable modules are deleted.

- [ ] **Step 1: RED — test exact reconciliation, retention, and the post-window 404 contract.**

```ts
it("reconciles only an unchanged migration-033 origin with exact release identity", async () => {
  const fixture = reconciliationFixture();
  expect(await fixture.reconcileLegacyOrigin("legacy-origin", adminActor())).toEqual({ status: "RECONCILED" });
  fixture.mutateInstalledByte();
  expect(await fixture.reconcileLegacyOrigin("legacy-origin", adminActor())).toEqual({ status: "REJECTED", code: "IDENTITY_CONFLICT" });
});
it("keeps snapshots, installations, assignments, agents, and grants after Source removal", async () => {
  const fixture = reconciliationFixture({ consumed: true });
  await fixture.removeSource("source-team");
  expect(fixture.retainedRows()).toEqual({ snapshots: 1, installations: 1, assignments: 1, agents: 1, grants: 1 });
});
it.each(["/api/catalogs", "/api/catalogs/legacy", "/api/catalogs/legacy/sync"])("returns 404 for retired route %s after the compatibility window", async (path) => {
  expect((await compatibilityApp().request(path)).status).toBe(404);
});
```

`reconciliationFixture` seeds migration-033 origin bytes and a matching canonical release, then exposes `mutateInstalledByte`, `removeSource`, and `retainedRows`. Task 1's five Catalog route integration files are changed in this task from compatibility-window 410 expectations to 404. Before GREEN, that updated test and the new compatibility test fail because `registerRetiredCatalogRoutes` still registers the 410 shim.

- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/api/src/catalog-library/reconciliation.test.ts apps/api/src/catalog-library/compatibility.integration.test.ts`; expected missing reconciliation and post-window 404 assertions receiving the still-installed 410 shim.

- [ ] **Step 3: GREEN — implement only exact reconciliation and cleanup.** Call `readLocalSkillEvidence` and fresh digest measurement; require exact authority/content Source, commit, path, name, version, and digest before writing canonical provenance. Use this fail-closed comparison:

```ts
const evidence = await readLocalSkillEvidence(origin.installRoot);
if (!sameIdentity(evidence, release) || evidence.digest !== release.digest) return { status: "REJECTED", code: "IDENTITY_CONFLICT" };
db.transaction(() => persistCanonicalOrigin(origin, release, actor));
return { status: "RECONCILED" };
```

Preserve archives through two-instance acceptance. Remove `registerRetiredCatalogRoutes` registration from `app.ts`, delete the shim and listed unused lifecycle modules/tests after `git grep` confirms no imports, and make every updated route test require framework-default 404. The 410 behavior remains proven historically by Task 1 and documented as the completed compatibility window; it is not asserted by the post-window suite. Update only adapter terminology in the package contract.

- [ ] **Step 4: Verify GREEN.** Run `npx vitest run apps/api/src/catalog-library/reconciliation.test.ts apps/api/src/catalog-library/compatibility.integration.test.ts apps/api/src/catalogs.integration.test.ts apps/api/src/catalogs.sync.integration.test.ts apps/api/src/catalogs.packages.integration.test.ts apps/api/src/catalogs.install.integration.test.ts apps/api/src/catalogs.import-preview.integration.test.ts packages/skills/src/catalogs/import.test.ts`; expected 404 retirement cleanup, exact reconciliation, retention, and format-v1 compatibility pass. Update `docs/SPEC.md` migration/reconciliation boundary.

- [ ] **Step 5: Commit.** `git add -A apps/api/src/catalog-library/reconciliation.ts apps/api/src/catalog-library/reconciliation.test.ts apps/api/src/catalog-library/compatibility.integration.test.ts apps/api/src/routes/catalogs.ts apps/api/src/catalog-configuration.ts apps/api/src/catalog-configuration.test.ts apps/api/src/catalog-sync/sync.ts apps/api/src/catalog-sync/browse.test.ts apps/api/src/catalog-sync/import-preview.test.ts apps/api/src/catalog-sync/install.test.ts apps/api/src/catalog-installed.ts apps/api/src/catalog-installed.test.ts apps/api/src/app.ts apps/api/src/catalogs.integration.test.ts apps/api/src/catalogs.sync.integration.test.ts apps/api/src/catalogs.packages.integration.test.ts apps/api/src/catalogs.install.integration.test.ts apps/api/src/catalogs.import-preview.integration.test.ts docs/SPEC.md docs/catalog-package-contract.md && git commit -m "feat(catalogs): reconcile legacy origins and retire catalogs"`.

### Task 18: Security matrix, two-instance acceptance, and final contract verification

**Files:**
- Create: `scenarios/catalog-source-library/fixtures.ts`, `scenarios/catalog-source-library/catalog-source-library.test.ts`, `apps/api/src/catalog-library/security.integration.test.ts`, `apps/agent-runner/src/catalog-library.e2e.test.ts`
- Modify: `package.json`, `docs/SPEC.md`

**Interfaces:** The scenario creates two isolated app databases/data roots and deterministic public/private Git fixtures, with releases `skill`, `native-classic`, `native-rlm`, and `wrapped`; it uses separate Source-scoped credential refs and no live credentials. It exposes `preparePublishedReleases`, `syncReviewInstallGrant`, `instantiateStopped`, `bindRequiredSecret`, `activateDeployment`, and `start`.

- [ ] **Step 1: RED — write the complete journey and leakage assertions.**

```ts
it("requires review/install/grant for the exact native RLM release before instantiation and reaches start after bindings", async () => {
  const fixture = twoInstanceFixture();
  const published = fixture.preparePublishedReleases(["skill", "native-classic", "native-rlm", "wrapped"]);
  await fixture.syncReviewInstallGrant(published.skill, "organization");
  await fixture.syncReviewInstallGrant(published.nativeRlm, "organization");
  const agent = await fixture.instantiateStopped(published.nativeRlm, localBindings());
  expect(await fixture.start(agent.name)).toMatchObject({ ok: false, code: "REQUIREMENTS_UNSATISFIED" });
  await fixture.bindRequiredSecret(agent, "API_KEY", "secret-1");
  await fixture.activateDeployment(agent);
  expect(await fixture.start(agent.name)).toEqual({ ok: true });
});
it("fails closed for source removal, failed sync, changed identity, tampered artifacts, and every unauthorized principal", async () => {
  const fixture = twoInstanceFixture();
  await fixture.runNegativeMatrix();
  expect(fixture.leakedStrings()).toEqual([]);
  expect(fixture.auditAgentReceiptCount()).toBe(0);
});
```

`localBindings()` returns `{ runnerId:"runner-a", workspacePath:"/owned/workspace/agent-a", modelId:"model-test", secretBindings:[] }`; `twoInstanceFixture()` creates public and private source instances with distinct credential refs. `runNegativeMatrix` is the final aggregate matrix: it enumerates admin, granted manageable human, ungranted human, unmanageable human, agent identity, global/scoped runners, and anonymous callers across Source, release review/install/grant/API activation, library, template, assignment, rollout plan/confirm/get/cancel/retry, deployment poll/claim/artifact/report, and runner start-requirements routes. It asserts the owning-task statuses rather than introducing new policy.

- [ ] **Step 2: Verify RED.** Run `npx vitest run scenarios/catalog-source-library/catalog-source-library.test.ts apps/api/src/catalog-library/security.integration.test.ts apps/agent-runner/src/catalog-library.e2e.test.ts`; expected the harness and full lifecycle assertions fail before implementation.

- [ ] **Step 3: GREEN — implement deterministic acceptance fixtures only.** Use test-only Git/artifact transports and isolated temporary roots. Exercise public/private sync, exact review/install/grant for `skill`, `native-classic`, `native-rlm`, and `wrapped` (including the native RLM dependency closure), native CLASSIC/RLM and WRAPPED stopped templates, missing-secret start gate, finite rollout, runner reassignment/restart, local edits, Source removal, failed sync preservation, tampered artifacts, complete unauthorized matrix, typed audit/no-receipt behavior, and redaction of credentials, URLs, paths, bytes, commands, and exceptions. The fixture's orchestration is:

```ts
for (const release of published) await fixture.syncReviewInstallGrant(release, "organization");
const agent = await fixture.instantiateStopped(published.nativeRlm, localBindings());
await fixture.bindRequiredSecret(agent, "API_KEY", "secret-1");
await fixture.activateDeployment(agent);
expect(await fixture.start(agent.name)).toEqual({ ok: true });
```

Do not add live credentials or production bypasses. Add the root package script exactly as `"scenario:test:catalog-source-library": "vitest run scenarios/catalog-source-library/catalog-source-library.test.ts"`; this makes the release-gate command below executable without an already-running service.

- [ ] **Step 4: Verify GREEN and release gate.** Run each command:

```bash
npm test
npm run lint
npm run build
npm run --workspace @orgops/opscli test
npx vitest run apps/api/src/catalog-library apps/api/src/routes/catalog-library.source.integration.test.ts apps/api/src/catalog-library/security.integration.test.ts apps/agent-runner/src/catalog-library.e2e.test.ts apps/admin-ui/src/catalog-library apps/user-ui/src/library scenarios/catalog-source-library
npm run scenario:test:catalog-source-library
```

Expected all relevant tests pass, fresh/upgraded migration applies cleanly, no generated file changes, phone-width browser fixtures pass, and only documented baseline diagnostics remain if the repository already has them. Update `docs/SPEC.md` with final implemented routes/events/schema/runtime facts.

- [ ] **Step 5: Commit acceptance evidence.** `git add package.json scenarios/catalog-source-library apps/api/src/catalog-library/security.integration.test.ts apps/agent-runner/src/catalog-library.e2e.test.ts docs/SPEC.md && git commit -m "test(catalogs): verify source library end to end"`.

## Acceptance and verification matrix

| Requirement | Evidence | Owning tasks |
|---|---|---|
| Migration archives 032, backfills joined Catalogs, preserves 033 origins, and boots the app | Fresh/upgraded migration fixture and existing Catalog integration retirement tests | 1, 17 |
| Source identity/ref/index and last-known-good sync are immutable | Authority tests plus canonical sync/attempt/snapshot HTTP tests | 2–3 |
| Admin-only source/review/install/grant/API activation and delegated human library/consumption are enforced at HTTP | Five-principal matrix per route family | 3, 4, 6–8, 18 |
| Release approval, inert all-kind install, exact reuse, no-overwrite, provenance, and separate activation hold | Installation and API activation tests with import/wrapper spies | 4–5, 13 |
| Runner poll/claim/artifact/report traverses STAGED and WAITING_FOR_IDLE before ACTIVE and is bound to runner/agent | Ordered runner API integration, rollout projection, and tamper tests | 10–11 |
| Start/restart/create/runner reconciliation all use one package-aware validator | API and runner entry-point tests with each missing prerequisite | 12 |
| Multi-channel generations never mix and old roots remain last known good | Two-channel lease test | 11 |
| Rollouts freeze explicit IDs, bind `SET_PRELOAD` true/false into digest/confirmation/persistence, expose partial/cancelled state, and retry failures only | Plan/confirm/retry tests | 14, 16 |
| Complete release/API activation and granted-manageable assignment journeys work at phone width, with ungranted/unmanageable denials | Five admin 390px fixtures plus user library/template/assignment/rollout 390px fixtures | 15–16 |
| Format-v1, local/built-in skills, audits, redaction, two-instance, opscli, and full checks remain green | Final security/scenario/full command set | 1, 13, 17–18 |

## Final self-review and handoff

Before implementation begins, the executor must compare every design section with the owning task above, scan this plan for unresolved markers and placeholder implementation prose, and reject any step that lacks an executable fixture or concrete command. Confirm every later interface name exactly matches the shared contract, especially the separated `CatalogAuthority` and `CatalogConsumption`, all `ActivationCoordinator` methods/results, `RunnerStartGateDelivery.getStartRequirements`, `RunnerCatalogClient`, agent-bound `StagedGeneration`, `AgentRuntimeGeneration.captureForTurn`, and `CatalogStartGate`. Compare every task's **Files** list with its `git add` list, allowing only unchanged reused files to be absent. Build in numeric order and confirm no task modifies a file before the task that creates it. Confirm each task's RED command runs before its GREEN step, route tests live first in their owning task before Task 18's aggregate matrix, and each changed contract has a same-task `docs/SPEC.md` update.

The implementation executor must finish with `git status --short`, verify `docs/research/pi-developer-powerups.md` is unchanged and unstaged, and retain the final scenario output. Live GitHub publication remains outside this plan and requires a separate approved design.
