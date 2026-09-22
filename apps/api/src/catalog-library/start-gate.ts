import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { OrgOpsDb } from "@orgops/db";
import { computeArtifactSemanticDigest, computePackageSetDigest, resolveImmutablePackageClosure } from "@orgops/skills";
import {
  AuthenticatedPrincipalSchema,
  DigestSchema,
  PackageManifestSchema,
  PackageReleaseIdSchema,
  PortableWrappedRecipeSchema,
  ReleaseIdentitySchema,
  RequirementReasonSchema,
  StartRequirementsResultSchema,
  type AuthenticatedPrincipal,
  type CatalogStartGate,
  type RequirementReason,
  type StartRequirementsResult,
} from "@orgops/schemas";

const id = z.string().min(1).max(200);
const revision = z.number().int().min(1).max(2_147_483_647);
const zeroOne = z.union([z.literal(0), z.literal(1)]);
const AgentAuthorizationSchema = z.object({ id, name: id, assigned_runner_id: id.nullable() }).passthrough();
const AgentSchema = z.object({
  id, name: id, model_id: id, workspace_path: z.string().min(1).max(4096), allow_outside_workspace: zeroOne,
  mode: z.enum(["CLASSIC", "RLM_REPL", "WRAPPED"]), wrapped_config_json: z.string().max(262144),
  visibility: z.enum(["PUBLIC", "PRIVATE"]), owner_human_id: id.nullable(), assigned_runner_id: id.nullable(),
  desired_state: z.enum(["RUNNING", "STOPPED"]), runtime_state: z.enum(["STARTING", "RUNNING", "STOPPED", "CRASHED"]), revision,
}).strict();
type AgentRow = z.infer<typeof AgentSchema>;
const OriginSchema = z.object({
  agent_id: id, release_id: PackageReleaseIdSchema, mode: z.enum(["CLASSIC", "RLM_REPL", "WRAPPED"]),
  consumed_by_kind: z.enum(["ADMIN", "GRANT"]), consumed_by_human_id: id, grant_id: id.nullable(),
  authority_source_id: id, content_source_id: id, package_kind: z.enum(["native-agent", "wrapped-agent"]),
  package_name: id, package_version: id, catalog_commit: z.string().min(1).max(64), package_commit: z.string().min(1).max(64),
  package_path: z.string().min(1).max(4096), package_digest: DigestSchema,
  created_at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((row, context) => {
  if ((row.consumed_by_kind === "GRANT") !== (row.grant_id !== null)) context.addIssue({ code: "custom", message: "origin provenance mismatch" });
});
const AssignmentSchema = z.object({
  assignment_id: id, agent_id: id, release_id: PackageReleaseIdSchema, local_skill_name: id,
  desired_state: z.enum(["DISABLED", "ENABLED"]), effective_state: z.enum(["DISABLED", "ENABLED"]),
  deployment_state: z.enum(["STABLE", "REQUESTED", "DEPLOYING", "FAILED"]), removal_requested: zeroOne, preload: zeroOne, effective_preload: zeroOne,
  active_generation: id.nullable(), desired_generation: id, revision,
  actor_kind: z.enum(["ADMIN", "GRANT"]), actor_human_id: id, grant_id: id.nullable(),
}).strict().superRefine((row, context) => {
  if ((row.actor_kind === "GRANT") !== (row.grant_id !== null)) context.addIssue({ code: "custom", message: "assignment provenance mismatch" });
});
type AssignmentRow = z.infer<typeof AssignmentSchema>;
const ReleaseSchema = z.object({
  package_release_id: PackageReleaseIdSchema, authority_source_id: id, content_source_id: id,
  kind: z.enum(["skill", "native-agent", "wrapped-agent"]), name: id, version: id, digest: DigestSchema,
  catalog_commit: z.string().min(1).max(64), package_commit: z.string().min(1).max(64), package_path: z.string().min(1).max(4096),
  manifest_json: z.string().max(262144),
}).strict();
type ReleaseRow = z.infer<typeof ReleaseSchema>;
const InstallationSchema = z.object({ release_id: PackageReleaseIdSchema, artifact_digest: DigestSchema,
  artifact_path: z.string().min(1).max(4096), state: z.enum(["INSTALLED", "QUARANTINED"]), installed_by_human_id: id, revision }).strict();
const ActivationSchema = z.object({ release_id: PackageReleaseIdSchema,
  approval_state: z.enum(["NOT_REQUIRED", "AWAITING_APPROVAL", "APPROVED", "REVOKED"]),
  runtime_state: z.enum(["INACTIVE", "ACTIVATING", "ACTIVE", "DEACTIVATING", "FAILED"]), revision }).strict();
const DeploymentSchema = z.object({
  deployment_id: id, rollout_id: id.nullable(), target_agent_id: id, release_id: PackageReleaseIdSchema,
  bound_runner_id: id, desired_generation: id, state: z.literal("ACTIVE"),
  attempt_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), lease_expires_at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  revision, failure_code: z.null(), desired_roots_json: z.string().min(2).max(262144), package_set_digest: DigestSchema,
  artifact_semantic_digest: DigestSchema, created_at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  updated_at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), completed_at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();
const ParticipantSchema = z.object({ deployment_id: id, assignment_id: id, agent_id: id,
  release_id: PackageReleaseIdSchema, local_skill_name: id, role: z.enum(["APPLY_DESIRED", "CARRY_EFFECTIVE"]),
  target_state: z.enum(["DISABLED", "ENABLED"]), target_preload: zeroOne,
  prior_effective_state: z.enum(["DISABLED", "ENABLED"]), prior_effective_preload: zeroOne,
  prior_active_generation: id.nullable(), assignment_revision: revision,
}).strict();

export class CatalogStartGateError extends Error {
  constructor(readonly code: "FORBIDDEN" | "STORAGE_FAILURE") { super(code); }
}

type Deps = {
  db: OrgOpsDb;
  projectRoot: string;
  artifactRoot: string;
  canManageHuman: (actor: Extract<AuthenticatedPrincipal, { kind: "HUMAN_ADMIN" | "AUTHENTICATED_HUMAN" }>, agentName: string) => boolean;
  isSecretUsable?: (ciphertext: string) => boolean;
  now?: () => number;
};

const denied = (reason: RequirementReason): StartRequirementsResult => StartRequirementsResultSchema.parse({
  ok: false, code: "REQUIREMENTS_UNSATISFIED", reasons: [reason],
});
const corruption = (): StartRequirementsResult => denied({ code: "DEPLOYMENT_REQUIRED" });
export function createCatalogStartGate({ db, projectRoot: _projectRoot, artifactRoot, canManageHuman,
  isSecretUsable = () => false, now = Date.now }: Deps): CatalogStartGate {
  const configuredArtifactRoot = resolve(artifactRoot);
  const agentById = db.prepare<[string], unknown>(`SELECT id,name,model_id,workspace_path,allow_outside_workspace,mode,wrapped_config_json,
    visibility,owner_human_id,assigned_runner_id,desired_state,runtime_state,revision FROM agents WHERE id=?`);

  function authorize(agentId: string, rawActor: AuthenticatedPrincipal, requireValidAgent = true): AgentRow | undefined {
    const actorResult = AuthenticatedPrincipalSchema.safeParse(rawActor);
    const rawAgent = agentById.get(agentId);
    const authorizationResult = AgentAuthorizationSchema.safeParse(rawAgent);
    if (!actorResult.success || !authorizationResult.success) throw new CatalogStartGateError("FORBIDDEN");
    const actor = actorResult.data;
    const authorization = authorizationResult.data;
    if (actor.kind === "RUNNER") {
      const runner = db.prepare<[string], { id: string }>("SELECT id FROM runner_nodes WHERE id=?").get(actor.runnerId);
      if (!runner || authorization.assigned_runner_id !== actor.runnerId) throw new CatalogStartGateError("FORBIDDEN");
      const parsed = AgentSchema.safeParse(rawAgent);
      if (!parsed.success) { if (requireValidAgent) throw new Error("malformed agent"); return undefined; }
      return parsed.data;
    }
    if (actor.kind === "AGENT") throw new CatalogStartGateError("FORBIDDEN");
    const human = db.prepare<[string], { id: string; is_admin: number; must_change_password: number }>(
      "SELECT id,is_admin,must_change_password FROM humans WHERE id=?",
    ).get(actor.id);
    const roleMatches = actor.kind === "HUMAN_ADMIN" ? human?.is_admin === 1 : human?.is_admin === 0 || human?.is_admin === 1;
    if (!human || human.must_change_password !== 0 || !roleMatches || !canManageHuman(actor, authorization.name)) {
      throw new CatalogStartGateError("FORBIDDEN");
    }
    const parsed = AgentSchema.safeParse(rawAgent);
    if (!parsed.success) { if (requireValidAgent) throw new Error("malformed agent"); return undefined; }
    return parsed.data;
  }

  function parseRows<T>(schema: z.ZodType<T>, rows: unknown[]): T[] | null {
    const parsed: T[] = [];
    for (const row of rows) { const result = schema.safeParse(row); if (!result.success) return null; parsed.push(result.data); }
    return parsed;
  }

  function validate(agentId: string, actor: AuthenticatedPrincipal): StartRequirementsResult {
    let agent: AgentRow;
    try { agent = authorize(agentId, actor)!; } catch (error) {
      if (error instanceof CatalogStartGateError) throw error;
      return corruption();
    }
    try {
      const originRaw = db.prepare<[string], unknown>(`SELECT agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,grant_id,
        authority_source_id,content_source_id,package_kind,package_name,package_version,catalog_commit,package_commit,package_path,package_digest,created_at
        FROM agent_template_origins WHERE agent_id=?`).get(agent.id);
      const assignmentRaw = db.prepare<[string], unknown>(`SELECT assignment_id,agent_id,release_id,local_skill_name,desired_state,
        effective_state,deployment_state,removal_requested,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,grant_id
        FROM agent_skill_assignments WHERE agent_id=? ORDER BY lower(local_skill_name),assignment_id`).all(agent.id);
      if (originRaw === undefined && assignmentRaw.length === 0) return { ok: true };
      const originResult = originRaw === undefined ? null : OriginSchema.safeParse(originRaw);
      const assignments = parseRows(AssignmentSchema, assignmentRaw);
      if ((originResult && !originResult.success) || !assignments) return corruption();
      const origin = originResult?.success ? originResult.data : null;
      if (origin && (origin.agent_id !== agent.id || origin.mode !== agent.mode)) return corruption();

      const reasons: RequirementReason[] = [];
      const add = (reason: RequirementReason) => {
        const parsed = RequirementReasonSchema.safeParse(reason);
        if (!parsed.success || reasons.length >= 64) throw new Error("reason overflow");
        if (!reasons.some(existing => JSON.stringify(existing) === JSON.stringify(parsed.data))) reasons.push(parsed.data);
      };
      if (!agent.assigned_runner_id || !db.prepare<[string], { id: string }>("SELECT id FROM runner_nodes WHERE id=?").get(agent.assigned_runner_id)) {
        add({ code: "RUNNER_BINDING_MISSING" });
      }
      if (!(agent.mode === "WRAPPED" && agent.model_id === "wrapped:none")) {
        const model = db.prepare<[string], unknown>("SELECT id,provider,model_name,enabled,defaults_json FROM models WHERE id=?").get(agent.model_id);
        const modelResult = z.object({ id, provider: id, model_name: id, enabled: zeroOne, defaults_json: z.string().max(262144) }).strict().safeParse(model);
        let defaultsValid = false;
        if (modelResult.success) {
          try { const defaults = JSON.parse(modelResult.data.defaults_json); defaultsValid = Boolean(defaults && typeof defaults === "object" && !Array.isArray(defaults)); }
          catch { defaultsValid = false; }
        }
        if (!modelResult.success || modelResult.data.enabled !== 1 || !defaultsValid) add({ code: "MODEL_BINDING_MISSING" });
      }
      if (agent.workspace_path.includes("\0") || !isAbsolute(agent.workspace_path)
        || resolve(agent.workspace_path) === resolve("/") || dirname(resolve(agent.workspace_path)) === resolve("/")) {
        add({ code: "WORKSPACE_BINDING_MISSING" });
      }
      if (agent.mode === "WRAPPED") {
        let config: unknown;
        try { config = JSON.parse(agent.wrapped_config_json); } catch { config = null; }
        if (!PortableWrappedRecipeSchema.safeParse(config).success) add({ code: "WRAPPED_WIRING_MISSING" });
      }

      const requiredReleaseIds = new Set<string>();
      if (origin) requiredReleaseIds.add(origin.release_id);
      for (const assignment of assignments) {
        if (assignment.agent_id !== agent.id) return corruption();
        if (assignment.removal_requested !== 1 && (assignment.desired_state === "ENABLED" || assignment.effective_state === "ENABLED")) requiredReleaseIds.add(assignment.release_id);
      }
      type Immutable = { row: ReleaseRow; manifest: z.infer<typeof PackageManifestSchema>; release: z.infer<typeof ReleaseIdentitySchema> };
      const immutableCache = new Map<string, Immutable | null>();
      const immutableById = (releaseId: string): Immutable | undefined => {
        if (immutableCache.has(releaseId)) return immutableCache.get(releaseId) ?? undefined;
        const releaseResult = ReleaseSchema.safeParse(db.prepare<[string], unknown>(`SELECT package_release_id,authority_source_id,
          content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json
          FROM catalog_package_releases WHERE package_release_id=?`).get(releaseId));
        if (!releaseResult.success) { immutableCache.set(releaseId, null); return undefined; }
        const row = releaseResult.data;
        let rawManifest: unknown;
        try { rawManifest = JSON.parse(row.manifest_json); } catch { rawManifest = null; }
        const manifestResult = PackageManifestSchema.safeParse(rawManifest);
        const releaseResultIdentity = ReleaseIdentitySchema.safeParse({ packageReleaseId: row.package_release_id,
          authoritySourceId: row.authority_source_id, contentSourceId: row.content_source_id, kind: row.kind, name: row.name,
          version: row.version, catalogCommit: row.catalog_commit, packageCommit: row.package_commit,
          packagePath: row.package_path, digest: row.digest });
        if (!manifestResult.success || !releaseResultIdentity.success || manifestResult.data.kind !== row.kind
          || manifestResult.data.name !== row.name || manifestResult.data.version !== row.version || manifestResult.data.digest !== row.digest) {
          immutableCache.set(releaseId, null); return undefined;
        }
        const value = { row, manifest: manifestResult.data, release: releaseResultIdentity.data };
        immutableCache.set(releaseId, value); return value;
      };
      const exactPin = (pin: (z.infer<typeof PackageManifestSchema>)["dependencies"][number]): Immutable[] => {
        const rows = db.prepare<[string, string, string, string, string], { package_release_id: string }>(`SELECT package_release_id
          FROM catalog_package_releases WHERE authority_source_id=? AND content_source_id=? AND name=? AND version=? AND digest=?
          ORDER BY package_release_id`).all(pin.catalogId, pin.sourceId, pin.name, pin.version, pin.digest);
        if (rows.length !== 1) return [];
        const item = immutableById(rows[0]!.package_release_id);
        return item ? [item] : [];
      };
      for (const releaseId of [...requiredReleaseIds].sort()) {
        const release = immutableById(releaseId);
        if (!release) { add({ code: "INSTALLATION_REQUIRED", packageReleaseId: releaseId }); continue; }
        const { row, manifest } = release;
        const originModeMismatch = row.kind === "native-agent"
          ? manifest.kind !== "native-agent" || manifest.native.mode !== origin?.mode
          : row.kind === "wrapped-agent" ? origin?.mode !== "WRAPPED" : origin !== null;
        if (origin && releaseId === origin.release_id && (origin.authority_source_id !== row.authority_source_id
          || origin.content_source_id !== row.content_source_id || origin.package_kind !== row.kind || origin.package_name !== row.name
          || origin.package_version !== row.version || origin.catalog_commit !== row.catalog_commit
          || origin.package_commit !== row.package_commit || origin.package_path !== row.package_path || origin.package_digest !== row.digest
          || originModeMismatch)) {
          add({ code: "INSTALLATION_REQUIRED", packageReleaseId: releaseId }); continue;
        }
        const installResult = InstallationSchema.safeParse(db.prepare<[string], unknown>(
          "SELECT release_id,artifact_digest,artifact_path,state,installed_by_human_id,revision FROM catalog_installations WHERE release_id=?",
        ).get(releaseId));
        if (installResult.success && installResult.data.state === "QUARANTINED") add({ code: "QUARANTINED", packageReleaseId: releaseId });
        else if (!installResult.success || installResult.data.artifact_digest !== row.digest
          || resolve(installResult.data.artifact_path) !== resolve(configuredArtifactRoot, row.name, row.digest.slice(7))
          || !db.prepare<[string], { id: string }>("SELECT id FROM humans WHERE id=?").get(installResult.data.installed_by_human_id)) {
          add({ code: "INSTALLATION_REQUIRED", packageReleaseId: releaseId });
        }
        if (manifest.executables.some(executable => executable.execution === "api-event-shapes")) {
          const activation = ActivationSchema.safeParse(db.prepare<[string], unknown>(
            "SELECT release_id,approval_state,runtime_state,revision FROM catalog_api_activations WHERE release_id=?",
          ).get(releaseId));
          if (!activation.success || activation.data.approval_state !== "APPROVED" || activation.data.runtime_state !== "ACTIVE") {
            add({ code: "API_ACTIVATION_REQUIRED", packageReleaseId: releaseId });
          }
        }
        for (const requirement of manifest.secrets.filter(secret => secret.required)) {
          const rows = db.prepare<[string, string, string], unknown>(`SELECT b.agent_id,b.release_id,b.requirement_name,b.secret_id,b.revision,
            s.id AS current_secret_id,s.name,s.scope_type,s.scope_id,s.ciphertext_b64 FROM agent_package_secret_bindings b
            LEFT JOIN secrets s ON s.id=b.secret_id WHERE b.agent_id=? AND b.release_id=? AND b.requirement_name=?`)
            .all(agent.id, releaseId, requirement.name);
          const bindingSchema = z.object({ agent_id: id, release_id: PackageReleaseIdSchema,
            requirement_name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), secret_id: id, revision,
            current_secret_id: id.nullable(), name: id.nullable(), scope_type: id.nullable(), scope_id: id.nullable(), ciphertext_b64: z.string().min(1).max(1048576).nullable() }).strict();
          const binding = rows.length === 1 ? bindingSchema.safeParse(rows[0]) : null;
          let usable = false;
          if (binding?.success && binding.data.current_secret_id === binding.data.secret_id
            && binding.data.name === requirement.name && binding.data.scope_type === "package"
            && binding.data.scope_id === row.name && binding.data.ciphertext_b64 !== null) {
            try { usable = isSecretUsable(binding.data.ciphertext_b64) === true; } catch { usable = false; }
          }
          if (!usable) add({ code: "SECRET_BINDING_MISSING", packageReleaseId: releaseId, requirementName: requirement.name });
        }
      }

      if (assignments.length) {
        type Deployment = z.infer<typeof DeploymentSchema>;
        type Participant = z.infer<typeof ParticipantSchema>;
        const deploymentSelect = `SELECT deployment_id,rollout_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,
          attempt_token,lease_expires_at,revision,failure_code,desired_roots_json,package_set_digest,artifact_semantic_digest,
          created_at,updated_at,completed_at FROM runner_package_deployments`;
        const participantSelect = `SELECT deployment_id,assignment_id,agent_id,release_id,local_skill_name,role,target_state,target_preload,
          prior_effective_state,prior_effective_preload,prior_active_generation,assignment_revision
          FROM runner_deployment_participants`;
        const participantHistoryValid = (participant: Participant, deployment: Deployment): boolean =>
          !(participant.target_state === "DISABLED" && participant.target_preload !== 0)
          && !(participant.prior_effective_state === "DISABLED" && participant.prior_effective_preload !== 0)
          && !(participant.prior_effective_state === "ENABLED" && participant.prior_active_generation === null)
          && !(participant.prior_active_generation !== null && participant.prior_active_generation === deployment.desired_generation)
          && (participant.role === "APPLY_DESIRED" || (participant.prior_active_generation !== null
            && participant.target_state === participant.prior_effective_state
            && participant.target_preload === participant.prior_effective_preload));
        const frozenDeployment = (raw: unknown, expected: readonly Pick<Participant,
          "assignment_id" | "agent_id" | "release_id" | "local_skill_name">[]): { deployment: Deployment; participants: Participant[] } | null => {
          const deploymentResult = DeploymentSchema.safeParse(raw);
          if (!deploymentResult.success || deploymentResult.data.target_agent_id !== agent.id) return null;
          const deployment = deploymentResult.data;
          const participants = parseRows(ParticipantSchema, db.prepare<[string], unknown>(`${participantSelect}
            WHERE deployment_id=? ORDER BY lower(local_skill_name),assignment_id`).all(deployment.deployment_id));
          if (!participants || participants.length !== expected.length
            || new Set(participants.map(item => item.assignment_id)).size !== participants.length
            || new Set(participants.map(item => item.local_skill_name.toLowerCase())).size !== participants.length
            || participants.some(item => item.deployment_id !== deployment.deployment_id || item.agent_id !== agent.id
              || !participantHistoryValid(item, deployment))
            || expected.some(item => !participants.some(participant => participant.assignment_id === item.assignment_id
              && participant.agent_id === item.agent_id && participant.release_id === item.release_id
              && participant.local_skill_name === item.local_skill_name))
            || !participants.some(item => item.release_id === deployment.release_id)) return null;
          let roots: unknown;
          try { roots = JSON.parse(deployment.desired_roots_json); } catch { roots = null; }
          const rootResult = z.array(ReleaseIdentitySchema).max(256).safeParse(roots);
          const rootIds = [...new Set(participants.filter(item => item.target_state === "ENABLED").map(item => item.release_id))];
          const expectedRoots = rootIds.map(releaseId => immutableById(releaseId)?.release);
          if (!rootResult.success || expectedRoots.some(item => item === undefined)
            || JSON.stringify(rootResult.success ? rootResult.data : null) !== JSON.stringify(expectedRoots)) return null;
          const packages = resolveImmutablePackageClosure(rootIds, {
            byId: releaseId => { const item = immutableById(releaseId); return item && { release: item.release, manifest: item.manifest }; },
            byPin: pin => exactPin(pin).map(item => ({ release: item.release, manifest: item.manifest })),
          });
          if (!packages || JSON.stringify(packages.filter(item => item.direct).map(item => item.release)) !== JSON.stringify(rootResult.data)
            || computePackageSetDigest(packages.map(item => item.release)) !== deployment.package_set_digest
            || computeArtifactSemanticDigest({ deploymentId: deployment.deployment_id, agentId: agent.id,
              generation: deployment.desired_generation, packages }) !== deployment.artifact_semantic_digest) return null;
          return { deployment, participants };
        };

        const names = new Set(assignments.map(item => item.local_skill_name.toLowerCase()));
        const commonGeneration = assignments[0]?.active_generation ?? null;
        let deploymentInvalid = names.size !== assignments.length || commonGeneration === null;
        for (const assignment of assignments) {
          if (assignment.deployment_state !== "STABLE" || assignment.desired_state !== assignment.effective_state
            || assignment.preload !== assignment.effective_preload || assignment.active_generation !== assignment.desired_generation
            || assignment.active_generation !== commonGeneration || (assignment.desired_state === "DISABLED" && assignment.preload !== 0)) deploymentInvalid = true;
        }
        const currentRows = commonGeneration && agent.assigned_runner_id
          ? db.prepare<[string, string, string], unknown>(`${deploymentSelect} WHERE target_agent_id=? AND bound_runner_id=?
            AND desired_generation=? AND state='ACTIVE' ORDER BY completed_at DESC,deployment_id DESC`)
            .all(agent.id, agent.assigned_runner_id, commonGeneration) : [];
        const current = currentRows.length === 1 ? frozenDeployment(currentRows[0], assignments.map(item => ({
          assignment_id: item.assignment_id, agent_id: item.agent_id, release_id: item.release_id, local_skill_name: item.local_skill_name,
        }))) : null;
        if (!current) deploymentInvalid = true;
        else {
          for (const assignment of assignments) {
            const participant = current.participants.find(item => item.assignment_id === assignment.assignment_id);
            if (!participant) { deploymentInvalid = true; continue; }
            if (participant.role === "APPLY_DESIRED") {
              if (assignment.revision !== participant.assignment_revision + 2 || assignment.deployment_state !== "STABLE"
                || assignment.desired_state !== participant.target_state || assignment.effective_state !== participant.target_state
                || assignment.preload !== participant.target_preload || assignment.effective_preload !== participant.target_preload
                || assignment.desired_generation !== current.deployment.desired_generation
                || assignment.active_generation !== current.deployment.desired_generation) deploymentInvalid = true;
            } else if (participant.prior_active_generation === null || assignment.revision !== participant.assignment_revision + 1
              || assignment.effective_state !== participant.prior_effective_state
              || assignment.effective_preload !== participant.prior_effective_preload || assignment.deployment_state === "FAILED"
              || assignment.deployment_state !== "STABLE" || assignment.desired_state !== participant.prior_effective_state
              || assignment.preload !== participant.prior_effective_preload
              || assignment.desired_generation !== current.deployment.desired_generation
              || assignment.active_generation !== current.deployment.desired_generation) deploymentInvalid = true;
          }

          const priorGenerations = [...new Set(current.participants.flatMap(item => item.prior_active_generation === null ? [] : [item.prior_active_generation]))];
          for (const generation of priorGenerations) {
            if (generation === current.deployment.desired_generation) { deploymentInvalid = true; continue; }
            const expected = current.participants.filter(item => item.prior_active_generation === generation);
            const priorRows = db.prepare<[string, string, string], unknown>(`${deploymentSelect} WHERE target_agent_id=?
              AND desired_generation=? AND deployment_id<>? AND state='ACTIVE' ORDER BY completed_at DESC,deployment_id DESC`)
              .all(agent.id, generation, current.deployment.deployment_id);
            const prior = priorRows.length === 1 ? frozenDeployment(priorRows[0], expected) : null;
            if (!prior) { deploymentInvalid = true; continue; }
            for (const currentParticipant of expected) {
              const priorParticipant = prior.participants.find(item => item.assignment_id === currentParticipant.assignment_id);
              if (!priorParticipant || priorParticipant.target_state !== currentParticipant.prior_effective_state
                || priorParticipant.target_preload !== currentParticipant.prior_effective_preload) {
                deploymentInvalid = true; continue;
              }
              const completedRevision = priorParticipant.assignment_revision + (priorParticipant.role === "APPLY_DESIRED" ? 2 : 1);
              if (completedRevision > 2_147_483_647 || completedRevision > currentParticipant.assignment_revision) deploymentInvalid = true;
            }
          }
        }
        if (deploymentInvalid) add({ code: "DEPLOYMENT_REQUIRED" });
      }

      reasons.sort((left, right) => `${left.code}\0${left.packageReleaseId ?? ""}\0${left.requirementName ?? ""}`
        .localeCompare(`${right.code}\0${right.packageReleaseId ?? ""}\0${right.requirementName ?? ""}`));
      return reasons.length ? StartRequirementsResultSchema.parse({ ok: false, code: "REQUIREMENTS_UNSATISFIED", reasons }) : { ok: true };
    } catch (error) {
      if (error instanceof CatalogStartGateError) throw error;
      return corruption();
    }
  }

  async function validateCatalogStart(agentId: string, actor: AuthenticatedPrincipal): Promise<StartRequirementsResult> {
    try { return StartRequirementsResultSchema.parse(db.transaction(() => validate(agentId, actor)).immediate()); }
    catch (error) { if (error instanceof CatalogStartGateError) throw error; throw new CatalogStartGateError("STORAGE_FAILURE"); }
  }

  async function setDesiredAgentState(agentId: string, desired: "RUNNING" | "STOPPED", actor: AuthenticatedPrincipal): Promise<StartRequirementsResult> {
    try {
      return StartRequirementsResultSchema.parse(db.transaction(() => {
        if (desired === "RUNNING") {
          const result = validate(agentId, actor);
          if (!result.ok) return result;
        } else {
          authorize(agentId, actor, false);
        }
        const changed = db.prepare("UPDATE agents SET desired_state=?,runtime_state=?,updated_at=? WHERE id=?")
          .run(desired, desired === "RUNNING" ? "STARTING" : "STOPPED", now(), agentId);
        if (changed.changes !== 1) throw new CatalogStartGateError("STORAGE_FAILURE");
        return { ok: true as const };
      }).immediate());
    } catch (error) { if (error instanceof CatalogStartGateError) throw error; throw new CatalogStartGateError("STORAGE_FAILURE"); }
  }

  return { validateCatalogStart, setDesiredAgentState };
}
