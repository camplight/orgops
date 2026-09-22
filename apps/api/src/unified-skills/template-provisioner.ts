import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { OrgOpsDb } from "@orgops/db";
import {
  CATALOG_LIMITS,
  CatalogAuditEventSchema,
  PackageManifestSchema,
  PackageReleaseIdSchema,
  PackageReleaseViewSchema,
  type AuthenticatedHuman,
  type CatalogAuditEvent,
  type CatalogLibraryErrorCode,
  type CatalogPolicy,
  type GrantView,
  type PackageManifest,
  type PackageReleaseView,
} from "@orgops/schemas";
import { catalogGrantId, parseCanonicalCatalogGrant } from "../catalog-library/grant-identity";
import type { SecretReferenceResolver } from "./provisioning";
import type { AgentSkillManagement } from "./management";

export type TemplateSecretBinding = Readonly<{ requirementName: string; secretId?: string; secretReferenceId?: string }>;
export type TemplateInstantiationInput = Readonly<{
  packageReleaseId: string;
  ownerHumanId: string;
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
  runnerId: string;
  workspacePath: string;
  modelId: string;
  secretBindings: readonly TemplateSecretBinding[];
}>;
export const TemplateInstantiationInputSchema: z.ZodType<TemplateInstantiationInput> = z.object({
  packageReleaseId: PackageReleaseIdSchema,
  ownerHumanId: z.string().min(1).max(200),
  name: z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
  runnerId: z.string().min(1).max(200),
  workspacePath: z.string().min(1).max(4096),
  modelId: z.string().min(1).max(200),
  secretBindings: z.array(z.object({
    requirementName: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    secretId: z.string().min(1).max(200).optional(),
    secretReferenceId: z.string().min(1).max(2048).optional(),
  }).strict().refine(binding => Boolean(binding.secretId) !== Boolean(binding.secretReferenceId))).max(64).refine(bindings => new Set(bindings.map(binding => binding.requirementName)).size === bindings.length),
}).strict();
export type TemplateRequirement = Readonly<{ name: string; state: "SATISFIED" | "MISSING" }>;
export type TemplateInstantiationResult = Readonly<{
  agent: Readonly<{
    id: string;
    name: string;
    ownerHumanId: string;
    visibility: "PUBLIC" | "PRIVATE";
    assignedRunnerId: string;
    modelId: string;
    mode: "CLASSIC" | "RLM_REPL" | "WRAPPED";
    desiredState: "STOPPED";
    runtimeState: "STOPPED";
    channelIds: readonly [];
  }>;
  origin: Readonly<{
    packageReleaseId: string;
    mode: "CLASSIC" | "RLM_REPL" | "WRAPPED";
    actorKind: "ADMIN" | "GRANT";
    actorHumanId: string;
    createdAt: number;
  }>;
  requirements: readonly TemplateRequirement[];
}>;
const TemplateInstantiationResultSchema: z.ZodType<TemplateInstantiationResult> = z.object({
  agent: z.object({
    id: z.string().min(1).max(200), name: z.string().min(1).max(200), ownerHumanId: z.string().min(1).max(200),
    visibility: z.enum(["PUBLIC", "PRIVATE"]), assignedRunnerId: z.string().min(1).max(200), modelId: z.string().min(1).max(200),
    mode: z.enum(["CLASSIC", "RLM_REPL", "WRAPPED"]), desiredState: z.literal("STOPPED"), runtimeState: z.literal("STOPPED"),
    channelIds: z.tuple([]),
  }).strict(),
  origin: z.object({
    packageReleaseId: z.string().min(1).max(200), mode: z.enum(["CLASSIC", "RLM_REPL", "WRAPPED"]),
    actorKind: z.enum(["ADMIN", "GRANT"]), actorHumanId: z.string().min(1).max(200),
    createdAt: z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }).strict(),
  requirements: z.array(z.object({
    name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), state: z.enum(["SATISFIED", "MISSING"]),
  }).strict()).max(64),
}).strict();

export class TemplateInstantiationError extends Error {
  constructor(readonly code: CatalogLibraryErrorCode) { super(code); }
}
const fail = (code: CatalogLibraryErrorCode): never => { throw new TemplateInstantiationError(code); };

type ReleaseRow = {
  package_release_id: string; authority_source_id: string; content_source_id: string;
  kind: "skill" | "native-agent" | "wrapped-agent"; name: string; version: string; digest: string;
  catalog_commit: string; package_commit: string; package_path: string; manifest_json: string;
  execution_preview_json: string; warnings_json: string; review_state: PackageReleaseView["reviewState"];
  review_digest: string | null; reviewed_by_human_id: string | null; reviewed_at: number | null;
  control_revision: number; installation_state: "INSTALLED" | "QUARANTINED" | null;
  installation_digest: string | null; activation_approval_state: PackageReleaseView["apiActivation"]["approvalState"] | null;
  activation_runtime_state: PackageReleaseView["apiActivation"]["runtimeState"] | null;
  activation_revision: number | null; activation_failure_code: PackageReleaseView["apiActivation"]["failureCode"];
  authority_enabled: number; authority_removed: number | null; content_enabled: number; content_removed: number | null;
  content_allow_packages: number; same_source: number;
};

type TemplateMode = "CLASSIC" | "RLM_REPL" | "WRAPPED";
type ResolvedRelease = { row: ReleaseRow; manifest: PackageManifest; view: PackageReleaseView };
type SkillPin = { release: ResolvedRelease; preload: boolean };
type AuditWriter = (tx: OrgOpsDb, event: CatalogAuditEvent) => void;

export type TemplateInstantiationDeps = Readonly<{
  db: OrgOpsDb;
  policy: CatalogPolicy;
  writeAudit: AuditWriter;
  resolveWorkspacePath(path: string): string;
  isWorkspaceAllowed(path: string): boolean;
  canUseSecret?(actor: AuthenticatedHuman, secret: { id: string; name: string; scopeType: string; scopeId: string | null }): boolean;
  secretReferenceResolver?: SecretReferenceResolver;
  management: AgentSkillManagement;
  now?: () => number;
  newId?: () => string;
}>;

const releaseSelect = `SELECT r.package_release_id,r.authority_source_id,r.content_source_id,r.kind,r.name,r.version,r.digest,
  r.catalog_commit,r.package_commit,r.package_path,r.manifest_json,r.execution_preview_json,r.warnings_json,
  c.review_state,c.review_digest,c.reviewed_by_human_id,c.reviewed_at,c.revision AS control_revision,
  i.state AS installation_state,i.artifact_digest AS installation_digest,
  a.approval_state AS activation_approval_state,a.runtime_state AS activation_runtime_state,
  a.revision AS activation_revision,a.failure_code AS activation_failure_code,
  authority.enabled AS authority_enabled,authority.removed_at AS authority_removed,
  content.enabled AS content_enabled,content.removed_at AS content_removed,content.allow_packages AS content_allow_packages,
  r.authority_source_id=r.content_source_id AS same_source
  FROM catalog_package_releases r
  JOIN catalog_release_controls c ON c.package_release_id=r.package_release_id
  JOIN catalog_sources authority ON authority.source_id=r.authority_source_id
  JOIN catalog_sources content ON content.source_id=r.content_source_id
  LEFT JOIN catalog_installations i ON i.release_id=r.package_release_id
  LEFT JOIN catalog_api_activations a ON a.release_id=r.package_release_id`;

function parseRelease(row: ReleaseRow): ResolvedRelease {
  try {
    const manifest = PackageManifestSchema.parse(JSON.parse(row.manifest_json));
    if (manifest.kind !== row.kind || manifest.name !== row.name || manifest.version !== row.version || manifest.digest !== row.digest) fail("INSPECTION_FAILED");
    const executionPreview = JSON.parse(row.execution_preview_json);
    const activationRequired = Array.isArray(executionPreview?.apiEventShapes) && executionPreview.apiEventShapes.length > 0;
    const view = PackageReleaseViewSchema.parse({
      packageReleaseId: row.package_release_id, authoritySourceId: row.authority_source_id,
      contentSourceId: row.content_source_id, kind: row.kind, name: row.name, version: row.version,
      digest: row.digest, catalogCommit: row.catalog_commit, packageCommit: row.package_commit,
      packagePath: row.package_path, manifest, executionPreview, warnings: JSON.parse(row.warnings_json),
      files: manifest.files.map(file => ({ path: file.path, mode: file.executable ? 0o755 : 0o644, size: file.size, digest: file.digest })),
      reviewState: row.review_state, reviewDigest: row.review_digest,
      reviewer: row.reviewed_by_human_id === null || row.reviewed_at === null ? null : { humanId: row.reviewed_by_human_id, reviewedAt: row.reviewed_at },
      installationState: row.installation_state ?? "ABSENT",
      apiActivation: row.activation_revision === null ? {
        approvalState: activationRequired ? "AWAITING_APPROVAL" : "NOT_REQUIRED", runtimeState: "INACTIVE", revision: 1, failureCode: null,
      } : { approvalState: row.activation_approval_state, runtimeState: row.activation_runtime_state, revision: row.activation_revision, failureCode: row.activation_failure_code },
      revision: row.control_revision,
    });
    return { row, manifest, view };
  } catch (error) {
    if (error instanceof TemplateInstantiationError) throw error;
    return fail("INSPECTION_FAILED");
  }
}

function modeFor(manifest: PackageManifest): TemplateMode {
  if (manifest.kind === "wrapped-agent") return "WRAPPED";
  if (manifest.kind === "native-agent") return manifest.native.mode;
  return fail("STATE_CONFLICT");
}

function fixedFailure(error: unknown): TemplateInstantiationError {
  return error instanceof TemplateInstantiationError ? error : new TemplateInstantiationError("STORAGE_FAILURE");
}

export function createTemplateInstantiation({
  db, policy, writeAudit, resolveWorkspacePath, isWorkspaceAllowed,
  canUseSecret = () => true, secretReferenceResolver, management, now = Date.now, newId = randomUUID,
}: TemplateInstantiationDeps) {
  const releaseById = db.prepare<[string], ReleaseRow>(`${releaseSelect} WHERE r.package_release_id=?`);
  const exactDependency = db.prepare<[string, string, string, string, string], ReleaseRow>(`${releaseSelect}
    WHERE r.authority_source_id=? AND r.content_source_id=? AND r.name=? AND r.version=? AND r.digest=?`);

  function currentGrant(actor: AuthenticatedHuman, releaseId: string): GrantView | undefined {
    if (actor.kind === "HUMAN_ADMIN") return undefined;
    const humanId = catalogGrantId(releaseId, "HUMAN", actor.id);
    const organizationId = catalogGrantId(releaseId, "ORGANIZATION");
    const rows = db.prepare<[string, string, string, string, string], {
      grant_id: string; release_id: string; subject_type: "ORGANIZATION" | "HUMAN"; human_id: string | null; revision: number; revoked_at: number | null;
    }>(`SELECT grant_id,release_id,subject_type,human_id,revision,revoked_at FROM catalog_grants WHERE revoked_at IS NULL AND
      ((grant_id=? AND release_id=? AND subject_type='HUMAN' AND human_id=?) OR
       (grant_id=? AND release_id=? AND subject_type='ORGANIZATION' AND human_id IS NULL))
      ORDER BY CASE subject_type WHEN 'HUMAN' THEN 0 ELSE 1 END LIMIT 2`).all(humanId, releaseId, actor.id, organizationId, releaseId);
    for (const row of rows) {
      const grant = parseCanonicalCatalogGrant({
        grantId: row.grant_id, releaseId: row.release_id,
        subject: row.subject_type === "ORGANIZATION" ? { kind: "ORGANIZATION" } : { kind: "HUMAN", humanId: row.human_id },
        revision: row.revision, revokedAt: row.revoked_at,
      });
      if (grant) return grant;
    }
    return undefined;
  }

  function requireLiveActor(actor: AuthenticatedHuman, ownerHumanId: string): void {
    if (!actor || (actor.kind !== "HUMAN_ADMIN" && actor.kind !== "AUTHENTICATED_HUMAN") || actor.id !== ownerHumanId) fail("FORBIDDEN");
    const row = db.prepare<[string], { is_admin: number; must_change_password: number }>(
      "SELECT is_admin,must_change_password FROM humans WHERE id=?",
    ).get(actor.id);
    if (!row || row.must_change_password !== 0 || (actor.kind === "HUMAN_ADMIN") !== (row.is_admin === 1)) fail("FORBIDDEN");
  }

  function resolveClosure(root: ResolvedRelease): SkillPin[] {
    const pins: SkillPin[] = [];
    const resolvedIds = new Set<string>();
    const seenNames = new Set<string>();
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const heights = new Map<string, number>();
    const preload = root.manifest.kind === "native-agent" ? new Set(root.manifest.native.alwaysPreloadedSkills) : new Set<string>();
    const visit = (parent: ResolvedRelease, depth: number): number => {
      const parentId = parent.row.package_release_id;
      if (visiting.has(parentId)) fail("IDENTITY_CONFLICT");
      if (depth > CATALOG_LIMITS.recursionDepth) fail("INSPECTION_FAILED");
      if (visited.has(parentId)) {
        const height = heights.get(parentId) ?? 0;
        if (depth + height > CATALOG_LIMITS.recursionDepth) fail("INSPECTION_FAILED");
        return height;
      }
      visiting.add(parentId);
      let height = 0;
      for (const pin of parent.manifest.dependencies) {
        const rows = exactDependency.all(pin.catalogId, pin.sourceId, pin.name, pin.version, pin.digest);
        if (rows.length !== 1) fail("IDENTITY_CONFLICT");
        const dependency = parseRelease(rows[0]!);
        const dependencyId = dependency.row.package_release_id;
        const expectedCommit = pin.revision.type === "exact" ? pin.revision.commit : parent.row.package_commit;
        if (dependency.row.kind !== "skill" || dependency.row.package_commit !== expectedCommit) fail("IDENTITY_CONFLICT");
        if (seenNames.has(dependency.row.name) && !resolvedIds.has(dependencyId)) fail("IDENTITY_CONFLICT");
        requireReleaseUsable(dependency);
        if (!resolvedIds.has(dependencyId)) {
          if (resolvedIds.size + 1 >= CATALOG_LIMITS.resolvedPackages) fail("INSPECTION_FAILED");
          resolvedIds.add(dependencyId);
          seenNames.add(dependency.row.name);
          pins.push({ release: dependency, preload: preload.has(dependency.row.name) });
        }
        height = Math.max(height, visit(dependency, depth + 1) + 1);
      }
      visiting.delete(parentId);
      visited.add(parentId);
      heights.set(parentId, height);
      return height;
    };
    visit(root, 0);
    return pins;
  }

  function requireReleaseUsable(release: ResolvedRelease): void {
    if (release.row.authority_enabled !== 1 || release.row.authority_removed !== null || release.row.content_enabled !== 1
      || release.row.content_removed !== null || (release.row.same_source !== 1 && release.row.content_allow_packages !== 1)) fail("SOURCE_NOT_ALLOWED");
    if (release.row.review_state !== "APPROVED" || release.row.review_digest === null) fail("RELEASE_NOT_APPROVED");
    if (release.row.installation_state !== "INSTALLED" || release.row.installation_digest !== release.row.digest) fail("INSTALLATION_REQUIRED");
    if (release.view.executionPreview.apiEventShapes.length > 0
      && (release.view.apiActivation.approvalState !== "APPROVED" || release.view.apiActivation.runtimeState !== "ACTIVE")) fail("API_ACTIVATION_REQUIRED");
  }

  async function instantiateTemplate(input: TemplateInstantiationInput, actor: AuthenticatedHuman): Promise<TemplateInstantiationResult> {
    try {
      const parsedInput = TemplateInstantiationInputSchema.safeParse(input);
      input = parsedInput.success ? parsedInput.data : fail("INVALID_REQUEST");
      const workspace = resolveWorkspacePath(input.workspacePath);
      if (!workspace || !isWorkspaceAllowed(workspace)) fail("INVALID_REQUEST");
      return db.transaction(() => {
        requireLiveActor(actor, input.ownerHumanId);
        const rootRow = releaseById.get(input.packageReleaseId);
        const root = parseRelease(rootRow ?? fail("NOT_FOUND"));
        const mode = modeFor(root.manifest);
        const grant = currentGrant(actor, root.row.package_release_id);
        const decision = policy.decide({ action: "TEMPLATE_INSTANTIATE", actor, release: root.view, ...(grant ? { grant } : {}) });
        if (!decision.allow) fail(decision.reasonCode);
        requireReleaseUsable(root);
        const existing = db.prepare<[string], { id: string; owner_human_id: string | null }>("SELECT id,owner_human_id FROM agents WHERE name=?").get(input.name);
        if (existing) fail("FORBIDDEN");
        if (!db.prepare<[string], { id: string }>("SELECT id FROM runner_nodes WHERE id=?").get(input.runnerId)) fail("INVALID_REQUEST");
        const model = db.prepare<[string], { id: string; enabled: number }>("SELECT id,enabled FROM models WHERE id=?").get(input.modelId);
        if ((!model || model.enabled !== 1) && !(mode === "WRAPPED" && input.modelId === "wrapped:none")) fail("INVALID_REQUEST");

        const requirements = root.manifest.secrets;
        const requirementNames = new Set(requirements.map(requirement => requirement.name));
        const bindings = new Map<string, string>();
        const opaqueBindings = input.secretBindings.filter(binding => binding.secretReferenceId);
        const satisfiedOpaque = new Set<string>();
        for (const binding of input.secretBindings) {
          if (!requirementNames.has(binding.requirementName) || bindings.has(binding.requirementName) || satisfiedOpaque.has(binding.requirementName)) fail("INVALID_REQUEST");
          if (binding.secretReferenceId) {
            if (!secretReferenceResolver || secretReferenceResolver.validate(actor, binding.secretReferenceId, "agent-provisioning") !== "VALID") fail("FORBIDDEN");
            satisfiedOpaque.add(binding.requirementName);
            continue;
          }
          if (!binding.secretId) fail("INVALID_REQUEST");
          const secret = db.prepare<[string], { id: string; name: string; scope_type: string; scope_id: string | null }>(
            "SELECT id,name,scope_type,scope_id FROM secrets WHERE id=?",
          ).get(binding.secretId!);
          if (!secret || !canUseSecret(actor, { id: secret.id, name: secret.name, scopeType: secret.scope_type, scopeId: secret.scope_id })) fail("FORBIDDEN");
          bindings.set(binding.requirementName, binding.secretId!);
        }
        const skillPins = resolveClosure(root);
        const timestamp = now();
        const agentId = newId();
        const actorKind = actor.kind === "HUMAN_ADMIN" ? "ADMIN" : "GRANT";
        const native = root.manifest.kind === "native-agent" ? root.manifest.native : undefined;
        const wrapped = root.manifest.kind === "wrapped-agent" ? (() => {
          const { source: _source, ...portable } = root.manifest.wrapped;
          return portable;
        })() : {};
        db.prepare(`INSERT INTO agents
          (id,name,model_id,system_instructions,soul_path,soul_contents,workspace_path,allow_outside_workspace,
           llm_call_timeout_ms,classic_max_model_steps,context_session_gap_ms,emit_audit_events,memory_context_mode,
           mode,visibility,owner_human_id,desired_state,runtime_state,assigned_runner_id,last_heartbeat_at,
           created_at,updated_at,enabled_skills_json,always_preloaded_skills_json,wrapped_config_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          agentId, input.name, input.modelId, native?.systemInstructions ?? "", `souls/${input.name}.md`, native?.soulContents ?? "", workspace, 0,
          native?.runtime.llmCallTimeoutMs ?? null, native?.runtime.classicMaxModelSteps ?? null,
          native?.runtime.contextSessionGapMs ?? null, native?.runtime.emitAuditEvents === false ? 0 : 1,
          mode === "WRAPPED" ? "OFF" : native?.runtime.memoryContextMode ?? "PER_CHANNEL_CROSS_CHANNEL",
          mode, input.visibility, actor.id, "STOPPED", "STOPPED", input.runnerId, null,
          timestamp, timestamp, "[]", "[]", JSON.stringify(wrapped),
        );
        db.prepare(`INSERT INTO agent_template_origins
          (agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,grant_id,authority_source_id,content_source_id,
           package_kind,package_name,package_version,catalog_commit,package_commit,package_path,package_digest,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(agentId, root.row.package_release_id, mode, actorKind, actor.id, grant?.grantId ?? null,
            root.row.authority_source_id, root.row.content_source_id, root.row.kind, root.row.name, root.row.version,
            root.row.catalog_commit, root.row.package_commit, root.row.package_path, root.row.digest, timestamp);
        const commands = skillPins.map(pin => ({ kind: "CATALOG" as const, operation: "ASSIGN" as const, agentId, packageReleaseId: pin.release.row.package_release_id, preload: pin.preload, expectedAgentRevision: 1, expectedAssignmentRevision: 0 }));
        if (commands.length > 0) {
          const scoped = management.inTransaction(db, actor, commands, 1);
          scoped.recheck();
          scoped.applyAll();
        }
        for (const [requirementName, secretId] of bindings) {
          db.prepare(`INSERT INTO agent_package_secret_bindings
            (agent_id,release_id,requirement_name,secret_id,created_by_human_id,revision,created_at,updated_at)
            VALUES (?,?,?,?,?,1,?,?)`).run(agentId, root.row.package_release_id, requirementName, secretId, actor.id, timestamp, timestamp);
        }
        if (opaqueBindings.length > 0) secretReferenceResolver!.bindForWrite(db, actor, agentId, opaqueBindings.map(binding => ({ requirementName: binding.requirementName, secretReferenceId: binding.secretReferenceId! })));
        const audit = CatalogAuditEventSchema.parse({
          type: "audit.catalog.template.instantiated", source: "system", status: "DELIVERED", channelId: null,
          payload: { actorKind: actor.kind, actorId: actor.id, action: "template.instantiate", outcome: "SUCCEEDED", revision: 1,
            releaseId: root.row.package_release_id, agentId, runnerId: input.runnerId, digest: root.row.digest },
        });
        writeAudit(db, audit as CatalogAuditEvent);
        const result: TemplateInstantiationResult = {
          agent: { id: agentId, name: input.name, ownerHumanId: actor.id, visibility: input.visibility,
            assignedRunnerId: input.runnerId, modelId: input.modelId, mode, desiredState: "STOPPED", runtimeState: "STOPPED", channelIds: [] },
          origin: { packageReleaseId: root.row.package_release_id, mode, actorKind, actorHumanId: actor.id, createdAt: timestamp },
          requirements: requirements.map(requirement => ({ name: requirement.name, state: bindings.has(requirement.name) || satisfiedOpaque.has(requirement.name) ? "SATISFIED" : "MISSING" })),
        };
        return TemplateInstantiationResultSchema.parse(result);
      }).immediate();
    } catch (error) {
      throw fixedFailure(error);
    }
  }

  return { instantiateTemplate };
}

export type TemplateInstantiation = ReturnType<typeof createTemplateInstantiation>;
