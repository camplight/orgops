# Source-backed package library design

**Status:** authoritative implementation design, approved direction consolidated from the architecture synthesis on 2026-09-14.

**Related contracts:** `docs/catalog-package-contract.md` remains the package-format and offline-inspection contract. This design changes the live source, release, installation, grant, library, activation, and runner lifecycle around that contract; it does not replace the format-v1 manifest/index schemas.

## 1. What this supersedes

This document supersedes the lifecycle and consumption portions of `docs/superpowers/specs/2026-09-09-skill-agent-catalogs-design.md`. Specifically, it replaces:

- the separate `catalog_sources` plus `catalogs` resource model in sections 3 and 4 with one canonical **Source** resource containing repository identity, selected ref, display name, policy, and the fixed `catalog/index.json` path;
- the old mutable Catalog ref/display-name lifecycle and all routes that expose it;
- the prior administrator-only consumption rule in sections 2, 7, 8, and 10 with administrator-controlled grants and a regular-human user library;
- the prior single installation/activation boundary with immutable source snapshots, persisted release review, content-addressed inert installation, explicit API event-shape activation, normalized skill assignments, and finite rollouts;
- the old Phase-13 skill-only installation model and its `catalog_installed_origins` authority assumptions with the all-kind inert installation model and canonical release/installation tables;
- the earlier suggestion that a rollout could become a persistent managed policy with a finite target-set operation only;
- the earlier assumption that grants would need no delegated consumption, while retaining the rule that source management, acquisition, approval, installation, publication, and API-code activation remain administrator-only.

The following portions remain binding and are carried forward unless explicitly changed below: format-v1 package/index compatibility; GitHub-only in-app read transport and the approved credential/redirect restrictions; positive export allowlists; no package execution during discovery, inspection, staging, or installation; no automatic updates, side-by-side skill-name conflicts, source registration, autonomous publication, or general RBAC; separate read and publication credentials; imported agents as independent local copies; existing authentication and runner assignment semantics; and the requirement to update `docs/SPEC.md` for every implemented API, event, schema, or runtime change. Live GitHub publishing remains a later design, not part of this implementation plan.

## 2. Goal and scope

OrgOps will provide a source-backed package library. An administrator configures an immutable Source binding, synchronizes its fixed catalog index, reviews exact immutable releases, installs inert artifacts, and grants approved installed releases to selected humans or the organization. A granted human can view a filtered library, create a stopped native/wrapped template instance, assign an installed skill to manageable agents, or launch a finite rollout over explicitly selected manageable agents.

The system keeps source authority, release identity, review approval, installation, grant entitlement, local agent ownership, API-code activation, and runner deployment as separate capabilities. A source or grant never becomes execution authority. A local agent and activated assignment survive source removal or grant revocation; revocation prevents only new consumption.

Out of scope: a hosted marketplace, instance federation, automatic upstream updates, managed future-agent policies, side-by-side conflicting skill versions, GitHub publication, automatic forks, multi-repository PR transactions, package sandboxing, and general RBAC.

## 3. Binding global constraints

These constraints apply to every implementation task and are intentionally copied into the implementation plan.

- The API is the sole SQLite owner. Route modules receive dependencies from `app.ts`.
- Catalog/source authority is available only to a currently authorized human administrator. Human sessions, usernames, agents, and runner credentials do not confer it.
- Configuration mutations use strict bounded JSON, reject unknown fields, and use optimistic revisions.
- Source identifiers and repository identities remain reserved after removal. Restoration preserves identity, restores disabled, and does not restore credentials or package permission.
- Repository read credentials remain source-scoped, encrypted, API-private, metadata-only on reads, and separate from agent-visible secrets and publication credentials.
- Catalog authority never implies permission to fetch external package locations. External locations and cross-source dependencies require independent, explicit `allowPackages`.
- Git synchronization must preserve the last known good state after any failed fetch, validation, identity, or promotion attempt.
- Package identity and installed provenance are immutable. An existing `(authority namespace, name, version)` may not silently map to changed content.
- Package discovery, inspection, and staging do not execute package code.
- Installation is not activation. Standalone skill installation does not alter existing agents.
- API event-shape modules and wrapped commands are distinct execution hazards: event-shape activation may execute code in the API process; wrapped setup/runtime executes only on an assigned runner after explicit start.
- Imported agents are independent local copies, created stopped, with positive selection of portable fields. They are not synchronized replicas of an upstream agent.
- Missing required bindings block start. Secret values never enter manifests, provenance, previews, audits, or runner deployment metadata.
- Native skill selection affects prompt composition, dynamic event shapes, and filesystem roots. A turn must not observe a partially changed skill tree.
- The runtime remains assigned-host based; there is no scheduler.
- Audit events are channel-less `audit.*` bookkeeping events and must not wake agents.
- V1 does not include automatic upstream updates, side-by-side conflicting skill versions, automatic dependency source registration, autonomous publication, or general RBAC.
- Package format v1 is already implemented and externally consumable. Compatibility should be narrow rather than maintaining two live domain models.

## 4. Canonical vocabulary and immutable identities

**Source** is the complete configured catalog authority: immutable `sourceId`, immutable canonical repository identity, immutable selected Git ref, fixed index path `catalog/index.json`, display name, enabled state, independent external-package permission, optional source-scoped read credential, revision, and tombstone lifecycle. Changing repository or ref creates a new Source; it never mutates an authority namespace.

**Catalog index** is the format-v1 document at `catalog/index.json` in a Source snapshot. It asserts releases but grants no credentials, registration, approval, installation, or execution authority. “Catalog” remains in format names such as `CatalogIndex` and compatibility code only.

**Source snapshot** is an immutable successful observation `(sourceId, sourceCommit, indexDigest, exact index bytes, observed ref)`. A failed sync records an attempt and never replaces the current snapshot.

**Package release** is an immutable recognized release:

```text
packageReleaseId
authoritySourceId
kind / name / version / digest
contentSourceId / packageCommit / path
canonical manifest, execution preview, warnings
```

`authoritySourceId` is the Source whose index asserts the entry. `contentSourceId` is the Source containing bytes; they differ only for permitted external locations. The unique identity is `(authoritySourceId, name, version)`, and any later changed immutable field is an `IDENTITY_CONFLICT` for the complete sync.

**Release review** is separate from source trust and API execution approval: `PENDING -> APPROVED|REJECTED`, `APPROVED -> WITHDRAWN`, and `REJECTED|WITHDRAWN -> PENDING`. Every approval echoes the exact release digest and review digest.

**Grant** permits one human or the organization (including current and future authenticated humans) to consume one approved Package release. It cannot fetch, install, publish, activate API modules, or operate another user’s agents.

**Installation** is an immutable verified inert copy in the API-owned content-addressed artifact store. It does not change an agent, register event types, run setup, or execute content.

**API execution approval** is an explicit administrator decision to load a release’s `api-event-shapes` modules. Release approval is insufficient.

**Skill assignment** is a normalized relationship from one agent to one exact installed skill release, with desired enabled/preloaded state and local authorization provenance. V1 permits one release per local skill name and rejects conflicts.

**Template instance** is a stopped local agent created from one exact installed native or wrapped template release and local bindings. It is independent and retains immutable origin metadata.

**Rollout** is a finite operation over an immutable explicitly captured target list. It never enrolls future agents and never becomes a managed update policy.

**User library** is a query projection of approved, installed, effectively granted releases. It is not a new authority table and never exposes source credentials, hidden releases, or raw package bytes.

## 5. Deep modules and interfaces

The implementation must preserve small external seams and keep route/UI adapters thin. The following interfaces are binding; private helpers may differ.

### CatalogAuthority

`apps/api/src/catalog-library/authority.ts` owns Source lifecycle, strict revisions, credentials, policy, sync attempts, snapshots/releases, review, grants, and redacted audit coupling.

```ts
type CatalogAuthority = {
  execute(command: CatalogAuthorityCommand, actor: HumanAdmin): Promise<CatalogAuthorityResult>;
  query(query: CatalogAuthorityQuery, actor: AuthenticatedHuman): Promise<CatalogAuthorityQueryResult>;
};
```

`CatalogAuthorityCommand` contains only administrator controls: Source/credential lifecycle, sync, release review, and grant changes. HTTP handlers validate/translate only and never duplicate policy SQL.

### CatalogConsumption

`apps/api/src/catalog-library/consumption.ts` owns delegated mutations. Its actor is discriminated and its policy check is command-specific: an administrator may consume only for an agent they can manage, while a regular human additionally needs an effective current grant.

```ts
type ConsumptionActor =
  | { kind: "HUMAN_ADMIN"; id: string }
  | { kind: "AUTHENTICATED_HUMAN"; id: string };
type CatalogConsumption = {
  assignSkill(command: AssignmentCommand, actor: ConsumptionActor): Promise<AssignmentMutationResult>;
};
```

Neither a human session nor an administrator flag is inferred from a username. The API constructs these actors only after live authentication, and `CatalogConsumption` never accepts runner or agent principals.

### SecretBindingMutation

`apps/api/src/catalog-library/secret-binding.ts` owns the one-agent requirement binding mutation. The route is `PUT /api/library/agents/:agentId/requirements/:requirementName/secret-binding` and accepts only `{expectedAgentRevision,secretId}`. The implementation derives the agent and release from the immutable template origin, then in one immediate transaction strictly validates the origin/release/manifest identity, uppercase requirement membership, current secret reference authorization/decryptability, stopped state, owner or fresh administrator actor, and exact agent revision. A caller cannot choose an alternate release or requirement metadata. It returns only `{agentId,requirementName,revision,state:"SATISFIED"}`; no secret reference or value is returned or persisted outside the binding reference. Each accepted mutation writes exactly one channel-less `audit.catalog.secret_binding.changed` event in the same transaction and creates no event receipt. Malformed or corrupt evidence, wrong revision, non-owner, runner, agent, and non-stopped callers fail with fixed privacy-safe errors.

### PackageInstallation

`apps/api/src/catalog-library/installation.ts` composes the existing `inspectGitPackage`, `readLocalSkillEvidence`, `prepareImport`, and resolver contracts. It owns exact closure verification, content-addressed staging, no-overwrite promotion, origin persistence, and recovery.

```ts
type PackageInstallation = {
  installExact(command: InstallExactCommand, actor: HumanAdmin): Promise<InstallResult>;
  inspectAvailability(packageReleaseId: string): Availability;
};
```

All package kinds are inertly installable. Native and wrapped agent artifacts are stored and reviewed but do not create agents until template instantiation. Installation never imports event modules or executes wrapped commands.

### CatalogPolicy

`apps/api/src/catalog-library/policy.ts` is the centralized authorization seam. It distinguishes source authority, external-package permission, release approval, installation, grants, agent ownership, and runner assignment.

```ts
type CatalogPolicy = {
  decide(input: PolicyDecisionInput): PolicyDecision;
};
```

Actions: `SOURCE_MANAGE`, `RELEASE_REVIEW`, `RELEASE_INSTALL`, `GRANT_MANAGE`, `API_EXECUTION_APPROVE`, `LIBRARY_VIEW`, `TEMPLATE_INSTANTIATE`, `SKILL_ASSIGN`, `ROLLOUT_CREATE`, and `RUNNER_DEPLOY`.

### ActivationCoordinator

`apps/api/src/catalog-library/activation.ts` owns preflight, finite target capture, rollout/target/deployment state, retry, cancellation, supersession, and package-aware start requirements. It never fetches repositories.

```ts
type ActivationCoordinator = {
  plan(command: ActivationPlanCommand, actor: ConsumptionActor): Promise<ActivationPlan>;
  confirm(command: ConfirmActivationCommand, actor: ConsumptionActor): Promise<RolloutView>;
  getRollout(id: string, actor: ConsumptionActor): Promise<RolloutView>;
  cancel(command: CancelRolloutCommand, actor: ConsumptionActor): Promise<CancelRolloutResult>;
  retryFailed(command: RetryFailedRolloutCommand, actor: ConsumptionActor): Promise<RetryFailedRolloutResult>;
  approveApiExecution(command: ApiExecutionApprovalCommand, actor: HumanAdmin): Promise<ApiActivationResult>;
  activateApiExecution(command: ApiExecutionActivationCommand, actor: HumanAdmin): Promise<ApiActivationResult>;
  deactivateApiExecution(command: ApiExecutionDeactivationCommand, actor: HumanAdmin): Promise<ApiActivationResult>;
};
```

The rollout methods accept only human actors. Administrator status bypasses the grant requirement, not `canManageAgent`; ordinary humans require both a grant and management authority for every target. The three API-execution methods accept only a freshly checked `HumanAdmin`.

### RunnerArtifactDelivery

`apps/api/src/catalog-library/runner-delivery.ts` plus runner adapters owns only already-bound deployment records.

```ts
type RunnerArtifactDelivery = {
  poll(context: RunnerContext): Promise<DeploymentCommand[]>;
  claim(context: DeploymentClaimContext): Promise<DeploymentClaim>;
  getArtifact(context: DeploymentContext): Promise<VerifiedArtifactEnvelope>;
  report(context: DeploymentContext, report: DeploymentReport): Promise<DeploymentReceipt>;
};
type RunnerStartGateDelivery = {
  getStartRequirements(context: RunnerStartRequirementsContext): Promise<StartRequirementsResult>;
};
```

A runner request never supplies a URL, ref, Source ID, arbitrary agent ID, or credential. The deployment row binds those values and each request rechecks runner and agent assignment. `GET /api/runners/:runnerId/agents/:agentName/start-requirements` is the executable start-gate seam: runner authentication must match `:runnerId`, the current agent assignment must match that runner, and the method invokes the same package-aware validator as human start/restart before returning the bounded `StartRequirementsResult`.

### AgentRuntimeGeneration

`apps/agent-runner/src/runtime-generation.ts` is the runner-side seam that gives one agent one coherent skill generation across all channels.

```ts
type StagedGeneration = {
  agentId: string;
  deploymentId: string;
  generation: RuntimeGeneration;
  stagedRoot: string;
};
type AgentRuntimeGeneration = {
  captureForTurn(agentId: string): Promise<TurnLease>;
  stage(deployment: DeploymentCommand, artifact: VerifiedArtifactEnvelope): Promise<StagedGeneration>;
  activateWhenIdle(staged: StagedGeneration): Promise<ActivationResult>;
};
```

`stage` rejects a deployment/artifact agent or generation mismatch and returns an agent-bound token; `activateWhenIdle` derives the agent exclusively from that token. A turn captures one immutable generation before prompt composition. Activation waits for every channel lease for that agent, blocks new leases for the pointer swap, then selects the new generation. No turn mixes old/new markdown, event shapes, or filesystem roots.

## 6. Database model and migration 034

Add `packages/db/migrations/034_catalog_source_library.sql` and update `packages/db/src/schema.ts` by hand. Every mutable table uses integer revisions constrained to `1..2147483647`; booleans and enums have database checks; bounded JSON columns use strict canonical DTOs.

### Canonical source and credentials

`catalog_sources` becomes the complete Source table: `source_id` PK, `display_name`, `canonical_url`, optional `ssh_user`, immutable `repository_identity`, immutable `ref`, `enabled`, `allow_packages`, `revision`, `removed_at`, nullable `current_snapshot_id`, and timestamps. Repository identity/ref are not editable. Source IDs remain reserved. Removed implies disabled and `allow_packages=0`.

`catalog_source_read_credentials` replaces the old credential table with `source_id` PK/FK, unique opaque `credential_ref`, `kind='https-basic'`, ciphertext, a bounded revision, optional migration-only `legacy_binding_source_id` plus `legacy_credential_ref`, and timestamps. New encryption envelopes bind Source ID, repository identity, and credential ref. Migration gives every Catalog-derived Source a deterministic unique new reference while retaining the old reference and old Source binding solely for decrypting the copied envelope; a migrated envelope is accepted only when both archived values and the current repository identity match. Rotation clears both compatibility columns. No credential ciphertext is selected in metadata or sent to runners.

### Snapshots and releases

`catalog_sync_attempts`: `attempt_id`, `source_id`, `source_revision`, state `RUNNING|SUCCEEDED|FAILED|ABANDONED`, optional resolved commit/snapshot, fixed failure code, actor, revision, and timestamps. One running attempt per Source.

`catalog_snapshots`: immutable `snapshot_id`, Source, exact commit, index digest, exact index JSON, observed ref, originating attempt, created time. Unique `(source_id, source_commit)` and equal re-observation must have equal digest and bytes.

`catalog_package_releases`: immutable `package_release_id`, authority/content Source IDs, kind/name/version/digest, package commit/path, bounded manifest/execution/warning JSON, and created time. Unique `(authority_source_id,name,version)`.

`catalog_snapshot_entries`: `(snapshot_id, package_release_id)` with ordinal, allowing one immutable release to appear in many snapshots.

`catalog_release_controls`: one row per release with `review_state`, `review_digest`, reviewer/action IDs/times, and revision. Approval binds the release’s identity, manifest, execution preview, and warnings.

### Grants, installation, activation, and local consumption

`catalog_grants`: grant ID, release ID, `ORGANIZATION|HUMAN`, optional human ID constrained by subject type, revision, revoked timestamp, actor/times. Revocation is a tombstone. Organization grants explicitly include future humans.

`catalog_install_operations`: operation/revision, root release, exact dependency closure digest, `PENDING|INSTALLING|INSTALLED|FAILED`, actor/time, fixed failure code.

`catalog_installations`: release PK, artifact digest/path, `INSTALLED|QUARANTINED`, actor/time, last verification, and bounded revision. Paths never leave API/internal audit.

`catalog_api_activations`: release PK, approval state `NOT_REQUIRED|AWAITING_APPROVAL|APPROVED|REVOKED`, runtime state `INACTIVE|ACTIVATING|ACTIVE|DEACTIVATING|FAILED`, revisions, actor/time, fixed failure.

`agent_template_origins`: agent PK, release, mode, actor/time, grant/admin marker, and copied immutable identity fields.

`agent_package_secret_bindings`: agent/release/requirement/secret reference PK, actor/time, and bounded revision. Only references persist; existing secret scope checks remain authoritative.

`agent_skill_assignments`: assignment ID, agent, release, local skill name, desired state `DISABLED|ENABLED`, effective state `DISABLED|ENABLED`, deployment state `STABLE|REQUESTED|DEPLOYING|FAILED`, preload, active/desired generation, revision, actor/grant/time, timestamps; unique `(agent_id, local_skill_name)`. `ADMIN` provenance requires a null grant and `GRANT` provenance requires a non-null grant. A request changes desired/deployment state only; effective state and active generation change only after the bound runner reports the desired generation `ACTIVE`.

`catalog_rollouts`: rollout ID, release, immutable plan digest, discriminated operation `ENABLE|DISABLE|SET_PRELOAD`; `SET_PRELOAD` alone carries and persists a required boolean preload value. State is `DRAFT|QUEUED|RUNNING|SUCCEEDED|PARTIAL|FAILED|CANCELLED`, with actor/time and revision.

`catalog_rollout_targets`: rollout/agent PK, captured runner, expected assignment revision, `QUEUED|BLOCKED|STAGING|VERIFYING|WAITING_FOR_IDLE|ACTIVATING|SUCCEEDED|FAILED|SKIPPED|SUPERSEDED`, attempts, fixed reason, timestamps, and bounded revision. Target IDs freeze at confirmation.

`runner_package_deployments`: deployment ID, rollout/target/agent/release IDs, bound runner, desired generation, `QUEUED|CLAIMED|STAGED|WAITING_FOR_IDLE|ACTIVE|FAILED|SUPERSEDED`, attempt token, lease expiry, revision, fixed failure, timestamps. Retry is idempotent by deployment ID and attempt token.

Every `failure_code`, `reason_code`, and provenance-kind column uses a database `CHECK` over the fixed code set owned by its state machine; arbitrary text is invalid.

### Migration and compatibility procedure

Migration 034 must:

1. Rename migration-032 `catalog_sources`, `catalogs`, and `catalog_read_credentials` to archival `*_legacy_032` tables.
2. Create canonical tables and indexes/checks.
3. For every old Catalog, create a new Source with `sourceId=old catalog_id`, joined repository fields, old ref/display name, and enabled/permission/removed state derived from both old rows.
4. Copy each encrypted credential without decryption and record `legacy_binding_source_id`.
5. Retain old source-only rows in archival tables; do not invent a ref. The admin UI shows a migration warning requiring explicit new Source creation.
6. Preserve migration-033 origins unchanged, map their old Catalog ID to the resulting Source ID, and do not fabricate releases or approval. Reconciliation later requires exact commit/path/name/version/digest and fresh local measurement.
7. Perform no filesystem, network, Git, random, or master-key work.
8. Keep archives through two-instance acceptance; remove them only in a later migration after verified export/reconciliation.

Format-v1 `catalogId` maps to `authoritySourceId` and v1 `sourceId` maps to `contentSourceId` at the adapter. No format-v2 schema is introduced.

For one compatibility release, `/api/catalog-sources` is the complete Source API and every `/api/catalogs` route returns fixed `410 CATALOG_RESOURCE_RETIRED`; no mutable proxy or synthesized Catalog remains. Remove the retirement shim after that release. Existing `enabled_skills_json` and `always_preloaded_skills_json` remain for built-in/local skills; catalog assignments are canonical and projected together by the runner with name-collision rejection.

## 7. Synchronization and immutable release discovery

Source creation writes configuration in a short transaction and then runs one bounded immediate sync outside that transaction. Creation succeeds with a failed attempt and returns the Source receipt plus attempt status. Sync requires current admin authority, strict body, source lock, source revision, enabled/nonremoved Source, Source-scoped credential, existing GitHub-only sanitized transport, fixed index path, and offline package inspection.

The sequence is: persist `RUNNING`; fetch configured ref to staging; inspect `catalog/index.json` and every reached package required for bounded release records; enforce external/cross-source `allowPackages` on the content Source; compare all known authority/name/version mappings; promote the exact commit to retained mirror state; then in one immediate transaction recheck admin authority, Source revision, and immutable binding, insert/reuse snapshots/releases, create pending controls, update current snapshot, complete attempt, and append audit. Publish WebSocket notifications only after commit. Startup reconciliation removes orphan staging refs.

Any fetch, parse, package, source-policy, identity, promotion, transaction, or cleanup failure preserves the last current snapshot and installed/activated content. A failed attempt is queryable with a fixed redacted code. Sync never executes package code or creates grants/installation/activation authority.

## 8. HTTP contracts, authorization, errors, and audits

All catalog bodies are strict JSON, valid UTF-8, unknown-field rejecting, and actual-stream bounded to 16 KiB unless a smaller route bound applies. Rollout target arrays cap at 256. Every protected response uses `Cache-Control: no-store`. Existing auth guard bodies remain unchanged; catalog failures use fixed `{error,code}` envelopes with no submitted values, URL, path, SQL, crypto, Git stderr, credential ref, authored bytes, or exception text.

All source-management, release-review, sync, hidden-release browsing, installation, grant, API-activation, and reconciliation routes require `requireAuth` plus a fresh live human admin check. Global/scoped runners are denied even with an admin cookie. Admin mutations recheck authority in the immediate transaction after body parsing.

The canonical route surface is:

- Sources: `GET/POST/PATCH/DELETE /api/catalog-sources`, `GET /api/catalog-sources/:sourceId`, `POST .../:sourceId/restore`, `PUT/DELETE .../:sourceId/read-credential`, `POST .../:sourceId/sync`, `GET .../:sourceId/sync-attempts`, and `GET .../:sourceId/snapshots`.
- Releases: `GET /api/catalog-releases`, `GET .../:packageReleaseId`, and `POST .../:id/{approve,reject,withdraw,reopen,install,api-execution/approve,api-execution/activate,api-execution/deactivate}`. Approval requires expected revision, exact release digest, and review digest.
- Grants: `GET .../:id/grants`, organization `PUT/DELETE`, and human `PUT/DELETE .../:id/grants/humans/:humanId`, all revision guarded.
- Library: `GET /api/library/packages`, `GET .../packages/:packageReleaseId`, `POST /api/library/templates/:packageReleaseId/instances`, and `PUT /api/library/agents/:agentId/requirements/:requirementName/secret-binding`. The authenticated human is derived server-side; only a separate admin route can choose another owner. Template creation and secret binding use only the redacted projections and local secret references defined above.
- Agent skills: `PUT/DELETE /api/agents/:name/catalog-skills/:packageReleaseId`, with expected agent/assignment revision and preload state.
- Rollouts: `POST /api/catalog-rollouts/plan`, `POST /api/catalog-rollouts`, `GET .../:rolloutId`, `POST .../:rolloutId/cancel`, and `POST .../:rolloutId/retry-failed`.
- Runner protocol: `GET /api/runners/:runnerId/package-deployments`, `GET /api/runners/:runnerId/agents/:agentName/start-requirements`, `POST /api/runner-package-deployments/:id/claim`, `GET .../:id/artifact`, and `POST .../:id/report`, all bound to authenticated runner identity and current agent assignment.

The strict body contract is fixed: Source create is `{sourceId,displayName,repository,ref,enabled,allowPackages}`; Source patch is `{expectedRevision,displayName?,enabled?,allowPackages?}`; remove/restore/read-credential mutations are revision guarded; sync is `{expectedRevision}` and always reads `catalog/index.json`; release review is `{expectedRevision,digest,reviewDigest}`; grant changes carry the grant revision; library template creation carries only local name, visibility, runner, workspace, model, and secret-reference bindings; assignment carries expected agent/assignment revision and preload; rollout planning carries one release, at most 256 explicit agent IDs, and a discriminated operation of `{operation:"ENABLE"}`, `{operation:"DISABLE"}`, or `{operation:"SET_PRELOAD",preload:boolean}`, while confirmation echoes the plan digest and exact IDs. The preload value is included in the digest, confirmation, and persisted rollout. Unknown fields, invalid UTF-8, absent required fields, duplicate IDs, and bodies over the actual streamed limit fail before domain work.

Canonical errors have fixed messages: `INVALID_REQUEST` (“Invalid catalog library request”), `PAYLOAD_TOO_LARGE` (“Catalog library request too large”), `FORBIDDEN` (“Administrator access required”), `NOT_FOUND` (“Catalog library resource not found”), `REMOVED` (“Catalog library resource removed”), `REVISION_CONFLICT` (“Catalog library changed; reload metadata”), `STATE_CONFLICT` (“Catalog library operation conflicts with current state”), `IDENTITY_CONFLICT` (“Catalog release identity already reserved”), `SOURCE_NOT_ALLOWED` (“Package source is not enabled for this operation”), `SOURCE_UNAVAILABLE` (“Package source is unavailable”), `RELEASE_NOT_APPROVED` (“Package release is not approved”), `GRANT_REQUIRED` (“A current grant is required”), `INSTALLATION_REQUIRED` (“Package release is not installed”), `API_ACTIVATION_REQUIRED` (“API execution approval is required”), `REQUIREMENTS_UNSATISFIED` (“Agent requirements are not satisfied”), `OPERATION_IN_PROGRESS` (“Catalog operation is already in progress”), `DEPLOYMENT_SUPERSEDED` (“Runner deployment was superseded”), `INSPECTION_FAILED` (“Package inspection failed; last-known-good content is unchanged”), `STORAGE_FAILURE` (“Catalog library operation failed”), and `SYNC_FAILED` (“Source synchronization failed”). The retirement response is `CATALOG_RESOURCE_RETIRED` (“Catalog resource retired; use Source Library”). Where needed, responses include only a bounded reason identifier; authentication guard bodies remain the existing bodies.

Add strict core shapes and typed audits for `audit.catalog.source.changed`, `audit.catalog.sync.completed`, `audit.catalog.sync.failed`, `audit.catalog.release.reviewed`, `audit.catalog.grant.changed`, `audit.catalog.installation.changed`, `audit.catalog.api_activation.changed`, `audit.catalog.template.instantiated`, `audit.catalog.assignment.changed`, `audit.catalog.rollout.changed`, and `audit.catalog.deployment.reported`. Payloads include actor kind/ID, operation/attempt ID, Source/release IDs, package identity/digest, affected agent/runner IDs, action/outcome, revision, and fixed failure reason. They never include credentials/refs, repository URLs, host paths, bytes, authored commands/prompts/warnings, raw exceptions, or Git output. Successful mutations and audits commit together; durable network/filesystem/runner attempts are audited at final transition. All are `system`, `DELIVERED`, channel-less `audit.*` events and create no receipts or wakeups.

## 9. Review, grants, installation, and deletion semantics

A new release is hidden and `PENDING`. Approval binds exact digest/review digest; rejection/withdrawal blocks new grant, install, instantiation, assignment, and rollout. Reopen is explicit. Release identity rows never delete.

Installation is all-kind, inert, and administrator-only. It composes the unchanged exact resolver and inspection contracts, verifies closure, modes, paths, limits, digest, occupied namespace, and complete remeasurement before reuse. Artifact directories are content-addressed and immutable. Population uses exclusive creation and no replacement; any conflict aborts the whole operation. Cleanup removes only this operation’s staging/targets and preserves unmanaged siblings. Origins are written last in one transaction. Filesystem/SQLite crash windows remain explicit residual risks and never justify overwrite.

API event-shape activation has its own approval and state machine. It imports only approved installed module roots after an explicit activation operation. Activation persists `ACTIVATING`, composes and validates a candidate, then uses a reversible registry swap before the final `ACTIVE` transaction. Import, validation, registry-swap, or final persistence failure restores the prior registry when necessary and durably records `FAILED` (or leaves `ACTIVATING` if even failure persistence is unavailable); it never leaves `ACTIVE` while the old registry is loaded. Deactivation removes future registry composition but cannot roll back side effects; restart may be required. Wrapped setup/sidecars/runtime are dormant until explicit agent start.

Organization grants say “includes current and future users” in UI. Individual grants name one human. Grants require approved releases and administrator authority. Revocation blocks new library actions but never deletes/stops/invalidate existing local agents or assignments. Source removal disables permission, deletes its credential, cancels unstarted syncs, and retains snapshots, releases, grants, installations, assignments, agents, and provenance. Restore preserves identity, returns disabled with permission off and no credential. Release withdrawal and grant revocation do not unload code or uninstall content; quarantine blocks new starts where required.

## 10. Runner artifacts, assignment, activation, and start gate

Artifact envelopes contain an immutable release identity (`packageReleaseId`, authority/content Source IDs, kind/name/version, catalog/package commits, package-relative path, and digest), the canonical format-v1 `PackageManifest`, the complete ordered dependency identity list, complete bounded base64 files with only package-relative paths and modes `0o644|0o755`, semantic digest, agent ID, deployment ID, and deployment generation. The envelope is strict and bounded by the existing format-v1 file/count/byte limits. It contains no Source URL/ref, credential or credential reference, API artifact/mirror/host path, grant data, secret value/reference, setup output, or command beyond fields already present in the reviewed canonical manifest.

A bound runner authenticates, claims attempt token, fetches artifact, re-inspects bytes, compares identity/digest, rejects links/modes/overflow/drift, stages a new versioned directory, reports `STAGED`, reports `WAITING_FOR_IDLE` before awaiting zero active turn leases across every channel for the agent, atomically switches generation, and reports `ACTIVE`. Each report projects the rollout target so status UIs can distinguish staging, waiting, and active completion. Prior generation remains last known good. Reassignment supersedes old deployment and creates one bound to the new runner. Runner restart reconciliation is idempotent.

Every agent start/restart passes one package-aware validator. It requires installed exact releases, assigned runner, matching verified deployment generation/digest, active required API event-shapes, valid required secret references, model/mode/workspace/runner bindings, supported wrapped wiring, and no quarantined/failed prerequisite. It returns `409 REQUIREMENTS_UNSATISFIED` with bounded package/requirement reason IDs. It does not recheck historical grants, Source enablement, or source credentials because local authorization is independent after consumption.

Skill assignment phases are projected from desired/effective/deployment columns: enabling moves effective `DISABLED` through `ENABLE_REQUESTED` and `DEPLOYING`, and only an `ACTIVE` report changes it to effective `ENABLED`; disabling similarly preserves effective `ENABLED` until the disabling generation is `ACTIVE`. A failed deployment records `FAILED` while retaining the prior effective state and active generation. Rollouts use `DRAFT -> QUEUED -> RUNNING -> SUCCEEDED|PARTIAL|FAILED|CANCELLED`; cancellation prevents unclaimed targets and never rolls back successes; retry is failed-target-only: persisted `FAILED` targets may be retried, while `SUCCEEDED`, `SKIPPED`, and `SUPERSEDED` targets are never replayed. Deployment uses `QUEUED -> CLAIMED -> STAGED -> WAITING_FOR_IDLE -> ACTIVE` with failure/superseded exits.

## 11. UI journeys and mobile behavior

### Administrator Sources and releases

Replace separate Sources/Catalogs editors with one Source journey: display name, GitHub HTTPS URL, selected ref, enabled flag, independent external-package permission, optional masked read credential, immediate sync status, last-good snapshot, explicit retry, disable/remove/restore. Index path is fixed/read-only. Removal confirmation states credential/policy effects and explicitly says snapshots/releases/grants/installations/agents remain. A stale sync leaves last-good data visible.

The admin release queue filters pending/approved/rejected/withdrawn, source availability, installation, and API approval. Detail shows immutable identity, both commits, digest, manifest, dependencies, compatibility, files/modes, event modules, scripts, wrapped commands/external sources, warnings, review digest, and reviewer. Release approval and API execution approval are separate confirmations. Grant management shows organization-grant future-user scope, human grants, revisions, revocations, and independent source/release/install conditions.

### User Library and consumption

Add a Library navigation item to the user UI. Cards show only approved, installed, effectively granted releases with kind/name/version, description/attribution, digest, ready/blocked status, and the relevant action. Empty states distinguish no grants, not installed, no compatible releases, and no manageable agents. Users never see credentials, hidden releases, repository administration, raw bytes, or unapproved releases.

Template wizard selects immutable template summary, exact dependencies, local name/visibility, runner/workspace/model, permitted secret references, and final confirmation. It always creates a stopped agent with an origin and requirement checklist; there is no start checkbox.

Skill rollout selects one exact release, explicitly listed manageable agents, enabled/preloaded effect, per-agent blockers, plan digest and target list; `SET_PRELOAD` confirmations show the exact true/false value. Status shows queue/stage/wait/active/failure and partial means partial. The regular-user Library client and controller expose plan, exact-list confirmation, status refresh, cancellation, and failed-target-only retry. The browser journey proves a granted human can assign a skill to a manageable agent, cannot assign when ungranted or targeting an unmanageable agent, can select manageable rollout targets, confirm the echoed operation/digest/list, observe partial completion, retry only failed targets, and cannot target an unmanageable agent.

### Shared and phone-width behavior

Protected operations perform a fresh auth check bound to the current human, use operation generations/abort/supersession, never auto-retry mutations, require explicit reload after conflicts, preserve last-good views after read failures, escape all untrusted text, clear credentials before awaits, and provide real labels/buttons/focus/`aria-busy`/status/alerts. Desktop tables become responsive stacked cards at phone width. The mobile admin shell is required before final release, including Source, release, grant, library, template, and rollout journeys; it is not deferred as an app-wide redesign.

## 12. Security, errors, and recovery

Read credentials are decrypted only inside the Source fetch operation and injected through the existing sanitized GitHub HTTPS mechanism; no cross-source forwarding, redirect forwarding, argv/config/mirror/log/response leakage, or publication capability is allowed. Same-UID `/proc` exposure from environment injection remains an acknowledged residual. Package bytes are untrusted; no module evaluation or command execution occurs until explicit activation/start and the relevant administrator/runtime controls.

Errors are fixed/redacted and never expose submitted values, URL, host path, command, SQL, crypto details, authored bytes, credential reference, or raw exception. Failed sync preserves current snapshot. Failed install leaves no active change, records a failed operation, cleans only its own staged/claimed targets, and never overwrites unmanaged content. Ambiguous runner/network outcomes remain durable and reconcile before retry. Reassignment supersedes deployment authority. A process crash may leave filesystem/SQLite cleanup work; startup reconciliation identifies orphan staging and operation records rather than claiming false success.

A release may be quarantined after integrity drift. Quarantine blocks new activation/start where required but does not promise removal of already executed side effects. A grant/source/release policy change never silently stops an independent running agent; emergency stop/quarantine is a separate explicit administrative action.

## 13. Phased implementation boundaries

- **R1 Source cutover and snapshots:** vocabulary/DTOs, migration/backfill/archive, complete Source, fixed index, immutable snapshots/releases, sync attempts, old-route retirement, admin Source UI. No grants, install changes, library, activation, or runner behavior.
- **R2 Review and exact installation:** review state/digest, release queue/detail, inert content-addressed all-kind installation, migration-033 reconciliation. No consumption or activation.
- **R3 Grants and read-only library:** grants, centralized policy, library list/detail, responsive UI, revocation authorization. No instantiation or agent mutation.
- **R4 Runner delivery and start prerequisites:** normalized assignments/bindings, deployment records/protocol, artifact verification/staging, agent-wide generation leases, package-aware start gate. Exercise direct admin assignments only.
- **R5 API activation and finite rollout:** API approval/activation, rollout plan/confirm/status/cancel/retry, partial states, delegated targeting, multi-channel consistency. No managed policies/upgrades.
- **R6 Template instantiation:** native CLASSIC/RLM_REPL and WRAPPED positive-field selection, local bindings, stopped creation, origins/requirements, explicit start.
- **R7 Compatibility and acceptance:** remove retirement shim after one compatibility release, archive export/reconciliation, complete phone shell, controlled public/private two-instance acceptance, `docs/SPEC.md` and contract updates, independent security/architecture review.

## 14. Acceptance criteria

### Source and synchronization

- One Source resource contains immutable repository+ref and fixed index path; no exposed mutable Catalog lifecycle remains.
- Source routes reject regular humans, agents, and global/scoped runners; bodies are strict/actual-stream bounded; stale revisions fail.
- Removal/restore reserve identity and reset permission/credential as specified.
- Failed sync preserves last current snapshot; changed identity under known authority/name/version rejects the complete sync.
- External locations require current explicit `allowPackages` on their referenced Source and never inherit catalog authority or credentials.

### Releases, approval, and installation

- Releases begin pending/hidden; approval binds exact digest/review digest; API module approval is separate.
- Skill, native, and wrapped artifacts install inertly without package code execution.
- Reuse requires complete remeasurement; origin records retain authority/content Sources, commits, path, version, digest, actor, and time.
- Source removal retains local content/provenance.

### Grants and library

- Organization grants explicitly include future humans; individual grants are exact-human scoped.
- Library exposes only approved, installed, effectively granted releases; users cannot fetch/install/review/grant/publish/API-activate.
- Revocation blocks new consumption but does not mutate existing agents; users cannot target unmanageable agents.

### Templates and start

- Native CLASSIC, native RLM_REPL, and WRAPPED templates create stopped agents from allowlisted fields.
- Runner/model/workspace/secret values are local bindings; missing required secrets may be saved but block start.
- Secret binding is the exact revision/origin/requirement/secret-authorization route above; its response and audit are fixed redacted projections and the accepted transition creates no receipt.
- Wrapped setup/commands do not run before explicit start; existing agents are never changed by sync/review/grant/install.

### Activation and rollout

- Assignments pin exact installed releases/digests; rollouts freeze target lists and never enroll future agents.
- Retries do not replay success; partial completion is explicit; old generations remain active until verified replacement.
- Multi-channel turns never observe mixed generations; reassignment supersedes old runner authority; restart reconciliation is idempotent; tampered artifacts never activate.

### Audit, compatibility, and verification

- Every successful control transition and every durable sync/install/activation/deployment outcome emits one typed channel-less audit event, including secret binding; these audits create no receipts.
- Audits/errors/responses/logs contain no credentials, URLs, host paths, bytes, or raw exceptions, and audits never wake agents.
- Existing format-v1 repositories remain consumable; existing origins survive until exact reconciliation; built-in/local skills remain unchanged.
- Fresh/upgraded migrations are tested and idempotent; old Catalog routes return retirement response during compatibility release.
- Full Vitest, opscli tests, workspace type checks, focused runner tests, and controlled two-instance acceptance pass.
- Phone-width browser tests cover Source, release, grant, library, template, and rollout journeys.

## 15. Current implementation verification

At design time, the branch still contains the pre-redesign seams: migration 032’s `catalog_sources`/`catalogs` tables, migration 033’s skill-only `catalog_installed_origins`, `apps/api/src/catalog-configuration.ts`, `apps/api/src/catalog-sync/sync.ts`, `apps/api/src/routes/catalogs.ts`, `apps/admin-ui/src/catalogs/*`, and `CatalogsScreen.tsx`. The runner currently reads `enabledSkills`/`alwaysPreloadedSkills` from the active skill root in `turn-executor.ts`, and `channel-loop.ts` serializes per `(agent, channel)` rather than per agent. These facts are why the plan introduces normalized assignment/deployment records and an agent-wide generation lease instead of extending the current JSON fields or channel loop in place.

No production behavior is changed by this design document. Implementation tasks must update `docs/SPEC.md` in the same task whenever they change an API surface, event contract, schema, or runtime behavior, and must retain the old contract documentation until the format compatibility work is complete.
