# Skill and agent catalogs — v1 requirements

Status: approved by the owner in conversation. Phases 1–9 are implemented, reviewed and parent-verified: administrator authority/reset protection, inert package/catalog contracts, administrator-only source configuration with isolated encrypted read credentials, bounded offline exact-Git inspection, and the configuration-only administrator UI. Phase 5 includes parent browser verification of all fourteen route-backed actions and React-development StrictMode lifecycles; shared-shell phone-width layout remains a documented limitation. Phase 6 implements bounded pure offline publication preparation from supplied complete evidence, with full byte review and supplementary redacted findings; task/whole-phase reviews and fresh parent verification are complete. Phase 7 implements bounded read-only publication tree evidence from trusted provisioned local bare storage: `readGitPublicationEvidence` returns only commit, explicit indexPath, complete ordinary-file/tree inventory and exact index base64 or proven absence. It rejects every special leaf, hashes actual bodies independently of Git OIDs, preserves malformed index bytes without semantic approval, and awaits confirmed cleanup. Configuration/bindings, complete retained history and live authority remain independently caller-owned; no transport, package execution, permission inference or publication is added. Synthetic SHA1/SHA256 composition and terminal lifecycle tests exercise the adapter; all task/whole-phase reviews and independent fresh parent verification are complete: 1681 Vitest tests across 47 files, 3 opscli tests, and all twelve workspace lints with exactly the unchanged 488 baseline diagnostics (API486/runner2; ten clean workspaces). The parent also executed both documented synthetic Git examples. Only this bounded offline slice is accepted. See [the exact API, limits and synthetic example](../../catalog-package-contract.md#offline-git-publication-tree-evidence). Phase 8 implements bounded pure `prepareImport` previews with independent supplied local-byte measurement, namespace conflict/reuse checks, shared explicit source permissions, unchanged exact dependency resolution and complete inert review. All task/whole-phase reviews and fresh parent verification are complete: 1937 Vitest tests/50 files, 3 opscli tests, unchanged 488 diagnostics across all twelve workspace lints, and the public synthetic example. Caller completeness/provenance remain unproved; no local binding, installation, activation or start authority is created. See [the import contract](../../catalog-package-contract.md#offline-import-preparation). Phase 9 implements bounded read-only neutral local skill-root evidence (`readLocalSkillEvidence`) over one explicitly supplied trusted quiescent root, composed with unchanged `prepareImport`; all task/whole-phase reviews and fresh parent verification are complete: 2095 Vitest tests/53 files, 3 opscli tests, unchanged 488 diagnostics across all twelve workspace lints, and the executed public synthetic example. Caller-controlled origins/all-location completeness and every write/install/activation authority remain external. See [the local evidence contract](../../catalog-package-contract.md#offline-local-skill-root-evidence). Live evidence acquisition, authority revalidation, confirmation/GitHub submission/retry reconciliation, remote transport, package browsing/import, installation and publishing UI remain subsequent separately planned slices. Two-instance acceptance remains outstanding. Owner decisions (2026-09-11): Q1 resolved to GitHub-hosted repositories only (public or private via an HTTPS read token; LAN/VPN/private-IP Git servers unsupported, default-deny all other destinations, no credential forwarding across redirects); Q2 resolved to desktop-first for the initial release, with a phone-width/shared mobile admin shell required before the final version. Phase 10 implements the read-only live GitHub catalog synchronization slice: a pure GitHub-only destination policy, sanitized env-only credential injection with redirects/protocol/helpers locked down, an owned per-source bare mirror with staged offline inspection before an atomic old-value-guarded promotion, admin-only POST/GET sync routes and a desktop-only Catalogs-screen sync section; all task and whole-phase reviews plus fresh independent parent verification are complete, and the parent-authorized live smoke against a private GitHub test repository passed end-to-end (real fetch, index read, forced-failure preservation, no raw or base64 credential leakage): 2197 Vitest tests/57 files, 3 opscli tests, unchanged 488 diagnostics across all twelve workspace lints, byte-identical root lint. Mirrored content is untrusted, nothing is written back to GitHub, and the phone-width mobile admin shell remains outstanding and required before the final version. Phase 11 implements the read-only catalog package browsing and detail slice: admin-only list/inspect GET routes over the verify-only Phase 10 mirror and the unchanged offline inspection, with external locations rejected unfetched, current-commit inspection bound to the index digest, a base64-stripped inventory, a 1 MiB reject-not-truncate response ceiling, disabled-catalog read consistency, and a desktop-only Catalogs-screen packages section; all task and whole-phase reviews and fresh independent parent verification are complete, and the parent-authorized live browse of the real vault passed end-to-end: 2246 Vitest tests/59 files, 3 opscli tests, unchanged 488 diagnostics across all twelve workspace lints, byte-identical root lint. Browsing remains fully inert — nothing is fetched, installed, activated or executed — and the phone-width mobile admin shell remains outstanding and required before the final version. Phase 12 implements the read-only catalog import preview under Option A: an admin-only POST route composing the Phase 11 mirror preconditions, Option A local occupancy (every present name occupied, no reuse or origins), configured sources/synced catalogs, bounded inspectGitPackage supply and the UNCHANGED prepareImport, returning a base64-free closed projection with a fixed PREVIEW_REJECTED 422 envelope and a desktop-only Catalogs-screen import-preview section; all task and whole-phase reviews plus fresh independent parent verification are complete: 2297 Vitest tests/61 files, 3 opscli tests, unchanged 488 diagnostics across all twelve workspace lints, byte-identical root lint. Installation, activation, the publishing UI and the phone-width mobile admin shell still remain outstanding and separately planned. Phase 13 implements the catalog package installation write path under mechanism 2: installed-origin persistence (migration `033`), an owned installed-packages store deliberately outside the live skills root (installed content is inert to the API's `SKILL_ROOT` dynamic-import path until a separate Phase 14 activation approval), an origin-aware import preview, an admin-only POST install route with explicit confirmation and fixed `INSTALL_REJECTED`/`KIND_NOT_INSTALLABLE`/`INSTALL_IN_PROGRESS` envelopes, atomic exclusive target-name claims followed by staged-content promotion with narrow rollback (not atomic whole-directory publication), and a desktop-only two-step install control with an inert result; the initial whole-phase review was BLOCKED on rollback, no-overwrite and preview fail-closed defects. The final fix wave adds regression coverage and corrects those contracts; its fresh scoped re-review approved all six corrections, and independent parent verification completed with 2379 Vitest tests/65 files, 3 opscli tests, exact unchanged 488 diagnostics, byte-identical root lint, and fresh standalone migration 033 application/idempotency on an owned database. Install is not activation — nothing is started, enabled, API-loaded or secret-bound — and activation, secret references/bindings, agent creation, the publishing UI and the phone-width mobile admin shell still remain outstanding and separately planned.

## 1. Purpose and scope

Allow administrators to share reusable skills and agent definitions between independently operated OrgOps instances. The first audience is our own instances. The same package/catalog format must support a later public community catalog and private company catalogs, including instances using only private sources.

V1 uses Git-backed catalogs, not a new hosted registry service or instance-to-instance replication protocol. Authors can publish without OrgOps through normal Git workflows. OrgOps-assisted publishing creates GitHub pull requests.

Research and alternatives: [`../../research/skill-agent-sharing.md`](../../research/skill-agent-sharing.md). Git-backed catalogs were selected over a dedicated registry (additional service, identity and moderation responsibilities) and direct instance sharing (coupling distribution to production instance availability and authentication).

## 2. Agreed product decisions

- Instance-configured public and private Git catalogs; no central instance registration requirement.
- One format for portable skills, native agent templates and wrapped agent recipes.
- Git-host-neutral format and consumption; GitHub-only in-app PR publishing.
- Admin-only catalog management, installation, template instantiation and publishing in v1.
- Imported agents are independent local copies with recorded origins, not synchronized deployments.
- Pinned skill dependencies are previewed and installed with their agent template.
- No automatic dependency source registration, version substitution, or upstream overwrite.
- Secret requirements are portable; secret values and live agent state are not.
- Imports create stopped agents. Missing declared requirements prevent starting them.
- Browsing never executes downloaded package code. Activation of executable content requires explicit approval.

## 3. Concepts and identities

A **catalog** is a named, administrator-configured Git source containing an index of packages and releases. Display names are not security identities; retain the configured repository identity and resolved revision.

A **package release** is a versioned, self-contained directory plus distribution metadata. Its identity is catalog/source namespace + package name + version. Distinguish the package's publisher attribution from authenticated repository provenance; a claimed author name is not proof of ownership.

An **agent template** is portable configuration from which a local native agent can be created. A **wrapped recipe** serves the same purpose for an external runtime. Neither is an export of a running agent's database row.

An **installation origin** records source identity, package identity, declared version, resolved commit, content digest and installation actor/time. Record catalog and package revisions separately when their repositories differ. Tags or branches alone are not sufficient provenance.

A **local binding** supplies instance-specific choices: agent name, runner, workspace, model where applicable, and secret references.

## 4. Catalog configuration and discovery

Administrators can add, inspect, refresh, disable and remove catalog sources. Configuration includes a local display name, Git URL, selected ref and optional private read credential reference.

Only explicitly configured, enabled sources may be used for discovery or dependency resolution. No default public catalog is required in v1, and no catalog can register another catalog implicitly. Source-owner permissions determine who can fetch private content; instance policy determines which sources the instance accepts. A public source does not require the consumer to register its OrgOps instance with a central service.

The catalog index identifies package releases and their package locations. The format permits packages in the catalog repository or explicit Git package sources. External locations must be displayed and checked against instance source policy; trusting an index is not permission to fetch from arbitrary repositories or forward credentials to them.

Discovery shows kind, name, description, publisher attribution, license, versions, compatibility, source and refresh status. A catalog refresh changes discoverable metadata only; it does not install, activate or update local content.

If refreshing fails, show the error and time of the last successful refresh. Previously installed local copies continue to work. Removing a catalog stops future discovery and imports from that source without deleting existing installations.

## 5. Package contents and portability

All package kinds carry a versioned manifest format, package kind/name/version, description, author attribution, license declaration, compatibility requirements, declared secret requirements and explicit file inventory or equivalent digest coverage. Exact field spelling and serialization are implementation-plan decisions; the behaviors below are mandatory.

### Skills

Retain the portable `SKILL.md` directory convention and supporting assets, scripts and references. Put OrgOps distribution information in accompanying metadata rather than requiring authors to replace the skill format. Format compatibility does not guarantee compatibility with OrgOps tools or an external runtime.

Declare executable components, including OrgOps `event-shapes.ts/js` modules, and relevant platform/tool requirements. Validate metadata against inspected contents; declarations and scans are not proof of safety.

### Native agent templates

Include instructions, soul content when intended for sharing, portable runtime settings, suggested model requirements/settings, and exact skill dependencies. Support both native modes (`CLASSIC` and `RLM_REPL`) with their mode explicitly declared.

Do not copy local model row IDs, runner IDs, absolute workspace paths, channel memberships or local secret identifiers. Bind those locally where required. Recommended model settings are not permission to select an unavailable model silently.

### Wrapped agent recipes

Include external runtime identity/configuration, setup recipe, compatibility/platform requirements and declared secrets. Show setup, sidecar and turn commands in the preview.

Wrapped agents do not use OrgOps native prompt/skill injection or filesystem restrictions. A wrapped recipe must describe how its external runtime consumes any packaged resources; installing an OrgOps skill dependency must not be represented as automatically enabling it in the wrapped runtime. Reject unsupported declared wiring rather than claim successful configuration.

Pin OrgOps-distributed package contents. This does not make arbitrary commands such as an unpinned external dependency installer reproducible or safe; surface those external dependencies in the preview without promising full transitive runtime reproducibility.

### Export exclusions

Export from an explicit allowlist of portable fields and selected package files, not a broad database/workspace dump. Exclude secret values, repository credentials, conversations, event history, memory, process/session state, lifecycle state and machine-specific bindings.

User-authored prompts, files and commands may still contain embedded sensitive text. Require a file/diff preview and provide secret scanning as a supplementary safeguard, never a guarantee that publication is safe.

## 6. Skill dependencies and local copies

Agent packages declare exact skill releases, including their source identity and immutable resolution. Resolve only through configured, permitted sources. Include the complete required dependency set in one installation preview.

Missing access, missing releases, incompatible packages or unsupported dependency relationships block installation with an actionable explanation. Never silently choose another version or add a catalog. Detect dependency cycles and fail without partial activation.

Reuse an existing skill only when its pinned identity and installed content match. A local edit invalidates that equivalence. Block conflicting skill versions/names in v1; do not implement side-by-side skill versions or overwrite local skills automatically. Catalog namespacing does not remove collisions in the current runtime's skill-name namespace.

Imported agents and skills are independently editable. Preserve their original provenance without implying that locally modified content still matches the upstream digest. V1 does not merge upstream changes into local copies or offer managed template upgrades. New releases remain discoverable and can be imported subject to conflict rules.

## 7. Installation and execution boundary

The administrator follows **inspect → configure → approve → install**:

1. Resolve and stage the package/dependency set outside active skill discovery. Validate metadata and inspect files without importing modules or executing hooks, scripts, setup commands or package managers.
2. Show exact versions/revisions, source identities, files, dependencies, declared capabilities and executable components.
3. Select local name, runner, workspace, native model where applicable, and secret bindings. Show missing requirements.
4. Approve the exact inspected content and its activation effects. A changed revision/digest requires a new preview and approval.
5. Verify integrity, path safety, compatibility, dependency conflicts and required placement before activating installed files. Make needed resources available to the API and assigned runner as appropriate.
6. Create the local agent stopped, with provenance and requirement status. Incomplete installation cannot be started. An administrator may save a fully installed agent with missing secret bindings, but cannot start it until those requirements are satisfied.

A standalone skill follows the same inspection, approval and staging safeguards without creating an agent or requesting agent-specific bindings. Installation does not automatically enable it on existing agents; approving API-side event-schema activation remains necessary if the skill includes such modules.

Reject unsafe archive paths and symlinks that escape the package root. Bound downloads/extraction and do not forward credentials across unapproved sources or redirects. Digests detect content changes; they do not establish publisher trust or sandbox executable content.

### Two distinct code execution risks

- **Event-schema modules:** OrgOps currently imports these inside the API process. Never load them during discovery or staging. Installation approval must explicitly identify API-side execution before activation. A stopped agent does not neutralize an activated schema module.
- **Wrapped runtime commands:** execute on the assigned runner only after explicit start, not during catalog refresh or download. Native filesystem allowlisting does not constrain wrapped execution.

No new sandbox or claim of safe execution of untrusted packages is part of v1. Administrators must be warned of these trust boundaries before approving executable packages.

## 8. Secret requirements

Packages declare secret names, purpose/description and whether each is required, never secret values. Administrators map requirements to existing local secrets or supply new local secrets through OrgOps secret management.

Persist references using the existing secret storage/access mechanisms; do not duplicate values into manifests, exported files, origin records, preview payloads or audit logs. Missing declared credentials block start, including starts requested outside the import UI. Revalidate required bindings at start rather than relying only on an earlier preview.

Repository read credentials and publication write credentials are separate capabilities. Read permission must never imply publication permission.

## 9. Publishing through GitHub

1. An administrator selects a local skill/agent, new package or existing package update, release version and destination catalog.
2. OrgOps generates a portable package and proposed catalog index changes. Preserve known origin for an update; publication to another namespace is an explicit new destination, not an implicit ownership claim.
3. Validate portability and compatibility, check for likely secrets, and show every proposed file/diff before submission.
4. After explicit confirmation, use destination-scoped GitHub write access to create a branch and PR. Do not write directly to the default branch or merge automatically.
5. Report success only after GitHub confirms the PR; retain its link and publication status.
6. Merging makes the release discoverable on a subsequent catalog refresh. It does not modify consuming instances.

Each PR updates package files and the catalog entry together in one destination repository. Do not coordinate multi-repository releases. Dependencies must already be published/resolvable or be included as coherent releases in that same PR; unresolved dependencies prevent submission as a valid release.

Read-only access is sufficient for consumption. In-app publishing requires write access to the selected destination in v1; automatic forks and cross-organization contribution credential orchestration are not required. External contributors can use normal GitHub workflows independently of OrgOps.

### Initial GitHub authentication (approved)

V1 supports a temporary fine-grained GitHub personal access token (PAT), scoped to the selected destination repository, with **Contents: read/write** and **Pull requests: read/write** permissions. Use a short expiration date and permit replacement/revocation without changing package identities. Repository or organization policy may require additional owner approval; token permissions do not override that policy.

The administrator can create the repository and configure its token later. Neither is required to finish requirements or implementation planning; a configured repository and valid credential are required for real publication.

Configure the token through a secure local/admin secret entry mechanism, not chat, source files or package manifests. Store a credential reference in catalog configuration. Keep publication credentials out of agent-visible secrets and runner/runtime environments, as well as exports, previews and logs. Private GitHub consumption uses a separate repository-scoped read-only credential; public consumption does not require one.

Expired, revoked or insufficiently privileged credentials produce an actionable error without exposing the token or discarding prepared publication changes. GitHub App integration is deferred beyond v1.

Published release identities must not silently change their pinned contents. Republishing changed content requires a new version; detect a catalog that maps an already-known release to different content and refuse silent replacement.

## 10. Authorization and audit

Catalog configuration/credentials, package installation, template instantiation and PR submission require an authenticated human administrator. Agents, regular humans and runner credentials cannot authorize these management operations. Runners may carry out already-authorized host-local installation work through appropriately scoped internal operations; that is not authority to choose new packages or publish.

**Implemented Phase-1 prerequisite:** `humans.is_admin` is persisted, and the shared live authenticated-human administrator capability check rejects runner credentials, including requests with administrator cookies. Neither possession of a session nor the username `admin` is sufficient. Fresh database seeding designates only the initial human; upgrades require explicit offline, backed-up, human-ID-verified promotion. The implemented guard and bootstrap/recovery procedure are documented in `docs/SPEC.md`. A general role editor/RBAC system remains outside scope.

**Owner-approved Phase-1 scope exception:** protect the existing temporary-password reset when its target is currently an administrator. Require the shared live authenticated-human administrator decision before changing credentials or disclosing a password; deny ordinary humans, global/scoped runners (including requests with administrator cookies), demoted callers and callers with current forced-password-change requirements. Preserve the target's designation, require rotation after reset, and leave non-admin-target resets and normal self-profile password changes unchanged. Recovery uses another accessible administrator or the documented offline, backed-up, human-ID-verified bootstrap procedure; no online recovery/role endpoint is introduced.

Audit catalog mutations, approvals, installation outcomes and publishing attempts/outcomes, recording actor, source, revision and affected local resources without credentials. Define concrete routes/events during implementation planning and update `docs/SPEC.md` when those contracts are implemented, not in this requirements-only change.

## 11. Failure and recovery

- An unavailable source does not break already installed copies. Show stale metadata clearly; never treat failed refresh as proof of a new release.
- Validation/access/conflict failures make no active installation changes. Report the package and requirement that failed without leaking credentials.
- Interrupted installation leaves the agent non-runnable. Persist enough operation state for safe retry without duplicate agents or repeated unintended activation. Retain pre-existing shared skills; cleanup must not remove another agent's dependencies.
- Installation cannot roll back arbitrary side effects of approved executable schema modules. Do not promise transactional rollback of external code; report activation failures distinctly and prevent agent start.
- Failed PR submission preserves prepared changes for retry. Reconcile an uncertain GitHub result before retrying so a lost response does not create duplicate PRs. Do not report success without confirmation.
- Missing declared secrets can be completed later. Failed wrapped setup is a runtime failure surfaced through existing lifecycle reporting, not a reason to rerun setup during catalog browsing.

## 12. Module responsibilities

Preserve existing API composition and wrapper-harness boundaries. Suggested responsibility seams, not a prescribed file layout:

- **Catalog discovery:** source configuration, authenticated read access, validated index snapshots and refresh status; no code activation.
- **Package format/validation:** portable serialization, identity/digest validation, dependency resolution and export allowlists; no host setup execution.
- **Installation orchestration:** approved operation state, local bindings, collision handling and coordinated API/runner placement.
- **GitHub publisher:** prepared file changes to a confirmed branch/PR, with retry reconciliation; no automatic merge or consumer updates.
- **Authorization/credentials:** administrator checks, scoped credential references and redacted audit data shared by those workflows.

The API remains the database owner; host-local filesystem/setup work remains assigned to the relevant runner. Extend harness modules rather than growing wrapped orchestration to accommodate package-specific runtimes.

## 13. Acceptance criteria and verification

The primary end-to-end scenario uses two instances and a catalog repository:

1. An administrator configures public and private catalogs with separate credential references where needed.
2. Instance A prepares and submits a GitHub PR for each package kind: skill, native template and wrapped recipe. Native mode coverage includes CLASSIC and RLM_REPL.
3. After merge and refresh, instance B discovers the exact published releases.
4. B previews an agent with pinned skill dependencies, binds local resources/secrets, and installs an independent stopped copy with provenance.
5. Missing declared requirements block start. After configuration, an explicit start runs the expected native or wrapped behavior.
6. Local edits survive catalog refresh and newer upstream releases. Removing a catalog does not remove local copies.

Required negative and recovery coverage:

- Management attempts from regular humans, agents, unscoped/scoped runners and unauthenticated callers are rejected server-side.
- Private-source failures and cross-source credential routing do not leak secrets.
- Missing/inaccessible dependencies, cycles, incompatible mode/platform requirements, local-name conflicts and modified installed skills produce explicit failures.
- Traversal, escaping symlinks, malformed manifests and digest/revision changes are rejected.
- Inspection/staging never executes package code. API schema activation requires the separate disclosed approval effect; wrapped setup waits for explicit start.
- Exports use field/file allowlists and previews; known credentials are absent from generated artifacts and audit output.
- Interrupted API/runner installation and ambiguous GitHub responses can be retried without duplicate resources or unauthorized execution.
- Packages authored through Git without OrgOps are consumable through the same validation/import workflow.

Use colocated unit tests for pure format/validation rules, API authorization and operation-state tests, runner placement/start-gate tests, mocked GitHub integration tests, and a controlled two-instance end-to-end test. Existing runtime/event semantics must remain covered by the repository test suites.

## 14. Explicit non-goals

- Hosted public marketplace infrastructure, public accounts, rankings, ratings, billing or automated moderation.
- Direct production-instance federation or replication.
- Automatic upstream synchronization, update merging, managed upgrades or side-by-side conflicting skill versions.
- Transfer of conversations, memory, credentials or active runtime sessions.
- In-app GitLab/other-host PR integrations, GitHub App integration, automatic forks or multi-repository publishing transactions.
- Autonomous agent publication or general-purpose RBAC.
- A new sandbox or guaranteed safety/reproducibility of arbitrary third-party runtime code.

## 15. Review handoff

The product flows above consolidate the approved conversation, including destination write access rather than automatic forks, no automatic enablement of standalone skill installations on existing agents, and immutable-release checks against changed content under an already-known version.

Phase 1 implemented the reviewed administrator designation/bootstrap mechanism and the owner-approved password-reset exception. Phase 2 implemented the pure package/catalog contract in `docs/superpowers/plans/2026-09-10-catalogs-02-package-contract.md`, with all four tasks, whole-phase review corrections and parent verification complete. Phase 3 implemented administrator-only source/catalog configuration, isolated HTTPS-basic read credential storage and transactional audit events in `docs/superpowers/plans/2026-09-10-catalogs-03-source-configuration.md`, with task/whole-phase reviews and parent verification complete. Phase 4 implemented bounded offline exact-Git inspection in `docs/superpowers/plans/2026-09-10-catalogs-04-offline-git-inspection.md`, with task/whole-phase reviews and parent verification complete. Phase 5 implemented the existing configuration-only administrator UI in `docs/superpowers/plans/2026-09-10-catalogs-05-configuration-ui.md`, with task/whole-phase/correction reviews and parent suite/browser verification complete. Phase 6 implemented the pure offline preparation subset in `docs/superpowers/plans/2026-09-10-catalogs-06-offline-publication-preparation.md`, with task/whole-phase reviews and fresh parent verification complete. Phase 7 adds the bounded offline tree/index evidence subset in `docs/superpowers/plans/2026-09-10-catalogs-07-offline-publication-evidence.md`, with all task/whole-phase reviews and independent fresh parent verification complete. Phase 8 implemented the conditional pure import-review subset in `docs/superpowers/plans/2026-09-10-catalogs-08-offline-import-preparation.md`, with all task/whole-phase reviews and fresh parent verification complete. Phase 9 added bounded offline local skill-root evidence in `docs/superpowers/plans/2026-09-11-catalogs-09-offline-local-evidence.md`, with all task/whole-phase reviews and independent fresh parent verification complete. Live acquisition/discovery, authority revalidation, confirmation/PR submission/retry reconciliation, package browsing/import orchestration, installation, publishing UI and two-instance acceptance remain subsequent reviewed slices. Q1 is resolved to GitHub-hosted destinations only (public/private via HTTPS read token); Q2 is desktop-first, with a required mobile admin shell before the final version. All plans must preserve these requirements; materially new product/security behavior requires renewed approval.

The existing source-configuration UI now consumes the implemented administrator APIs without repository acquisition. Subsequent discovery/import/publishing UI requires its own reviewed plan. Network reachability/transport policy requires explicit review before live fetching; local configuration UI can advance independently. Approval of the requirements does not claim that the later catalog workflows are already implemented.
