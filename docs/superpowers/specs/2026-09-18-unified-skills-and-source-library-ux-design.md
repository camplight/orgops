# Unified Skills and Source Library UX

**Status:** approved architectural/product design; documentation only
**Date:** 2026-09-18
**Scope:** admin-ui, user-ui retirement, catalog/skill HTTP adapters, agent creation and skill lifecycle

This specification defines the unified Skills inventory and the approved Source Library redesign. It is an implementation contract, not an implementation. Source Library remains a separate top-level navigation item; Sources are not moved under Skills.

## 1. Decision summary

1. **Source Library remains top-level and admin-only.** It is the administrative home for Sources, releases, and the package kinds a Source may contain: skills, native-agent templates, wrapped-agent templates, and API modules. It changes to a master/detail experience with an unselected-by-default **+ Add Source** drawer, an unmistakable selected Source/release header, and Overview, Compatibility, Contents, Security, and Activity tabs. Creating a Source immediately attempts sync; failure is retryable and does not discard last-good data. Selection is URL-addressable.
2. **Skills becomes the unified inventory.** It projects built-in/local skills and catalog releases with `kind=skill` into one inventory. Search, origin, version, readiness, blockers, and Installed/Available-style filters are first-class. Administrators receive full provenance; ordinary humans receive only the bounded, privacy-safe projection of local skills and catalog skills granted to them.
3. **Source Library is not nested in Skills.** Skills is a consumption and assignment inventory; Source Library is a source/release authority surface. The distinction is intentional.
4. **The user-ui Library is retired.** Its navigation and `/library` route return to the normal conversation workspace. Existing privacy-safe Library API endpoints remain as compatibility adapters where they reduce migration risk, but no user-ui screen manages skills.
5. **Admin-ui is the only skill-management UI.** Every authenticated human can open unified Skills. Administrative actions and provenance tabs are permission-gated. Ordinary humans can act only on catalog skills granted to them and agents they can manage; they can never use the screen to administer Sources or grants.
6. **Agent creation starts with Blank or an eligible template.** A template selection is only a selection until explicit instantiation. It pre-fills the exact portable mode/configuration/requirements and does not create a per-user copy merely because it appears in the inventory. The unified Skills step accepts both local and catalog skills. Any catalog template or catalog skill selection creates the agent `STOPPED`, queues exact assignments/deployments, and exposes an explicit Start action only after readiness and secrets pass.
7. **Existing agents gain a Skills tab.** It uses the same inventory and supports add/enable/disable/remove/preload-later, deployment state/history, safe catalog turn-boundary activation, and immediate local desired=effective state for future turns without changing a captured active turn.

## 2. Problem and current evidence

OrgOps currently has several representations of the same operator concept:

- `apps/admin-ui/src/screens/SkillsScreen.tsx` renders only the result of `GET /api/skills`, which is a filesystem `listSkills(SKILL_ROOT)` projection. It has no catalog identity, release, readiness, grant, deployment, or blocker model.
- `apps/admin-ui/src/screens/AgentsScreen.tsx` edits `enabledSkills` and `alwaysPreloadedSkills` as local string arrays in the agent form. It has no catalog release selection, assignment history, deployment generation, or agent-wide turn boundary. The existing create/update adapters write these local JSON columns directly.
- `apps/api/src/routes/skills.ts` exposes a single unparameterized local list route. It is intentionally shallow and does not know catalog policy or agent manageability.
- `apps/api/src/routes/catalog-library.ts` already has separate Source/release authority, privacy-safe human Library projections, template instantiation, catalog assignment, rollout, strict body parsing, `no-store`, and fixed error codes. Those are useful backend seams, but the current user Library presents package consumption outside admin-ui and the current admin Skills screen cannot consume those projections.
- `apps/admin-ui/src/screens/SourceLibraryScreen.tsx` already renders Source and release data, but Source and release lists/details are stacked rather than a durable master/detail selection. Source creation is always visible rather than a closed drawer, and the current view does not provide the five approved detail tabs.
- `apps/admin-ui/src/components/layout/Sidebar.tsx` keeps `skills` and `source-library` as distinct screens, while `apps/admin-ui/src/App.tsx` gates Source Library to a live administrator. This separation is retained.
- `apps/user-ui/src/App.tsx` has a separate `library` route and navigation item backed by `LibraryScreen.tsx`, whose actions include template creation and catalog skill assignment. That is the UI being retired; the backend projections remain useful adapters.
- `packages/schemas/src/catalogs/source-library.ts` already distinguishes `LOCAL`-style instance concerns from catalog release IDs, human-safe package projections, manageable agents, template options, rollout state, and typed fixed errors. Existing format-v1 schemas retain `catalogId` and `sourceId` for package compatibility.
- `docs/SPEC.md` and `docs/superpowers/specs/2026-09-14-catalog-source-library-design.md` establish the security boundary: installation is inert, API event-shape activation is separate, wrapped commands wait for explicit start, grants do not grant Source authority, and audit events are channel-less bookkeeping.

The failure is not a lack of screens. It is a misplaced policy boundary: each UI reconstructs part of skill identity and authorization. A deep inventory interface can hide the local/catalog split, while thin UI and HTTP adapters preserve locality, security, and runtime invariants.

## 3. Goals and non-goals

### Goals

- Give every authenticated human one understandable Skills inventory in admin-ui.
- Keep Source authority and Source/release administration in a separate admin-only Source Library.
- Make local and catalog skill references explicit in the domain while hiding that split from ordinary UI consumers.
- Preserve catalog provenance, grants, installation state, assignment history, local edits, and existing origins.
- Ensure policy is decided in deep modules rather than copied into React controllers or routes.
- Make blank/template agent creation, catalog assignment, deployment, readiness, and explicit start safe and observable.
- Retire user-ui Library without removing useful privacy-safe backend adapters.
- Preserve existing security/runtime rules: no package execution during discovery, exact release identities, no secret leakage, no partial catalog package generation during a turn, captured local turn snapshots remain immutable, and no authorization by URL or UI state.

### Non-goals

- Moving Sources under Skills or merging Source and skill domain models.
- A marketplace, automatic updates, managed future-agent policies, side-by-side conflicting local skill names, or package sandboxing.
- Changing package format-v1, Source identity, grant semantics, runner assignment, wrapped-runtime ownership, or the event-routing policy.
- Adding general RBAC.
- Creating a per-user template instance during browsing or selection.
- Making an ordinary human an administrator by granting a skill.
- Replacing the API's existing catalog authority, installation, rollout, or runner protocols; this design adds a unified adapter/depth layer above them.

## 4. Information architecture

### Admin-ui navigation

The primary navigation remains:

- **Skills** — unified inventory for all authenticated humans; admin controls are gated within the screen.
- **Agents** — agent list and create flow; each existing agent has a Skills tab.
- **Source Library** — separate top-level item visible only to administrators. It is never a child route of Skills.

The retired `Catalogs` navigation is not reintroduced. Any old admin URL that resolves to the retired Catalogs surface uses the existing compatibility response or redirects to Source Library without synthesizing a mutable Catalog model.

### Unified Skills screen

The screen is a master/detail layout:

- **Master:** search; `All`, `Installed`, and `Available` filters; `Local` and `Catalog` origin filters; readiness filter; cards/rows showing name, kind, origin, version, readiness, and blockers.
- **Detail:** selected skill summary, safe description, version/release, readiness and blockers, assignment context when an agent is selected, and permitted actions.
- **Agent context:** optional `agentId` in the URL selects an agent for management. It is a context, not a permission grant. The server rechecks manageability.
- **Admin-only detail:** full provenance, Source/release identity, digest, compatibility, installation/API activation state, grants, contents/security links, and audit/activity links. Full provenance is never returned to an ordinary human by merely hiding it with CSS.

The selected skill and optional agent context are URL-preserved. A reload or back/forward navigation restores selection when the actor remains authorized; otherwise the UI shows a bounded not-found/permission state and clears the invalid selection.

### Source Library

Source Library is a master/detail workspace:

- **Master pane:** Sources with enabled/removed state, last-good sync status, selected ref, and current snapshot timestamp. Releases can be scoped to the selected Source.
- **Detail header:** `Source name`, Source ID, release name/version when selected, and a clear selected-state indicator. The header never implies that a release is a Source.
- **Tabs:**
  - **Overview:** repository URL/ref, fixed `catalog/index.json` path, enabled state, last-good snapshot, sync state, and retry.
  - **Compatibility:** release/package compatibility, dependencies, runtime/platform constraints, and install/readiness status.
  - **Contents:** immutable file inventory, modes, sizes, digests, package kind, and dependency closure. No execution occurs from viewing.
  - **Security:** external-package permission, API event-shape activation status, wrapped command warnings, secret requirement names, and credential configured/absent state. Credential values and refs never render.
  - **Activity:** sync attempts, review/install/activation/grant history, deployment/assignment transitions, and fixed audit outcomes.
- **+ Add Source drawer:** closed by default. It collects the exact strict Source create fields. Submission creates the Source and immediately starts the first sync; the drawer closes only after the create receipt is committed, and the selected Source URL is updated. A sync failure leaves the Source selected with an inline retry action.

Source Library responsibilities remain domain-wise unchanged: Source lifecycle, source-scoped credentials, synchronization, immutable snapshots/releases, review, install, grants, API activation, and administrative audit. The redesign changes information scent and locality, not authority.

### Agent creation and existing agent management

Create Agent is a staged flow:

1. **Origin:** choose `Blank` or an eligible installed/granted native/wrapped agent template. Eligibility is computed by the server for the actor; it includes release approval, installation, grant (unless admin), compatibility, and required local bindings.
2. **Template review/configuration:** for a template, show exact mode, portable instructions/soul/configuration, requirements, dependency skills, compatibility, origin, and blockers. No agent row exists yet.
3. **Local bindings:** choose name, visibility, runner, workspace, model where the mode supports one, and permitted secret references. The UI cannot edit portable fields independently of the selected template.
4. **Skills:** use `UnifiedSkillInventory` in agent context. Local skills and eligible catalog skills are selectable. Preload is separate from enabled. The selection is an immutable submission snapshot.
5. **Review and instantiate:** show exact origin, mode/config, skill refs, release digests, blockers, and resulting desired state. Explicit confirmation creates the agent.

A blank creation uses the existing local-agent contract and does not acquire catalog content. A catalog template or any catalog skill selection has the stronger invariant: the new agent and runtime are `STOPPED`, no channels/turns/processes are created, exact assignments are persisted, and deployment work is queued. The UI shows **Start after ready** rather than auto-starting. A user can save unresolved secret bindings only when the existing agent contract allows it; Start remains blocked until the start gate passes.

Existing Agent detail gains a **Skills** tab. It uses the same inventory component/controller and exposes:

- local add/remove, enable/disable, and preload-later;
- catalog add/enable/disable/remove with exact release identity and grant checks;
- current desired/effective/deployment states;
- deployment attempt/history and last failure reason;
- a generation/readiness explanation and explicit reload/retry where appropriate.

Catalog assignment changes activate only at a safe turn boundary: existing turns retain one captured catalog generation, and no turn sees mixed markdown, event shapes, or filesystem roots. Local JSON changes commit as desired=effective with `deployment=STABLE` for future turns, while an already captured active turn remains unchanged. Removal means removing the assignment/enablement from this agent, not deleting the Source release or destroying historical provenance.

## 5. Domain model and deep module seams

The design follows codebase-design vocabulary deliberately. The high-leverage policy lives behind deep interfaces. HTTP and React remain shallow adapters. Locality is preserved where data has different authority or runtime behavior.

### 5.1 `UnifiedSkillInventory` — read module

`UnifiedSkillInventory` is the single read seam consumed by Skills, Create Agent, and Agent Skills controllers. It hides:

- filesystem `listSkills` and built-in/local metadata;
- CatalogPolicy, release approval, installation, grants, and compatibility;
- normalized catalog assignments and local JSON assignment state;
- agent manageability and runner/deployment readiness.

The trusted deep module keeps filesystem evidence separate from the wire reference. No host path is included in any HTTP or UI projection, including the administrator projection; internal provenance may retain a bounded opaque local-root key only when needed for server-side lookup.

```ts
type TrustedLocalSkillRef = {
  kind: "LOCAL";
  name: string;
  localOrigin: "BUILT_IN" | "WORKSPACE";
  trustedRootKey: string;
};

type SkillRef =
  | { kind: "LOCAL"; name: string; localOrigin: "BUILT_IN" | "WORKSPACE" }
  | { kind: "CATALOG"; packageReleaseId: string; name: string; version: string; digest: string };

type InventoryActor =
  | { kind: "HUMAN_ADMIN"; id: string }
  | { kind: "AUTHENTICATED_HUMAN"; id: string };

type InventoryQuery = {
  query?: string;
  origin?: "ALL" | "LOCAL" | "CATALOG";
  availability?: "ALL" | "INSTALLED" | "AVAILABLE";
};
type InventoryRouteQuery = { agentId?: string; filters: InventoryQuery };

type SkillReadiness =
  | { state: "READY" }
  | {
      state: "BLOCKED";
      blockers: readonly {
        code:
          | "GRANT_REQUIRED"
          | "INSTALLATION_REQUIRED"
          | "INCOMPATIBLE"
          | "SOURCE_UNAVAILABLE"
          | "RUNNER_REQUIRED"
          | "REQUIREMENT_MISSING"
          | "CONFLICT";
        requirement?: string;
      }[];
    };

type SkillAssignmentProjection = {
  desired: "ENABLED" | "DISABLED" | "ABSENT";
  effective: "ENABLED" | "DISABLED";
  preload: boolean;
  deployment: "STABLE" | "REQUESTED" | "DEPLOYING" | "FAILED";
  revision: number;
};

type SkillInventoryItem = {
  ref: SkillRef;
  description: string;
  version?: string;
  readiness: SkillReadiness;
  assignment?: SkillAssignmentProjection;
  provenance: "FULL_ADMIN" | "BOUNDED_HUMAN";
};

type AgentSkillInventory = { items: readonly SkillInventoryItem[]; agentRevision: number };

type UnifiedSkillInventory = {
  list(actor: InventoryActor, filters: InventoryQuery): Promise<readonly SkillInventoryItem[]>;
  listForAgent(actor: InventoryActor, agentId: string, filters: InventoryQuery): Promise<AgentSkillInventory>;
};
```

The admin and ordinary-human projections contain no host paths. The administrator projection may include bounded authority/content Source IDs, commit/path metadata for catalog packages, review/install/API states, grants, and historical origin; it never includes local filesystem paths. The ordinary-human projection contains only bounded package identity, description, compatibility/readiness, digest, and assignment state for a manageable agent; it omits Source URL/ref, credentials, hidden releases, raw files, commands, reviewer/principal data, and grant population. The server derives the actor from live authentication; a client cannot request `FULL_ADMIN`.

Inventory includes actor-visible approved catalog skill releases whether or not they are installed. `INSTALLED` means usable local content or installed catalog content; `AVAILABLE` means visible, approved, not-yet-installed catalog content. Assignment state is independent. An uninstalled catalog item is `BLOCKED` with `INSTALLATION_REQUIRED`.

**Invariant:** inventory listing is observational. It never installs, activates, mutates an assignment, creates an agent, fetches an external package, or starts a process.

### 5.2 `AgentSkillManagement` — command module

`AgentSkillManagement` owns all skill mutations for an existing agent. It is the only module allowed to translate a UI command into local JSON changes or normalized catalog assignment/deployment work.

```ts
type SkillChangeCommand =
  | {
      kind: "LOCAL";
      operation: "ADD" | "REMOVE" | "ENABLE" | "DISABLE" | "SET_PRELOAD";
      agentId: string;
      name: string;
      preload?: boolean;
      expectedAgentRevision: number;
    }
  | {
      kind: "CATALOG";
      operation: "ASSIGN" | "REMOVE" | "ENABLE" | "DISABLE" | "SET_PRELOAD";
      agentId: string;
      packageReleaseId: string;
      preload?: boolean;
      expectedAgentRevision: number;
      expectedAssignmentRevision: number;
    };

type SkillDeploymentEvent = {
  eventId: string;
  operation: SkillChangeCommand["operation"];
  state: "REQUESTED" | "DEPLOYING" | "STABLE" | "FAILED" | "SUPERSEDED";
  desiredGeneration: string;
  effectiveGeneration: string | null;
  failureCode: "DEPLOYMENT_SUPERSEDED" | "INSPECTION_FAILED" | "STORAGE_FAILURE" | null;
  revision: number;
  createdAt: number;
};

type CatalogDesiredAssignment = {
  packageReleaseId: string;
  desired: "ENABLED" | "DISABLED";
  preload: boolean;
};

type SkillBatchResult = {
  agentRevision: number;
  assignmentRevisions: readonly number[];
  catalogSetChanged: boolean;
  deploymentId?: string;
};

type AgentSkillManagement = {
  execute(command: SkillChangeCommand, actor: InventoryActor): Promise<SkillAssignmentProjection & { ref: SkillRef }>;
  history(agentId: string, ref: SkillRef, actor: InventoryActor): Promise<readonly SkillDeploymentEvent[]>;
  /** T2/T3 shared seam: caller owns this immediate transaction and commit. */
  inTransaction(
    tx: unknown,
    actor: InventoryActor,
    commands: readonly SkillChangeCommand[],
    expectedAgentRevision: number,
  ): {
    recheck(): void;
    applyAll(): SkillBatchResult;
  };
};

declare function catalogDesiredSetChanged(
  before: readonly CatalogDesiredAssignment[],
  after: readonly CatalogDesiredAssignment[],
): boolean;
```

The module checks actor manageability, live agent revision, grant/release/install state, local name conflicts, runner assignment, and mode compatibility. `inTransaction(...).recheck()` validates every command before any assignment write. `applyAll()` reads the exact desired catalog set before mutation, derives the complete final desired set, and computes `catalogSetChanged` by comparing canonical sets keyed by `packageReleaseId` and including `desired` plus `preload`. It persists the complete local/catalog desired set in one immediate transaction, writes assignment audits, and, if and only if `catalogSetChanged`, enqueues exactly one complete agent generation for the final catalog set—even when that after-set is empty. A local-only batch never enqueues, including when unchanged catalog assignments already exist. Public single-command execution delegates to a one-command batch. There is no one-live-deployment conflict between commands in the same batch.

Local skills remain in the existing `enabled_skills_json` and `always_preloaded_skills_json` authority for built-in/local behavior. Catalog skills remain normalized in `agent_skill_assignments`, pinned to an exact installed release and digest. The seam projects both into one inventory but never merges them into one storage column. This preserves local edit locality, catalog provenance, one-release-per-local-name conflict checks, and independent Source/grant lifecycle. Existing origins and assignments are historical records, not disposable cache entries.

**Catalog runtime invariant:** catalog assignment desired state may change before catalog effective state, but catalog effective state changes only after a verified runner deployment activates a complete new package generation at an idle turn boundary. A failed catalog deployment retains the last known-good effective state and generation. Local JSON commits are immediately desired=effective and `STABLE` for future turns; they never enqueue a package generation, and an active turn continues with its previously captured local snapshot.

### 5.3 `AgentProvisioning` — creation module

`AgentProvisioning` owns Blank/template choice, preflight, creation, assignment, and cleanup. It hides differences between local JSON and normalized catalog assignments from the route and UI.

```ts
type AgentCreation =
  | {
      kind: "BLANK";
      local: {
        name: string;
        visibility: "PUBLIC" | "PRIVATE";
        mode: "CLASSIC" | "RLM_REPL" | "WRAPPED";
        modelId?: string;
        workspacePath: string;
        runnerId: string;
        desiredState?: "RUNNING" | "STOPPED";
        localSkills: readonly { name: string; preload: boolean }[];
        catalogSkills: readonly { packageReleaseId: string; preload: boolean }[];
      };
    }
  | {
      kind: "TEMPLATE";
      packageReleaseId: string;
      local: {
        name: string;
        visibility: "PUBLIC" | "PRIVATE";
        runnerId: string;
        workspacePath: string;
        modelId?: string;
        secretBindings: readonly SealedSecretBinding[];
      };
      catalogSkills: readonly { packageReleaseId: string; preload: boolean }[];
      localSkills: readonly { name: string; preload: boolean }[];
    };

type AgentConfigSnapshot = {
  mode: "CLASSIC" | "RLM_REPL" | "WRAPPED";
  portableInstructions: string;
  portableSoul: string | null;
  portableConfig: Record<string, unknown>;
  defaultSkillRefs: readonly SkillRef[];
};

type TemplateOption = {
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

type SafeRunnerOption = { runnerId: string; label: string; state: "AVAILABLE" | "UNAVAILABLE" };
type SafeModelOption = { modelId: string; label: string; state: "AVAILABLE" | "UNAVAILABLE" };
type OpaqueSecretReference = z.infer<typeof OpaqueSecretReferenceSchema>;
type SealedSecretBinding = { requirementName: string; secretReferenceId: OpaqueSecretReference };
type SafeSecretReference = { secretReferenceId: OpaqueSecretReference; requirementName: string; displayName: string; keyName?: string };
type TemplateOptionsResult = {
  templates: readonly TemplateOption[];
  runners: readonly SafeRunnerOption[];
  models: readonly SafeModelOption[];
  secretReferences: readonly SafeSecretReference[];
};
type InternalSecretReferenceClaims = {
  actorHumanId: string;
  secretId: string;
  purpose: "agent-provisioning";
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}; // private to the resolver module; never a public DTO
type SecretReferenceValidation = "VALID" | "INVALID";
type SecretReferenceResolver = {
  issue(actor: InventoryActor, secretId: string): OpaqueSecretReference;
  validate(actor: InventoryActor, secretReferenceId: OpaqueSecretReference, purpose: "agent-provisioning"): SecretReferenceValidation;
  bindForWrite(
    tx: SqliteImmediateTransaction,
    actor: InventoryActor,
    agentId: string,
    bindings: readonly SealedSecretBinding[],
  ): void;
};
// Handles are AEAD-sealed with the existing crypto/key seam, have a random nonce, expire at issuedAt + 10 minutes, and are bounded by OpaqueSecretReferenceSchema to 2048 UTF-8 bytes inside the 16 KiB request body. They are not persisted. validate() may decode for preflight feedback but returns no raw identifier. bindForWrite() resolves the same sealed handles again inside the immediate persistence transaction, rechecking the current actor, purpose, expiry, visibility/ownership, and decryptability immediately before it writes secret bindings. The raw secretId is scoped inside bindForWrite(), is never returned to provisioning, and never enters a public command, receipt, report, log, or audit. Replay before expiry is allowed but idempotent and never bypasses revisions or policy.

type ProvisionAgentHttpInput = z.infer<typeof ProvisionAgentSchema>;

type AgentProvisioning = {
  toAgentCreation(body: ProvisionAgentHttpInput, actor: InventoryActor): AgentCreation;
  preflight(command: AgentCreation, actor: InventoryActor): Promise<{
    ok: boolean;
    exactConfig: AgentConfigSnapshot;
    exactSkillRefs: readonly SkillRef[];
    creationBlockers: readonly { code: string; item: string; detail?: string }[];
    startBlockers: readonly { code: string; item: string; detail?: string }[];
  }>;
  templateOptions(actor: InventoryActor): Promise<TemplateOptionsResult>;
  create(command: AgentCreation, actor: InventoryActor): Promise<{
    agentId: string;
    desiredState: "RUNNING" | "STOPPED";
    runtimeState: "STOPPED" | "STARTING";
    queuedDeploymentIds: readonly string[];
  }>;
};
```

Creation runs **preflight all, then write**:

1. Validate local input, uniqueness, actor ownership, runner/workspace/model bindings, mode rules, and visibility.
2. Resolve one exact template release (if any), dependency closure, compatibility, installed content, grants, requirements, and exact selected skills.
3. Check local/catalog name collisions and whether each catalog assignment can be deployed to the chosen runner.
4. Validate/decode sealed secret references for bounded preflight feedback without returning raw IDs or replacing the handles in `AgentCreation`. Missing required secrets are a blocker for Start; they do not become manifest data.
5. In the same immediate transaction used for writes, recheck the live actor, grants, release/install revisions, runner and agent-name uniqueness, every expected agent/assignment revision, and each same sealed handle. `bindForWrite()` rechecks current actor, purpose, expiry, visibility/ownership, and decryptability immediately before binding writes; stale preflight results are never trusted across this boundary.
6. In one SQLite transaction, write the agent, template origin, normalized catalog assignments, local JSON skills, requirements, secret bindings through `bindForWrite()`, and audit rows. Queue deployment records in the same transaction where possible. Insert audit rows after state writes but before commit. Raw secret IDs stay internal to the transaction helper and are absent from public commands and reports.
7. Publish dashboard/event notifications only after commit. No channel, receipt, turn, process, wrapper setup, or model call is created by provisioning.

For a catalog selection, the transaction must atomically establish `desiredState=STOPPED` and `runtimeState=STOPPED`. If any catalog assignment or origin write cannot be committed, no new agent is visible. If a filesystem staging action is needed for a deployment, it is content-addressed, owned by the operation, cleaned on failure, and the agent remains stopped; recovery reconciles durable operation records before retry. If cleanup cannot be proven, the operation fails closed and does not claim success. A later explicit Start uses the existing package-aware start gate.

### 5.4 HTTP adapters

Routes validate, authenticate, translate, and serialize. They do not decide policy, read filesystem roots, inspect catalog tables, or reproduce readiness logic. All protected responses are `Cache-Control: no-store`.

#### Canonical read routes

- `GET /api/skills/inventory` — unified inventory. Strict query keys: `agentId?`, `q?`, `origin?`, `availability?`; unknown query keys are invalid. Without `agentId`, the adapter calls `list(actor, filters)` and returns `{items}`. With `agentId`, it calls `listForAgent(actor, agentId, filters)` and returns `{items,agentRevision}` after manageability authorization.
- `GET /api/agents/:agentId/skills` — deep-authorized inventory with required agent context and `{items,agentRevision}`.
- `GET /api/agents/:agentId/skills/history` — bounded deployment/history projection for an authorized manageable agent; it accepts only the typed local/catalog reference query.
- `GET /api/agents/template-options` — actor-projected `TemplateOptionsResult` containing eligible native/wrapped templates, safe runner/model options, and authorized opaque secret-reference selectors. It includes the server-resolved portable `exactConfig` snapshot and never returns hidden releases, raw manifests, host paths, secret storage IDs, values, ciphertext, or owner IDs.
- `GET /api/catalog-sources...`, `/api/catalog-releases...`, and existing Source Library routes — remain administrator-only Source Library routes, not aliases of Skills.

#### Canonical command routes

- `POST /api/agents/provision` — strict flat discriminated Blank/template HTTP body matching `ProvisionAgentSchema`; `toAgentCreation(body, actor)` copies each opaque sealed reference unchanged into nested `AgentCreation` and performs no resolution. Preflight may validate/decode for feedback, but the same handle is resolved again only by `bindForWrite()` inside the immediate persistence transaction. The route returns a creation receipt and, for any non-empty catalog selection, explicit `STOPPED` plus queued deployment IDs. It never auto-starts.
- `PATCH /api/agents/:agentId/skills` — strict `SkillChangeCommand`, including `kind`, operation, exact local name or package release ID, expected agent revision, and expected assignment revision for catalog commands.
- `POST /api/agents/:agentId/skills/preflight` — strict selection body; read-only preflight used by the edit controller. It returns only `creationBlockers`, `startBlockers`, and exact projected refs; it does not reserve or mutate.
- `POST /api/agents/:agentId/start` or the existing agent start adapter — remains the explicit lifecycle action and invokes the same package-aware start gate. A Start response never bypasses secret, deployment, API activation, runner, or compatibility checks.

Existing `GET /api/skills`, `POST/PATCH /api/agents`, existing `/api/agents/:name/catalog-skills/*`, `/api/library/*`, and rollout routes remain compatibility adapters initially. They translate into the deep modules or preserve their current local behavior; they do not become a second authority. Existing user Library adapters remain privacy-safe and server-authorized even while no user-ui Library screen calls them.

#### Exact adapter schemas and strictness

The following are the canonical route shapes. They are Zod-style sketches whose field names, discriminators, bounds, and strictness are part of the contract; implementation may place them in the existing schemas package.

```ts
const SkillSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LOCAL"), name: z.string().min(1).max(64), preload: z.boolean() }).strict(),
  z.object({ kind: z.literal("CATALOG"), packageReleaseId: PackageReleaseIdSchema, preload: z.boolean() }).strict(),
]);
type SkillSelection = z.infer<typeof SkillSelectionSchema>;
const LocalSkillSelectionSchema = z.object({ name: z.string().min(1).max(64), preload: z.boolean() }).strict();
const CatalogSkillSelectionSchema = z.object({ packageReleaseId: PackageReleaseIdSchema, preload: z.boolean() }).strict();
const ProvisionBaseSchema = z.object({
  name: z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
  runnerId: z.string().min(1).max(200),
  workspacePath: z.string().min(1).max(4096),
  modelId: z.string().min(1).max(200).optional(),
}).strict();
const OpaqueSecretReferenceSchema = z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/); // one base64url token, so characters equal UTF-8 bytes
const ProvisionAgentSchema = z.discriminatedUnion("kind", [
  ProvisionBaseSchema.extend({
    kind: z.literal("BLANK"), mode: z.enum(["CLASSIC", "RLM_REPL", "WRAPPED"]),
    localSkills: z.array(LocalSkillSelectionSchema).max(64),
    catalogSkills: z.array(CatalogSkillSelectionSchema).max(64),
    desiredState: z.enum(["RUNNING", "STOPPED"]).optional(),
  }).strict(),
  ProvisionBaseSchema.extend({
    kind: z.literal("TEMPLATE"), packageReleaseId: PackageReleaseIdSchema,
    secretBindings: z.array(z.object({ requirementName: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), secretReferenceId: OpaqueSecretReferenceSchema }).strict()).max(64),
    localSkills: z.array(LocalSkillSelectionSchema).max(64),
    catalogSkills: z.array(CatalogSkillSelectionSchema).max(64),
  }).strict(),
]);
const SkillPreflightSchema = z.object({ selection: z.array(SkillSelectionSchema).min(0).max(64) }).strict();
type SkillPreflight = z.infer<typeof SkillPreflightSchema>;
const SkillCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LOCAL"), operation: z.enum(["ADD", "REMOVE", "ENABLE", "DISABLE", "SET_PRELOAD"]), agentId: z.string().min(1).max(200), name: z.string().min(1).max(64), preload: z.boolean().optional(), expectedAgentRevision: z.number().int().min(1).max(2147483647) }).strict(),
  z.object({ kind: z.literal("CATALOG"), operation: z.enum(["ASSIGN", "REMOVE", "ENABLE", "DISABLE", "SET_PRELOAD"]), agentId: z.string().min(1).max(200), packageReleaseId: PackageReleaseIdSchema, preload: z.boolean().optional(), expectedAgentRevision: z.number().int().min(1).max(2147483647), expectedAssignmentRevision: z.number().int().min(0).max(2147483647) }).strict(),
]);
```

`GET /api/skills/inventory` accepts only the bounded query keys `agentId`, `q`, `origin=ALL|LOCAL|CATALOG`, and `availability=ALL|INSTALLED|AVAILABLE`; an unknown key is `INVALID_REQUEST`. Without `agentId`, it calls `list(actor, filters)` and returns `{items}`. With `agentId`, it calls `listForAgent(actor, agentId, filters)` and returns `{items,agentRevision}` after manageability authorization. `GET /api/agents/:agentId/skills` accepts no query/body and returns `{items,agentRevision}`. `GET /api/agents/:agentId/skills/history` accepts exactly `kind=LOCAL&name=...&localOrigin=...` or `kind=CATALOG&packageReleaseId=...`; it has no browser `get` endpoint. `POST /api/agents/provision` accepts only the flat `ProvisionAgentSchema`; the route translates it into nested `AgentCreation` and returns `201 {agentId,desiredState,runtimeState,queuedDeploymentIds}`. `POST /api/agents/:agentId/skills/preflight` accepts `SkillPreflightSchema` with at most 64 entries and returns `200 {ok,exactSkillRefs,creationBlockers,startBlockers}` without mutation. `PATCH /api/agents/:agentId/skills` accepts only `SkillCommandSchema` and returns the bounded assignment projection. `POST /api/agents/:agentId/start` accepts an empty body and no query; it returns the existing start-gate result or `409 REQUIREMENTS_UNSATISFIED`. Path `:agentId` is bounded and is never taken from a body field.

A no-store middleware is mounted before authentication on every protected API path, so 401/403 responses are also `Cache-Control: no-store`; authentication then derives the live actor, bounded input is parsed, and the deep module authorizes. All routes use actual-stream UTF-8 body limits (16 KiB maximum, smaller limits for selection/history where appropriate), reject unknown fields, and never reveal hidden agent/release existence.

#### Strictness and security rules

- JSON bodies are UTF-8, actual-stream bounded, strict, and reject unknown fields. Use the existing 16 KiB catalog bound or a smaller route-specific limit; cap skill selections and history entries to fixed limits.
- Authentication and authorization precedence is fixed after path-level no-store: authenticate first; derive the human actor; then parse bounded input; then authorize the deep command. A runner header overrides any cookie: empty or malformed runner credentials are rejected and never fall back to the cookie. Principals are unauthenticated, invalid/empty runner, valid global runner, valid scoped runner, authenticated human, and administrator; an independent agent HTTP principal is unsupported and receives 401. Do not reveal whether an inaccessible agent or release exists. A malformed ID supplied by an unauthenticated caller receives the existing auth guard response, not a resource-enumeration response.
- Secret selector privacy is separate from secret storage: an authorized actor may receive only a short-lived AEAD-sealed opaque `secretReferenceId` bounded by `OpaqueSecretReferenceSchema` to 2048 UTF-8 bytes; raw storage IDs, values, ciphertext, owner IDs, and other humans' references never enter HTTP/UI projections or browser state. `toAgentCreation` preserves the sealed handle. Handles carry actor, purpose, timestamps, and a random nonce, expire after 10 minutes, are not persisted, and are absent from logs/audits. Preflight validation returns no raw ID; the persistence transaction resolves the same handle again through `bindForWrite()` and rechecks actor, purpose, expiry, visibility/ownership, and decryptability immediately before binding writes.
- Errors use fixed codes and messages: `INVALID_REQUEST`, `PAYLOAD_TOO_LARGE`, `FORBIDDEN`, `NOT_FOUND`, `REVISION_CONFLICT`, `STATE_CONFLICT`, `GRANT_REQUIRED`, `INSTALLATION_REQUIRED`, `REQUIREMENTS_UNSATISFIED`, `SOURCE_UNAVAILABLE`, `DEPLOYMENT_SUPERSEDED`, and `STORAGE_FAILURE`. Responses contain no submitted URL, Source credential/ref, host path, SQL, Git stderr, raw exception, secret, package bytes, or hidden release existence.
- Route parameters are bounded and validated before deep calls. Actor, agent, and release IDs in a success projection are those selected by the server, never echoed from untrusted body fields.
- Read routes are no-store and preserve last-good client projections after transient failures. Mutations are never automatically retried; a revision conflict requires explicit reload.

## 6. Data flows

### 6.1 Install/review to Skills

1. Administrator creates or selects a Source in Source Library. Source creation commits configuration, then immediate sync runs outside the short configuration transaction.
2. Sync fetches only the configured allowed Source and fixed `catalog/index.json`, inspects package metadata offline, preserves last-good snapshot on failure, and records immutable releases.
3. Administrator reviews an exact release, installs inert content, and separately approves/activates API event shapes when applicable. Installation does not enable a skill or change an agent.
4. `UnifiedSkillInventory` reads local filesystem skills plus actor-visible approved catalog `kind=skill` releases, including approved releases not yet installed. For ordinary humans, the CatalogPolicy projection includes only effectively granted releases. For admins, it includes full bounded provenance and readiness. Uninstalled visible releases are `AVAILABLE` and blocked by `INSTALLATION_REQUIRED`; they are never treated as installed.
5. Selecting a catalog skill in Skills or Create Agent refers to `packageReleaseId` and digest, never a mutable name/version alone. Selecting a local skill refers to its local name and trusted local root.

### 6.2 Create Agent

The controller loads template options and inventory through interfaces, displays preflight blockers, and submits one `AgentCreation` command. It does not build a second policy graph. `AgentProvisioning` resolves template dependencies and exact skill refs, writes local and catalog state in their proper stores, creates no channels or turns, and returns a stopped catalog result. The UI shows the resulting assignment/deployment checklist and a separate Start action.

A failed preflight creates nothing. A failed transaction creates no visible agent or assignment. A crash between durable DB commit and deployment delivery is reconciled from queued deployment rows; it does not silently create a running agent.

### 6.3 Post-creation skill management

The Agent Skills tab loads the same `UnifiedSkillInventory.listForAgent`, which returns `{items,agentRevision}` after manageability authorization. A command carries revisions and the discriminated local/catalog ref to `AgentSkillManagement`. A batch compares the exact before/after desired catalog sets, including release IDs, desired state, and preload. If `catalogSetChanged` is true it schedules exactly one complete final-package-set generation, including an empty generation when the last catalog assignment is removed; if false it schedules none. A local-only batch never schedules catalog deployment even when unchanged catalog assignments exist. Runner delivery stages a changed catalog set outside the active root, verifies exact digests, waits for all channel turn leases, and atomically swaps it. The old catalog generation remains active until the swap succeeds. Local changes use one atomic batch helper for the JSON authority; after commit, local desired and effective selection are equal and `deployment=STABLE` for future turns, with no local artifact deployment. An in-flight turn retains the immutable Agent/config object captured by the existing channel-loop/turn-executor seam. History is read from the unified `SkillDeploymentEvent` DTO. Tests cover removing the last catalog assignment, disabling the last enabled catalog assignment, changing catalog preload, a local-only batch while catalog assignments exist, no lost local JSON update, and no mixed-generation turn.

## 7. Permissions and visibility

| Capability | Unauthenticated | Runner/agent | Authenticated human | Administrator |
|---|---|---|---|---|
| Open Skills screen | No | No | Yes | Yes |
| List local/built-in skills | No | Runtime-only existing protocol | Own bounded inventory | Full local inventory |
| List catalog skills | No | No | Granted, approved, compatible projection including `AVAILABLE` releases | Full approved/reviewed catalog skill inventory including `AVAILABLE` releases |
| View full Source/release provenance | No | No | No | Yes |
| Create/update/remove/sync Source | No | No | No | Yes |
| Review/install/grant/API-activate release | No | No | No | Yes |
| Browse eligible agent templates | No | No | Granted installed compatible templates | All policy-eligible templates |
| Create Blank agent | No | No (except existing scoped runner contract) | Existing manageability/ownership rules | Yes, subject to same agent safety rules |
| Instantiate catalog template | No | No | Granted release and allowed local bindings | Yes, for a manageable owner/target |
| Manage an existing agent's local skills | No | No | Only manageable agents | Only manageable agents; admin does not bypass target manageability |
| Manage catalog skills on an agent | No | No | Current grant plus manageable agent | Admin authority plus manageable agent |
| Start/restart agent | No | Existing runner/lifecycle protocol only | Existing lifecycle policy and package start gate | Same start gate; no bypass of missing requirements |
| View deployment history | No | Bound runner protocol only | Manageable agents | Manageable agents and administrative release activity |

“Administrator” is a live authenticated-human capability, not a username, cookie field, runner scope, or UI affordance. Source Library tabs/actions are hidden or disabled for ordinary humans and are also rejected server-side. Catalog provenance is bounded by server projection; CSS hiding is not a privacy control.

Organization grants include current and future humans as already defined by Source Library. A grant permits consumption, not Source administration, installation, API activation, publication, or access to another human's agent.

## 8. UX behavior, accessibility, and responsive layout

### Unified Skills

- The heading says **Skills**, with supporting text “Local skills and approved catalog skills available to this account.”
- Every row exposes origin (`Built-in`, `Local`, or `Catalog`), version where applicable, readiness, and a concise blocker. A catalog row can say “Available after installation” or “Granted and ready”; it does not expose a hidden Source URL to an ordinary human.
- `Installed` means usable local content or installed catalog content; `Available` means visible and eligible to consume but not necessarily assigned to an agent. Assignment state is separate from installation state.
- Search matches bounded name/description/version. Empty states distinguish no local skills, no granted catalog skills, no installed catalog skills, no compatible skills, and no manageable agent in the selected context.
- Actions are disabled only as a presentation aid; the server remains authoritative. Tooltips explain external-package permission in plain language: “This Source may reference packages stored elsewhere. It does not give packages permission to run or give OrgOps another repository credential.”

### Source Library

- The master pane has an obvious selection and keyboard focus. The detail header persists the selected Source/release while tabs change.
- `+ Add Source` is a button that opens a drawer; no credential field is mounted while the drawer is closed. On submit, sensitive fields are synchronously cleared before awaiting the request. Immediate sync progress, last-good snapshot, and retry remain visible.
- Contextual errors appear next to the failed Source/release/action and in one live status region; identical errors are deduplicated. A failed sync says that last-good content remains selected.
- Removal confirms credential deletion, permission reset, disabled state, and retention of snapshots/releases/grants/installations/agents. Restore explicitly says credentials and external-package permission are not restored.
- Compatibility, Contents, and Security use bounded disclosure and warn before any executable API module or wrapped command action. Viewing is never execution.

### Create Agent and Agent Skills

- The first step visibly distinguishes Blank from “Installed template.” Template cards state whether the caller has a grant, whether requirements are satisfied, and that choosing a template does not create an agent.
- The review screen shows exact mode/config and exact local/catalog skill refs. Catalog selections show “This agent will be created stopped and will need deployment before Start.”
- A missing secret is a named requirement with a local binding control, never a secret value. Start is unavailable until the existing start gate says ready.
- Agent Skills uses checkboxes/buttons with labels, `aria-describedby` blocker text, `aria-busy` during commands, live deployment status, and an explicit history region. “Waiting for agent to become idle” is user-facing copy for the boundary state.

At 390px, master/detail stacks into a selectable list followed by one detail panel; tables become cards; tabs wrap or become a horizontal, keyboard-scrollable tablist; digests and bounded metadata break safely; no control requires horizontal page scrolling. At desktop, master and detail remain simultaneously visible. All dialogs/drawers have focus management, Escape behavior, focus restoration, visible labels, status/alert regions, and sufficient target size.

## 9. Errors and recovery

The UI uses fixed server codes and contextual copy:

- `GRANT_REQUIRED`: “This catalog skill is not granted to your account.”
- `INSTALLATION_REQUIRED`: “This release is approved but not installed yet.”
- `REQUIREMENTS_UNSATISFIED`: “This agent cannot start until the listed requirements are ready.”
- `REVISION_CONFLICT`: “This agent changed elsewhere. Reload before applying your change.”
- `STATE_CONFLICT`: “The skill state changed while this screen was open. Reload the selected agent.”
- `SOURCE_UNAVAILABLE`: “The Source is unavailable. Last-good catalog data is still shown.”
- `DEPLOYMENT_SUPERSEDED`: “A newer deployment replaced this request.”
- `STORAGE_FAILURE`: “OrgOps could not save this change. No new active catalog skill generation was selected.”

Read failures preserve last-good projection and show a retry. Failed mutations do not optimistically claim a commit. Successful local JSON commits immediately project desired=effective and `STABLE` for future turns, while catalog mutations retain desired/effective distinctions until deployment. Catalog deployment failures retain the previous effective generation. A catalog template creation failure cannot leave a partially visible agent; startup reconciliation handles durable queued work and owned staging directories. Source sync failure cannot replace the current snapshot. No error includes credentials, package bytes, raw command output, or hidden-resource existence.

## 10. Migration and retirement sequence

The initial no-migration assumption was superseded by three narrowly justified durable gaps found during implementation: migration 043 adds the assignment removal tombstone marker/index, migration 044 adds provision-operation receipts, and migration 045 rebuilds those receipts around the actor-scoped composite identity `(actor_human_id, operation_id)` while preserving rows, foreign keys, checks, and the digest index. These migrations are applied in order on fresh databases and are idempotent across upgrades from 042, 043, and 044. Local enabled/preload JSON remains the desired/effective authority for local prompt selection; there is no local artifact deployment or local deployment-state migration. A turn captures the agent/config and local enabled/preload snapshot at its start, and committed local changes become `STABLE` desired state for the next turn while the active turn retains its captured snapshot. Existing audit-derived history records local changes. Catalog artifacts and event modules still use content-addressed staging and generation activation; that staging requirement does not apply to selecting local prompt JSON.

The executable sequence is:

1. **Read seam:** implement and test `UnifiedSkillInventory` projections over existing filesystem/catalog/policy data. Add no UI changes until local and catalog fixtures prove distinct refs and privacy projections.
2. **Admin inventory:** replace the local-only Skills screen with unified Skills and URL selection. Keep Source Library as a separate top-level item and preserve its current admin gate.
3. **Source master/detail:** reshape Source Library without changing Source domain responsibilities. Add tabs, closed add drawer, immediate sync/retry, URL selection, contextual deduped errors, and plain-language permission help. Preserve source/release historical records.
4. **Provisioning:** add preflight and explicit Blank/template creation adapters. Keep old `POST /api/agents` behavior as a compatibility adapter until all clients use `AgentProvisioning`. Catalog selections enforce stopped creation and queued exact deployment.
5. **Existing-agent management:** add Skills tab and route adapters. Verify safe generation activation across all channels before exposing catalog enable/disable broadly.
6. **User-ui retirement:** remove the Library navigation and screen from user-ui. `/library` loads the normal conversation workspace and preserves any conversation deep-link behavior; it does not silently open admin Skills. Keep `/api/library/*` privacy-safe adapters for clients or staged rollout, and mark them non-UI compatibility routes.
7. **Adapter cleanup:** after a release containing compatibility telemetry and migration checks, remove only dead UI callers and retired Catalog aliases. Keep historical origins and assignments. Update `docs/SPEC.md` with final route/event/runtime facts in the same implementation tasks.

No user action is lost by route retirement: existing agents, local skills, catalog assignments, grants, Sources, releases, installations, origins, and deployment history remain in their respective authorities.

## 11. Telemetry, audit, and events

Use existing typed channel-less `audit.catalog.*` events and add no wake-up behavior. Relevant transitions include:

- `audit.catalog.source.changed`, `audit.catalog.sync.completed`, `audit.catalog.sync.failed`;
- `audit.catalog.release.reviewed`, `audit.catalog.installation.changed`, `audit.catalog.api_activation.changed`, `audit.catalog.grant.changed`;
- `audit.catalog.template.instantiated`, `audit.catalog.assignment.changed`, `audit.catalog.rollout.changed`, `audit.catalog.deployment.reported`.

Skill inventory reads and filter changes are low-cardinality UI telemetry only: screen, origin filter, readiness filter, result count bucket, and outcome. Do not record skill descriptions, URLs, credentials, secret IDs, prompts, package bytes, or raw query text. Command telemetry records operation kind, local/catalog kind, fixed outcome code, revision conflict, deployment state, and bounded IDs where the existing audit contract permits them.

Successful control transitions and durable failed attempts write audit state transactionally where possible. Audit events are `system`, `DELIVERED`, channel-less, create no receipts, and never wake agents. Existing event-shape activation and wrapped runtime events retain their current execution boundaries.

## 12. Testing and real-Chrome acceptance

### Unit and contract tests

- `UnifiedSkillInventory` tests prove local/catalog discriminated refs, admin versus bounded human projections, grant filtering, install/readiness blockers, optional agent context, and nonenumeration.
- `AgentSkillManagement` tests prove revision guards, manageability, local JSON preservation, normalized catalog assignment, collision rejection, exact before/after `catalogSetChanged`, exactly one generation for remove-last (empty final set), disable-last, and preload-only changes, no generation for local-only batches with catalog rows present, catalog desired/effective separation, retry/supersession, and no partial state.
- `AgentProvisioning` tests prove preflight-all-before-write, Blank/template exact config, the shared 2048-byte opaque-handle bound, sealed-handle preservation through `toAgentCreation`, transaction re-resolution including expiry between preflight and write, no raw ID in public commands/reports, no per-user creation on selection, catalog STOPPED invariant, queued deployment, no channels/turns/processes, secret redaction, transaction rollback, and owned staging cleanup.
- HTTP tests prove strict schemas, unknown-field rejection, actual-stream body limits, UTF-8 handling, no-store, auth precedence, fixed errors, nonenumeration, and compatibility adapters.
- Source Library tests prove master/detail URL selection, tab projections, closed drawer, immediate create/sync/retry, last-good preservation, deduplicated contextual errors, and independent external-package permission.
- Runtime tests prove a turn captures one catalog generation plus one local Agent/config snapshot, catalog deployment waits for all channel leases, the old catalog generation remains active on failure, committed local JSON is `STABLE` for future turns without changing an active turn, and local/catalog assignment changes do not change runner host semantics.
- Regression tests prove `/api/skills`, old agent routes, `/api/library/*`, historical origins, and Source Library domain routes continue their documented compatibility behavior during rollout.

### Real-Chrome acceptance

Run the built admin-ui and API in a real browser at desktop and 390px widths, using an admin and ordinary human account:

1. Ordinary human opens Skills, sees local skills and only granted catalog skills, sees bounded provenance, cannot open Source Library, and cannot target an unmanageable agent.
2. Admin opens Skills, sees local plus full catalog inventory, filters/searches, follows a catalog skill to its release/source context without moving Source Library under Skills, and sees readiness/blockers.
3. Admin opens Source Library, confirms no Source/release is selected until clicked, uses URL-preserved selection, switches all five tabs, opens/closes the add drawer, creates a Source, observes immediate sync, forces a failure, retries, and verifies last-good data remains.
4. Human opens Create Agent, chooses Blank and cancels without an agent row; chooses an eligible template, verifies exact mode/config/requirements, selects local/catalog skills, confirms, sees a stopped agent, observes queued deployment, and cannot Start before readiness/secrets.
5. Human opens an existing manageable agent's Skills tab, enables/disables/removes/preloads a local and a granted catalog skill, sees desired/effective/deployment states and history, verifies local commits are immediately `STABLE` for future turns without changing the active turn, and verifies the catalog action waits for the safe boundary.
6. Ordinary human attempts direct forbidden Source, release, grant, assignment, and unmanageable-agent routes and receives fixed server errors without existence leakage.
7. User-ui `/library` and its old navigation return to the normal conversation workspace at desktop and phone width; no Library screen or skill-management controls remain.
8. Refresh/back/forward preserves valid selections, focus returns after drawers/dialogs, status and errors are announced, and no page or tab introduces horizontal overflow.

Acceptance includes a fresh database and an upgraded database with existing local skills, Source releases, grants, assignments, and template origins. It includes a failed sync, failed deployment, revision conflict, missing secret, revoked grant, Source removal/restore, runner reassignment, and browser reload during each.

## 13. Rollout phases

- **Phase A — read-only seam:** implement inventory projections, schemas, policy tests, and telemetry; no visible behavior change.
- **Phase B — unified Skills:** ship admin-ui unified inventory and ordinary-human privacy projection. Keep Source Library separate; retain only the privacy-safe backend Library adapters while the user-ui screen is removed in the retirement phase.
- **Phase C — Source Library UX:** ship master/detail, tabs, closed drawer, immediate sync/retry, URL selection, contextual errors, and responsive browser coverage.
- **Phase D — provisioning:** ship Blank/template chooser, preflight, inline skill selection, explicit stopped catalog creation, queued deployments, and start-gate messaging.
- **Phase E — existing-agent Skills:** ship the shared controller/tab and safe turn-boundary deployment history; enable catalog mutations after runner generation acceptance passes.
- **Phase F — user-ui retirement:** remove Library navigation/route, route old `/library` to conversations, retain backend adapters, and verify no client imports the retired screen.
- **Phase G — compatibility cleanup:** remove dead UI adapters only after browser and API telemetry show no use; retain domain/history adapters and update `docs/SPEC.md`.

## 14. Risks and resolved questions

- **Risk: two sources of truth for skills.** Resolved by making `UnifiedSkillInventory` the sole read seam and `AgentSkillManagement` the sole command seam. Local JSON and normalized catalog assignment persistence remain separate by authority, not exposed as separate UI concepts.
- **Risk: a catalog grant is mistaken for Source permission.** Resolved by deriving inventory and commands through CatalogPolicy; grants allow consumption only. Source Library remains admin-only.
- **Risk: selecting a template creates an unexpected agent.** Resolved by selection-only preflight and explicit instantiation; no database row exists before confirmation.
- **Risk: catalog content starts partially configured.** Resolved by atomic stopped creation, exact queued assignments, package-aware start gate, and no channels/turns/processes before explicit Start.
- **Risk: local JSON and catalog assignments drift.** Resolved by one command module, separate persistence, projection tests, revisions, immediate local desired=effective commits for future turns, and agent-wide generation activation only for changed catalog sets.
- **Risk: user-ui retirement strands backend clients.** Resolved by preserving privacy-safe `/api/library/*` adapters while removing only the UI and documenting the compatibility window.
- **Risk: privacy leakage through admin-shaped responses.** Resolved by server-side actor projection, strict route schemas, fixed errors, and nonenumeration; ordinary humans never receive full provenance.
- **Risk: Source Library redesign accidentally changes Source domain.** Resolved by retaining Source responsibilities and routes, changing only information architecture and thin controller state.
- **Resolved question — where do Sources live?** Top-level Source Library, never under Skills.
- **Resolved question — who manages skills?** Admin-ui, available to all authenticated humans with permission-gated actions; no user-ui Library management.
- **Resolved question — what does a catalog template do?** It pre-fills exact portable config and requirements, then creates one explicit independent stopped local agent; it never auto-creates per user.
- **Resolved question — what happens to old Library URLs?** They return to the normal conversation workspace; privacy-safe backend routes remain adapters where useful.
- **Resolved question — is a database migration part of this spec?** No. Existing stores and historical records are preserved; a migration is allowed only if implementation proves a representation gap and must be separately reviewed.

## 15. Required SPEC and implementation handoff

This document does not change runtime behavior. Each implementation task that changes an API route, schema, event, route retirement behavior, agent state invariant, or runner generation behavior must update `docs/SPEC.md` in the same task. The update must name compatibility adapters, strict request/response shapes, authorization precedence, error codes, data persistence, and runtime safety invariants.

The implementation handoff is complete when the deep module contracts above are exercised by focused tests, HTTP adapters are thin, UI controllers consume only those interfaces, Source Library remains a separate top-level admin surface, user-ui Library is retired, and the real-Chrome acceptance matrix passes without changing protected research files or historical provenance.
