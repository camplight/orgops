import { constants } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { OrgOpsDb } from "@orgops/db";
import {
  CatalogAuditEventSchema,
  DeploymentClaimContextSchema,
  DeploymentContextSchema,
  DeploymentReportSchema,
  PackageManifestSchema,
  ReleaseIdentitySchema,
  RunnerContextSchema,
  RunnerStartRequirementsContextSchema,
  StartRequirementsResultSchema,
  VerifiedArtifactEnvelopeSchema,
  type CatalogAuditEvent,
  type CatalogLibraryErrorCode,
  type DeploymentClaim,
  type DeploymentCommand,
  type DeploymentReceipt,
  type PackageManifest,
  type ReleaseIdentity,
  type CatalogStartGate,
  type RunnerArtifactDelivery,
  type RunnerStartGateDelivery,
  type VerifiedArtifactEnvelope,
} from "@orgops/schemas";
import { recomputeRolloutAggregate } from "./rollout";
import { canonicalManifestBytes, computeArtifactSemanticDigest, computePackageSetDigest, inspectPackage, packageNamespace,
  resolveImmutablePackageClosure } from "@orgops/skills";

const INT_MAX = 2_147_483_647;
const LIVE = ["QUEUED", "CLAIMED", "STAGED", "WAITING_FOR_IDLE"] as const;
const id = z.string().min(1).max(200);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const safeTimestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const DeploymentRowSchema = z.object({
  deployment_id: id, rollout_id: id.nullable(), target_agent_id: id, release_id: id, bound_runner_id: id,
  desired_generation: id, state: z.enum(["QUEUED", "CLAIMED", "STAGED", "WAITING_FOR_IDLE", "ACTIVE", "FAILED", "SUPERSEDED"]),
  attempt_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).nullable(), lease_expires_at: safeTimestamp.nullable(),
  revision: z.number().int().min(1).max(INT_MAX),
  failure_code: z.enum(["DEPLOYMENT_SUPERSEDED", "INSPECTION_FAILED", "STORAGE_FAILURE"]).nullable(),
  desired_roots_json: z.string().max(262144).nullable(), package_set_digest: digest.nullable(), artifact_semantic_digest: digest.nullable(),
  completed_at: safeTimestamp.nullable(), agent_name: id, assigned_runner_id: id.nullable(),
}).strict().superRefine((row, context) => {
  const tokenPresent = row.attempt_token !== null; const leasePresent = row.lease_expires_at !== null;
  const pairRequired = row.state === "CLAIMED" || row.state === "STAGED" || row.state === "WAITING_FOR_IDLE"
    || row.state === "ACTIVE" || row.state === "FAILED";
  if (tokenPresent !== leasePresent || (pairRequired && !tokenPresent) || (row.state === "QUEUED" && tokenPresent)) {
    context.addIssue({ code: "custom", message: "lease invariant" });
  }
  if (row.state === "FAILED" && row.failure_code !== "INSPECTION_FAILED" && row.failure_code !== "STORAGE_FAILURE") {
    context.addIssue({ code: "custom", message: "failure invariant" });
  }
  if (row.state === "SUPERSEDED" && row.failure_code !== "DEPLOYMENT_SUPERSEDED") context.addIssue({ code: "custom", message: "failure invariant" });
  if (row.state !== "FAILED" && row.state !== "SUPERSEDED" && row.failure_code !== null) context.addIssue({ code: "custom", message: "failure invariant" });
  const complete = row.state === "ACTIVE" || row.state === "FAILED" || row.state === "SUPERSEDED";
  if (complete !== (row.completed_at !== null)) context.addIssue({ code: "custom", message: "completion invariant" });
  if ((row.desired_roots_json === null) !== (row.package_set_digest === null)) context.addIssue({ code: "custom", message: "freeze invariant" });
});
type DeploymentRow = z.infer<typeof DeploymentRowSchema>;
const ParticipantSchema = z.object({
  deployment_id: id, assignment_id: id, agent_id: id, release_id: id, local_skill_name: id,
  role: z.enum(["APPLY_DESIRED", "CARRY_EFFECTIVE"]), target_state: z.enum(["DISABLED", "ENABLED"]), target_preload: z.union([z.literal(0), z.literal(1)]),
  prior_effective_state: z.enum(["DISABLED", "ENABLED"]), prior_effective_preload: z.union([z.literal(0), z.literal(1)]),
  prior_active_generation: id.nullable(), assignment_revision: z.number().int().min(1).max(INT_MAX),
}).strict();
type Participant = z.infer<typeof ParticipantSchema>;
const AssignmentSchema = z.object({
  assignment_id: id, agent_id: id, release_id: id, local_skill_name: id, desired_state: z.enum(["DISABLED", "ENABLED"]),
  effective_state: z.enum(["DISABLED", "ENABLED"]), deployment_state: z.enum(["STABLE", "REQUESTED", "DEPLOYING", "FAILED"]),
  removal_requested: z.union([z.literal(0), z.literal(1)]), preload: z.union([z.literal(0), z.literal(1)]),
  effective_preload: z.union([z.literal(0), z.literal(1)]), active_generation: id.nullable(), desired_generation: id,
  revision: z.number().int().min(1).max(INT_MAX),
}).strict();
type Assignment = z.infer<typeof AssignmentSchema>;
const revision = z.number().int().min(1).max(INT_MAX);
const ReleaseRowSchema = z.object({
  package_release_id: id, authority_source_id: id, content_source_id: id, kind: z.string().max(40), name: id, version: id,
  digest, catalog_commit: z.string().min(1).max(200), package_commit: z.string().min(1).max(200), package_path: z.string().min(1).max(4096),
  manifest_json: z.string().max(262144), review_state: z.string().max(40), review_digest: digest.nullable(), review_revision: revision,
  artifact_digest: digest.nullable(), artifact_path: z.string().min(1).max(4096).nullable(), installation_state: z.string().max(40).nullable(),
  installation_revision: revision.nullable(),
}).strict();
type ReleaseRow = z.infer<typeof ReleaseRowSchema>;
const SourcePolicySchema = z.object({ source_id: id, enabled: z.union([z.literal(0), z.literal(1)]),
  allow_packages: z.union([z.literal(0), z.literal(1)]), removed_at: safeTimestamp.nullable(), revision }).strict();
const ApiPolicySchema = z.object({ release_id: id, approval_state: z.string().max(40), runtime_state: z.string().max(40), revision }).strict();
const RolloutTargetRowSchema = z.object({
  rollout_id: id, agent_id: id, captured_runner_id: id.nullable(), target_ordinal: z.number().int().min(0).max(255), attempts: z.number().int().min(0).max(INT_MAX),
  state: z.enum(["QUEUED", "BLOCKED", "STAGING", "VERIFYING", "WAITING_FOR_IDLE", "ACTIVATING", "SUCCEEDED", "FAILED", "SKIPPED", "SUPERSEDED"]),
  revision,
}).strict();

export class RunnerDeliveryError extends Error { constructor(readonly code: CatalogLibraryErrorCode) { super(code); } }

export function createRunnerStartGateDelivery(db: OrgOpsDb, gate: CatalogStartGate): RunnerStartGateDelivery {
  return {
    async getStartRequirements(rawContext) {
      try {
        const parsed = RunnerStartRequirementsContextSchema.safeParse(rawContext);
        if (!parsed.success) throw new RunnerDeliveryError("INVALID_REQUEST");
        const context = parsed.data;
        if (context.allowedAgentName !== undefined && context.allowedAgentName !== context.agentName) {
          throw new RunnerDeliveryError("FORBIDDEN");
        }
        const agent = db.prepare<[string], { id: string }>("SELECT id FROM agents WHERE name=?").get(context.agentName);
        if (!agent) throw new RunnerDeliveryError("FORBIDDEN");
        return StartRequirementsResultSchema.parse(await gate.validateCatalogStart(agent.id, { kind: "RUNNER", runnerId: context.runnerId }));
      } catch (error) {
        if (error instanceof RunnerDeliveryError) throw error;
        if (error && typeof error === "object" && (error as { code?: unknown }).code === "FORBIDDEN") {
          throw new RunnerDeliveryError("FORBIDDEN");
        }
        throw new RunnerDeliveryError("STORAGE_FAILURE");
      }
    },
  };
}
const fail = (code: CatalogLibraryErrorCode): never => { throw new RunnerDeliveryError(code); };
const fixed = (error: unknown) => error instanceof RunnerDeliveryError ? error : new RunnerDeliveryError("STORAGE_FAILURE");
const inside = (root: string, target: string) => { const path = relative(resolve(root), resolve(target)); return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep)); };
const sha256 = (value: Buffer | string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const assignmentSelect = `SELECT assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,
  removal_requested,preload,effective_preload,active_generation,desired_generation,revision FROM agent_skill_assignments`;
const parseAssignment = (raw: unknown): Assignment => {
  const parsed = AssignmentSchema.safeParse(raw);
  return parsed.success ? parsed.data : fail("STATE_CONFLICT");
};

type Deps = { db: OrgOpsDb; artifactRoot: string; writeAudit: (tx: OrgOpsDb, audit: CatalogAuditEvent) => void; now?: () => number;
  newId?: () => string; newAttemptToken?: () => string; leaseMs?: number; onFileRead?: (path: string) => void | Promise<void> };

export function createRunnerArtifactDelivery({ db, artifactRoot, writeAudit, now = Date.now, newId = randomUUID,
  newAttemptToken = () => randomBytes(32).toString("base64url"), leaseMs = 60_000, onFileRead }: Deps): RunnerArtifactDelivery {
  const configuredRoot = resolve(artifactRoot);
  const selectDeployment = (suffix: string) => `SELECT d.deployment_id,d.rollout_id,d.target_agent_id,d.release_id,d.bound_runner_id,
    d.desired_generation,d.state,d.attempt_token,d.lease_expires_at,d.revision,d.failure_code,d.desired_roots_json,d.package_set_digest,
    d.artifact_semantic_digest,d.completed_at,a.name AS agent_name,a.assigned_runner_id FROM runner_package_deployments d JOIN agents a ON a.id=d.target_agent_id ${suffix}`;
  const byId = db.prepare<[string], unknown>(selectDeployment("WHERE d.deployment_id=?"));
  const parseDeployment = (value: unknown): DeploymentRow => { const parsed = DeploymentRowSchema.safeParse(value); return parsed.success ? parsed.data : fail("STATE_CONFLICT"); };
  const requireRunner = (runnerId: string) => { if (!db.prepare<[string], { ok: number }>("SELECT 1 AS ok FROM runner_nodes WHERE id=?").get(runnerId)) fail("FORBIDDEN"); };
  const participantsFor = (deploymentId: string): Participant[] => db.prepare<[string], unknown>(
    "SELECT deployment_id,assignment_id,agent_id,release_id,local_skill_name,role,target_state,target_preload,prior_effective_state,prior_effective_preload,prior_active_generation,assignment_revision FROM runner_deployment_participants WHERE deployment_id=? ORDER BY lower(local_skill_name),assignment_id",
  ).all(deploymentId).map(value => { const parsed = ParticipantSchema.safeParse(value); return parsed.success ? parsed.data : fail("STATE_CONFLICT"); });
  const nextGeneration = (agentId: string): string => {
    for (let attempt = 0; attempt < 8; attempt++) { const candidate = newId(); if (id.safeParse(candidate).success && !db.prepare<[string, string], { ok: number }>(
      "SELECT 1 AS ok FROM runner_package_deployments WHERE target_agent_id=? AND desired_generation=?",
    ).get(agentId, candidate)) return candidate; }
    return fail("STORAGE_FAILURE");
  };

  function releaseById(releaseId: string) {
    const raw = db.prepare<[string], unknown>(`SELECT r.package_release_id,r.authority_source_id,r.content_source_id,r.kind,r.name,r.version,r.digest,
      r.catalog_commit,r.package_commit,r.package_path,r.manifest_json,c.review_state,c.review_digest,c.revision AS review_revision,
      i.artifact_digest,i.artifact_path,i.state AS installation_state,i.revision AS installation_revision
      FROM catalog_package_releases r JOIN catalog_release_controls c ON c.package_release_id=r.package_release_id
      LEFT JOIN catalog_installations i ON i.release_id=r.package_release_id WHERE r.package_release_id=?`).get(releaseId) ?? fail("INSPECTION_FAILED");
    const rowResult = ReleaseRowSchema.safeParse(raw); if (!rowResult.success) fail("INSPECTION_FAILED"); const row = rowResult.data!;
    const parsed = PackageManifestSchema.safeParse((() => { try { return JSON.parse(row.manifest_json); } catch { return null; } })());
    if (!parsed.success) fail("INSPECTION_FAILED");
    const manifest = parsed.data!;
    if (Buffer.byteLength(row.manifest_json) > 256 * 1024 || row.kind !== "skill" || manifest.kind !== "skill" || manifest.name !== row.name
      || manifest.version !== row.version || manifest.digest !== row.digest || row.review_state !== "APPROVED" || !row.review_digest
      || row.installation_state !== "INSTALLED" || row.artifact_digest !== row.digest || !row.artifact_path) fail("INSPECTION_FAILED");
    const authorityResult = SourcePolicySchema.safeParse(db.prepare<[string], unknown>(
      "SELECT source_id,enabled,allow_packages,removed_at,revision FROM catalog_sources WHERE source_id=?",
    ).get(row.authority_source_id));
    const contentResult = SourcePolicySchema.safeParse(db.prepare<[string], unknown>(
      "SELECT source_id,enabled,allow_packages,removed_at,revision FROM catalog_sources WHERE source_id=?",
    ).get(row.content_source_id));
    if (!authorityResult.success || !contentResult.success) fail("INSPECTION_FAILED");
    const authority = authorityResult.data!; const content = contentResult.data!;
    if (authority.enabled !== 1 || authority.removed_at !== null || content.enabled !== 1 || content.removed_at !== null
      || (row.authority_source_id !== row.content_source_id && content.allow_packages !== 1)) fail("INSPECTION_FAILED");
    const activationRaw = db.prepare<[string], unknown>(
      "SELECT release_id,approval_state,runtime_state,revision FROM catalog_api_activations WHERE release_id=?",
    ).get(releaseId);
    const activationResult = activationRaw === undefined ? null : ApiPolicySchema.safeParse(activationRaw);
    if (activationResult !== null && !activationResult.success) fail("INSPECTION_FAILED");
    const activation = activationResult?.data ?? null;
    if (manifest.executables.some(item => item.execution === "api-event-shapes")
      && (!activation || activation.approval_state !== "APPROVED" || activation.runtime_state !== "ACTIVE")) fail("INSPECTION_FAILED");
    return { row, manifest, authority, content, activation, identity: ReleaseIdentitySchema.parse({
      packageReleaseId: row.package_release_id, authoritySourceId: row.authority_source_id, contentSourceId: row.content_source_id,
      kind: "skill", name: row.name, version: row.version, catalogCommit: row.catalog_commit, packageCommit: row.package_commit,
      packagePath: row.package_path, digest: row.digest,
    }) };
  }

  function closure(rootIds: readonly string[]) {
    const loaded = new Map<string, ReturnType<typeof releaseById>>();
    const load = (releaseId: string) => {
      const existing = loaded.get(releaseId); if (existing) return existing;
      const value = releaseById(releaseId); loaded.set(releaseId, value); return value;
    };
    const packages = resolveImmutablePackageClosure(rootIds, {
      byId: releaseId => { const item = load(releaseId); return { release: item.identity, manifest: item.manifest }; },
      byPin: pin => db.prepare<[string, string, string, string, string], { package_release_id: string }>(
        `SELECT package_release_id FROM catalog_package_releases WHERE authority_source_id=? AND content_source_id=? AND name=? AND version=? AND digest=? ORDER BY package_release_id`,
      ).all(pin.catalogId, pin.sourceId, pin.name, pin.version, pin.digest).map(row => {
        const item = load(row.package_release_id); return { release: item.identity, manifest: item.manifest };
      }),
    });
    if (!packages) return fail("INSPECTION_FAILED");
    return packages.map(pkg => ({ ...load(pkg.release.packageReleaseId), direct: pkg.direct }));
  }

  function freeze(row: DeploymentRow): DeploymentRow {
    const existing = participantsFor(row.deployment_id);
    if (existing.length || row.desired_roots_json !== null || row.package_set_digest !== null) {
      if (!existing.length || !row.desired_roots_json || !row.package_set_digest) fail("STATE_CONFLICT");
      return row;
    }
    const storedAssignments = db.prepare<[string], unknown>(`${assignmentSelect} WHERE agent_id=? ORDER BY lower(local_skill_name),assignment_id`).all(row.target_agent_id).map(parseAssignment);
    const assignments = storedAssignments.filter(assignment => assignment.removal_requested === 0
      || (assignment.deployment_state === "REQUESTED" && assignment.desired_generation === row.desired_generation));
    if (!assignments.length) fail("STATE_CONFLICT");
    for (const assignment of assignments) {
      const apply = assignment.deployment_state === "REQUESTED" && assignment.desired_generation === row.desired_generation;
      const targetState = apply ? assignment.desired_state : assignment.effective_state;
      const targetPreload = targetState === "ENABLED" ? (apply ? assignment.preload : assignment.effective_preload) : 0;
      db.prepare(`INSERT INTO runner_deployment_participants
        (deployment_id,assignment_id,agent_id,release_id,local_skill_name,role,target_state,target_preload,prior_effective_state,
         prior_effective_preload,prior_active_generation,assignment_revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(row.deployment_id, assignment.assignment_id, assignment.agent_id, assignment.release_id, assignment.local_skill_name,
          apply ? "APPLY_DESIRED" : "CARRY_EFFECTIVE", targetState, targetPreload, assignment.effective_state,
          assignment.effective_preload, assignment.active_generation, assignment.revision);
    }
    const frozen = participantsFor(row.deployment_id);
    const rootIds = [...new Set(frozen.filter(item => item.target_state === "ENABLED").map(item => item.release_id))];
    const packages = closure(rootIds);
    const desiredRoots = rootIds.map(releaseId => packages.find(item => item.identity.packageReleaseId === releaseId)!.identity);
    const setDigest = computePackageSetDigest(packages.map(item => item.identity));
    const changed = db.prepare(`UPDATE runner_package_deployments SET desired_roots_json=?,package_set_digest=?,updated_at=?
      WHERE deployment_id=? AND desired_roots_json IS NULL AND package_set_digest IS NULL`).run(JSON.stringify(desiredRoots), setDigest, now(), row.deployment_id);
    if (changed.changes !== 1) fail("REVISION_CONFLICT");
    return parseDeployment(byId.get(row.deployment_id));
  }

  function expectedRevision(row: DeploymentRow, participant: Participant): number {
    if (participant.role === "CARRY_EFFECTIVE") return participant.assignment_revision + (row.state === "ACTIVE" ? 1 : 0);
    return participant.assignment_revision + (row.state === "STAGED" || row.state === "WAITING_FOR_IDLE" ? 1 : row.state === "ACTIVE" ? 2 : 0);
  }
  function validateParticipants(row: DeploymentRow): Participant[] {
    const participants = participantsFor(row.deployment_id);
    if (!participants.length) fail("STATE_CONFLICT");
    for (const participant of participants) {
      const currentRaw = db.prepare<[string], unknown>(`${assignmentSelect} WHERE assignment_id=?`).get(participant.assignment_id);
      const current = parseAssignment(currentRaw ?? fail("STATE_CONFLICT"));
      if (current.agent_id !== participant.agent_id || current.agent_id !== row.target_agent_id
        || current.release_id !== participant.release_id || current.local_skill_name !== participant.local_skill_name
        || current.revision !== expectedRevision(row, participant)) fail("STATE_CONFLICT");
      if (participant.role === "APPLY_DESIRED") {
        const expectedState = row.state === "STAGED" || row.state === "WAITING_FOR_IDLE" ? "DEPLOYING" : row.state === "ACTIVE" ? "STABLE" : "REQUESTED";
        if (current.desired_generation !== row.desired_generation || current.desired_state !== participant.target_state
          || (participant.target_state === "ENABLED" ? current.preload : 0) !== participant.target_preload
          || current.deployment_state !== expectedState) fail("STATE_CONFLICT");
      } else if (current.effective_state !== participant.prior_effective_state
        || current.effective_preload !== participant.prior_effective_preload
        || current.active_generation !== participant.prior_active_generation) fail("STATE_CONFLICT");
    }
    return participants;
  }

  function supersede(row: DeploymentRow): void {
    // An ACTIVE deployment can be historical after a newer assignment generation was
    // committed. Its participant snapshot remains evidence, but must not be validated
    // against the newer assignment before revoking runner authority.
    const participants = row.state === "ACTIVE" ? participantsFor(row.deployment_id) : validateParticipants(row);
    if (!participants.length) fail("STATE_CONFLICT");
    if (row.revision >= INT_MAX) fail("REVISION_CONFLICT");
    for (const participant of participants.filter(item => item.role === "APPLY_DESIRED")) {
      const assignment = parseAssignment(db.prepare<[string], unknown>(`${assignmentSelect} WHERE assignment_id=?`).get(participant.assignment_id) ?? fail("STATE_CONFLICT"));
      if (assignment.revision >= INT_MAX) fail("REVISION_CONFLICT");
      if (assignment.deployment_state === "DEPLOYING") {
        const changed = db.prepare("UPDATE agent_skill_assignments SET deployment_state='REQUESTED',revision=revision+1,updated_at=? WHERE assignment_id=? AND revision=? AND deployment_state='DEPLOYING'")
          .run(now(), participant.assignment_id, assignment.revision);
        if (changed.changes !== 1) fail("REVISION_CONFLICT");
      }
    }
    const changed = db.prepare(`UPDATE runner_package_deployments SET state='SUPERSEDED',failure_code='DEPLOYMENT_SUPERSEDED',attempt_token=NULL,
      lease_expires_at=NULL,revision=revision+1,updated_at=?,completed_at=? WHERE deployment_id=? AND revision=?`).run(now(), now(), row.deployment_id, row.revision);
    if (changed.changes !== 1) fail("REVISION_CONFLICT");
    if (row.rollout_id) {
      const target = db.prepare<[string, string], { state: string; revision: number }>("SELECT state,revision FROM catalog_rollout_targets WHERE rollout_id=? AND agent_id=?").get(row.rollout_id, row.target_agent_id) ?? fail("REVISION_CONFLICT");
      const terminalTarget = ["SUCCEEDED", "FAILED", "SKIPPED", "SUPERSEDED"].includes(target.state);
      if (row.assigned_runner_id) {
        const replacement = createDeployment(row.target_agent_id, row.assigned_runner_id, row.release_id, true, row.rollout_id);
        void replacement;
      } else if (terminalTarget) {
        // Terminal rollout history is immutable; with no assigned runner there
        // is no standalone replacement to provision.
        return;
      } else {
        if (target.revision >= INT_MAX) fail("REVISION_CONFLICT");
        const changedTarget = db.prepare("UPDATE catalog_rollout_targets SET captured_runner_id=NULL,state='SUPERSEDED',reason_code='DEPLOYMENT_SUPERSEDED',revision=revision+1,updated_at=?,completed_at=? WHERE rollout_id=? AND agent_id=? AND revision=? AND state NOT IN ('SKIPPED','SUPERSEDED')").run(now(), now(), row.rollout_id, row.target_agent_id, target.revision);
        if (changedTarget.changes !== 1) fail("REVISION_CONFLICT");
        recomputeRolloutAggregate(db, row.rollout_id, writeAudit, now);
      }
    }
  }

  function createDeployment(agentId: string, runnerId: string, releaseId: string, requested: boolean, rolloutId: string | null = null): string {
    // A deployment may retain rollout provenance only while both the rollout and
    // its target are live. Reconciliation can run after an aggregate reaches a
    // terminal state, so a replacement in that case is deliberately standalone.
    let effectiveRolloutId: string | null = null;
    let rolloutTarget: z.infer<typeof RolloutTargetRowSchema> | undefined;
    if (rolloutId) {
      const rollout = db.prepare<[string], { state: string }>("SELECT state FROM catalog_rollouts WHERE rollout_id=?").get(rolloutId);
      const targetRaw = db.prepare<[string, string], unknown>("SELECT rollout_id,agent_id,captured_runner_id,target_ordinal,attempts,state,revision FROM catalog_rollout_targets WHERE rollout_id=? AND agent_id=?").get(rolloutId, agentId);
      const parsedTarget = RolloutTargetRowSchema.safeParse(targetRaw);
      if (!rollout || !parsedTarget.success) fail("REVISION_CONFLICT");
      const liveRollout = rollout!;
      const liveTarget = parsedTarget.data!;
      const targetIsLive = ["QUEUED", "STAGING", "VERIFYING", "WAITING_FOR_IDLE", "ACTIVATING"].includes(liveTarget.state);
      if (["QUEUED", "RUNNING"].includes(liveRollout.state) && targetIsLive) {
        if (liveTarget.revision >= INT_MAX || liveTarget.attempts >= INT_MAX) fail("REVISION_CONFLICT");
        effectiveRolloutId = rolloutId;
        rolloutTarget = liveTarget;
      }
    }
    const storedAssignments = db.prepare<[string], unknown>(`${assignmentSelect} WHERE agent_id=? ORDER BY lower(local_skill_name),assignment_id`).all(agentId).map(parseAssignment);
    const assignments = storedAssignments.filter(assignment => assignment.removal_requested === 0 || (requested && assignment.deployment_state === "REQUESTED"));
    if (!assignments.length || assignments.some(item => item.revision >= INT_MAX)) fail("REVISION_CONFLICT");
    const generation = nextGeneration(agentId);
    if (requested) {
      for (const assignment of assignments.filter(item => item.deployment_state === "REQUESTED")) {
        const changed = db.prepare("UPDATE agent_skill_assignments SET desired_generation=?,revision=revision+1,updated_at=? WHERE assignment_id=? AND revision=? AND deployment_state='REQUESTED'")
          .run(generation, now(), assignment.assignment_id, assignment.revision);
        if (changed.changes !== 1) fail("REVISION_CONFLICT");
      }
    }
    const deploymentId = newId();
    db.prepare(`INSERT INTO runner_package_deployments
      (deployment_id,rollout_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,revision,created_at,updated_at)
      VALUES (?,?, ?,?,?,?,'QUEUED',1,?,?)`).run(deploymentId, effectiveRolloutId, agentId, releaseId, runnerId, generation, now(), now());
    freeze(parseDeployment(byId.get(deploymentId)));
    if (effectiveRolloutId && rolloutTarget) {
      // Re-read inside the surrounding reconciliation transaction immediately
      // before changing the target. A terminal transition wins the race and
      // leaves its historical target byte-for-byte unchanged.
      const liveRollout = db.prepare<[string], { state: string }>("SELECT state FROM catalog_rollouts WHERE rollout_id=?").get(effectiveRolloutId);
      const currentTarget = RolloutTargetRowSchema.safeParse(db.prepare<[string, string], unknown>(
        "SELECT rollout_id,agent_id,captured_runner_id,target_ordinal,attempts,state,revision FROM catalog_rollout_targets WHERE rollout_id=? AND agent_id=?",
      ).get(effectiveRolloutId, agentId));
      if (!liveRollout || !["QUEUED", "RUNNING"].includes(liveRollout.state) || !currentTarget.success
        || !["QUEUED", "STAGING", "VERIFYING", "WAITING_FOR_IDLE", "ACTIVATING"].includes(currentTarget.data.state)
        || currentTarget.data.revision !== rolloutTarget.revision) {
        // The deployment was inserted with stale rollout provenance. Keep the
        // whole operation transactional rather than reopening a terminal target.
        db.prepare("UPDATE runner_package_deployments SET rollout_id=NULL WHERE deployment_id=? AND rollout_id=? AND state='QUEUED'").run(deploymentId, effectiveRolloutId);
        return deploymentId;
      }
      const currentAssignmentRaw = db.prepare<[string, string], unknown>(`${assignmentSelect} WHERE agent_id=? AND release_id=?`).get(agentId, releaseId);
      const currentAssignment = currentAssignmentRaw === undefined ? undefined : parseAssignment(currentAssignmentRaw);
      if (currentAssignment?.removal_requested === 1) fail("REVISION_CONFLICT");
      const changedTarget = db.prepare("UPDATE catalog_rollout_targets SET captured_runner_id=?,expected_assignment_revision=COALESCE(?,expected_assignment_revision),state='QUEUED',reason_code=NULL,blocker_json=NULL,attempts=attempts+1,revision=revision+1,updated_at=?,completed_at=NULL WHERE rollout_id=? AND agent_id=? AND revision=? AND state IN ('QUEUED','STAGING','VERIFYING','WAITING_FOR_IDLE','ACTIVATING')").run(runnerId, currentAssignment?.revision ?? null, now(), effectiveRolloutId, agentId, rolloutTarget.revision);
      if (changedTarget.changes !== 1) fail("REVISION_CONFLICT");
    }
    return deploymentId;
  }

  function reconcile(): void {
    db.transaction(() => {
      // Parse every marker before SQL filtering so a corrupt tombstone cannot be mistaken for absence.
      db.prepare<[], unknown>(`${assignmentSelect} ORDER BY assignment_id`).all().map(parseAssignment);
      const rows = db.prepare<[], unknown>(selectDeployment("WHERE d.state IN ('QUEUED','CLAIMED','STAGED','WAITING_FOR_IDLE','ACTIVE') ORDER BY d.created_at,d.deployment_id")).all();
      for (const raw of rows) { let row = parseDeployment(raw); row = freeze(row); if (row.assigned_runner_id !== row.bound_runner_id) supersede(row); }
      const candidates = db.prepare<[], { agent_id: string; assigned_runner_id: string; release_id: string; requested: number; rollout_id: string | null }>(`SELECT a.id AS agent_id,a.assigned_runner_id,
        COALESCE(MIN(CASE WHEN s.deployment_state='REQUESTED' THEN s.release_id END),MIN(s.release_id)) AS release_id,
        MAX(CASE WHEN s.deployment_state='REQUESTED' THEN 1 ELSE 0 END) AS requested,
        (SELECT old.rollout_id FROM runner_package_deployments old JOIN catalog_rollouts cr ON cr.rollout_id=old.rollout_id
          WHERE old.rowid=(SELECT MAX(latest.rowid) FROM runner_package_deployments latest WHERE latest.target_agent_id=a.id)
          AND old.state='SUPERSEDED' AND old.rollout_id IS NOT NULL AND cr.state IN ('QUEUED','RUNNING')
          AND EXISTS (SELECT 1 FROM catalog_rollout_targets rt WHERE rt.rollout_id=old.rollout_id AND rt.agent_id=a.id
            AND rt.state IN ('QUEUED','STAGING','VERIFYING','WAITING_FOR_IDLE','ACTIVATING')) LIMIT 1) AS rollout_id
        FROM agents a JOIN agent_skill_assignments s ON s.agent_id=a.id AND (s.removal_requested=0 OR s.deployment_state='REQUESTED') WHERE a.assigned_runner_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM runner_package_deployments d WHERE d.target_agent_id=a.id AND d.state IN ('QUEUED','CLAIMED','STAGED','WAITING_FOR_IDLE'))
        AND (EXISTS (SELECT 1 FROM agent_skill_assignments r WHERE r.agent_id=a.id AND r.deployment_state='REQUESTED')
          OR EXISTS (SELECT 1 FROM runner_package_deployments old WHERE old.rowid=(SELECT MAX(latest.rowid) FROM runner_package_deployments latest WHERE latest.target_agent_id=a.id)
            AND old.state IN ('ACTIVE','FAILED','SUPERSEDED') AND old.bound_runner_id<>a.assigned_runner_id))
        GROUP BY a.id,a.assigned_runner_id ORDER BY a.id`).all();
      for (const candidate of candidates) createDeployment(candidate.agent_id, candidate.assigned_runner_id, candidate.release_id, candidate.requested === 1, candidate.rollout_id);
    })();
  }

  function bound(rawContext: unknown, requireToken: boolean): { row: DeploymentRow; token?: string } {
    reconcile();
    const parsed = (requireToken ? DeploymentContextSchema : DeploymentClaimContextSchema).safeParse(rawContext);
    if (!parsed.success) fail("INVALID_REQUEST");
    const data = parsed.data as z.infer<typeof DeploymentContextSchema>;
    requireRunner(data.runnerId);
    let row = parseDeployment(byId.get(data.deploymentId) ?? fail("NOT_FOUND")); row = freeze(row);
    if (row.state === "SUPERSEDED") fail("DEPLOYMENT_SUPERSEDED");
    if (row.bound_runner_id !== data.runnerId || row.assigned_runner_id !== data.runnerId
      || (data.allowedAgentName !== undefined && row.agent_name !== data.allowedAgentName)) fail("FORBIDDEN");
    if (requireToken && row.attempt_token !== data.attemptToken) fail("STATE_CONFLICT");
    return { row, ...(requireToken ? { token: data.attemptToken } : {}) };
  }

  async function poll(rawContext: unknown): Promise<DeploymentCommand[]> {
    try {
      const parsed = RunnerContextSchema.safeParse(rawContext); if (!parsed.success) fail("INVALID_REQUEST");
      const context = parsed.data!; requireRunner(context.runnerId); reconcile();
      const commands: DeploymentCommand[] = [];
      for (const raw of db.prepare<[string], unknown>(selectDeployment("WHERE d.bound_runner_id=? AND d.state IN ('QUEUED','CLAIMED','STAGED','WAITING_FOR_IDLE') ORDER BY d.created_at,d.deployment_id LIMIT 32")).all(context.runnerId)) {
        const row = parseDeployment(raw); if (row.assigned_runner_id !== context.runnerId) fail("STATE_CONFLICT");
        const rootsJson = row.desired_roots_json ?? fail("STATE_CONFLICT");
        const setDigest = row.package_set_digest ?? fail("STATE_CONFLICT");
        if (context.allowedAgentName !== undefined && row.agent_name !== context.allowedAgentName) continue;
        const roots = z.array(ReleaseIdentitySchema).max(256).safeParse(JSON.parse(rootsJson)); if (!roots.success) fail("STATE_CONFLICT");
        commands.push({ deploymentId: row.deployment_id, agentId: row.target_agent_id, agentName: row.agent_name, assignedRunnerId: row.bound_runner_id,
          releaseId: row.release_id, desiredGeneration: row.desired_generation, desiredRoots: roots.data!, packageSetDigest: setDigest });
      }
      return commands;
    } catch (error) { throw fixed(error); }
  }

  async function claim(rawContext: unknown): Promise<DeploymentClaim> {
    try {
      const { row } = bound(rawContext, false);
      if (!LIVE.includes(row.state as typeof LIVE[number])) fail("STATE_CONFLICT");
      validateParticipants(row);
      if (row.attempt_token && row.lease_expires_at !== null && row.lease_expires_at > now()) return { deploymentId: row.deployment_id, attemptToken: row.attempt_token, leaseExpiresAt: row.lease_expires_at };
      if (row.revision >= INT_MAX) fail("REVISION_CONFLICT");
      const token = newAttemptToken(); const expires = now() + leaseMs;
      if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !Number.isSafeInteger(expires)) fail("STORAGE_FAILURE");
      const changed = db.prepare(`UPDATE runner_package_deployments SET state='CLAIMED',attempt_token=?,lease_expires_at=?,failure_code=NULL,
        revision=revision+1,updated_at=?,completed_at=NULL WHERE deployment_id=? AND revision=?`).run(token, expires, now(), row.deployment_id, row.revision);
      if (changed.changes !== 1) fail("REVISION_CONFLICT");
      return { deploymentId: row.deployment_id, attemptToken: token, leaseExpiresAt: expires };
    } catch (error) { throw fixed(error); }
  }

  async function canonicalDirectory(path: string, canonicalRoot: string): Promise<string> {
    const stat = await fs.lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) fail("INSPECTION_FAILED");
    const real = await fs.realpath(path); if (!inside(canonicalRoot, real)) fail("INSPECTION_FAILED"); return real;
  }
  async function measure(pkg: ReturnType<typeof releaseById>, canonicalRoot: string) {
    const expectedRoot = join(configuredRoot, pkg.row.name, pkg.row.digest.slice(7));
    if (!inside(configuredRoot, expectedRoot) || resolve(pkg.row.artifact_path!) !== expectedRoot) fail("INSPECTION_FAILED");
    const namespace = join(configuredRoot, pkg.row.name);
    const beforeNamespace = await canonicalDirectory(namespace, canonicalRoot);
    const beforeRoot = await canonicalDirectory(expectedRoot, canonicalRoot);
    if (beforeRoot !== await fs.realpath(expectedRoot) || !inside(beforeNamespace, beforeRoot)) fail("INSPECTION_FAILED");
    const expected = new Map(pkg.manifest.files.map(file => [file.path, file]));
    const entries: Array<{ type: "file"; path: string; base64: string; executable: boolean }> = [];
    const actualFolded = new Set<string>();
    const manifestPath = join(expectedRoot, "orgops-package.json");
    const expectedManifestBytes = canonicalManifestBytes(pkg.manifest);
    let manifestHandle: fs.FileHandle | undefined;
    try {
      const manifestStat = await fs.lstat(manifestPath);
      if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.nlink !== 1
        || (manifestStat.mode & 0o777) !== 0o644 || manifestStat.size !== expectedManifestBytes.length) fail("INSPECTION_FAILED");
      manifestHandle = await fs.open(manifestPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const firstManifestStat = await manifestHandle.stat();
      if (!firstManifestStat.isFile() || firstManifestStat.nlink !== 1 || (firstManifestStat.mode & 0o777) !== 0o644
        || firstManifestStat.size !== expectedManifestBytes.length) fail("INSPECTION_FAILED");
      const manifestBytes = await manifestHandle.readFile();
      const secondManifestStat = await manifestHandle.stat();
      if (secondManifestStat.dev !== firstManifestStat.dev || secondManifestStat.ino !== firstManifestStat.ino
        || secondManifestStat.size !== firstManifestStat.size || secondManifestStat.mtimeMs !== firstManifestStat.mtimeMs
        || !manifestBytes.equals(expectedManifestBytes)) fail("INSPECTION_FAILED");
    } catch (error) {
      if (error instanceof RunnerDeliveryError) throw error;
      fail("INSPECTION_FAILED");
    } finally { await manifestHandle?.close().catch(() => undefined); }
    const walk = async (directory: string, prefix = "") => {
      const before = await canonicalDirectory(directory, canonicalRoot);
      for (const item of await fs.readdir(directory, { withFileTypes: true })) {
        const path = prefix ? `${prefix}/${item.name}` : item.name; const folded = path.toLowerCase();
        if (path === "orgops-package.json" && prefix === "") continue;
        if (actualFolded.has(folded) || item.isSymbolicLink() || (!item.isDirectory() && !item.isFile())) fail("INSPECTION_FAILED");
        actualFolded.add(folded);
        if (item.isDirectory()) await walk(join(directory, item.name), path);
        else {
          const claim = expected.get(path) ?? fail("INSPECTION_FAILED"); const filePath = join(directory, item.name);
          let handle: fs.FileHandle | undefined;
          try {
            handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            const first = await handle.stat(); const mode = claim.executable ? 0o755 : 0o644;
            if (!first.isFile() || first.nlink !== 1 || (first.mode & 0o777) !== mode || first.size !== claim.size) fail("INSPECTION_FAILED");
            await onFileRead?.(filePath); const bytes = await handle.readFile(); const second = await handle.stat();
            if (second.dev !== first.dev || second.ino !== first.ino || second.size !== first.size || second.mtimeMs !== first.mtimeMs
              || bytes.byteLength !== claim.size || sha256(bytes) !== claim.digest) fail("INSPECTION_FAILED");
            entries.push({ type: "file", path, base64: bytes.toString("base64"), executable: claim.executable });
          } finally { await handle?.close().catch(() => undefined); }
        }
      }
      if (await fs.realpath(directory) !== before) fail("INSPECTION_FAILED");
    };
    try { await walk(expectedRoot); } catch (error) { if (error instanceof RunnerDeliveryError) throw error; fail("INSPECTION_FAILED"); }
    if (entries.length !== expected.size) fail("INSPECTION_FAILED");
    entries.sort((a, b) => a.path.localeCompare(b.path));
    const inspected = inspectPackage(pkg.manifest, entries); if (!inspected.ok || inspected.value.manifest.digest !== pkg.row.digest) fail("INSPECTION_FAILED");
    if (await fs.realpath(configuredRoot) !== canonicalRoot || await fs.realpath(expectedRoot) !== beforeRoot) fail("INSPECTION_FAILED");
    return entries;
  }

  async function getArtifact(rawContext: unknown): Promise<VerifiedArtifactEnvelope> {
    try {
      const context = DeploymentContextSchema.parse(rawContext);
      const { row } = bound(context, true);
      if (!LIVE.slice(1).includes(row.state as typeof LIVE[number]) || row.lease_expires_at === null || row.lease_expires_at <= now()) fail("STATE_CONFLICT");
      const frozenParticipants = validateParticipants(row);
      const roots = z.array(ReleaseIdentitySchema).max(256).parse(JSON.parse(row.desired_roots_json!));
      const packages = closure(roots.map(item => item.packageReleaseId));
      if (JSON.stringify(packages.filter(item => item.direct).map(item => item.identity)) !== JSON.stringify(roots)
        || computePackageSetDigest(packages.map(item => item.identity)) !== row.package_set_digest) fail("STATE_CONFLICT");
      const trigger = releaseById(row.release_id);
      const frozenPackages = JSON.stringify(packages); const frozenTrigger = JSON.stringify(trigger);
      const frozenParticipantSet = JSON.stringify(frozenParticipants);
      let fileCount = 0; let byteCount = 0;
      for (const pkg of packages) { fileCount += pkg.manifest.files.length; byteCount += pkg.manifest.files.reduce((sum, file) => sum + file.size, 0);
        if (fileCount > 256 || byteCount > 8 * 1024 * 1024) fail("INSPECTION_FAILED"); }
      const rootStat = await fs.lstat(configuredRoot); if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("INSPECTION_FAILED");
      const canonicalRoot = await fs.realpath(configuredRoot); if (canonicalRoot !== configuredRoot) fail("INSPECTION_FAILED");
      const files: VerifiedArtifactEnvelope["files"][number][] = []; const packaged: VerifiedArtifactEnvelope["packages"][number][] = [];
      for (let index = 0; index < packages.length; index++) {
        const pkg = packages[index]!; packaged.push({ release: pkg.identity, manifest: pkg.manifest, direct: pkg.direct, namespace: packageNamespace(index, pkg.identity) });
        for (const entry of await measure(pkg, canonicalRoot)) files.push({ packageReleaseId: pkg.identity.packageReleaseId, path: entry.path,
          mode: entry.executable ? 0o755 : 0o644, bytesBase64: entry.base64 });
      }
      const envelope: VerifiedArtifactEnvelope = { deploymentId: row.deployment_id, agentId: row.target_agent_id, generation: row.desired_generation,
        release: trigger.identity, manifest: trigger.manifest, dependencies: packaged.filter(pkg => pkg.release.packageReleaseId !== row.release_id)
          .map(pkg => ({ release: pkg.release, direct: pkg.direct })), packages: packaged, semanticDigest: "" as VerifiedArtifactEnvelope["semanticDigest"], files };
      envelope.semanticDigest = computeArtifactSemanticDigest(envelope) as VerifiedArtifactEnvelope["semanticDigest"];
      const parsed = VerifiedArtifactEnvelopeSchema.safeParse(envelope); if (!parsed.success) fail("INSPECTION_FAILED");
      db.transaction(() => {
        const fresh = parseDeployment(byId.get(row.deployment_id));
        if (fresh.bound_runner_id !== context.runnerId || fresh.assigned_runner_id !== context.runnerId
          || (context.allowedAgentName !== undefined && fresh.agent_name !== context.allowedAgentName)) fail("FORBIDDEN");
        if (fresh.target_agent_id !== row.target_agent_id || fresh.agent_name !== row.agent_name || fresh.release_id !== row.release_id
          || fresh.desired_generation !== row.desired_generation || fresh.state !== row.state || fresh.attempt_token !== row.attempt_token
          || fresh.lease_expires_at !== row.lease_expires_at || fresh.lease_expires_at === null || fresh.lease_expires_at <= now()
          || fresh.desired_roots_json !== row.desired_roots_json || fresh.package_set_digest !== row.package_set_digest
          || fresh.failure_code !== row.failure_code || fresh.completed_at !== row.completed_at || fresh.rollout_id !== row.rollout_id) fail("STATE_CONFLICT");
        const currentParticipants = validateParticipants(fresh);
        if (JSON.stringify(currentParticipants) !== frozenParticipantSet) fail("STATE_CONFLICT");
        const currentRoots = z.array(ReleaseIdentitySchema).max(256).safeParse((() => {
          try { return JSON.parse(fresh.desired_roots_json!); } catch { return null; }
        })());
        if (!currentRoots.success || JSON.stringify(currentRoots.data) !== JSON.stringify(roots)) fail("STATE_CONFLICT");
        const currentPackages = closure(currentRoots.data!.map(item => item.packageReleaseId));
        if (JSON.stringify(currentPackages) !== frozenPackages || JSON.stringify(releaseById(fresh.release_id)) !== frozenTrigger
          || JSON.stringify(currentPackages.filter(item => item.direct).map(item => item.identity)) !== fresh.desired_roots_json
          || computePackageSetDigest(currentPackages.map(item => item.identity)) !== fresh.package_set_digest) fail("STATE_CONFLICT");
        if (fresh.artifact_semantic_digest !== null && fresh.artifact_semantic_digest !== envelope.semanticDigest) fail("STATE_CONFLICT");
        if (row.artifact_semantic_digest !== null) {
          if (fresh.revision !== row.revision || fresh.artifact_semantic_digest !== row.artifact_semantic_digest) fail("STATE_CONFLICT");
        } else if (fresh.artifact_semantic_digest === envelope.semanticDigest) {
          if (fresh.revision !== row.revision + 1) fail("STATE_CONFLICT");
        } else {
          if (fresh.revision !== row.revision || fresh.revision >= INT_MAX) fail("REVISION_CONFLICT");
          const changed = db.prepare(`UPDATE runner_package_deployments SET artifact_semantic_digest=?,revision=revision+1,updated_at=?
            WHERE deployment_id=? AND revision=? AND artifact_semantic_digest IS NULL AND state=? AND attempt_token=? AND lease_expires_at=?
              AND bound_runner_id=? AND desired_generation=? AND desired_roots_json=? AND package_set_digest=?`)
            .run(envelope.semanticDigest, now(), row.deployment_id, row.revision, row.state, row.attempt_token, row.lease_expires_at,
              row.bound_runner_id, row.desired_generation, row.desired_roots_json, row.package_set_digest);
          if (changed.changes !== 1) fail("REVISION_CONFLICT");
        }
      }).immediate();
      return envelope;
    } catch (error) { throw fixed(error); }
  }

  function updateRollout(row: DeploymentRow, targetState: string, reason: string | null, completed: number | null): void {
    if (!row.rollout_id) return;
    const targetRaw = db.prepare<[string, string], unknown>(
      "SELECT rollout_id,agent_id,captured_runner_id,target_ordinal,attempts,state,revision FROM catalog_rollout_targets WHERE rollout_id=? AND agent_id=?",
    ).get(row.rollout_id, row.target_agent_id);
    if (targetRaw === undefined) fail("REVISION_CONFLICT");
    const targetResult = RolloutTargetRowSchema.safeParse(targetRaw);
    if (!targetResult.success) fail("STATE_CONFLICT");
    const target = targetResult.data!;
    if (target.rollout_id !== row.rollout_id || target.agent_id !== row.target_agent_id) fail("STATE_CONFLICT");
    if (target.revision >= INT_MAX) fail("REVISION_CONFLICT");
    const expected = targetState === "STAGING" ? ["QUEUED"] : targetState === "WAITING_FOR_IDLE" ? ["STAGING"]
      : targetState === "SUCCEEDED" ? ["WAITING_FOR_IDLE"] : targetState === "SUPERSEDED" ? ["QUEUED", "STAGING", "WAITING_FOR_IDLE"]
      : ["QUEUED", "STAGING", "WAITING_FOR_IDLE"];
    if (!expected.includes(target.state)) fail("STATE_CONFLICT");
    const changed = db.prepare("UPDATE catalog_rollout_targets SET state=?,reason_code=?,revision=revision+1,updated_at=?,completed_at=? WHERE rollout_id=? AND agent_id=? AND revision=?")
      .run(targetState, reason, now(), completed, row.rollout_id, row.target_agent_id, target.revision);
    if (changed.changes !== 1) fail("REVISION_CONFLICT");
  }

  async function report(rawContext: unknown, rawReport: unknown): Promise<DeploymentReceipt> {
    try {
      const context = DeploymentContextSchema.safeParse(rawContext); const reportResult = DeploymentReportSchema.safeParse(rawReport);
      if (!context.success || !reportResult.success) fail("INVALID_REQUEST");
      const contextData = context.data!; const report = reportResult.data!;
      if (report.state === "FAILED" && report.failureCode === "DEPLOYMENT_SUPERSEDED") fail("STATE_CONFLICT");
      return db.transaction(() => {
        const { row } = bound(contextData, true);
        if (report.generation !== row.desired_generation) fail("STATE_CONFLICT");
        if (row.state === report.state) {
          if ((row.failure_code ?? undefined) !== report.failureCode) fail("STATE_CONFLICT");
          return { deploymentId: row.deployment_id, state: row.state, revision: row.revision } as DeploymentReceipt;
        }
        const allowed = (row.state === "CLAIMED" && (report.state === "STAGED" || report.state === "FAILED"))
          || (row.state === "STAGED" && (report.state === "WAITING_FOR_IDLE" || report.state === "FAILED"))
          || (row.state === "WAITING_FOR_IDLE" && (report.state === "ACTIVE" || report.state === "FAILED"));
        if (!allowed || row.revision >= INT_MAX) fail("STATE_CONFLICT");
        const participants = validateParticipants(row);
        if (participants.some(item => expectedRevision(row, item) >= INT_MAX)) fail("REVISION_CONFLICT");
        if (report.state === "STAGED") for (const participant of participants.filter(item => item.role === "APPLY_DESIRED")) {
          const changed = db.prepare("UPDATE agent_skill_assignments SET deployment_state='DEPLOYING',revision=revision+1,updated_at=? WHERE assignment_id=? AND revision=? AND deployment_state='REQUESTED'")
            .run(now(), participant.assignment_id, participant.assignment_revision); if (changed.changes !== 1) fail("REVISION_CONFLICT");
        }
        if (report.state === "ACTIVE") {
          if (!row.artifact_semantic_digest) fail("STATE_CONFLICT");
          for (const participant of participants) {
            const revision = expectedRevision(row, participant);
            let changed;
            if (participant.role === "APPLY_DESIRED") changed = db.prepare(`UPDATE agent_skill_assignments SET desired_state=?,preload=?,effective_state=?,effective_preload=?,
              deployment_state='STABLE',desired_generation=?,active_generation=?,revision=revision+1,updated_at=? WHERE assignment_id=? AND revision=?`)
              .run(participant.target_state, participant.target_preload, participant.target_state, participant.target_preload,
                row.desired_generation, row.desired_generation, now(), participant.assignment_id, revision);
            else {
              const current = parseAssignment(db.prepare<[string], unknown>(`${assignmentSelect} WHERE assignment_id=?`).get(participant.assignment_id) ?? fail("STATE_CONFLICT"));
              if (current.deployment_state === "FAILED") changed = db.prepare("UPDATE agent_skill_assignments SET active_generation=?,revision=revision+1,updated_at=? WHERE assignment_id=? AND revision=? AND deployment_state='FAILED'")
                .run(row.desired_generation, now(), participant.assignment_id, revision);
              else changed = db.prepare(`UPDATE agent_skill_assignments SET effective_state=?,effective_preload=?,desired_state=?,preload=?,deployment_state='STABLE',
                desired_generation=?,active_generation=?,revision=revision+1,updated_at=? WHERE assignment_id=? AND revision=? AND deployment_state='STABLE'`)
                .run(participant.prior_effective_state, participant.prior_effective_preload, participant.prior_effective_state,
                  participant.prior_effective_preload, row.desired_generation, row.desired_generation, now(), participant.assignment_id, revision);
            }
            if (changed.changes !== 1) fail("REVISION_CONFLICT");
          }
        }
        if (report.state === "FAILED") for (const participant of participants.filter(item => item.role === "APPLY_DESIRED")) {
          const revision = expectedRevision(row, participant);
          const changed = db.prepare("UPDATE agent_skill_assignments SET deployment_state='FAILED',revision=revision+1,updated_at=? WHERE assignment_id=? AND revision=?")
            .run(now(), participant.assignment_id, revision); if (changed.changes !== 1) fail("REVISION_CONFLICT");
        }
        const completed = report.state === "ACTIVE" || report.state === "FAILED" ? now() : null;
        const changed = db.prepare(`UPDATE runner_package_deployments SET state=?,failure_code=?,revision=revision+1,updated_at=?,completed_at=?
          WHERE deployment_id=? AND revision=? AND attempt_token=?`).run(report.state, report.failureCode ?? null, now(), completed,
            row.deployment_id, row.revision, contextData.attemptToken); if (changed.changes !== 1) fail("REVISION_CONFLICT");
        const targetState = report.state === "STAGED" ? "STAGING" : report.state === "WAITING_FOR_IDLE" ? "WAITING_FOR_IDLE"
          : report.state === "ACTIVE" ? "SUCCEEDED" : "FAILED";
        updateRollout(row, targetState, report.failureCode ?? null, completed);
        if (row.rollout_id) recomputeRolloutAggregate(db, row.rollout_id, writeAudit, now);
        const audit = CatalogAuditEventSchema.parse({ type: "audit.catalog.deployment.reported", source: "system", status: "DELIVERED", channelId: null,
          payload: { actorKind: "RUNNER", actorId: contextData.runnerId, action: report.state, outcome: report.state === "FAILED" ? "FAILED" : "SUCCEEDED",
            revision: row.revision + 1, releaseId: row.release_id, operationId: row.deployment_id, agentId: row.target_agent_id,
            runnerId: row.bound_runner_id, ...(report.failureCode ? { failureCode: report.failureCode } : {}) } }) as CatalogAuditEvent;
        writeAudit(db, audit);
        return { deploymentId: row.deployment_id, state: report.state, revision: row.revision + 1 };
      })();
    } catch (error) { throw fixed(error); }
  }

  return { poll, claim, getArtifact, report };
}
