# Unified Skills and Source Library UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one server-authorized unified Skills inventory and lifecycle flow while retaining Source Library as a separate admin-only master/detail authority surface, retiring the user-ui Library, and preserving local/catalog storage, provenance, grants, deployment generations, and explicit stopped-agent start safety.

**Architecture:** Put identity, actor projection, readiness, manageability, revision, persistence, and runtime policy in deep TypeScript modules. Keep Hono route handlers as strict authenticated adapters and keep React controllers as thin consumers of the canonical inventory/command interfaces. Local skills remain in the existing JSON columns and catalog skills remain pinned in `agent_skill_assignments`; the unified read projection never merges those authorities or performs installation/execution.

**Tech Stack:** TypeScript, Zod, Hono, SQLite/better-sqlite3 with existing Drizzle schema, React 18, Tailwind, Vitest, Playwright Core with installed Chrome, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-18-unified-skills-and-source-library-ux-design.md`

## Global Constraints

- Use npm commands from the repository root; never use pnpm.
- Source Library remains a separate top-level navigation item and is administrator-only; Sources are never nested under Skills.
- Admin-ui is the only skill-management UI; every authenticated human can open Skills, while actions and provenance are server-gated.
- Do not authorize from client identity, URL state, CSS visibility, username, or cookie fields; authenticate first, derive the live actor, then validate input and authorize the deep module.
- A supplied `x-orgops-runner-token` takes precedence over a human session; malformed runner credentials receive the existing runner auth response.
- Protected responses use `Cache-Control: no-store`, fixed error envelopes, non-enumerating inaccessible-resource behavior, bounded parameters, UTF-8 streamed body limits of 16 KiB or less, and strict unknown-field rejection.
- Preserve local JSON persistence and catalog normalized persistence with exact origins, release IDs, digests, grants, revisions, deployment history, and only the narrowly justified migrations 043, 044, and 045 recorded by implementation.
- Inventory reads are inert: discovery never installs, activates event shapes, mutates assignments, creates agents, starts processes, fetches packages, or runs commands.
- Catalog template or catalog-skill creation is atomic and `STOPPED`; selection is not instantiation; no channels, receipts, turns, model calls, wrapper setup, or processes exist before explicit Start.
- Catalog assignment/package generations become effective only after complete staging, digest verification, all channel turn leases reaching the safe boundary, and atomic activation; failure retains the last-known-good catalog generation. Local JSON commits are immediately desired=effective and `STABLE` for future turns, while a captured active turn remains unchanged.
- Secret values, raw storage IDs, ciphertext, owner IDs, and other humans' references never cross a bounded projection; an authorized actor may receive only a short-lived single-base64url AEAD-sealed opaque `secretReferenceId` bounded to 2048 UTF-8 bytes by the shared schema, plus safe display/key names when available. Handles expire after 10 minutes, are actor/purpose bound with a random nonce, are not persisted, and never appear in logs/audits; secret storage IDs are never browser state or provisioning wire fields.
- External-package permission, installation, review, API event-shape activation, and wrapped-runtime execution remain independent authorities.
- Every implementation task that changes an API route, schema, event, route-retirement behavior, agent-state invariant, or runner-generation behavior updates `docs/SPEC.md` in that same task.
- Real-Chrome checks run at desktop and 390px; stacked master/detail, wrapped tabs, focus restoration, live status/error regions, and zero horizontal overflow are acceptance requirements.

## File Responsibility Map

- `packages/schemas/src/unified-skills.ts` — shared strict Zod schemas and TypeScript contracts for trusted internal versus wire refs, actors, inventory items, preflight/template options, change commands, flat HTTP provisioning bodies, nested domain commands/results, history, DTOs, error codes, and bounded request/query parsing.
- `packages/schemas/src/index.ts` and `packages/schemas/src/index.test.ts` — public exports and schema contract tests.
- `apps/api/src/unified-skills/inventory.ts` — `UnifiedSkillInventory` deep read module; joins local filesystem evidence, catalog policy/install/grant data, agent state, and actor-safe projections without side effects.
- `apps/api/src/unified-skills/inventory.test.ts` — local/catalog identity, grant, install, readiness, manageability, projection-redaction, and inert-read tests.
- `apps/api/src/unified-skills/management.ts` — `AgentSkillManagement` deep command module; owns local JSON/catalog assignment writes, revision guards, audit records, and deployment enqueueing.
- `apps/api/src/unified-skills/management.test.ts` — command authorization, collision, revision, desired/effective, deployment, retry/supersession, and persistence tests.
- `apps/api/src/unified-skills/provisioning.ts` — `AgentProvisioning` preflight/write transaction, template closure, stopped invariant, secret binding validation, deployment queue, and owned staging cleanup.
- `apps/api/src/unified-skills/provisioning.test.ts` — preflight-all-before-write, blank/template, rollback, cleanup, redaction, and no-runtime-side-effect tests.
- `apps/api/src/routes/unified-skills.ts` — canonical inventory/history/agent-skill route adapters with strict query/body parsing, actor resolution, fixed errors, no-store, and 16 KiB streaming limits.
- `apps/api/src/routes/agent-skills.ts` — canonical skill command/preflight route adapters.
- `apps/api/src/routes/agent-provisioning.ts` — canonical template-option and `/api/agents/provision` adapters.
- `apps/api/src/routes/unified-skills.integration.test.ts` — actual Hono route surface/auth/body-limit/error/nonenumeration/compatibility tests.
- `apps/api/src/routes/agent-skills.integration.test.ts` — canonical command and history endpoint matrix.
- `apps/api/src/routes/agent-provisioning.integration.test.ts` — provisioning endpoint matrix and atomic stopped creation.
- `apps/api/src/app.ts` — composition-root dependency wiring, runner-header precedence preservation, actor derivation, and compatibility adapter registration.
- `apps/api/src/routes/skills.ts` — `GET /api/skills` compatibility adapter to the unified local projection.
- `apps/api/src/routes/agents.ts` — old generic create/update/start adapters; retain existing clients while routing skill mutations and package start checks through deep modules.
- `apps/api/src/routes/catalog-library.ts` — retain Source Library and privacy-safe `/api/library/*` routes; add only shared adapters where canonical modules replace duplicated policy.
- `apps/api/src/catalog-library/authority.ts` — retain Source/release authority, immediate create sync, last-good behavior, revisions, and admin-only authority actions.
- `apps/api/src/catalog-library/consumption.ts` and `apps/api/src/catalog-library/templates.ts` — adapt old catalog assignment/template commands to canonical management/provisioning without creating a second authority.
- `apps/api/src/catalog-library/authority.test.ts`, `apps/api/src/catalog-library/consumption.test.ts`, `apps/api/src/catalog-library/templates.test.ts`, `apps/api/src/catalog-library/library.integration.test.ts`, `apps/api/src/catalog-library/assignments.integration.test.ts`, and existing route integration tests — regression coverage for old routes and source/release/grant/install/start behavior.
- `apps/agent-runner/src/runtime-generation.ts`, `apps/agent-runner/src/package-delivery.ts`, `apps/agent-runner/src/channel-loop.ts`, and their existing tests — only when catalog artifact behavior changes; preserve and extend safe generation capture, staging, all-channel idle activation, and failure retention. Local JSON selection is not deployed as an artifact.
- `apps/admin-ui/src/unified-skills/api.ts` — strict browser DTO decoder and canonical inventory/command/provisioning HTTP client.
- `apps/admin-ui/src/unified-skills/state.ts` — shared inventory/selection/agent-context/deployment controller with URL state, last-good reads, fixed errors, and mutation supersession.
- `apps/admin-ui/src/unified-skills/state.test.ts` and `apps/admin-ui/src/unified-skills/api.test.ts` — controller and client contract tests.
- `apps/admin-ui/src/screens/SkillsScreen.tsx` and `apps/admin-ui/src/screens/SkillsScreen.test.tsx` — unified master/detail Skills screen with origin/readiness filters, permission-gated admin detail, and responsive/accessibility behavior.
- `apps/admin-ui/src/screens/SourceLibraryScreen.tsx`, `apps/admin-ui/src/screens/SourceLibraryScreen.test.tsx`, `apps/admin-ui/src/catalog-library/state.ts`, `apps/admin-ui/src/catalog-library/source-library.browser.test.ts` — Source master/detail, URL selection, five tabs, closed add drawer, immediate sync/retry, contextual error dedupe, and Chrome acceptance.
- `apps/admin-ui/src/screens/AgentsScreen.tsx`, `apps/admin-ui/src/screens/AgentsScreen.test.tsx`, `apps/admin-ui/src/types.ts`, `apps/admin-ui/src/App.tsx`, `apps/admin-ui/src/hooks/useOrgOpsData.ts`, and `apps/admin-ui/src/api.ts` — Blank/template creation flow, shared Skills step, existing-agent Skills tab, and canonical API wiring.
- `apps/admin-ui/src/components/layout/Sidebar.tsx`, `apps/admin-ui/src/components/layout/Sidebar.test.tsx`, and `apps/admin-ui/src/App.test.tsx` — ordinary-human Skills visibility and admin-only Source Library navigation/security tests.
- `apps/admin-ui/src/screens/AgentSkillsTab.tsx`, `apps/admin-ui/src/screens/AgentSkillsTab.test.tsx`, `apps/admin-ui/src/components/skills/UnifiedSkillPicker.tsx`, and `apps/admin-ui/src/components/skills/UnifiedSkillPicker.test.tsx` — reusable picker and existing-agent assignment/deployment/history UI.
- `apps/user-ui/src/App.tsx`, `apps/user-ui/src/App.test.tsx`, `apps/user-ui/src/styles.css`, `apps/user-ui/src/LibraryScreen.tsx`, `apps/user-ui/src/LibraryScreen.test.tsx`, `apps/user-ui/src/library/api.ts`, `apps/user-ui/src/library/api.test.ts`, `apps/user-ui/src/library/state.ts`, `apps/user-ui/src/library/state.test.ts`, and `apps/user-ui/src/library/library.browser.test.ts` — remove Library navigation/screen/controller callers and route `/library` to the ordinary conversation workspace; do not remove backend `/api/library/*` adapters.
- `docs/SPEC.md` — final route, DTO, auth precedence, error, persistence, audit, and runtime-generation contract updates in each relevant implementation task.
- `docs/superpowers/plans/2026-09-18-unified-skills-and-source-library-ux.md` — this plan only; no protected `.superpowers/` or `docs/research/*` file is touched. The initial no-migration ruling was superseded by migrations 043–045 for representation gaps discovered during implementation.

## Locked Interfaces and Route Contract

All later tasks use these names and fields; implementers must not introduce a second spelling or authority.

### Shared domain contracts

```ts
export type TrustedLocalSkillRef = {
  kind: "LOCAL";
  name: string;
  localOrigin: "BUILT_IN" | "WORKSPACE";
  trustedRootKey: string;
};

export type SkillRef =
  | { kind: "LOCAL"; name: string; localOrigin: "BUILT_IN" | "WORKSPACE" }
  | { kind: "CATALOG"; packageReleaseId: string; name: string; version: string; digest: string };

export type InventoryActor =
  | { kind: "HUMAN_ADMIN"; id: string }
  | { kind: "AUTHENTICATED_HUMAN"; id: string };

export type InventoryQuery = {
  query?: string;
  origin?: "ALL" | "LOCAL" | "CATALOG";
  availability?: "ALL" | "INSTALLED" | "AVAILABLE";
};
export type InventoryRouteQuery = { agentId?: string; filters: InventoryQuery };
export type InventoryFiltersInput = InventoryQuery;

export type SkillSelection =
  | { kind: "LOCAL"; name: string; preload: boolean }
  | { kind: "CATALOG"; packageReleaseId: string; preload: boolean };

export type AgentConfigSnapshot = {
  mode: "CLASSIC" | "RLM_REPL" | "WRAPPED";
  portableInstructions: string;
  portableSoul: string | null;
  portableConfig: Record<string, unknown>;
  defaultSkillRefs: readonly SkillRef[];
};

export type TemplateOption = {
  packageReleaseId: string;
  name: string;
  version: string;
  digest: string;
  mode: "CLASSIC" | "RLM_REPL" | "WRAPPED";
  description: string;
  exactConfig: AgentConfigSnapshot;
  requirements: readonly { name: string; state: "SATISFIED" | "MISSING" }[];
  dependencySkills: readonly SkillRef[];
  readiness: SkillReadiness;
};

export type SafeRunnerOption = { runnerId: string; label: string; state: "AVAILABLE" | "UNAVAILABLE" };
export type SafeModelOption = { modelId: string; label: string; state: "AVAILABLE" | "UNAVAILABLE" };
export type OpaqueSecretReference = z.infer<typeof OpaqueSecretReferenceSchema>;
export type SealedSecretBinding = { requirementName: string; secretReferenceId: OpaqueSecretReference };
export type SafeSecretReference = { secretReferenceId: OpaqueSecretReference; requirementName: string; displayName: string; keyName?: string };
export type TemplateOptionsResult = { templates: readonly TemplateOption[]; runners: readonly SafeRunnerOption[]; models: readonly SafeModelOption[]; secretReferences: readonly SafeSecretReference[] };
type InternalSecretReferenceClaims = { actorHumanId: string; secretId: string; purpose: "agent-provisioning"; issuedAt: number; expiresAt: number; nonce: string }; // private to the resolver module; never a public DTO
export type SecretReferenceValidation = "VALID" | "INVALID";
export type SecretReferenceResolver = {
  issue(actor: InventoryActor, secretId: string): OpaqueSecretReference;
  validate(actor: InventoryActor, secretReferenceId: OpaqueSecretReference, purpose: "agent-provisioning"): SecretReferenceValidation;
  bindForWrite(tx: SqliteImmediateTransaction, actor: InventoryActor, agentId: string, bindings: readonly SealedSecretBinding[]): void;
};
// The resolver uses the existing AEAD crypto/key seam. OpaqueSecretReferenceSchema bounds every handle to 2048 UTF-8 bytes inside the 16 KiB request body. Handles have a random nonce, expire at issuedAt + 10 minutes, are not persisted, and are absent from logs/audits. validate() may decode for preflight feedback but returns no raw ID. bindForWrite() resolves the same handle again inside the immediate persistence transaction and rechecks current actor, purpose, expiry, visibility/ownership, and decryptability immediately before binding writes. Raw secretId remains internal to bindForWrite() and never enters a public command, receipt, report, log, or audit.

export type SkillReadiness =
  | { state: "READY" }
  | { state: "BLOCKED"; blockers: readonly {
      code: "GRANT_REQUIRED" | "INSTALLATION_REQUIRED" | "INCOMPATIBLE" | "SOURCE_UNAVAILABLE" | "RUNNER_REQUIRED" | "REQUIREMENT_MISSING" | "CONFLICT";
      requirement?: string;
    }[] };

export type SkillAssignmentProjection = {
  desired: "ENABLED" | "DISABLED" | "ABSENT";
  effective: "ENABLED" | "DISABLED";
  preload: boolean;
  deployment: "STABLE" | "REQUESTED" | "DEPLOYING" | "FAILED";
  revision: number;
};

export type AdminSkillProvenance = {
  authoritySourceId: string;
  contentSourceId: string;
  catalogCommit: string;
  packageCommit: string;
  packagePath: string;
  reviewState: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  installationState: "ABSENT" | "INSTALLED" | "QUARANTINED";
  apiActivation: "NOT_REQUIRED" | "AWAITING_APPROVAL" | "APPROVED" | "REVOKED";
  grantIds: readonly string[];
};

export type SkillInventoryItem = {
  ref: SkillRef;
  description: string;
  version?: string;
  readiness: SkillReadiness;
  assignment?: SkillAssignmentProjection;
  provenance: "FULL_ADMIN" | "BOUNDED_HUMAN";
  adminProvenance?: AdminSkillProvenance;
};

export type AgentSkillInventory = { items: readonly SkillInventoryItem[]; agentRevision: number };

export type UnifiedSkillInventory = {
  list(actor: InventoryActor, filters: InventoryQuery): Promise<readonly SkillInventoryItem[]>;
  listForAgent(actor: InventoryActor, agentId: string, filters: InventoryQuery): Promise<AgentSkillInventory>;
};
```

`TrustedLocalSkillRef.trustedRootKey` remains internal to the deep module and is never serialized. No HTTP or UI projection, including admin, contains a host path. Catalog references always contain the exact `packageReleaseId` and digest. `FULL_ADMIN` is selected only from the live server actor, never a client field.

```ts
export type SkillChangeCommand =
  | { kind: "LOCAL"; operation: "ADD" | "REMOVE" | "ENABLE" | "DISABLE" | "SET_PRELOAD"; agentId: string; name: string; preload?: boolean; expectedAgentRevision: number }
  | { kind: "CATALOG"; operation: "ASSIGN" | "REMOVE" | "ENABLE" | "DISABLE" | "SET_PRELOAD"; agentId: string; packageReleaseId: string; preload?: boolean; expectedAgentRevision: number; expectedAssignmentRevision: number };

export type SkillDeploymentEvent = z.infer<typeof SkillDeploymentEventSchema>;

export type CatalogDesiredAssignment = { packageReleaseId: string; desired: "ENABLED" | "DISABLED"; preload: boolean };
export type SkillBatchResult = { agentRevision: number; assignmentRevisions: readonly number[]; catalogSetChanged: boolean; deploymentId?: string };
export declare function catalogDesiredSetChanged(before: readonly CatalogDesiredAssignment[], after: readonly CatalogDesiredAssignment[]): boolean;

export type AgentSkillManagement = {
  execute(command: SkillChangeCommand, actor: InventoryActor): Promise<SkillAssignmentProjection & { ref: SkillRef }>;
  history(agentId: string, ref: SkillRef, actor: InventoryActor): Promise<readonly SkillDeploymentEvent[]>;
  inTransaction(tx: unknown, actor: InventoryActor, commands: readonly SkillChangeCommand[], expectedAgentRevision: number): {
    recheck(): void;
    applyAll(): SkillBatchResult;
  };
};
```

```ts
export type AgentCreation =
  | { kind: "BLANK"; local: { name: string; visibility: "PUBLIC" | "PRIVATE"; mode: "CLASSIC" | "RLM_REPL" | "WRAPPED"; modelId?: string; workspacePath: string; runnerId: string; desiredState?: "RUNNING" | "STOPPED"; localSkills: readonly { name: string; preload: boolean }[]; catalogSkills: readonly { packageReleaseId: string; preload: boolean }[] } }
  | { kind: "TEMPLATE"; packageReleaseId: string; local: { name: string; visibility: "PUBLIC" | "PRIVATE"; runnerId: string; workspacePath: string; modelId?: string; secretBindings: readonly SealedSecretBinding[] }; catalogSkills: readonly { packageReleaseId: string; preload: boolean }[]; localSkills: readonly { name: string; preload: boolean }[] };

export type AgentConfigSnapshot = {
  mode: "CLASSIC" | "RLM_REPL" | "WRAPPED";
  portableInstructions: string;
  portableSoul: string | null;
  portableConfig: Record<string, unknown>;
  defaultSkillRefs: readonly SkillRef[];
};

export type ProvisionAgentHttpInput = z.infer<typeof ProvisionAgentSchema>;

export type AgentProvisioning = {
  toAgentCreation(body: ProvisionAgentHttpInput, actor: InventoryActor): AgentCreation;
  preflight(command: AgentCreation, actor: InventoryActor): Promise<{ ok: boolean; creationBlockers: readonly { code: string; item: string; detail?: string }[]; startBlockers: readonly { code: string; item: string; detail?: string }[]; exactConfig: AgentConfigSnapshot; exactSkillRefs: readonly SkillRef[] }>;
  templateOptions(actor: InventoryActor): Promise<TemplateOptionsResult>;
  create(command: AgentCreation, actor: InventoryActor): Promise<{ agentId: string; desiredState: "RUNNING" | "STOPPED"; runtimeState: "STOPPED" | "STARTING"; queuedDeploymentIds: readonly string[] }>;
};
```

### Canonical HTTP routes and DTOs

- `GET /api/skills/inventory?agentId=&q=&origin=ALL|LOCAL|CATALOG&availability=ALL|INSTALLED|AVAILABLE` accepts only those four keys. Without `agentId` it calls `list(actor, filters)` and returns `200 { items: SkillInventoryItem[] }`; with `agentId` it calls `listForAgent(actor, agentId, filters)` and returns `200 { items: SkillInventoryItem[]; agentRevision: number }` after manageability authorization.
- `GET /api/agents/:agentId/skills` accepts no query/body and returns `200 { items: SkillInventoryItem[]; agentRevision: number }`.
- `GET /api/agents/:agentId/skills/history?kind=LOCAL&name=...&localOrigin=...` or `?kind=CATALOG&packageReleaseId=...` accepts only the typed discriminated ref query and returns `200 { events: SkillDeploymentEvent[] }`; inaccessible agents/releases return the fixed non-enumerating response. There is no browser `get()` endpoint.
- `GET /api/agents/template-options` accepts no query/body and returns `200 TemplateOptionsResult`, projected by actor. `SafeSecretReference` contains only an opaque `secretReferenceId`, safe display/key names, and requirement name.
- `POST /api/agents/:agentId/skills/preflight` accepts exactly `{ selection: SkillSelection[] }`, max 64, and returns `200 { ok: boolean; exactSkillRefs: SkillRef[]; creationBlockers: { code: string; item: string; detail?: string }[]; startBlockers: { code: string; item: string; detail?: string }[] }`; it does not reserve or mutate.
- `PATCH /api/agents/:agentId/skills` accepts exactly `SkillCommandSchema` without a body `agentId` authority override and returns `200 { ref, desired, effective, preload, deployment, revision }`.
- `POST /api/agents/provision` accepts exactly the flat `ProvisionAgentSchema`; the adapter translates it into nested `AgentCreation` while preserving opaque `secretReferenceId` handles unchanged and performs no route-time resolution. It returns `201 { agentId, desiredState, runtimeState, queuedDeploymentIds }`. Any non-empty catalog selection always returns `STOPPED`/`STOPPED`. The server runs `AgentProvisioning.preflight`; the immediate write transaction repeats mutable checks and resolves the same sealed handles again through `bindForWrite()` immediately before binding writes. Creation blockers create no row, while start-only blockers permit a stopped result.
- `POST /api/agents/:agentId/start` accepts an empty body and no query, invokes the existing package-aware start gate, returns the existing start result, and maps unmet requirements to `409 REQUIREMENTS_UNSATISFIED`.
- Existing `GET /api/skills`, generic `POST/PATCH /api/agents`, `POST/PATCH /api/agents/:name`, `/api/agents/:name/catalog-skills/*`, `/api/library/*`, `/api/catalog-rollouts*`, and all `/api/catalog-sources*`/`/api/catalog-releases*` routes remain compatibility/domain adapters. They call the deep modules or retain their documented source authority; they never create a second policy graph.

Canonical mutation body schemas are strict and exact:

```ts
const SkillSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LOCAL"), name: z.string().min(1).max(64), preload: z.boolean() }).strict(),
  z.object({ kind: z.literal("CATALOG"), packageReleaseId: PackageReleaseIdSchema, preload: z.boolean() }).strict(),
]);
export type SkillSelection = z.infer<typeof SkillSelectionSchema>;
const SkillPreflightSchema = z.object({ selection: z.array(SkillSelectionSchema).min(0).max(64) }).strict();
export type SkillPreflight = z.infer<typeof SkillPreflightSchema>;
const SkillDeploymentEventSchema = z.object({
  eventId: z.string().min(1).max(200),
  operation: z.enum(["ADD", "REMOVE", "ENABLE", "DISABLE", "SET_PRELOAD", "ASSIGN"]),
  state: z.enum(["REQUESTED", "DEPLOYING", "STABLE", "FAILED", "SUPERSEDED"]),
  desiredGeneration: z.string().min(1).max(200),
  effectiveGeneration: z.string().min(1).max(200).nullable(),
  failureCode: z.enum(["DEPLOYMENT_SUPERSEDED", "INSPECTION_FAILED", "STORAGE_FAILURE"]).nullable(),
  revision: z.number().int().min(0).max(2147483647),
  createdAt: z.number().int().nonnegative(),
}).strict();


const LocalSkillSelectionSchema = z.object({ name: z.string().min(1).max(64), preload: z.boolean() }).strict();
const CatalogSkillSelectionSchema = z.object({ packageReleaseId: PackageReleaseIdSchema, preload: z.boolean() }).strict();
const ProvisionBaseSchema = z.object({ name: z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/), visibility: z.enum(["PUBLIC", "PRIVATE"]), runnerId: z.string().min(1).max(200), workspacePath: z.string().min(1).max(4096), modelId: z.string().min(1).max(200).optional() }).strict();
const OpaqueSecretReferenceSchema = z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/); // one base64url token, so characters equal UTF-8 bytes
const ProvisionAgentSchema = z.discriminatedUnion("kind", [
  ProvisionBaseSchema.extend({ kind: z.literal("BLANK"), mode: z.enum(["CLASSIC", "RLM_REPL", "WRAPPED"]), localSkills: z.array(LocalSkillSelectionSchema).max(64), catalogSkills: z.array(CatalogSkillSelectionSchema).max(64), desiredState: z.enum(["RUNNING", "STOPPED"]).optional() }).strict(),
  ProvisionBaseSchema.extend({ kind: z.literal("TEMPLATE"), packageReleaseId: PackageReleaseIdSchema, secretBindings: z.array(z.object({ requirementName: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), secretReferenceId: OpaqueSecretReferenceSchema }).strict()).max(64), localSkills: z.array(LocalSkillSelectionSchema).max(64), catalogSkills: z.array(CatalogSkillSelectionSchema).max(64) }).strict(),
]);
const SkillCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LOCAL"), operation: z.enum(["ADD", "REMOVE", "ENABLE", "DISABLE", "SET_PRELOAD"]), agentId: z.string().min(1).max(200), name: z.string().min(1).max(64), preload: z.boolean().optional(), expectedAgentRevision: z.number().int().min(1).max(2147483647) }).strict(),
  z.object({ kind: z.literal("CATALOG"), operation: z.enum(["ASSIGN", "REMOVE", "ENABLE", "DISABLE", "SET_PRELOAD"]), agentId: z.string().min(1).max(200), packageReleaseId: PackageReleaseIdSchema, preload: z.boolean().optional(), expectedAgentRevision: z.number().int().min(1).max(2147483647), expectedAssignmentRevision: z.number().int().min(0).max(2147483647) }).strict(),
]);
```

A path-level no-store middleware is mounted before `requireAuth`, so authentication failures also carry `Cache-Control: no-store`. After authentication, routes derive the live actor, parse streamed UTF-8 bodies, and call deep authorization; no body/query is accepted on routes declared empty. All canonical endpoints use the fixed error mapping: `INVALID_REQUEST=400`, `PAYLOAD_TOO_LARGE=413`, `FORBIDDEN=403`, `NOT_FOUND=404`, `REVISION_CONFLICT=409`, `STATE_CONFLICT=409`, `GRANT_REQUIRED=403`, `INSTALLATION_REQUIRED=409`, `REQUIREMENTS_UNSATISFIED=409`, `SOURCE_UNAVAILABLE=503`, `DEPLOYMENT_SUPERSEDED=409`, `STORAGE_FAILURE=500`, `SOURCE_NOT_ALLOWED=403`, `RELEASE_NOT_APPROVED=409`, `API_ACTIVATION_REQUIRED=409`, `OPERATION_IN_PROGRESS=409`, `INSPECTION_FAILED=422`, `SYNC_FAILED=502`, and `REMOVED=409`. Error bodies are `{ error: string; code: ErrorCode }` with no resource internals.

### Five-principal route matrix

| Endpoint family | Unauthenticated | Runner | Agent | Authenticated human | Administrator | Deep rule |
|---|---:|---:|---:|---:|---:|---|
| `/api/skills/inventory`, template options, agent inventory/history | 401 | 403 | 401 unsupported | 200 bounded to grants/manageability | 200 full approved/reviewed projection | Six cases are tested separately: unauthenticated, malformed/empty runner, valid global runner, valid scoped runner, human, and admin; runner headers cannot impersonate humans. |
| `POST /api/agents/provision`, skill preflight/commands | 401 | 403 | 401 unsupported | 200/201 only for permitted/manageable target | 200/201 only for permitted/manageable target | Grants authorize consumption, not Source authority; admin does not bypass target manageability. |
| `POST /api/agents/:agentId/start` | 401 | runner lifecycle protocol only | 403 | existing lifecycle policy plus start gate | same start gate | Missing secret/deployment/API activation/runner/compatibility is never bypassed. |
| `/api/catalog-sources*`, `/api/catalog-releases*`, grants/install/API activation | 401 | 403 | 401 unsupported | 403 | 200 | Existing admin gate remains; Source/release existence is not leaked to other principals. |
| `/api/library/*` privacy-safe compatibility projections | 401 | 403 | 403 | 200 bounded | 200 bounded/full only where existing adapter allows | Keep adapters server-authorized and no-store after user-ui retirement. |
| Runner package delivery routes | 401 | 200 only for the scoped valid runner header | 403 | 403 | 403 | Header precedence is resolved before session auth; runner scope binds agent/runner. |

## Task Dependencies and Interface Order

The approved execution order is **T1 → T4 → T5 → T2 → T3 → T6 → T7 → T8 → T9**. Task numbers remain stable so the task brief and commits are unambiguous; this explicit order overrides the document order. T2 is the mutation prerequisite for T3, while T4/T5 establish the read and Source UX before mutation UI. No implementation starts before T1 contracts and tests are accepted.

- Task 1 defines and tests trusted/internal versus wire refs, `InventoryActor`, `InventoryQuery`, `SkillInventoryItem`, `SkillPreflightSchema`, safe option DTOs, `UnifiedSkillInventory.listForAgent`, route DTOs, fixed error codes, and the path-level no-store read adapter. Tasks 2–7 import these exact names.
- Task 4 consumes only Task 1 read DTOs and must ship ordinary-human/admin projection tests before mutation UI; its URL identity is typed and it has no browser `get()` dependency.
- Task 5 may proceed after existing Source Library adapters are understood, but it must not import Skills policy or move routes under Skills; URL setters preserve unrelated screen keys.
- Task 2 depends on Task 1 refs and assignment projection; it defines `SkillChangeCommand`, `SkillDeploymentEvent`, `AgentSkillManagement`, its transaction-scoped helper, one atomic local batch helper, and typed history query. Task 7 and compatibility adapters consume these exact commands.
- Task 3 depends on Tasks 1–2 for exact refs and transaction-scoped helpers; it defines flat HTTP-to-nested `AgentCreation` translation, `AgentConfigSnapshot`, `TemplateOption`, `AgentProvisioning`, and creation/start blocker separation. Task 6 consumes only route/client DTOs, never internal policy.
- Task 6 depends on Tasks 1, 3, and the shared picker from Task 4; it submits flat HTTP bodies with local and catalog skills for Blank/template and renders server-provided exact config.
- Task 7 depends on Tasks 1–2 and the shared UI picker; it owns safe catalog artifact runtime files when modified, maps internal `STAGED`/`WAITING_FOR_IDLE` to public `DEPLOYING`, and tests local turn-snapshot/concurrency semantics.
- Task 8 follows Tasks 4–7 so no user-ui caller remains for old Library behavior; backend compatibility routes stay.
- Task 9 follows all implementation tasks and verifies the complete acceptance matrix, route inventory, browser behavior, documentation, exact staging, and protected-file status.

---

### Task 1: Shared strict contracts, unified inventory, and canonical read routes

**Files:**
- Create: `packages/schemas/src/unified-skills.ts`
- Modify: `packages/schemas/src/index.ts`, `packages/schemas/src/index.test.ts`
- Create: `apps/api/src/unified-skills/inventory.ts`, `apps/api/src/unified-skills/inventory.test.ts`
- Create: `apps/api/src/routes/unified-skills.ts`, `apps/api/src/routes/unified-skills.integration.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/routes/skills.ts`
- Modify: `docs/SPEC.md`

**Interfaces:**
- Consumes: existing `listSkills`, `CatalogPolicy`, `PackageReleaseViewSchema`, `CatalogAuthority`, `createCatalogConsumption` projections, `AccessControl`, and `requireAuth` from `apps/api/src/app.ts`.
- Produces: the exact contracts in “Locked Interfaces and Route Contract,” `createUnifiedSkillInventory(deps): UnifiedSkillInventory`, `registerUnifiedSkillRoutes(app, deps)`, and a legacy `GET /api/skills` adapter that returns the existing local shape from the same trusted local read source.

- [ ] **Step 1: Write the failing schema and inventory tests**

```ts
it("keeps local and catalog identity distinct and redacts bounded-human provenance", async () => {
  const inventory = createUnifiedSkillInventory(fixtureDeps({ actor: "human" }));
  const items = await inventory.list({ kind: "AUTHENTICATED_HUMAN", id: "human-user" }, { origin: "ALL", availability: "ALL" });
  expect(items).toEqual(expect.arrayContaining([
    expect.objectContaining({ ref: { kind: "LOCAL", name: "local-tool", localOrigin: "WORKSPACE" }, provenance: "BOUNDED_HUMAN" }),
    expect.objectContaining({ ref: { kind: "CATALOG", packageReleaseId: "release-skill", name: "catalog-tool", version: "1.0.0", digest: expect.stringMatching(/^sha256:/) }, provenance: "BOUNDED_HUMAN" }),
  ]));
  expect(JSON.stringify(items)).not.toContain("authoritySourceId");
  expect(JSON.stringify(items)).not.toContain("https://private.example");
});

it("shows an approved but uninstalled visible release as AVAILABLE and blocked", async () => {
  const inventory = createUnifiedSkillInventory(fixtureDeps({ actor: "human", grants: ["release-uninstalled"], installed: [] }));
  const items = await inventory.list({ kind: "AUTHENTICATED_HUMAN", id: "human-user" }, { origin: "CATALOG", availability: "AVAILABLE" });
  expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ ref: expect.objectContaining({ packageReleaseId: "release-uninstalled" }), readiness: { state: "BLOCKED", blockers: [{ code: "INSTALLATION_REQUIRED" }] } })]));
});

it("filters a revoked or ungranted release without revealing its existence", async () => {
  const inventory = createUnifiedSkillInventory(fixtureDeps({ actor: "human", grants: [] }));
  const items = await inventory.list({ kind: "AUTHENTICATED_HUMAN", id: "human-user" }, { origin: "CATALOG", availability: "ALL" });
  expect(items.some(item => item.ref.kind === "CATALOG" && item.ref.packageReleaseId === "release-hidden")).toBe(false);
});

it("is observational", async () => {
  const deps = fixtureDeps({ actor: "admin" });
  await createUnifiedSkillInventory(deps).list({ kind: "HUMAN_ADMIN", id: "human-admin" }, { origin: "ALL", availability: "ALL" });
  expect(deps.installExact).not.toHaveBeenCalled();
  expect(deps.enqueueDeployment).not.toHaveBeenCalled();
  expect(deps.createAgent).not.toHaveBeenCalled();
});

it("passes parsed filters directly to inventory with and without agent context", async () => {
  const inventory = fixtureInventory();
  await appWithInventory(inventory).request("/api/skills/inventory?q=deploy&origin=CATALOG", { headers: humanHeaders });
  expect(inventory.list).toHaveBeenCalledWith(humanActor, { query: "deploy", origin: "CATALOG", availability: "ALL" });
  await appWithInventory(inventory).request("/api/skills/inventory?agentId=agent-1&q=deploy&origin=CATALOG", { headers: humanHeaders });
  expect(inventory.listForAgent).toHaveBeenCalledWith(humanActor, "agent-1", { query: "deploy", origin: "CATALOG", availability: "ALL" });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run packages/schemas/src/index.test.ts apps/api/src/unified-skills/inventory.test.ts apps/api/src/routes/unified-skills.integration.test.ts`

Expected: FAIL because `UnifiedSkillInventory`, its schemas, the inventory factory, and canonical routes do not exist.

- [ ] **Step 3: Add the exact schemas and deep read implementation**

```ts
export const TrustedLocalSkillRefSchema = z.object({ kind: z.literal("LOCAL"), name: z.string().min(1).max(64), localOrigin: z.enum(["BUILT_IN", "WORKSPACE"]), trustedRootKey: z.string().min(1).max(128) }).strict();
export const SkillRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LOCAL"), name: z.string().min(1).max(64), localOrigin: z.enum(["BUILT_IN", "WORKSPACE"]) }).strict(),
  z.object({ kind: z.literal("CATALOG"), packageReleaseId: PackageReleaseIdSchema, name: PackageNameSchema, version: VersionSchema, digest: DigestSchema }).strict(),
]);
export const InventoryFiltersSchema = z.object({ query: z.string().max(200).optional(), origin: z.enum(["ALL", "LOCAL", "CATALOG"]).default("ALL"), availability: z.enum(["ALL", "INSTALLED", "AVAILABLE"]).default("ALL") }).strict();
export const InventoryRouteQuerySchema = z.object({ agentId: z.string().min(1).max(200).optional(), filters: InventoryFiltersSchema }).strict();
export const SkillInventoryItemSchema = z.object({ ref: SkillRefSchema, description: z.string().min(1).max(4096), version: VersionSchema.optional(), readiness: SkillReadinessSchema, assignment: SkillAssignmentProjectionSchema.optional(), provenance: z.enum(["FULL_ADMIN", "BOUNDED_HUMAN"]), adminProvenance: AdminSkillProvenanceSchema.optional() }).strict().superRefine((item, ctx) => { if (item.provenance === "FULL_ADMIN" && !item.adminProvenance) ctx.addIssue({ code: "custom", message: "admin provenance required" }); if (item.provenance === "BOUNDED_HUMAN" && item.adminProvenance) ctx.addIssue({ code: "custom", message: "bounded projection cannot contain admin provenance" }); });

export function createUnifiedSkillInventory(deps: UnifiedSkillInventoryDeps): UnifiedSkillInventory {
  async function listItems(actor: InventoryActor, agentId: string | undefined, filters: InventoryQuery) {
    const local = deps.listLocal().map(item => deps.projectLocal(item, actor));
    const catalog = deps.listCatalogSkills(actor).map(item => deps.projectCatalog(item, actor, agentId));
    return [...local, ...catalog].filter(item => matchesInventoryQuery(item, filters)).sort(compareInventoryItems);
  }
  return {
    list: (actor, filters) => listItems(actor, undefined, filters),
    async listForAgent(actor, agentId, filters = {}) {
      const agent = deps.requireManageableAgent(agentId, actor);
      return { items: await listItems(actor, agentId, filters), agentRevision: agent.revision };
    },
  };
}
```

The implementation must call `CatalogPolicy` for catalog visibility/readiness and manageability, include actor-visible approved `kind=skill` releases whether installed or not, preserve exact digest identity, classify `INSTALLED` versus `AVAILABLE`, and make uninstalled releases `INSTALLATION_REQUIRED`. `listForAgent` performs manageability authorization and returns the revision from the same deep read; the route never calls `readAgentRevision` separately. It must use the existing local `listSkills` evidence and never call installation, event-shape activation, deployment, process, or agent creation dependencies.

- [ ] **Step 4: Add the thin Hono read adapter and legacy route bridge**

```ts
app.use("/api/skills/*", noStore);
app.use("/api/agents/*/skills*", noStore);
app.get("/api/skills/inventory", requireAuth, async c => {
  const parsed: SafeParse<InventoryRouteQuery> = parseExactInventoryQuery(new URL(c.req.url).searchParams);
  if (!parsed.ok) return catalogError(c, "INVALID_REQUEST");
  const actor = inventoryActor(c);
  try {
    if (parsed.value.agentId) {
      return c.json(await inventory.listForAgent(actor, parsed.value.agentId, parsed.value.filters));
    }
    return c.json({ items: await inventory.list(actor, parsed.value.filters) });
  } catch (error) { return catalogError(c, fixedInventoryErrorCode(error)); }
});
app.get("/api/agents/:agentId/skills", requireAuth, async c => {
  if (new URL(c.req.url).search || c.req.raw.body) return catalogError(c, "INVALID_REQUEST");
  const agentId = boundedAgentId(c.req.param("agentId"));
  if (!agentId) return catalogError(c, "NOT_FOUND");
  const result = await inventory.listForAgent(inventoryActor(c), agentId, { origin: "ALL", availability: "ALL" });
  return c.json(result);
});
```

Use actual-stream UTF-8 validation for any body-bearing canonical read helper, mount `noStore` before `requireAuth` so 401/403 responses are covered, use fixed envelopes, and derive the actor after auth. Add six principal fixtures: anonymous, empty/malformed runner, valid global runner, valid scoped runner, ordinary human, and admin; assert runner-header precedence over a valid cookie and unsupported agent credentials return 401. Add typed history-query validation and assert no host path appears in any projection. Update `app.ts` composition with one inventory instance and keep `GET /api/skills` as a compatibility response over local skills only.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `npx vitest run packages/schemas/src/index.test.ts apps/api/src/unified-skills/inventory.test.ts apps/api/src/routes/unified-skills.integration.test.ts apps/api/src/app.test.ts -t "skills|runner header|auth"`

Expected: PASS, including strict unknown-query rejection, no-store, bounded-human nonenumeration, 16 KiB streamed body behavior, and inert-read assertions.

- [ ] **Step 6: Commit the task**

```bash
git add packages/schemas/src/unified-skills.ts packages/schemas/src/index.ts packages/schemas/src/index.test.ts apps/api/src/unified-skills/inventory.ts apps/api/src/unified-skills/inventory.test.ts apps/api/src/routes/unified-skills.ts apps/api/src/routes/unified-skills.integration.test.ts apps/api/src/app.ts apps/api/src/routes/skills.ts docs/SPEC.md
git commit -m "feat(skills): add unified inventory read seam"
```

---

### Task 2: Agent skill commands, normalized/local persistence, and canonical mutation adapters

**Files:**
- Create: `apps/api/src/unified-skills/management.ts`, `apps/api/src/unified-skills/management.test.ts`
- Create: `apps/api/src/routes/agent-skills.ts`, `apps/api/src/routes/agent-skills.integration.test.ts`
- Modify: `packages/schemas/src/unified-skills.ts`, `packages/schemas/src/index.ts`
- Modify: `apps/api/src/routes/catalog-library.ts`, `apps/api/src/routes/agents.ts`, `apps/api/src/app.ts`
- Modify: `apps/api/src/catalog-library/consumption.ts`, `apps/api/src/catalog-library/consumption.test.ts`, `apps/api/src/catalog-library/assignments.integration.test.ts`
- Modify: `docs/SPEC.md`

**Interfaces:**
- Consumes: `SkillRef`, `InventoryActor`, `UnifiedSkillInventory`, `agent_skill_assignments`, `CatalogPolicy`, `enqueueBoundDeployment`, and the existing audit writer.
- Produces: `createAgentSkillManagement(deps): AgentSkillManagement`, `SkillCommandSchema`, `SkillDeploymentEventSchema`, `PATCH /api/agents/:agentId/skills`, `POST /api/agents/:agentId/skills/preflight`, and history DTOs. Old `/api/agents/:name/catalog-skills/:packageReleaseId` PUT/DELETE adapters translate to `CATALOG` commands with the resolved agent ID; generic `PATCH /api/agents/:name` no longer becomes a second catalog authority.

- [ ] **Step 1: Write the failing command and route tests**

```ts
it("updates local JSON and catalog normalized assignment in one command boundary", async () => {
  const management = createAgentSkillManagement(fixtureDeps());
  const local = await management.execute({ kind: "LOCAL", operation: "ADD", agentId: "agent-1", name: "local-tool", preload: true, expectedAgentRevision: 4 }, adminActor);
  expect(local).toMatchObject({ ref: { kind: "LOCAL", name: "local-tool" }, desired: "ENABLED", effective: "ENABLED", preload: true, deployment: "STABLE" });
  expect(dbRow("agents", "enabled_skills_json")).toEqual('["local-tool"]');
  const catalog = await management.execute({ kind: "CATALOG", operation: "ASSIGN", agentId: "agent-1", packageReleaseId: "release-skill", preload: false, expectedAgentRevision: 5, expectedAssignmentRevision: 0 }, adminActor);
  expect(catalog.ref).toEqual(expect.objectContaining({ kind: "CATALOG", packageReleaseId: "release-skill" }));
  expect(dbRow("agent_skill_assignments", "release_id")).toBe("release-skill");
  expect(enqueueBoundDeployment).toHaveBeenCalledTimes(1);
});

it("keeps an active turn on its captured local snapshot while a concurrent local update becomes stable for the next turn", async () => {
  const deps = fixtureDeps({ localSkills: ["one"] });
  const turn = deps.captureTurnSnapshot("agent-1");
  await deps.management.updateLocalBatch({ agentId: "agent-1", enabled: ["two"], preloaded: [] }, adminActor);
  expect(turn.localSkills).toEqual(["one"]);
  expect(deps.readLocalDesired("agent-1")).toEqual({ enabled: ["two"], preloaded: [] });
});

it("compares exact order-independent catalog sets across release, desired state, and preload", () => {
  const before = [
    { packageReleaseId: "release-b", desired: "DISABLED" as const, preload: true },
    { packageReleaseId: "release-a", desired: "ENABLED" as const, preload: false },
  ];
  expect(catalogDesiredSetChanged(before, [...before].reverse())).toBe(false);
  expect(catalogDesiredSetChanged(before, [{ ...before[0]!, packageReleaseId: "release-c" }, before[1]!])).toBe(true);
  expect(catalogDesiredSetChanged(before, [{ ...before[0]!, desired: "ENABLED" }, before[1]!])).toBe(true);
  expect(catalogDesiredSetChanged(before, [{ ...before[0]!, preload: false }, before[1]!])).toBe(true);
});

it("enqueues exactly one empty generation when removing the last catalog assignment", async () => {
  const deps = fixtureDeps({ catalog: [{ packageReleaseId: "release-a", desired: "ENABLED", preload: false }] });
  await deps.management.execute({ kind: "CATALOG", operation: "REMOVE", agentId: "agent-1", packageReleaseId: "release-a", expectedAgentRevision: 4, expectedAssignmentRevision: 2 }, adminActor);
  expect(deps.enqueueOneCompleteGeneration).toHaveBeenCalledTimes(1);
  expect(deps.enqueueOneCompleteGeneration).toHaveBeenCalledWith(expect.anything(), []);
});

it("enqueues exactly once when disabling the last enabled catalog assignment", async () => {
  const deps = fixtureDeps({ catalog: [{ packageReleaseId: "release-a", desired: "ENABLED", preload: false }] });
  await deps.management.execute({ kind: "CATALOG", operation: "DISABLE", agentId: "agent-1", packageReleaseId: "release-a", expectedAgentRevision: 4, expectedAssignmentRevision: 2 }, adminActor);
  expect(deps.enqueueOneCompleteGeneration).toHaveBeenCalledTimes(1);
  expect(deps.enqueueOneCompleteGeneration).toHaveBeenCalledWith(expect.anything(), [{ packageReleaseId: "release-a", desired: "DISABLED", preload: false }]);
});

it("enqueues exactly once when only catalog preload changes", async () => {
  const deps = fixtureDeps({ catalog: [{ packageReleaseId: "release-a", desired: "ENABLED", preload: false }] });
  await deps.management.execute({ kind: "CATALOG", operation: "SET_PRELOAD", agentId: "agent-1", packageReleaseId: "release-a", preload: true, expectedAgentRevision: 4, expectedAssignmentRevision: 2 }, adminActor);
  expect(deps.enqueueOneCompleteGeneration).toHaveBeenCalledTimes(1);
  expect(deps.enqueueOneCompleteGeneration).toHaveBeenCalledWith(expect.anything(), [{ packageReleaseId: "release-a", desired: "ENABLED", preload: true }]);
});

it("never enqueues for a local-only batch when catalog assignments already exist", async () => {
  const deps = fixtureDeps({ catalog: [{ packageReleaseId: "release-a", desired: "ENABLED", preload: false }] });
  const result = await deps.management.execute({ kind: "LOCAL", operation: "ADD", agentId: "agent-1", name: "local-tool", preload: true, expectedAgentRevision: 4 }, adminActor);
  expect(result).toMatchObject({ desired: "ENABLED", effective: "ENABLED", deployment: "STABLE" });
  expect(deps.enqueueOneCompleteGeneration).not.toHaveBeenCalled();
});

it.each(["REVISION_CONFLICT", "FORBIDDEN", "GRANT_REQUIRED", "INSTALLATION_REQUIRED", "STATE_CONFLICT"] as const)("rejects %s without partial persistence", async code => {
  const management = createAgentSkillManagement(fixtureDeps({ failure: code }));
  await expect(management.execute({ kind: "CATALOG", operation: "ASSIGN", agentId: "hidden-agent", packageReleaseId: "release-hidden", preload: false, expectedAgentRevision: 4, expectedAssignmentRevision: 0 }, humanActor)).rejects.toMatchObject({ code });
  expect(dbCount("agent_skill_assignments")).toBe(0);
});

it("requires strict canonical mutation body and no-store", async () => {
  const response = await app.request("/api/agents/agent-1/skills", { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ kind: "LOCAL", operation: "ADD", agentId: "agent-1", name: "x", expectedAgentRevision: 1, unexpected: true }) });
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run apps/api/src/unified-skills/management.test.ts apps/api/src/routes/agent-skills.integration.test.ts`

Expected: FAIL because the command module, strict schema, canonical route, and compatibility bridge do not exist.

- [ ] **Step 3: Implement the command transaction and exact revisions**

```ts
export function catalogDesiredSetChanged(before: readonly CatalogDesiredAssignment[], after: readonly CatalogDesiredAssignment[]): boolean {
  const canonical = (set: readonly CatalogDesiredAssignment[]) => [...set]
    .sort((a, b) => a.packageReleaseId.localeCompare(b.packageReleaseId));
  const left = canonical(before);
  const right = canonical(after);
  return left.length !== right.length || left.some((entry, index) => {
    const other = right[index]!;
    return entry.packageReleaseId !== other.packageReleaseId || entry.desired !== other.desired || entry.preload !== other.preload;
  });
}

export function createAgentSkillManagement(deps: AgentSkillManagementDeps): AgentSkillManagement {
  function inTransaction(tx: SqliteImmediateTransaction, actor: InventoryActor, commands: readonly SkillChangeCommand[], expectedAgentRevision: number) {
    return {
      recheck() {
        deps.requireLiveHuman(actor);
        for (const command of commands) {
          deps.requireManageableAgent(tx, command.agentId, actor);
          deps.recheckGrantReleaseInstallRevisionAndName(tx, command);
        }
        deps.requireAgentRevision(tx, commands[0]!.agentId, expectedAgentRevision);
      },
      applyAll() {
        const agentId = commands[0]!.agentId;
        const beforeCatalog = readDesiredCatalogSet(tx, agentId);
        const finalDesired = validateAndCombineAllCommands(tx, commands, actor);
        const catalogSetChanged = catalogDesiredSetChanged(beforeCatalog, finalDesired.catalog);
        persistAllLocalAndCatalogAssignments(tx, finalDesired, actor);
        const deploymentId = catalogSetChanged ? enqueueOneCompleteGeneration(tx, finalDesired.catalog) : undefined;
        const assignmentRevisions = writeAssignmentAudits(tx, finalDesired, actor);
        return { agentRevision: incrementAgentRevision(tx, agentId), assignmentRevisions, catalogSetChanged, deploymentId };
      },
    };
  }
  async function execute(raw: SkillChangeCommand, actor: InventoryActor) {
    const command = SkillCommandSchema.parse(raw);
    return deps.db.transaction(tx => { const scoped = inTransaction(tx, actor, [command], command.expectedAgentRevision); scoped.recheck(); const batch = scoped.applyAll(); return deps.assignmentProjection(tx, command, batch); }).immediate();
  }
  return { execute, inTransaction, history: (agentId, ref, actor) => deps.readHistory(agentId, ref, actor) };
}
```

`applyAll` must validate every local and catalog command, read the exact before-set, and combine all commands into one final desired set before writing. `catalogDesiredSetChanged(before, after)` treats catalog assignments as an order-independent set keyed by exact `packageReleaseId` and compares every entry's `desired` and `preload`; the returned `SkillBatchResult.catalogSetChanged` is the sole enqueue predicate. When true, `applyAll` enqueues exactly one complete generation for the final catalog set, including an empty set after removing the last assignment. When false, it enqueues none. A local-only batch never enqueues, even if unchanged catalog assignments are present. It preserves valid local JSON with one atomic `updateLocalBatch(tx, ...)`, persists every normalized catalog assignment, and writes all assignment audits before commit. It must reject the whole batch before any write on actor/manageability/revision/grant/release/install/name failure. Local JSON remains desired/effective authority for prompt selection: committed arrays are `STABLE` for future turns, while an active turn keeps its captured snapshot; no local artifact deployment row is invented. Tests explicitly cover removal of the last catalog assignment, disabling the last enabled catalog assignment, a catalog preload-only change, and a local-only batch while catalog assignments exist. Public single-command execution delegates to `inTransaction(...,[command],...)`; there is no one-live-deployment conflict within a batch. Notifications publish only after commit.

- [ ] **Step 4: Implement canonical and compatibility route adapters**

```ts
app.use("/api/agents/*/skills*", noStore);
app.patch("/api/agents/:agentId/skills", requireAuth, async c => {
  const body = await readStrictBody(c, SkillCommandSchema);
  if (!body.ok || body.value.agentId !== c.req.param("agentId")) return catalogError(c, body.ok ? "INVALID_REQUEST" : body.code);
  try { return c.json(await management.execute(body.value, inventoryActor(c))); }
  catch (error) { return catalogError(c, fixedSkillErrorCode(error)); }
});

app.post("/api/agents/:agentId/skills/preflight", requireAuth, async c => {
  const body = await readStrictBody(c, SkillPreflightSchema);
  if (!body.ok) return catalogError(c, body.code);
  if (body.value.selection.length > 64) return catalogError(c, "INVALID_REQUEST");
  return c.json(await deps.preflight(c.req.param("agentId"), body.value.selection, inventoryActor(c)));
});
```

Add `GET /api/agents/:agentId/skills/history` with exact discriminated query parsing (`LOCAL` requires `name` and `localOrigin`; `CATALOG` requires `packageReleaseId`) and bounded event count. Translate old catalog assignment bodies `{ expectedAgentRevision, expectedAssignmentRevision, preload }` to the exact `CATALOG` command, preserving old status/error envelopes and no-store. Generic `PATCH /api/agents/:name` local-array updates must call one `updateLocalBatch(tx, ...)` helper, increment one revision, and write one audit row; it must never mutate catalog assignments. Update `consumption.ts` to delegate to management or share its transaction-scoped helpers; do not let old routes write directly.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `npx vitest run apps/api/src/unified-skills/management.test.ts apps/api/src/routes/agent-skills.integration.test.ts apps/api/src/catalog-library/consumption.test.ts apps/api/src/catalog-library/assignments.integration.test.ts`

Expected: PASS for local JSON preservation, normalized catalog storage, exact before/after `catalogSetChanged`, exactly-one empty/final catalog generation on remove-last, disable-last, and preload changes, zero generation for local-only batches with catalog rows present, revision guards, permission/nonenumeration, strict body and stream limits, no-store, compatibility route behavior, audit transactionality, and catalog desired/effective deployment separation.

- [ ] **Step 6: Commit the task**

```bash
git add packages/schemas/src/unified-skills.ts packages/schemas/src/index.ts apps/api/src/unified-skills/management.ts apps/api/src/unified-skills/management.test.ts apps/api/src/routes/agent-skills.ts apps/api/src/routes/agent-skills.integration.test.ts apps/api/src/routes/catalog-library.ts apps/api/src/routes/agents.ts apps/api/src/app.ts apps/api/src/catalog-library/consumption.ts apps/api/src/catalog-library/consumption.test.ts apps/api/src/catalog-library/assignments.integration.test.ts docs/SPEC.md
git commit -m "feat(skills): centralize agent skill commands"
```

---

### Task 3: Atomic Blank/template provisioning and stopped catalog creation

**Files:**
- Create: `apps/api/src/unified-skills/provisioning.ts`, `apps/api/src/unified-skills/provisioning.test.ts`
- Create: `apps/api/src/routes/agent-provisioning.ts`, `apps/api/src/routes/agent-provisioning.integration.test.ts`
- Modify: `packages/schemas/src/unified-skills.ts`, `packages/schemas/src/index.ts`
- Modify: `apps/api/src/catalog-library/templates.ts`, `apps/api/src/catalog-library/templates.test.ts`, `apps/api/src/catalog-library/templates.integration.test.ts`, `apps/api/src/routes/catalog-library.ts`
- Modify: `apps/api/src/routes/agents.ts`, `apps/api/src/app.ts`
- Modify: `docs/SPEC.md`

**Interfaces:**
- Consumes: flat `ProvisionAgentHttpInput`, `SecretReferenceResolver`, `AgentCreation`, `AgentConfigSnapshot`, `SkillRef`, `AgentSkillManagement.inTransaction(tx, actor, commands, expectedAgentRevision)`, `CatalogPolicy`, `createCatalogStartGate`, runner/deployment table contracts, and existing workspace path checks.
- Produces: `createAgentProvisioning(deps): AgentProvisioning`, `toAgentCreation(body, actor)`, `GET /api/agents/template-options`, `POST /api/agents/provision`, canonical preflight receipt DTOs, old template instance adapter delegation, and generic `POST /api/agents` compatibility behavior that remains local-only unless it explicitly calls provisioning.

- [ ] **Step 1: Write the failing transaction and route tests**

```ts
it("preflights every selected skill before creating any row", async () => {
  const provisioning = createAgentProvisioning(fixtureDeps({ secondSkill: "GRANT_REQUIRED" }));
  const command = templateCreation({ catalogSkills: [{ packageReleaseId: "release-ok", preload: false }, { packageReleaseId: "release-denied", preload: false }] });
  await expect(provisioning.preflight(command, humanActor)).resolves.toMatchObject({ ok: false, creationBlockers: [{ code: "GRANT_REQUIRED", item: "release-denied" }], startBlockers: [] });
  await expect(provisioning.create(command, humanActor)).rejects.toMatchObject({ code: "GRANT_REQUIRED" });
  expect(dbCount("agents")).toBe(0);
  expect(dbCount("agent_skill_assignments")).toBe(0);
});

it("uses the T2 transaction-scoped management helper for every selected skill", async () => {
  const management = createAgentSkillManagement(fixtureDeps());
  const provisioning = createAgentProvisioning(fixtureDeps({ management }));
  await provisioning.create(templateCreation({ catalogSkills: [{ packageReleaseId: "release-skill", preload: false }] }), adminActor);
  expect(management.inTransaction).toHaveBeenCalledWith(expect.anything(), adminActor, expect.arrayContaining([expect.objectContaining({ kind: "CATALOG", packageReleaseId: "release-skill" })]), expect.any(Number));
  expect(management.inTransaction.mock.results[0]!.value.recheck).toHaveBeenCalledTimes(1);
  expect(management.inTransaction.mock.results[0]!.value.applyAll).toHaveBeenCalledTimes(1);
});

it("issues bounded actor-bound sealed handles without exposing a raw identifier", () => {
  const resolver = fixtureSecretReferenceResolver({ now: 1_000 });
  const handle = resolver.issue(adminActor, "secret-1");
  expect(Buffer.byteLength(handle, "utf8")).toBeLessThanOrEqual(2048);
  expect(OpaqueSecretReferenceSchema.safeParse(handle).success).toBe(true);
  expect(OpaqueSecretReferenceSchema.safeParse("a".repeat(2048)).success).toBe(true);
  expect(OpaqueSecretReferenceSchema.safeParse("a".repeat(2049)).success).toBe(false);
  expect(ProvisionAgentSchema.safeParse(templateHttpInput({ secretBindings: [{ requirementName: "API_KEY", secretReferenceId: "a".repeat(2048) }] })).success).toBe(true);
  expect(ProvisionAgentSchema.safeParse(templateHttpInput({ secretBindings: [{ requirementName: "API_KEY", secretReferenceId: "a".repeat(2049) }] })).success).toBe(false);
  expect(resolver.validate(adminActor, handle, "agent-provisioning")).toBe("VALID");
  expect(resolver.validate(humanActor, handle, "agent-provisioning")).toBe("INVALID");
  expect(resolver.validate(adminActor, "not-a-sealed-handle", "agent-provisioning")).toBe("INVALID");
  expect(JSON.stringify(resolver.validate(adminActor, handle, "agent-provisioning"))).not.toContain("secret-1");
});

it("keeps the sealed handle unchanged in AgentCreation and does not resolve it in the route translation", () => {
  const deps = fixtureDeps();
  const handle = deps.secretReferenceResolver.issue(adminActor, "secret-1");
  const command = createAgentProvisioning(deps).toAgentCreation(templateHttpInput({ secretBindings: [{ requirementName: "API_KEY", secretReferenceId: handle }] }), adminActor);
  expect(command.kind).toBe("TEMPLATE");
  if (command.kind === "TEMPLATE") expect(command.local.secretBindings).toEqual([{ requirementName: "API_KEY", secretReferenceId: handle }]);
  expect(deps.secretReferenceResolver.validate).not.toHaveBeenCalled();
  expect(deps.secretReferenceResolver.bindForWrite).not.toHaveBeenCalled();
});

it("rejects expiry between successful preflight validation and transaction re-resolution", async () => {
  const resolver = fixtureSecretReferenceResolver({ preflightNow: 1_000, transactionNow: 601_001 });
  const handle = resolver.issue(adminActor, "secret-1");
  const deps = fixtureDeps({ secretReferenceResolver: resolver });
  const command = templateCreation({ secretBindings: [{ requirementName: "API_KEY", secretReferenceId: handle }] });
  await expect(createAgentProvisioning(deps).preflight(command, adminActor)).resolves.toMatchObject({ ok: true, creationBlockers: [] });
  await expect(createAgentProvisioning(deps).create(command, adminActor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(resolver.bindForWrite).toHaveBeenCalledTimes(1);
  expect(dbCount("agents")).toBe(0);
  expect(dbCount("agent_secret_bindings")).toBe(0);
  expect(dbCount("deployment_records")).toBe(0);
  expect(dbCount("audit_events")).toBe(0);
});

it("permits a missing secret to create stopped while keeping Start blocked", async () => {
  const command = templateCreation({ secretBindings: [] });
  await expect(createAgentProvisioning(fixtureDeps({ missingSecret: "API_KEY" })).preflight(command, adminActor)).resolves.toMatchObject({ ok: true, creationBlockers: [], startBlockers: [{ code: "REQUIREMENTS_UNSATISFIED", item: "API_KEY" }] });
  const result = await createAgentProvisioning(fixtureDeps({ missingSecret: "API_KEY" })).create(command, adminActor);
  expect(result).toMatchObject({ desiredState: "STOPPED", runtimeState: "STOPPED" });
});

it("creates all catalog selections stopped with one complete queued generation", async () => {
  const result = await createAgentProvisioning(fixtureDeps()).create(templateCreation({ catalogSkills: [{ packageReleaseId: "release-a", preload: false }, { packageReleaseId: "release-b", preload: true }] }), adminActor);
  expect(result).toMatchObject({ desiredState: "STOPPED", runtimeState: "STOPPED", queuedDeploymentIds: ["deployment-complete-set"] });
  expect(dbCount("deployment_records")).toBe(1);
  expect(dbRow("agents", "desired_state")).toBe("STOPPED");
  expect(dbRow("agents", "runtime_state")).toBe("STOPPED");
  expect(dbCount("channels")).toBe(0);
  expect(dbCount("events", "type LIKE 'agent.turn.%'")).toBe(0);
});

it("does not put a sealed handle or raw secret ID in a public receipt and leaves no staging on rollback", async () => {
  const deps = fixtureDeps({ writeFailure: true });
  const handle = deps.secretReferenceResolver.issue(adminActor, "secret-1");
  await expect(createAgentProvisioning(deps).create(templateCreation({ secretBindings: [{ requirementName: "API_KEY", secretReferenceId: handle }] }), adminActor)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  expect(dbCount("agents")).toBe(0);
  expect(JSON.stringify(deps.publicReports())).not.toContain(handle);
  expect(JSON.stringify(deps.publicReports())).not.toContain("secret-1");
  expect(await ownedStagingEntries()).toEqual([]);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run apps/api/src/unified-skills/provisioning.test.ts apps/api/src/routes/agent-provisioning.integration.test.ts`

Expected: FAIL because `AgentProvisioning`, strict provisioning schemas, and `/api/agents/provision` do not exist.

- [ ] **Step 3: Implement preflight-all-before-write and one transaction**

```ts
export function createAgentProvisioning(deps: AgentProvisioningDeps): AgentProvisioning {
  function toAgentCreation(body: ProvisionAgentHttpInput, _actor: InventoryActor): AgentCreation {
    if (body.kind === "BLANK") return {
      kind: "BLANK",
      local: { name: body.name, visibility: body.visibility, mode: body.mode, modelId: body.modelId, workspacePath: body.workspacePath, runnerId: body.runnerId, desiredState: body.desiredState, localSkills: body.localSkills, catalogSkills: body.catalogSkills },
    };
    return { kind: "TEMPLATE", packageReleaseId: body.packageReleaseId, local: { name: body.name, visibility: body.visibility, runnerId: body.runnerId, workspacePath: body.workspacePath, modelId: body.modelId, secretBindings: body.secretBindings.map(binding => ({ ...binding })) }, localSkills: body.localSkills, catalogSkills: body.catalogSkills };
  }
  async function preflight(command: AgentCreation, actor: InventoryActor) {
    const parsed = AgentCreationSchema.parse(command);
    deps.requireLiveHuman(actor);
    const invalidHandle = parsed.kind === "TEMPLATE" && parsed.local.secretBindings.some(binding =>
      deps.secretReferenceResolver.validate(actor, binding.secretReferenceId, "agent-provisioning") !== "VALID",
    );
    if (invalidHandle) throw new AgentProvisioningError("FORBIDDEN");
    const exactConfig = await deps.resolvePortableConfig(parsed, actor);
    const exactSkillRefs = await deps.resolveSkillRefs(parsed, actor);
    const { creationBlockers, startBlockers } = deps.classifyBlockers(exactConfig, exactSkillRefs, parsed, actor);
    return { ok: creationBlockers.length === 0, creationBlockers, startBlockers, exactConfig, exactSkillRefs };
  }
  async function create(command: AgentCreation, actor: InventoryActor) {
    const checked = await preflight(command, actor);
    if (checked.creationBlockers.length) throw new AgentProvisioningError(checked.creationBlockers[0]!.code);
    return deps.db.immediateTransaction(tx => {
      deps.recheckCreationPolicy(tx, command, actor, checked);
      const agent = deps.insertAgent(tx, command, checked.exactConfig, checked.startBlockers);
      const commands = deps.skillCommandsForCreation(agent.id, command, checked.exactSkillRefs);
      const scoped = deps.management.inTransaction(tx, actor, commands, agent.revision);
      scoped.recheck();
      const assignments = scoped.applyAll();
      if (command.kind === "TEMPLATE") deps.secretReferenceResolver.bindForWrite(tx, actor, agent.id, command.local.secretBindings);
      deps.writeTemplateOriginRequirementsAndAudit(tx, agent, command, checked.startBlockers, assignments.assignmentRevisions);
      return deps.receipt(agent, assignments.deploymentId ? [assignments.deploymentId] : []);
    });
  }
  return { toAgentCreation, preflight, templateOptions: actor => deps.templateOptions(actor), create };
}
```

`toAgentCreation` is a shape translation only: it copies each `OpaqueSecretReference` into `SealedSecretBinding` and never calls `validate`, `bindForWrite`, or exposes a raw ID. Preflight may call `validate` to decode the handle for bounded feedback, but `AgentCreation`, blocker reports, and receipts retain no resolved identifier. The transaction must validate name uniqueness, actor ownership/visibility, runner/workspace/model bindings, template kind/mode and exact dependency closure, approved/installed/API-activated state, grants, and local/catalog name collisions. After those live checks and immediately before secret-binding writes, `bindForWrite(tx, actor, agent.id, command.local.secretBindings)` resolves the same sealed handles again and rechecks current actor, purpose `agent-provisioning`, expiry, visibility/ownership, and decryptability. Raw `secretId` is scoped entirely inside that helper, which writes the internal binding and returns `void`; it is never stored in `AgentCreation`, preflight, a public receipt/report, log, or audit. Malformed, expired (including expiry after preflight but before the transaction), wrong-actor, wrong-purpose, invisible, or undecryptable handles use the fixed nonenumerating error and roll back every agent/assignment/deployment/audit write. The transaction writes the agent, template origin, local JSON skills, normalized catalog assignments, secret bindings, audit row, and queue records atomically; audit is inserted after state writes and before commit, and notifications publish only after commit. Creation blockers fail; start-only blockers such as missing secrets are persisted as stopped readiness blockers. Any non-empty catalog selection forces `STOPPED`/`STOPPED`; Blank with no catalog selection uses the existing local contract. No channels, receipts, turn records, process, wrapper setup, or model call is created. Any catalog artifact staging is content-addressed and deleted on failure; local prompt selection is JSON-only and is not staged.

- [ ] **Step 4: Add strict provisioning routes and old-template delegation**

```ts
app.use("/api/agents/*", noStore);
app.post("/api/agents/provision", requireAuth, async c => {
  const body = await readStrictBody(c, ProvisionAgentSchema);
  if (!body.ok) return catalogError(c, body.code);
  try {
    const actor = inventoryActor(c);
    const command = provisioning.toAgentCreation(body.value, actor);
    const receipt = await provisioning.create(command, actor);
    return c.json(receipt, 201);
  } catch (error) { return catalogError(c, fixedProvisioningErrorCode(error)); }
});

app.get("/api/agents/template-options", requireAuth, async c => {
  if (new URL(c.req.url).search || c.req.raw.body) return catalogError(c, "INVALID_REQUEST");
  return c.json(await provisioning.templateOptions(inventoryActor(c)));
});
```

Keep `POST /api/library/templates/:packageReleaseId/instances` as a privacy-safe compatibility adapter that translates its flat body into nested `AgentCreation.TEMPLATE`, returns the existing `UserTemplateInstantiationResultSchema`, and never returns secret IDs, owner identity, internal channels, or hidden release details. Keep generic `POST /api/agents` local-only and explicitly preserve its old response/status behavior. `templateOptions()` returns safe runner/model/secret-reference options plus server-derived `exactConfig`; React never reconstructs portable configuration.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `npx vitest run apps/api/src/unified-skills/provisioning.test.ts apps/api/src/routes/agent-provisioning.integration.test.ts apps/api/src/catalog-library/templates.test.ts apps/api/src/catalog-library/templates.integration.test.ts apps/api/src/catalog-library/start-gate.test.ts`

Expected: PASS for exact template config, 2048-byte opaque-handle schema reuse, sealed-handle preservation through `toAgentCreation`, transaction re-resolution, expiry between preflight and transaction with full rollback, no raw ID in public commands/reports, no per-user row on selection, atomic catalog stopped creation, queued exact deployment IDs, missing-secret start blockers, staging cleanup, no runtime side effects, compatibility response redaction, and start-gate reuse.

- [ ] **Step 6: Commit the task**

```bash
git add packages/schemas/src/unified-skills.ts packages/schemas/src/index.ts apps/api/src/unified-skills/provisioning.ts apps/api/src/unified-skills/provisioning.test.ts apps/api/src/routes/agent-provisioning.ts apps/api/src/routes/agent-provisioning.integration.test.ts apps/api/src/catalog-library/templates.ts apps/api/src/catalog-library/templates.test.ts apps/api/src/catalog-library/templates.integration.test.ts apps/api/src/routes/catalog-library.ts apps/api/src/routes/agents.ts apps/api/src/app.ts docs/SPEC.md
git commit -m "feat(agents): add atomic skill-aware provisioning"
```

---

### Task 4: Admin unified Skills screen and shared inventory controller

**Files:**
- Create: `apps/admin-ui/src/unified-skills/api.ts`, `apps/admin-ui/src/unified-skills/api.test.ts`, `apps/admin-ui/src/unified-skills/state.ts`, `apps/admin-ui/src/unified-skills/state.test.ts`, `apps/admin-ui/src/unified-skills/unified-skills.browser.test.ts`
- Create: `apps/admin-ui/src/components/skills/UnifiedSkillPicker.tsx`, `apps/admin-ui/src/components/skills/UnifiedSkillPicker.test.tsx`
- Modify: `apps/admin-ui/src/types.ts`, `apps/admin-ui/src/screens/SkillsScreen.tsx`, `apps/admin-ui/src/screens/SkillsScreen.test.tsx`, `apps/admin-ui/src/screens/index.ts`
- Modify: `apps/admin-ui/src/App.tsx`, `apps/admin-ui/src/hooks/useOrgOpsData.ts`, `apps/admin-ui/src/api.ts`, `apps/admin-ui/src/App.test.tsx`, `apps/admin-ui/src/components/layout/Sidebar.test.tsx`

**Interfaces:**
- Consumes: canonical `GET /api/skills/inventory`, `SkillInventoryItem`, `SkillRef`, fixed errors, and existing `AuthSnapshot`.
- Produces: `createUnifiedSkillApi(fetchImpl): UnifiedSkillApi`, `createUnifiedSkillController(deps)`, picker props `{ items, selected, onChange, disabled }`, and a Skills screen that is mounted for every authenticated human but displays admin provenance/actions only when the server DTO contains `FULL_ADMIN`.

- [ ] **Step 1: Write the failing client/controller/screen tests**

```ts
it("decodes a bounded-human item and rejects admin provenance", async () => {
  const api = createUnifiedSkillApi(async () => response({ items: [{ ref: { kind: "CATALOG", packageReleaseId: "release", name: "safe", version: "1.0.0", digest }, description: "Safe", readiness: { state: "READY" }, provenance: "BOUNDED_HUMAN", adminProvenance: { authoritySourceId: "leak" } }] }));
  await expect(api.list({ origin: "ALL", availability: "ALL" })).resolves.toMatchObject({ ok: false, error: { code: "PROTOCOL" } });
});

it("dispatches agent URL context through listForAgent and retains agentRevision", async () => {
  const api = createUnifiedSkillApi(fetchFixture({ items: [], agentRevision: 7 }));
  await api.listForAgent("agent-a", { origin: "ALL", availability: "ALL" });
  expect(fetchFixture.lastUrl()).toContain("/api/agents/agent-a/skills");
  expect(fetchFixture.lastResult()).toMatchObject({ value: { agentRevision: 7 } });
});

it("keeps URL selection and clears unauthorized selection", () => {
  window.history.replaceState({}, "", "/?screen=skills&skillKind=CATALOG&packageReleaseId=release-skill&agentId=agent-a");
  const controller = createUnifiedSkillController(testControllerDeps({ response: { items: [] } }));
  expect(controller.snapshot().selection).toEqual({ skill: { kind: "CATALOG", packageReleaseId: "release-skill" }, agentId: "agent-a" });
  controller.applyUnauthorizedSelection();
  expect(new URL(window.location.href).search).toBe("?screen=skills");
});

it("renders origin, readiness, blockers, and bounded empty states", () => {
  const html = renderToStaticMarkup(<SkillsScreen state={fixtureState} actions={fixtureActions} />);
  expect(html).toContain("Local");
  expect(html).toContain("Catalog");
  expect(html).toContain("Available after installation");
  expect(html).not.toContain("https://private.example");
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run apps/admin-ui/src/unified-skills/api.test.ts apps/admin-ui/src/unified-skills/state.test.ts apps/admin-ui/src/components/skills/UnifiedSkillPicker.test.tsx apps/admin-ui/src/screens/SkillsScreen.test.tsx`

Expected: FAIL because the unified client/controller, picker, and new screen state do not exist.

- [ ] **Step 3: Implement strict client decoding and URL-aware controller**

```ts
export type UnifiedSkillApi = {
  list(filters: InventoryFiltersInput, signal?: AbortSignal): Promise<Result<{ items: SkillInventoryItem[] }>>;
  listForAgent(agentId: string, filters: InventoryFiltersInput, signal?: AbortSignal): Promise<Result<{ items: SkillInventoryItem[]; agentRevision: number }>>;
};

export function createUnifiedSkillController(deps: UnifiedSkillControllerDeps) {
  let state = initialUnifiedSkillState(readSelectionFromUrl());
  return {
    snapshot: () => state,
    async load(query: InventoryQueryInput) {
      const result = state.selection.agentId
        ? await deps.api.listForAgent(state.selection.agentId, query, state.abortController.signal)
        : await deps.api.list(query, state.abortController.signal);
      state = result.ok ? { ...state, items: result.value.items, agentRevision: "agentRevision" in result.value ? result.value.agentRevision : null, lastGoodItems: result.value.items, error: null } : { ...state, items: state.lastGoodItems, error: fixedCopy(result.error.code) };
      return state;
    },
    select(ref: SkillRefInput) {
      const url = new URL(window.location.href);
      url.searchParams.set("screen", "skills"); url.searchParams.set("skillKind", ref.kind);
      if (ref.kind === "LOCAL") { url.searchParams.set("name", ref.name); url.searchParams.set("localOrigin", ref.localOrigin); url.searchParams.delete("packageReleaseId"); }
      else { url.searchParams.set("packageReleaseId", ref.packageReleaseId); url.searchParams.delete("name"); url.searchParams.delete("localOrigin"); }
      window.history.pushState({}, "", url); state = { ...state, selection: readSelectionFromUrl() };
    },
    applyUnauthorizedSelection() {
      const url = new URL(window.location.href);
      for (const key of ["skillKind", "name", "localOrigin", "packageReleaseId", "agentId"]) url.searchParams.delete(key);
      window.history.replaceState({}, "", url); state = { ...state, selection: readSelectionFromUrl() };
    },
    dispose() { state.abortController.abort(); state = { ...state, items: [], lastGoodItems: [] }; },
  };
}
```

The API sends `credentials: "include"`, `cache: "no-store"`, no client actor kind, strict schema parses every nested value, rejects any local `path` field, and maps only fixed codes. The controller keeps search/origin/availability/readiness filters, distinguishes Installed from Available from assignment state, preserves last-good projection on transient read failures, and never optimistically claims an effective mutation. The picker displays local and catalog items uniformly while passing exact discriminated refs back to its owner; it never reconstructs portable config or uses an untyped URL string.

- [ ] **Step 4: Implement the admin-ui Skills master/detail surface**

```tsx
export function SkillsScreen({ state, actions }: SkillsScreenProps) {
  return <main className="min-w-0" aria-busy={state.busy}>
    <h1>Skills</h1>
    <p>Local skills and approved catalog skills available to this account.</p>
    <SkillFilters value={state.filters} onChange={actions.setFilters} />
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(16rem,24rem)_minmax(0,1fr)]">
      <SkillMaster items={state.items} selected={state.selection.skill} onSelect={actions.select} />
      <SkillDetail item={state.selectedItem} agentId={state.selection.agentId} admin={state.selectedItem?.provenance === "FULL_ADMIN"} />
    </div>
  </main>;
}
```

Mount Skills for ordinary authenticated humans without admin gating; keep Source Library filtering exclusively on live `isAdmin`. Preserve separate `skills` and `source-library` screens and reject stale non-admin Source selection before loading. Add browser-safe origin labels, blockers, tooltip copy for external-package permission, keyboard labels, `aria-describedby`, one live status region, and stacked 390px layout with no page overflow. `useOrgOpsData` must stop using `/api/skills` for the new screen but keep the old local response for compatibility callers until Task 8.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `npx vitest run apps/admin-ui/src/unified-skills/api.test.ts apps/admin-ui/src/unified-skills/state.test.ts apps/admin-ui/src/components/skills/UnifiedSkillPicker.test.tsx apps/admin-ui/src/screens/SkillsScreen.test.tsx apps/admin-ui/src/App.test.tsx apps/admin-ui/src/components/layout/Sidebar.test.tsx`

Expected: PASS for admin/full versus ordinary/bounded projections, URL reload/back/forward selection, invalid-selection clearing, local/catalog filters, privacy-safe errors and empty states, ordinary-human Skills access, and Source Library admin-only navigation.

- [ ] **Step 6: Commit the task**

```bash
git add apps/admin-ui/src/unified-skills/api.ts apps/admin-ui/src/unified-skills/api.test.ts apps/admin-ui/src/unified-skills/state.ts apps/admin-ui/src/unified-skills/state.test.ts apps/admin-ui/src/unified-skills/unified-skills.browser.test.ts apps/admin-ui/src/components/skills/UnifiedSkillPicker.tsx apps/admin-ui/src/components/skills/UnifiedSkillPicker.test.tsx apps/admin-ui/src/types.ts apps/admin-ui/src/screens/SkillsScreen.tsx apps/admin-ui/src/screens/SkillsScreen.test.tsx apps/admin-ui/src/screens/index.ts apps/admin-ui/src/App.tsx apps/admin-ui/src/hooks/useOrgOpsData.ts apps/admin-ui/src/api.ts apps/admin-ui/src/App.test.tsx apps/admin-ui/src/components/layout/Sidebar.test.tsx
git commit -m "feat(admin-ui): add unified skills inventory"
```

---

### Task 5: Source Library master/detail redesign and admin source lifecycle UX

**Files:**
- Modify: `apps/admin-ui/src/screens/SourceLibraryScreen.tsx`, `apps/admin-ui/src/screens/SourceLibraryScreen.test.tsx`
- Modify: `apps/admin-ui/src/catalog-library/state.ts`, `apps/admin-ui/src/catalog-library/state.test.ts`, `apps/admin-ui/src/catalog-library/api.ts`, `apps/admin-ui/src/catalog-library/api.test.ts`
- Modify: `apps/admin-ui/src/catalog-library/source-library.browser.test.ts`, `apps/admin-ui/src/App.tsx`, `apps/admin-ui/src/App.test.tsx`
- Modify: `docs/SPEC.md`

**Interfaces:**
- Consumes: existing Source Library authority/client/state contracts, `SourceView`, `PackageReleaseView`, `SyncAttemptView`, `SnapshotView`, grants, rollout DTOs, and live-admin auth check.
- Produces: URL-addressable `source` and `release` selection state, `SourceDetailTab = "OVERVIEW" | "COMPATIBILITY" | "CONTENTS" | "SECURITY" | "ACTIVITY"`, closed-by-default `AddSourceDrawer`, and Source Library behavior that keeps `createSource` authority’s immediate sync receipt and last-good data.

- [ ] **Step 1: Write the failing state and browser tests**

```ts
it("starts with no source/release selection and restores valid URL selection", async () => {
  const controller = createSourceLibraryController(testDeps({ url: "/?screen=source-library" }));
  await controller.load();
  expect(controller.snapshot().selectedSource).toBeNull();
  window.history.replaceState({}, "", "/?screen=source-library&source=source-team&release=release-skill&tab=SECURITY");
  await controller.restoreUrlSelection();
  expect(controller.snapshot().selectedSource?.sourceId).toBe("source-team");
  expect(controller.snapshot().detailTab).toBe("SECURITY");
});

it("keeps last-good source data after sync failure and deduplicates contextual errors", async () => {
  const controller = createSourceLibraryController(testDeps({ sync: { code: "SOURCE_UNAVAILABLE" } }));
  await controller.sync("source-team");
  await controller.sync("source-team");
  expect(controller.snapshot().lastGoodSnapshot?.snapshotId).toBe("snapshot-1");
  expect(controller.snapshot().contextErrors).toHaveLength(1);
  expect(controller.snapshot().contextErrors[0]).toMatchObject({ target: "source-team", code: "SOURCE_UNAVAILABLE" });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run apps/admin-ui/src/catalog-library/state.test.ts apps/admin-ui/src/screens/SourceLibraryScreen.test.tsx`

Expected: FAIL because URL selection, tabs, closed drawer, contextual error state, and master/detail rendering are not implemented.

- [ ] **Step 3: Add URL-safe state and immediate-sync drawer flow**

```ts
export type SourceDetailTab = "OVERVIEW" | "COMPATIBILITY" | "CONTENTS" | "SECURITY" | "ACTIVITY";

type SourceLibraryState = ExistingSourceLibraryState & {
  selectedSourceId: string | null;
  selectedReleaseId: string | null;
  detailTab: SourceDetailTab;
  addDrawerOpen: boolean;
  contextErrors: readonly { target: string; code: string; message: string }[];
};

async function createAndSelect(input: SourceCreate) {
  const value = await actions.createSource(input);
  if (!value) return;
  const source = value.source;
  setUrl({ source: source.sourceId, release: null, tab: "OVERVIEW" });
  state = { ...state, addDrawerOpen: false, selectedSource: source, selectedSourceId: source.sourceId, attempts: value.syncAttempt ? [value.syncAttempt] : state.attempts };
}
```

The drawer mounts no credential input while closed; before awaiting credential writes, clear username/password synchronously. Source create uses the existing authority `source.create` immediate sync receipt; when sync fails, keep the newly committed Source selected, show retry, and retain last-good snapshot/releases. Removal copy states credentials/permission reset and retention; restore does not restore them. Source and release selection are URL-addressable and invalid selections become bounded not-found/permission state, not source/release enumeration.

- [ ] **Step 4: Render five tabs with safe disclosure and responsive master/detail**

```tsx
const tabs: readonly SourceDetailTab[] = ["OVERVIEW", "COMPATIBILITY", "CONTENTS", "SECURITY", "ACTIVITY"];
return <section aria-label="Source Library" className="grid min-w-0 gap-4 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
  <SourceMaster sources={state.sources} releases={state.releases} selectedSourceId={state.selectedSourceId} onSelect={actions.selectSource} />
  <article aria-labelledby="source-detail-title" className="min-w-0">
    {state.selectedSource ? <SourceHeader source={state.selectedSource} release={state.selectedRelease} /> : <p>Select a Source or release to inspect it.</p>}
    <TabList tabs={tabs} selected={state.detailTab} onSelect={actions.selectTab} />
    {state.detailTab === "OVERVIEW" && <OverviewTab state={state} actions={actions} />}
    {state.detailTab === "COMPATIBILITY" && <CompatibilityTab release={state.selectedRelease} />}
    {state.detailTab === "CONTENTS" && <ContentsTab release={state.selectedRelease} />}
    {state.detailTab === "SECURITY" && <SecurityTab release={state.selectedRelease} source={state.selectedSource} />}
    {state.detailTab === "ACTIVITY" && <ActivityTab state={state} />}
  </article>
</section>;
```

Use bounded disclosure for commands, package permission, API activation, secret configured/absent status, immutable files, digests, and activity. Do not execute anything from Contents/Security viewing. Ensure 390px stacking, wrapped/keyboard-scrollable tabs, safe digest/path breaks, focus management, Escape/focus restoration, and one deduplicated live status region.

- [ ] **Step 5: Run focused tests and real-Chrome Source Library acceptance**

Run: `npx vitest run apps/admin-ui/src/catalog-library/api.test.ts apps/admin-ui/src/catalog-library/state.test.ts apps/admin-ui/src/screens/SourceLibraryScreen.test.tsx apps/admin-ui/src/catalog-library/source-library.browser.test.ts`

Expected: PASS with Chrome at 390px for unselected initial state, URL/back-forward selection, all five tabs, closed drawer, immediate create/sync, failed sync retry with last-good retention, contextual error dedupe, credential clearing, no XSS, focus restoration, and zero horizontal overflow.

- [ ] **Step 6: Commit the task**

```bash
git add apps/admin-ui/src/screens/SourceLibraryScreen.tsx apps/admin-ui/src/screens/SourceLibraryScreen.test.tsx apps/admin-ui/src/catalog-library/state.ts apps/admin-ui/src/catalog-library/state.test.ts apps/admin-ui/src/catalog-library/api.ts apps/admin-ui/src/catalog-library/api.test.ts apps/admin-ui/src/catalog-library/source-library.browser.test.ts apps/admin-ui/src/App.tsx apps/admin-ui/src/App.test.tsx docs/SPEC.md
git commit -m "feat(admin-ui): redesign source library workspace"
```

---

### Task 6: Create Agent Blank/template flow with unified Skills and review/start gate

**Files:**
- Modify: `apps/admin-ui/src/screens/AgentsScreen.tsx`, `apps/admin-ui/src/screens/AgentsScreen.test.tsx`
- Modify: `apps/admin-ui/src/types.ts`, `apps/admin-ui/src/App.tsx`, `apps/admin-ui/src/api.ts`, `apps/admin-ui/src/hooks/useOrgOpsData.ts`
- Modify: `apps/admin-ui/src/components/skills/UnifiedSkillPicker.tsx`, `apps/admin-ui/src/components/skills/UnifiedSkillPicker.test.tsx`
- Modify: `apps/admin-ui/src/App.test.tsx`

**Interfaces:**
- Consumes: `GET /api/agents/template-options`, `POST /api/agents/provision`, flat `ProvisionAgentSchema`, server-returned `TemplateOption.exactConfig`, `SkillRef`, and existing start-gate response. It does not depend on the existing-agent preflight route.
- Produces: staged Create Agent origin/template/bindings/skills/review controller, no row before explicit confirmation, exact local/catalog selection snapshot, and explicit stopped result/start messaging.

- [ ] **Step 1: Write the failing flow tests**

```ts
it("does not create an agent while browsing or selecting a template", async () => {
  render(<AgentsScreen {...fixtureProps()} />);
  await user.click(screen.getByRole("button", { name: "New agent" }));
  await user.click(screen.getByRole("button", { name: "Installed template" }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(fixture.onProvision).not.toHaveBeenCalled();
  expect(screen.getByText("No agent has been created yet.")).toBeInTheDocument();
});

it("submits exact refs and presents catalog creation as stopped", async () => {
  render(<AgentsScreen {...fixtureProps()} />);
  await completeTemplateSelection(user);
  await user.click(screen.getByRole("button", { name: "Create agent" }));
  expect(fixture.onProvision).toHaveBeenCalledWith(expect.objectContaining({ kind: "TEMPLATE", packageReleaseId: "release-template", catalogSkills: [{ packageReleaseId: "release-skill", preload: true }] }));
  expect(screen.getByText("Created stopped; deployment queued")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Start now" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run apps/admin-ui/src/screens/AgentsScreen.test.tsx apps/admin-ui/src/components/skills/UnifiedSkillPicker.test.tsx`

Expected: FAIL because the existing form writes generic agent JSON directly and has no Blank/template staged flow or unified local/catalog selection.

- [ ] **Step 3: Implement the staged controller and exact submission**

```ts
type CreateAgentStep = "ORIGIN" | "TEMPLATE" | "BINDINGS" | "SKILLS" | "REVIEW";
type CreationDraft = {
  origin: "BLANK" | "TEMPLATE";
  packageReleaseId?: string;
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
  mode: "CLASSIC" | "RLM_REPL" | "WRAPPED";
  modelId?: string;
  workspacePath: string;
  runnerId: string;
  desiredState?: "RUNNING" | "STOPPED";
  secretBindings: readonly SealedSecretBinding[];
  localSkills: readonly { name: string; preload: boolean }[];
  catalogSkills: readonly { packageReleaseId: string; preload: boolean }[];
};

async function submitCreation() {
  const command = draft.origin === "BLANK"
    ? { kind: "BLANK", name: draft.name, visibility: draft.visibility, mode: draft.mode, modelId: draft.modelId, workspacePath: draft.workspacePath, runnerId: draft.runnerId, desiredState: draft.desiredState, localSkills: draft.localSkills, catalogSkills: draft.catalogSkills }
    : { kind: "TEMPLATE", name: draft.name, visibility: draft.visibility, runnerId: draft.runnerId, workspacePath: draft.workspacePath, modelId: draft.modelId, packageReleaseId: draft.packageReleaseId!, secretBindings: draft.secretBindings, localSkills: draft.localSkills, catalogSkills: draft.catalogSkills };
  const receipt = await api.provision(command);
  setReceipt(receipt);
}
```

Template selection only loads safe options and the server-provided portable `exactConfig` snapshot; React stores/displays that snapshot and cannot reconstruct or edit portable fields independently. Local runner/workspace/model bindings remain top-level draft values, and secret bindings use only opaque `secretReferenceId` values. The review shows exact mode/configuration/requirements, local and catalog refs/digests, missing secret names, and “catalog selections create this agent stopped.” Blank uses the flat local contract but may include catalog skills; any non-empty catalog selection always displays stopped desired/runtime state and deployment IDs. Start is a separate action invoking the existing start gate.

- [ ] **Step 4: Wire API adapters without duplicate policy**

```ts
async function provision(command: ProvisionAgentHttpInput) {
  return postStrict<ProvisionReceipt>("/api/agents/provision", ProvisionAgentSchema, command);
}
```

The browser client sends only canonical flat bodies, uses no-store, sends only opaque `secretReferenceId` selectors, treats `REQUIREMENTS_UNSATISFIED`, `GRANT_REQUIRED`, `INSTALLATION_REQUIRED`, `REVISION_CONFLICT`, and `STORAGE_FAILURE` as fixed contextual states, and never sends secret storage IDs or values. The review derives visible blockers from template options and inventory; the server repeats `AgentProvisioning.preflight` inside `POST /api/agents/provision`, returning a bounded fixed error without creating a row when the final check fails. Remove direct `enabledSkills`/`alwaysPreloadedSkills` catalog construction from the new flow; retain generic fields only for old Blank compatibility if the deep adapter receives a local-only command.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `npx vitest run apps/admin-ui/src/screens/AgentsScreen.test.tsx apps/admin-ui/src/components/skills/UnifiedSkillPicker.test.tsx apps/admin-ui/src/App.test.tsx`

Expected: PASS for Blank/template selection, cancel-without-row, exact template config, local/catalog skill selection, server-returned blockers, stopped catalog receipts, missing-secret presentation without values, and separate Start visibility.

- [ ] **Step 6: Commit the task**

```bash
git add apps/admin-ui/src/screens/AgentsScreen.tsx apps/admin-ui/src/screens/AgentsScreen.test.tsx apps/admin-ui/src/types.ts apps/admin-ui/src/App.tsx apps/admin-ui/src/api.ts apps/admin-ui/src/hooks/useOrgOpsData.ts apps/admin-ui/src/components/skills/UnifiedSkillPicker.tsx apps/admin-ui/src/components/skills/UnifiedSkillPicker.test.tsx apps/admin-ui/src/App.test.tsx
git commit -m "feat(admin-ui): add staged agent provisioning flow"
```

---

### Task 7: Existing-agent Skills tab, assignment history, and safe deployment status

**Files:**
- Create: `apps/admin-ui/src/screens/AgentSkillsTab.tsx`, `apps/admin-ui/src/screens/AgentSkillsTab.test.tsx`
- Modify: `apps/admin-ui/src/screens/AgentsScreen.tsx`, `apps/admin-ui/src/screens/AgentsScreen.test.tsx`, `apps/admin-ui/src/screens/index.ts`
- Modify: `apps/admin-ui/src/unified-skills/api.ts`, `apps/admin-ui/src/unified-skills/state.ts`, `apps/admin-ui/src/types.ts`
- Modify: `apps/agent-runner/src/runtime-generation.ts`, `apps/agent-runner/src/package-delivery.ts`, `apps/agent-runner/src/channel-loop.ts` only if catalog artifact behavior changes, plus their tests
- Modify: `apps/agent-runner/src/runtime-generation.test.ts`, `apps/agent-runner/src/package-delivery.test.ts`, `apps/agent-runner/src/channel-loop.test.ts`, `apps/agent-runner/src/turn-executor.test.ts`, `apps/api/src/catalog-library/runner-delivery.test.ts`, `apps/api/src/catalog-library/rollout.test.ts`
- Modify: `docs/SPEC.md`

**Interfaces:**
- Consumes: `UnifiedSkillInventory.listForAgent(actor, agentId, filters)`, `AgentSkillManagement.execute/history`, canonical agent-skill routes, the existing channel-loop/turn-executor captured-agent snapshot seam, and current runner delivery protocol.
- Produces: existing-agent Skills tab with add/enable/disable/remove/preload-later, immediate local desired=effective `STABLE` state for future turns, catalog desired/effective/deployment states, bounded history, retry/supersession copy, and catalog runner-generation invariants across every channel.

- [ ] **Step 1: Write failing UI and runtime tests**

```ts
it("shows desired/effective state and sends revisions for local and catalog changes", async () => {
  render(<AgentSkillsTab {...fixtureProps({ agentRevision: 8, items: [localItem, catalogItem] })} />);
  await user.click(screen.getByRole("checkbox", { name: "Enable catalog-tool" }));
  expect(fixture.execute).toHaveBeenCalledWith(expect.objectContaining({ kind: "CATALOG", operation: "ASSIGN", agentId: "agent-1", packageReleaseId: "release-skill", expectedAgentRevision: 8, expectedAssignmentRevision: 3 }));
  expect(screen.getByText("Waiting for agent to become idle")).toBeInTheDocument();
  expect(screen.getByText("DEPLOYING")).toBeInTheDocument();
});

it("keeps local JSON changes out of an active channel turn and uses them for a newly dispatched turn", async () => {
  const captureStarted = deferred();
  const releaseFirst = deferred();
  const observations: string[][] = [];
  const fixtureManagement = createAgentSkillManagement(fixtureDeps());
  const manager = createChannelLoopManager({
    captureForTurn: async agentId => { captureStarted.resolve(); await releaseFirst.promise; return { agentId, generation: Object.freeze({ generation: "local", skillRoot: "/skills", promptRoot: "/skills", eventShapeRoot: "/skills" }), release() {} }; },
    processBatch: async agent => { observations.push([...(agent.enabledSkills ?? [])]); },
  });
  const oldAgent = testAgent("agent-a", ["skill-old"]);
  manager.enqueue(oldAgent, [testEvent("event-old")]);
  await captureStarted.promise;
  await fixtureManagement.updateLocalBatch({ agentId: "agent-a", enabled: ["skill-new"], preloaded: [] }, adminActor);
  releaseFirst.resolve();
  await waitFor(() => manager.activeWorkerCount() === 0, "first channel turn did not finish");
  manager.enqueue(testAgent("agent-a", ["skill-new"]), [testEvent("event-new")]);
  await waitFor(() => manager.activeWorkerCount() === 0, "new channel turn did not finish");
  expect(observations).toEqual([["skill-old"], ["skill-new"]]);
});

it("never exposes the new generation to a turn holding the old lease", async () => {
  const runtime = createAgentRuntimeGeneration(testRuntimeDeps());
  const lease = await runtime.captureForTurn("agent-1");
  const staged = await runtime.stage(deploymentB, artifactB);
  const activation = runtime.activateWhenIdle(staged);
  expect((await runtime.captureForTurn("agent-1")).generation.generation).toBe(lease.generation.generation);
  lease.release();
  await activation;
  expect((await runtime.captureForTurn("agent-1")).generation.generation).toBe("generation-b");
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run apps/admin-ui/src/screens/AgentSkillsTab.test.tsx apps/agent-runner/src/runtime-generation.test.ts apps/agent-runner/src/package-delivery.test.ts apps/agent-runner/src/channel-loop.test.ts`

Expected: FAIL because the Agent Skills tab/history controller and complete safe-boundary assertions are not yet wired to the canonical command seam.

- [ ] **Step 3: Implement the shared tab/controller**

```tsx
export function AgentSkillsTab({ agentId, inventory, management, onReload }: AgentSkillsTabProps) {
  return <section aria-labelledby="agent-skills-title" aria-busy={inventory.busy}>
    <h3 id="agent-skills-title">Skills</h3>
    <UnifiedSkillPicker items={inventory.items} selected={inventory.selected} onChange={management.stageSelection} />
    {inventory.items.map(item => <SkillAssignmentRow key={skillKey(item.ref)} item={item} onChange={management.execute} />)}
    <DeploymentHistory events={inventory.history} />
    <button type="button" onClick={onReload}>Reload</button>
  </section>;
}
```

All commands include the current agent revision and catalog assignment revision. Local and catalog operations use the same controller but persist through separate authorities. Successful local JSON actions immediately show desired=effective and `STABLE` for future turns while the captured active turn remains unchanged. Catalog disable actions do not claim effective state before deployment; failed/superseded catalog operations preserve the prior effective generation and show fixed code copy. “Preload later” changes desired preload without implicitly enabling a skill. Removal retains audit/history and only removes this agent’s assignment.

- [ ] **Step 4: Verify runner generation and all-channel boundary invariants**

Extend the catalog artifact runtime files only where an existing invariant is missing: stage content-addressed complete roots, verify semantic/package digests, report internal `STAGED` then `WAITING_FOR_IDLE` while mapping both to public `DEPLOYING`, wait for all `runner_deployment_participants`/channel leases, atomically activate, and delete owned staging on failed activation. Local enabled/preload JSON is not staged or deployed; the existing channel-loop/turn-executor seam captures the local prompt/config snapshot and concurrent committed changes are stable for future turns. Add tests that a failed catalog deployment leaves the old root, a newer request supersedes an older one, local updates do not lose writes, and turn executors use one captured generation for prompt, event-shapes, and filesystem roots. Never change runner host assignment semantics or wake agents from channel-less audit events.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run apps/admin-ui/src/screens/AgentSkillsTab.test.tsx apps/admin-ui/src/screens/AgentsScreen.test.tsx apps/agent-runner/src/runtime-generation.test.ts apps/agent-runner/src/package-delivery.test.ts apps/agent-runner/src/channel-loop.test.ts apps/agent-runner/src/turn-executor.test.ts apps/api/src/catalog-library/runner-delivery.test.ts apps/api/src/catalog-library/rollout.test.ts`

Expected: PASS for local/catalog management, immediate local desired=effective `STABLE` state for future turns, unchanged captured active turns, catalog desired/effective distinction, history, revision conflict/reload, failed catalog deployment retention, all-channel idle activation, one catalog-generation turn capture, and unchanged runner assignment/runtime semantics.

- [ ] **Step 6: Commit the task**

```bash
git add apps/admin-ui/src/screens/AgentSkillsTab.tsx apps/admin-ui/src/screens/AgentSkillsTab.test.tsx apps/admin-ui/src/screens/AgentsScreen.tsx apps/admin-ui/src/screens/AgentsScreen.test.tsx apps/admin-ui/src/screens/index.ts apps/admin-ui/src/unified-skills/api.ts apps/admin-ui/src/unified-skills/state.ts apps/admin-ui/src/types.ts apps/admin-ui/src/unified-skills/unified-skills.browser.test.ts apps/agent-runner/src/runtime-generation.ts apps/agent-runner/src/runtime-generation.test.ts apps/agent-runner/src/package-delivery.ts apps/agent-runner/src/package-delivery.test.ts apps/agent-runner/src/channel-loop.ts apps/agent-runner/src/channel-loop.test.ts apps/agent-runner/src/turn-executor.test.ts apps/api/src/catalog-library/runner-delivery.test.ts apps/api/src/catalog-library/rollout.test.ts docs/SPEC.md
git commit -m "feat(admin-ui): manage skills on existing agents"
```

---

### Task 8: Retire user-ui Library while retaining privacy-safe backend adapters

**Files:**
- Modify: `apps/user-ui/src/App.tsx`, `apps/user-ui/src/App.test.tsx`, `apps/user-ui/src/styles.css`
- Delete: `apps/user-ui/src/LibraryScreen.tsx`, `apps/user-ui/src/LibraryScreen.test.tsx`, `apps/user-ui/src/library/api.ts`, `apps/user-ui/src/library/api.test.ts`, `apps/user-ui/src/library/state.ts`, `apps/user-ui/src/library/state.test.ts`, `apps/user-ui/src/library/library.browser.test.ts`
- Modify: `apps/api/src/routes/catalog-library.ts`, `apps/api/src/catalog-library/library.integration.test.ts`, `apps/api/src/catalog-library/templates.integration.test.ts`, `apps/api/src/catalog-library/assignments.integration.test.ts`
- Modify: `docs/SPEC.md`

**Interfaces:**
- Consumes: admin-ui canonical Skills/provisioning paths and existing server-authorized `/api/library/*` DTOs.
- Produces: `/library` and old Library navigation returning to the normal user conversation workspace without opening admin Skills, no user-ui Library management imports, and retained privacy-safe backend compatibility routes with explicit non-UI documentation.

- [ ] **Step 1: Write the failing retirement and compatibility tests**

```ts
it("routes the retired user Library URL to conversations", () => {
  window.history.replaceState({}, "", "/library");
  render(<App />);
  expect(screen.getByRole("navigation", { name: "Main navigation" })).toHaveTextContent("Conversations");
  expect(screen.queryByRole("heading", { name: "Library" })).not.toBeInTheDocument();
});

it("keeps privacy-safe backend package projection without exposing source metadata", async () => {
  const response = await app.request("/api/library/packages", { headers: ordinaryHumanHeaders });
  expect(response.status).toBe(200);
  expect(JSON.stringify(await response.json())).not.toMatch(/source|credential|artifact|reviewer|private/i);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run apps/user-ui/src/App.test.tsx apps/user-ui/src/LibraryScreen.test.tsx apps/user-ui/src/library/api.test.ts apps/user-ui/src/library/state.test.ts apps/api/src/catalog-library/library.integration.test.ts`

Expected: FAIL because `/library` still mounts `LibraryScreen`, user-ui imports the old controller, and the retirement assertions do not exist.

- [ ] **Step 3: Remove the user-ui Library caller and route to conversations**

```tsx
const initialScreen = window.location.pathname.replace(/^\/+|\/+$/g, "") === "library" ? "conversations" : "conversations";
const [activeScreen, setActiveScreen] = useState<"conversations">(initialScreen);

function showConversations() {
  window.history.replaceState({}, "", "/");
  setActiveScreen("conversations");
}
```

Remove `LibraryScreen`, its controller/API imports and state effects, its navigation button, and library-only styles. Preserve ordinary conversation deep-link behavior and sign-out/password-change behavior. Do not redirect `/library` to admin `/skills`; user-ui and admin-ui remain separate applications.

- [ ] **Step 4: Preserve backend compatibility and add retirement assertions**

Keep `GET /api/library/packages`, safe detail, manageable-agent projection, template options/instance compatibility, catalog assignment, and rollout routes server-authorized, strict, no-store, fixed-error, bounded, and privacy-safe; mount their no-store middleware before auth. Add a source-level test before building that no user-ui module imports the retired Library screen and that old routes continue to return their existing DTOs/statuses for six principal cases. After the build, inspect the emitted asset manifest/chunks and assert no retired Library screen or management control is present.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run apps/user-ui/src/App.test.tsx apps/api/src/catalog-library/library.integration.test.ts apps/api/src/catalog-library/templates.integration.test.ts apps/api/src/catalog-library/assignments.integration.test.ts && npm run --workspace @orgops/user-ui lint && npm run --workspace @orgops/user-ui build && ! grep -R -E "LibraryScreen|library-management|Assign skill|Create from template" apps/user-ui/dist`

Expected: PASS; `/library` is the conversation workspace, no user-ui skill controls remain, privacy-safe backend adapters continue to work, and no package/source metadata leaks.

- [ ] **Step 6: Commit the task**

```bash
git add apps/user-ui/src/App.tsx apps/user-ui/src/App.test.tsx apps/user-ui/src/styles.css apps/user-ui/src/LibraryScreen.tsx apps/user-ui/src/LibraryScreen.test.tsx apps/user-ui/src/library apps/api/src/routes/catalog-library.ts apps/api/src/catalog-library/library.integration.test.ts apps/api/src/catalog-library/templates.integration.test.ts apps/api/src/catalog-library/assignments.integration.test.ts docs/SPEC.md
git commit -m "refactor(user-ui): retire library management surface"
```

---

### Task 9: Route inventory, security regression, documentation, and real-Chrome acceptance

**Files:**
- Create: `apps/api/src/routes/unified-skills.surface.test.ts`
- Create: `apps/admin-ui/src/screens/create-agent.browser.test.ts`
- Modify: `apps/api/src/app.test.ts`, `apps/api/src/routes/unified-skills.integration.test.ts`, `apps/api/src/routes/agent-skills.integration.test.ts`, `apps/api/src/routes/agent-provisioning.integration.test.ts`, `apps/admin-ui/src/App.test.tsx`, `apps/admin-ui/src/catalog-library/source-library.browser.test.ts`, `docs/SPEC.md`
- Do not modify: `.superpowers/`, `docs/research/installer-signing.md`, `docs/research/pi-developer-powerups.md`

**Interfaces:**
- Consumes: every canonical/compatibility route and DTO from Tasks 1–8, the five-principal matrix, fixed error map, browser controllers, and existing real-Chrome test harness using `playwright-core` and `ORGOPS_BROWSER_EXECUTABLE`.
- Produces: one route-surface inventory test, complete security/privacy/runtime regression evidence, updated `docs/SPEC.md`, and acceptance commands for fresh/upgraded databases and desktop/390px Chrome.

- [ ] **Step 1: Write the failing route-surface and acceptance tests**

```ts
it.each([
  ["GET", "/api/skills/inventory"],
  ["GET", "/api/agents/agent-1/skills"],
  ["GET", "/api/agents/template-options"],
  ["POST", "/api/agents/provision"],
  ["PATCH", "/api/agents/agent-1/skills"],
  ["POST", "/api/agents/agent-1/skills/preflight"],
  ["POST", "/api/agents/agent-1/start"],
] as const)("has an explicit authenticated route surface for %s %s", async (method, path) => {
  const response = await app.request(path, { method, headers: method === "GET" ? {} : jsonHeaders, body: method === "GET" ? undefined : "{}" });
  expect(response.status).not.toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("ordinary human cannot enumerate source or unmanageable-agent provenance", async () => {
  for (const path of ["/api/catalog-sources", "/api/catalog-releases", "/api/agents/hidden/skills", "/api/agents/agent-1/skills/history?kind=CATALOG&packageReleaseId=hidden"]) {
    const response = await app.request(path, { headers: ordinaryHumanHeaders });
    expect([403, 404]).toContain(response.status);
    expect(await response.text()).not.toMatch(/private|credential|sourceId|hidden/);
  }
});
```

- [ ] **Step 2: Run the focused RED checks**

Run: `npx vitest run apps/api/src/routes/unified-skills.surface.test.ts apps/admin-ui/src/unified-skills/unified-skills.browser.test.ts apps/admin-ui/src/screens/create-agent.browser.test.ts`

Expected: FAIL until every canonical route, browser fixture, and acceptance journey is registered.

- [ ] **Step 3: Add route inventory and security regression coverage**

```ts
const canonicalRoutes = new Set([
  "GET /api/skills/inventory", "GET /api/agents/:agentId/skills", "GET /api/agents/:agentId/skills/history",
  "GET /api/agents/template-options", "POST /api/agents/provision", "POST /api/agents/:agentId/skills/preflight",
  "PATCH /api/agents/:agentId/skills", "POST /api/agents/:agentId/start",
]);
expect(discoveredHonoRoutes()).toEqual(expect.arrayContaining([...canonicalRoutes]));
```

Cover unauthenticated, empty/malformed runner, valid global runner, valid scoped runner, ordinary human, and admin for each protected family; malformed runner precedence over a valid cookie; unsupported agent credentials returning 401; unknown fields; malformed UTF-8; actual-stream 16 KiB overflow; no-store including auth failures; fixed errors; no auth/resource enumeration; no secret/source/path/package/command leakage; compatibility `/api/skills`, old agent routes, `/api/library/*`, Source Library routes, historical origins, and retired Catalog aliases. Exercise fresh DB and upgrade DB fixtures with local skills, source releases, grants, assignments, template origins, failed sync, failed deployment, revision conflict, missing secret, revoked grant, Source removal/restore, runner reassignment, and reload during operations.

- [ ] **Step 4: Add real-Chrome admin acceptance at desktop and 390px**

Use the existing Vite/Playwright harness pattern:

```ts
const executable = process.env.ORGOPS_BROWSER_EXECUTABLE ?? "/usr/bin/google-chrome";
const browser = await chromium.launch({ executablePath: executable, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(adminUrl, { waitUntil: "domcontentloaded" });
expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
```

Verify ordinary human Skills sees only local/granted catalog items and bounded provenance, cannot Source Library or hidden agent; admin sees full inventory/readiness without moving Source Library under Skills; Source Library starts unselected, URL-preserves all five tabs, drawer closes after create receipt, immediate sync/failure/retry preserves last-good; Create Agent Blank cancels without a row, template shows exact config and exact refs, catalog result is stopped with queued deployment and Start blocked until requirements; existing-agent Skills shows local desired=effective `STABLE` immediately for future turns without changing a captured turn, and shows catalog desired/effective/deployment/history waiting for idle; old `/library` returns to conversations; focus, live status/errors, tooltips, redaction, and no overflow all pass.

- [ ] **Step 5: Update final contract documentation and run all verification commands**

Update `docs/SPEC.md` with the actual final route list, strict request/response DTOs, status/code mapping, runner-header precedence, six-case principal matrix, local/catalog persistence, audit event names and no-wake behavior, source/release compatibility routes, stopped provisioning invariant, catalog generation/turn-boundary activation versus immediate local desired=effective future-turn behavior, user-ui retirement behavior, and the superseding 043/044/045 migration decision.

Run:

```bash
npm test
npm run lint
npm run build
npx vitest run apps/api/src/routes/unified-skills.surface.test.ts apps/api/src/routes/unified-skills.integration.test.ts apps/api/src/routes/agent-skills.integration.test.ts apps/api/src/routes/agent-provisioning.integration.test.ts
npx vitest run apps/admin-ui/src/unified-skills/unified-skills.browser.test.ts apps/admin-ui/src/screens/create-agent.browser.test.ts apps/admin-ui/src/catalog-library/source-library.browser.test.ts
npm run scenario:test:catalog-source-library
```

Expected: PASS for the entire repository, every canonical route and compatibility adapter, security/runtime tests, UI builds, real Chrome at 390px and desktop, and catalog/source scenario acceptance.

- [ ] **Step 6: Commit the task**

```bash
git add apps/api/src/routes/unified-skills.surface.test.ts apps/admin-ui/src/unified-skills/unified-skills.browser.test.ts apps/admin-ui/src/screens/create-agent.browser.test.ts apps/api/src/app.test.ts apps/api/src/routes/unified-skills.integration.test.ts apps/api/src/routes/agent-skills.integration.test.ts apps/api/src/routes/agent-provisioning.integration.test.ts apps/admin-ui/src/App.test.tsx apps/admin-ui/src/catalog-library/source-library.browser.test.ts docs/SPEC.md
git commit -m "test(ui): verify unified skills and source library acceptance"
```

## Plan Self-Review

### Spec coverage checklist

- **Decision summary and information architecture:** Tasks 4–5 keep Skills and Source Library separate, admin-only Source Library, ordinary-human projection, and URL selections; Task 8 retires user-ui Library.
- **Deep modules and domain model:** Task 1 locks `SkillRef`, actor, query, readiness, item, and inventory; Task 2 locks management/change/history; Task 3 locks provisioning/config/receipt.
- **HTTP strictness/security:** Tasks 1–3 define every canonical route, strict Zod body/query DTO, streamed 16 KiB bound, no-store, fixed error/status map, auth order, runner precedence, and nonenumeration; Task 9 tests the actual Hono surface.
- **Data flows and persistence:** Task 1 reads local/catalog separately; Task 2 writes local JSON versus normalized catalog assignments, derives exact `catalogSetChanged`, enqueues one generation for every changed final catalog set including empty, and never enqueues for local-only batches; Task 3 atomically persists template origins/skills/deployments while re-resolving sealed handles in the write transaction; Task 7 verifies catalog generation activation and local captured-turn isolation.
- **Permissions:** Locked six-case matrix covers unauthenticated, malformed/empty runner, valid global runner, valid scoped runner, authenticated human, and administrator; an independent agent HTTP principal is unsupported and returns 401. Tasks 1–3 enforce it server-side and Task 9 probes it directly, including runner-scoped/header precedence.
- **Source Library:** Task 5 covers master/detail, unselected default, URL selection, five tabs, + Add drawer, immediate sync, retry, last-good data, security disclosure, grants, install/review/activation, and removal/restore copy.
- **Create Agent and existing agent lifecycle:** Tasks 3, 6, and 7 cover Blank/template choice, no row on selection, exact portable config, local/catalog Skills, stopped catalog creation, secret/start gate, assignment history, preload-later, and safe turn boundaries.
- **Runtime/event/audit invariants:** Tasks 2, 3, 7, and 9 retain channel-less `audit.catalog.*` events, no wake-up behavior, no package execution on read, no channels/turns/processes on provisioning, and old generation on failure.
- **UX/accessibility/responsive behavior:** Tasks 4–5 and 7–9 specify labels, focus/escape restoration, live regions, tooltip wording, 390px stacking, wrapped tabs, digest/path breaks, and overflow checks.
- **Migration/retirement/compatibility:** The initial no-migration ruling was superseded by migrations 043 (assignment tombstones), 044 (provision receipts), and 045 (actor-scoped composite provision identity). Local enabled/preload JSON remains desired/effective authority for future turns while active turns retain captured snapshots; catalog artifact staging remains separate. Tasks 2, 3, 8, and 9 retain existing tables/origins/routes, preserve privacy-safe `/api/library/*`, retire only user-ui callers, and require `docs/SPEC.md` updates in route/schema/runtime tasks.
- **Testing/rollout acceptance:** Every task has a real failing test, exact RED command/expected failure, implementation snippet, exact GREEN command, focused commit, and Task 9 has fresh/upgraded database and Chrome acceptance.

### Load-bearing contract ledger

- **R3:** `InventoryQuery` has no `agentId`; `/api/skills/inventory` dispatches `list(actor, filters)` without context and `listForAgent(actor, agentId, filters)` with context; both agent routes return the deep seam's `agentRevision`.
- **R4/R5/R6/R7:** Task 1 owns preflight/safe-option schemas; Task 3 owns explicit flat-to-nested `toAgentCreation(body, actor)`, which preserves `OpaqueSecretReferenceSchema` handles unchanged, plus `TemplateOptionsResult`, portable-only `exactConfig`, and only `creationBlockers`/`startBlockers`. The shared 2048-byte handle schema is reused by `ProvisionAgentSchema`; preflight returns no raw ID and `bindForWrite()` resolves the same handle again inside the immediate transaction, including expiry-between-preflight-and-write coverage.
- **R8:** Task 3's one immediate transaction calls `management.inTransaction(tx, actor, commands, expectedAgentRevision)`, then `recheck()` and `applyAll()`; provisioning does not duplicate assignment policy. `SkillBatchResult.catalogSetChanged` is derived from exact before/after catalog release ID, desired-state, and preload tuples and is the only enqueue predicate.
- **R9:** Local JSON commits set desired/effective equal and `STABLE` for future turns; the existing `channel-loop.test.ts` capture gate isolates an active immutable Agent from a newly dispatched Agent. Catalog-only runtime files are staged conditionally; no local RuntimeGeneration API is invented.
- **R15:** Task 4 creates the browser file; Task 7 may modify it; Task 9 only consumes it. Task 3 lists and stages `templates.integration.test.ts` explicitly. Exact `SkillSelectionSchema`, `SkillPreflightSchema`, `SkillDeploymentEventSchema`, `OpaqueSecretReferenceSchema`, sealed-handle resolver/binder contracts, `CatalogDesiredAssignment`, and `SkillBatchResult` are in the locked schema block.

### Placeholder and consistency scan

- A repository search found no placeholder instructions, wildcard staging commands, or unresolved choices in the task steps.
- Every later interface name is defined in the locked contract or the producing task; flat `ProvisionAgentSchema` is explicitly translated to nested `AgentCreation` without resolving its sealed handles.
- Trusted local paths never cross a wire/UI projection; typed URL refs preserve local/catalog identity; uninstalled visible releases are `AVAILABLE` with `INSTALLATION_REQUIRED`.
- Migrations 043, 044, and 045 are staged and tested for fresh databases, 042/043/044 upgrades, idempotence, preserved rows, and constraints. Local turn snapshots and the concurrent-update test cover R9; catalog artifact staging remains separately tested.
- The only plan/spec artifacts committed by this task are the two docs; `.superpowers/` and both research files remain untracked and unstaged.

### Final handoff checks

- [ ] Confirm the implementation worker starts at Task 1 and reads both this plan and the approved spec.
- [ ] Confirm each task’s focused conventional commit is separate and contains only its listed files.
- [ ] Confirm `git status --short` after every implementation task contains no protected research change and no unrelated staged file.
- [ ] Confirm final `git diff --check`, `npm test`, `npm run lint`, `npm run build`, route-surface tests, and real-Chrome tests are recorded in the release handoff.
