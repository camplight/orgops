import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { OrgOpsDb } from "@orgops/db";
import { catalogGrantId } from "./grant-identity";
import {
  ActivationPlanCommandSchema, ActivationPlanSchema, ActivationTargetPlanSchema,
  CatalogAuditEventSchema, ConfirmActivationCommandSchema, ConsumptionActorSchema, PackageReleaseViewSchema,
  RequirementReasonSchema, ReleaseIdentitySchema, RolloutViewSchema, CancelRolloutCommandSchema,
  RetryFailedRolloutCommandSchema, CancelRolloutResultSchema, RetryFailedRolloutResultSchema, type ActivationPlan, type ActivationPlanCommand, type ActivationTargetPlan,
  type CatalogAuditEvent, type CatalogLibraryErrorCode, type CatalogPolicy, type ConsumptionActor, type PackageReleaseView,
  type RequirementReason, type RolloutView,
} from "@orgops/schemas";

const MAX_REVISION = 2_147_483_647;
const id = z.string().min(1).max(200).regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/);
const actorKind = z.enum(["ADMIN", "GRANT"]);
const targetState = z.enum(["QUEUED", "BLOCKED", "STAGING", "VERIFYING", "WAITING_FOR_IDLE", "ACTIVATING", "SUCCEEDED", "FAILED", "SKIPPED", "SUPERSEDED"]);
const rolloutState = z.enum(["DRAFT", "QUEUED", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"]);
const reasonCode = z.enum(["FORBIDDEN", "REVISION_CONFLICT", "STATE_CONFLICT", "GRANT_REQUIRED", "INSTALLATION_REQUIRED", "DEPLOYMENT_REQUIRED", "API_ACTIVATION_REQUIRED", "SECRET_BINDING_MISSING", "RUNNER_BINDING_MISSING", "MODEL_BINDING_MISSING", "WORKSPACE_BINDING_MISSING", "WRAPPED_WIRING_MISSING", "QUARANTINED", "REQUIREMENTS_UNSATISFIED", "DEPLOYMENT_SUPERSEDED", "INSPECTION_FAILED", "STORAGE_FAILURE"]);
const RolloutRowSchema = z.object({
  rollout_id: id, release_id: id, operation: z.enum(["ENABLE", "DISABLE", "SET_PRELOAD"]), preload: z.union([z.literal(0), z.literal(1)]).nullable(), plan_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/), state: rolloutState,
  actor_kind: actorKind, actor_human_id: id, revision: z.number().int().min(1).max(MAX_REVISION), created_at: z.number().int().min(0), updated_at: z.number().int().min(0), completed_at: z.number().int().min(0).nullable(),
}).strict().superRefine((row, ctx) => {
  if ((row.operation === "SET_PRELOAD") !== (row.preload !== null)) ctx.addIssue({ code: "custom", message: "operation/preload invariant" });
});
const TargetRowSchema = z.object({ rollout_id: id, agent_id: id, captured_runner_id: id.nullable(), target_ordinal: z.number().int().min(0).max(255), expected_assignment_revision: z.number().int().min(0).max(MAX_REVISION), planned_preload: z.union([z.literal(0), z.literal(1)]), state: targetState, attempts: z.number().int().min(0).max(MAX_REVISION), reason_code: reasonCode.nullable(), blocker_json: z.string().max(16384).nullable(), prior_assignment_json: z.string().max(16384).nullable(), revision: z.number().int().min(1).max(MAX_REVISION), created_at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), updated_at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), completed_at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(), }).strict();
const AgentRowSchema = z.object({ id, name: z.string().min(1).max(200), model_id: id, workspace_path: z.string().min(1).max(4096), mode: z.enum(["CLASSIC", "RLM_REPL", "WRAPPED"]), wrapped_config_json: z.string().max(262144), owner_human_id: id.nullable(), assigned_runner_id: id.nullable(), revision: z.number().int().min(1).max(MAX_REVISION) }).strict();
const AssignmentSchema = z.object({ assignment_id: id, agent_id: id, release_id: id, local_skill_name: id, desired_state: z.enum(["DISABLED", "ENABLED"]), effective_state: z.enum(["DISABLED", "ENABLED"]), deployment_state: z.enum(["STABLE", "REQUESTED", "DEPLOYING", "FAILED"]), removal_requested: z.union([z.literal(0), z.literal(1)]), preload: z.union([z.literal(0), z.literal(1)]), effective_preload: z.union([z.literal(0), z.literal(1)]), active_generation: id.nullable(), desired_generation: id, revision: z.number().int().min(1).max(MAX_REVISION), actor_kind: actorKind, actor_human_id: id, grant_id: id.nullable() }).strict();
const assignmentSelect = "SELECT assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,removal_requested,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,grant_id FROM agent_skill_assignments";
const RetryParticipantSchema = z.object({ deployment_id: id, assignment_id: id, agent_id: id, release_id: id, local_skill_name: id, role: z.enum(["APPLY_DESIRED", "CARRY_EFFECTIVE"]), target_state: z.enum(["DISABLED", "ENABLED"]), target_preload: z.union([z.literal(0), z.literal(1)]), prior_effective_state: z.enum(["DISABLED", "ENABLED"]), prior_effective_preload: z.union([z.literal(0), z.literal(1)]), prior_active_generation: id.nullable(), assignment_revision: z.number().int().min(1).max(MAX_REVISION) }).strict();
type RolloutRow = z.infer<typeof RolloutRowSchema>;
type TargetRow = z.infer<typeof TargetRowSchema>;
type AgentRow = z.infer<typeof AgentRowSchema>;
type Assignment = z.infer<typeof AssignmentSchema>;
const PriorAssignmentSchema = AssignmentSchema.nullable();
const parsePriorAssignment = (raw: string | null): Assignment | null => {
  if (raw === null) return null;
  try { const parsed = PriorAssignmentSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : fail("STATE_CONFLICT"); } catch { return fail("STATE_CONFLICT"); }
};
const parseBlocker = (raw: string | null): RequirementReason | null => {
  if (raw === null) return null;
  try { const parsed = RequirementReasonSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : fail("STATE_CONFLICT"); } catch { return fail("STATE_CONFLICT"); }
};

export class RolloutError extends Error { constructor(readonly code: CatalogLibraryErrorCode) { super(code); } }
const fail = (code: CatalogLibraryErrorCode): never => { throw new RolloutError(code); };
const fixed = (error: unknown) => error instanceof RolloutError ? error : new RolloutError("STORAGE_FAILURE");
const parseCatalogAudit = (raw: unknown): CatalogAuditEvent => CatalogAuditEventSchema.parse(raw) as CatalogAuditEvent;

export type RolloutCoordinatorDeps = Readonly<{
  db: OrgOpsDb;
  policy: CatalogPolicy;
  readRelease(id: string): PackageReleaseView | undefined;
  startGate?: { validateCatalogStart(agentId: string, actor: ConsumptionActor): Promise<{ ok: true } | { ok: false; reasons: readonly RequirementReason[] }> };
  writeAudit(tx: OrgOpsDb, event: CatalogAuditEvent): void;
  now?: () => number;
  newId?: () => string;
  beforeImmediateTransaction?: () => void | Promise<void>;
}>;

function operationOf(row: RolloutRow) {
  return row.operation === "SET_PRELOAD" ? { operation: row.operation, preload: row.preload === 1 } : { operation: row.operation };
}
function parseRollout(raw: unknown): RolloutRow { const parsed = RolloutRowSchema.safeParse(raw); return parsed.success ? parsed.data : fail("STORAGE_FAILURE"); }
function parseTarget(raw: unknown): TargetRow {
  const parsed = TargetRowSchema.safeParse(raw); const value = parsed.success ? parsed.data : fail("STORAGE_FAILURE");
  try {
    if (value.blocker_json !== null) RequirementReasonSchema.parse(JSON.parse(value.blocker_json));
    if (value.prior_assignment_json !== null) PriorAssignmentSchema.parse(JSON.parse(value.prior_assignment_json));
  } catch { fail("STATE_CONFLICT"); }
  return value;
}
function parseAgent(raw: unknown): AgentRow { const parsed = AgentRowSchema.safeParse(raw); return parsed.success ? parsed.data : fail("FORBIDDEN"); }
function parseAssignment(raw: unknown): Assignment { const parsed = AssignmentSchema.safeParse(raw); return parsed.success ? parsed.data : fail("STATE_CONFLICT"); }
function parseFailedDeployment(raw: unknown) {
  const parsed = z.object({ deployment_id: id, rollout_id: id.nullable(), target_agent_id: id, release_id: id, bound_runner_id: id,
    desired_generation: id, state: z.literal("FAILED"), attempt_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    lease_expires_at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), revision: z.number().int().min(1).max(MAX_REVISION),
    failure_code: z.enum(["INSPECTION_FAILED", "STORAGE_FAILURE"]), desired_roots_json: z.string().max(262144).nullable(),
    package_set_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(), artifact_semantic_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
    created_at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), updated_at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    completed_at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), agent_name: id, assigned_runner_id: id.nullable(),
  }).strict().superRefine((row, ctx) => {
    if ((row.desired_roots_json === null) !== (row.package_set_digest === null)) ctx.addIssue({ code: "custom", message: "freeze invariant" });
    if (row.desired_roots_json !== null) {
      try { z.array(ReleaseIdentitySchema).max(256).parse(JSON.parse(row.desired_roots_json)); }
      catch { ctx.addIssue({ code: "custom", message: "roots invariant" }); }
    }
  }).safeParse(raw);
  return parsed.success ? parsed.data : fail("STATE_CONFLICT");
}

function actorIsLive(db: OrgOpsDb, actor: ConsumptionActor): void {
  const parsed = ConsumptionActorSchema.safeParse(actor);
  if (!parsed.success) fail("FORBIDDEN");
  const row = db.prepare<[string], { is_admin: number; must_change_password: number }>("SELECT is_admin,must_change_password FROM humans WHERE id=?").get(actor.id);
  if (!row || row.must_change_password !== 0 || (actor.kind === "HUMAN_ADMIN") !== (row.is_admin === 1)) fail("FORBIDDEN");
}

export function recomputeRolloutAggregate(db: OrgOpsDb, rolloutId: string, writeAudit?: (tx: OrgOpsDb, event: CatalogAuditEvent) => void, now = Date.now): void {
  const raw = db.prepare<[string], unknown>("SELECT rollout_id,release_id,operation,preload,plan_digest,state,actor_kind,actor_human_id,revision,created_at,updated_at,completed_at FROM catalog_rollouts WHERE rollout_id=?").get(rolloutId);
  if (raw === undefined) return;
  const rollout = parseRollout(raw);
  if (rollout.state === "CANCELLED") return;
  const targets = db.prepare<[string], unknown>("SELECT rollout_id,agent_id,captured_runner_id,target_ordinal,expected_assignment_revision,planned_preload,state,attempts,reason_code,blocker_json,prior_assignment_json,revision,created_at,updated_at,completed_at FROM catalog_rollout_targets WHERE rollout_id=? ORDER BY target_ordinal").all(rolloutId).map(parseTarget);
  if (!targets.length) fail("STATE_CONFLICT");
  const terminal = targets.every(item => ["SUCCEEDED", "FAILED", "SKIPPED", "SUPERSEDED"].includes(item.state));
  const successes = targets.filter(item => item.state === "SUCCEEDED").length;
  const active = targets.some(item => ["STAGING", "VERIFYING", "WAITING_FOR_IDLE", "ACTIVATING"].includes(item.state));
  const next = terminal ? successes === targets.length ? "SUCCEEDED" : successes > 0 ? "PARTIAL" : "FAILED" : active ? "RUNNING" : "QUEUED";
  if (next === rollout.state) return;
  if (rollout.revision >= MAX_REVISION) fail("REVISION_CONFLICT");
  const timestamp = now();
  const changed = db.prepare("UPDATE catalog_rollouts SET state=?,revision=revision+1,updated_at=?,completed_at=? WHERE rollout_id=? AND state=? AND revision=?").run(next, timestamp, terminal ? timestamp : null, rollout.rollout_id, rollout.state, rollout.revision);
  if (changed.changes !== 1) fail("REVISION_CONFLICT");
  if (writeAudit) writeAudit(db, parseCatalogAudit({ type: "audit.catalog.rollout.changed", source: "system", status: "DELIVERED", channelId: null, payload: { actorKind: rollout.actor_kind === "ADMIN" ? "HUMAN_ADMIN" : "AUTHENTICATED_HUMAN", actorId: rollout.actor_human_id, action: "aggregate", outcome: next === "FAILED" ? "FAILED" : "SUCCEEDED", revision: rollout.revision + 1, releaseId: rollout.release_id, operationId: rollout.rollout_id } }));
}

export function createRolloutCoordinator({ db, policy, readRelease, startGate, writeAudit, now = Date.now, newId = randomUUID, beforeImmediateTransaction }: RolloutCoordinatorDeps) {
  const agentById = db.prepare<[string], unknown>("SELECT id,name,model_id,workspace_path,mode,wrapped_config_json,owner_human_id,assigned_runner_id,revision FROM agents WHERE id=?");
  const releaseName = (release: PackageReleaseView) => release.manifest.name;
  const readGrantId = (actor: ConsumptionActor, releaseId: string): string | null => {
    if (actor.kind === "HUMAN_ADMIN") return null;
    const human = db.prepare<[string, string], { grant_id: string }>("SELECT grant_id FROM catalog_grants WHERE release_id=? AND revoked_at IS NULL AND subject_type='HUMAN' AND human_id=?").get(releaseId, actor.id);
    if (human) return human.grant_id;
    return db.prepare<[string], { grant_id: string }>("SELECT grant_id FROM catalog_grants WHERE release_id=? AND revoked_at IS NULL AND subject_type='ORGANIZATION' AND human_id IS NULL").get(releaseId)?.grant_id ?? null;
  };
  const readTargets = (rolloutId: string) => db.prepare<[string], unknown>("SELECT rollout_id,agent_id,captured_runner_id,target_ordinal,expected_assignment_revision,planned_preload,state,attempts,reason_code,blocker_json,prior_assignment_json,revision,created_at,updated_at,completed_at FROM catalog_rollout_targets WHERE rollout_id=? ORDER BY target_ordinal").all(rolloutId).map(parseTarget);
  const readRow = (rolloutId: string) => parseRollout(db.prepare<[string], unknown>("SELECT rollout_id,release_id,operation,preload,plan_digest,state,actor_kind,actor_human_id,revision,created_at,updated_at,completed_at FROM catalog_rollouts WHERE rollout_id=?").get(rolloutId) ?? fail("NOT_FOUND"));
  const view = (row: RolloutRow): RolloutView => {
    const targets = readTargets(row.rollout_id);
    const value = { id: row.rollout_id, releaseId: row.release_id, ...operationOf(row), state: row.state, revision: row.revision,
      targetIds: targets.map(target => target.agent_id), targets: targets.map(target => ({ agentId: target.agent_id, state: target.state, attempts: target.attempts, reasonCode: target.reason_code })) };
    const parsed = RolloutViewSchema.safeParse(value); return parsed.success ? parsed.data : fail("STORAGE_FAILURE");
  };
  const policyReleaseState = (release: PackageReleaseView): PackageReleaseView => PackageReleaseViewSchema.parse(release);
  const agentFor = (agentId: string) => parseAgent(agentById.get(agentId));
  const storedAssignmentFor = (agentId: string, releaseId: string): Assignment | undefined => {
    const raw = db.prepare<[string, string], unknown>(`${assignmentSelect} WHERE agent_id=? AND release_id=?`).get(agentId, releaseId);
    return raw === undefined ? undefined : parseAssignment(raw);
  };
  const currentAssignmentFor = (agentId: string, releaseId: string): Assignment | undefined => {
    const assignment = storedAssignmentFor(agentId, releaseId);
    return assignment?.removal_requested === 0 ? assignment : undefined;
  };
  const currentAssignmentsNamed = (agentId: string, localSkillName: string): Assignment[] => db.prepare<[string, string], unknown>(
    `${assignmentSelect} WHERE agent_id=? AND local_skill_name=? ORDER BY release_id`,
  ).all(agentId, localSkillName).map(parseAssignment).filter(assignment => assignment.removal_requested === 0);
  const currentAssignmentById = (assignmentId: string): Assignment | undefined => {
    const raw = db.prepare<[string], unknown>(`${assignmentSelect} WHERE assignment_id=?`).get(assignmentId);
    if (raw === undefined) return undefined;
    const assignment = parseAssignment(raw);
    return assignment.removal_requested === 0 ? assignment : undefined;
  };
  const requirement = (value: unknown): RequirementReason | null => { const parsed = RequirementReasonSchema.safeParse(value); return parsed.success ? parsed.data : null; };

  async function inspectTarget(command: ActivationPlanCommand, actor: ConsumptionActor, release: PackageReleaseView, agentId: string): Promise<{ agent: AgentRow; runnerId: string | null; assignmentRevision: number; blocker: RequirementReason | null; priorAssignment: Assignment | null }> {
    const agent = agentFor(agentId);
    const storedAssignment = storedAssignmentFor(agent.id, release.packageReleaseId);
    const assignment = storedAssignment?.removal_requested === 0 ? storedAssignment : undefined;
    const grant = readGrantId(actor, release.packageReleaseId) ? { grantId: readGrantId(actor, release.packageReleaseId)! } : undefined;
    const decision = policy.decide({ action: "ROLLOUT_CREATE", actor, release: policyReleaseState(release), agent: { id: agent.id, name: agent.name, ownerHumanId: agent.owner_human_id, assignedRunnerId: agent.assigned_runner_id, revision: agent.revision }, ...(grant ? { grant: { grantId: grant.grantId, releaseId: release.packageReleaseId, subject: actor.kind === "AUTHENTICATED_HUMAN" ? { kind: "HUMAN", humanId: actor.id } : { kind: "ORGANIZATION" }, revision: 1, revokedAt: null } } : {}) });
    if (!decision.allow) {
      if (["INSTALLATION_REQUIRED", "API_ACTIVATION_REQUIRED"].includes(decision.reasonCode)) return { agent, runnerId: agent.assigned_runner_id, assignmentRevision: assignment?.revision ?? 0, priorAssignment: assignment ?? null, blocker: RequirementReasonSchema.parse({ code: decision.reasonCode, packageReleaseId: release.packageReleaseId }) };
      if (["REQUIREMENTS_UNSATISFIED", "DEPLOYMENT_REQUIRED"].includes(decision.reasonCode)) return { agent, runnerId: agent.assigned_runner_id, assignmentRevision: assignment?.revision ?? 0, priorAssignment: assignment ?? null, blocker: RequirementReasonSchema.parse({ code: decision.reasonCode === "REQUIREMENTS_UNSATISFIED" ? "DEPLOYMENT_REQUIRED" : decision.reasonCode }) };
      fail(decision.reasonCode);
    }
    const collision = currentAssignmentsNamed(agent.id, releaseName(release));
    if (storedAssignment?.removal_requested === 1 || collision.some(item => item.release_id !== release.packageReleaseId)) return { agent, runnerId: agent.assigned_runner_id, assignmentRevision: assignment?.revision ?? 0, priorAssignment: assignment ?? null, blocker: { code: "DEPLOYMENT_REQUIRED" } };
    if (command.operation === "DISABLE" && !assignment) return { agent, runnerId: agent.assigned_runner_id, assignmentRevision: 0, priorAssignment: null, blocker: { code: "DEPLOYMENT_REQUIRED" } };
    if (command.operation === "SET_PRELOAD" && (!assignment || assignment.desired_state !== "ENABLED")) return { agent, runnerId: agent.assigned_runner_id, assignmentRevision: assignment?.revision ?? 0, priorAssignment: assignment ?? null, blocker: { code: "DEPLOYMENT_REQUIRED" } };
    const live = db.prepare<[string], { deployment_id: string }>("SELECT deployment_id FROM runner_package_deployments WHERE target_agent_id=? AND state IN ('QUEUED','CLAIMED','STAGED','WAITING_FOR_IDLE') LIMIT 1").get(agent.id);
    if (live) return { agent, runnerId: agent.assigned_runner_id, assignmentRevision: assignment?.revision ?? 0, priorAssignment: assignment ?? null, blocker: { code: "DEPLOYMENT_REQUIRED" } };
    let blocker: RequirementReason | null = null;
    if (agent.mode !== "WRAPPED" || agent.model_id !== "wrapped:none") {
      const model = db.prepare<[string], { id: string; enabled: number; defaults_json: string }>("SELECT id,enabled,defaults_json FROM models WHERE id=?").get(agent.model_id);
      let validModel = false;
      if (model) { try { const defaults = JSON.parse(model.defaults_json); validModel = model.enabled === 1 && !!defaults && typeof defaults === "object" && !Array.isArray(defaults); } catch { validModel = false; } }
      if (!validModel) blocker = { code: "MODEL_BINDING_MISSING" };
    }
    if (!agent.workspace_path.startsWith("/") || agent.workspace_path === "/" || agent.workspace_path.endsWith("/")) blocker = blocker ?? { code: "WORKSPACE_BINDING_MISSING" };
    if (!agent.assigned_runner_id || !db.prepare<[string], { id: string }>("SELECT id FROM runner_nodes WHERE id=?").get(agent.assigned_runner_id)) {
      blocker = { code: "RUNNER_BINDING_MISSING" };
    } else if (startGate) {
      const result = await startGate.validateCatalogStart(agent.id, actor);
      if (!result.ok) blocker = requirement(result.reasons[0]);
    }
    return { agent, runnerId: agent.assigned_runner_id, assignmentRevision: assignment?.revision ?? 0, priorAssignment: assignment ?? null, blocker };
  }

  function digestFor(command: ActivationPlanCommand, targets: readonly ActivationTargetPlan[]): string {
    const payload = { releaseId: command.releaseId, operation: command.operation, ...(command.operation === "SET_PRELOAD" ? { preload: command.preload } : {}), agentIds: command.agentIds, targets };
    return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
  }
  function planFromRow(row: RolloutRow): ActivationPlan {
    const targets = readTargets(row.rollout_id).map(target => ActivationTargetPlanSchema.parse({
      agentId: target.agent_id, assignmentRevision: target.expected_assignment_revision, runnerId: target.captured_runner_id, plannedPreload: target.planned_preload === 1,
      blocker: target.blocker_json !== null ? parseBlocker(target.blocker_json) : (target.reason_code === "DEPLOYMENT_REQUIRED" ? { code: "DEPLOYMENT_REQUIRED" } : null),
    }));
    const value = { planDigest: row.plan_digest, releaseId: row.release_id, ...operationOf(row), targets };
    const parsed = ActivationPlanSchema.safeParse(value); return parsed.success ? parsed.data : fail("STORAGE_FAILURE");
  }

  async function plan(raw: ActivationPlanCommand, actor: ConsumptionActor): Promise<ActivationPlan> {
    try {
      const command = ActivationPlanCommandSchema.safeParse(raw); if (!command.success) fail("INVALID_REQUEST"); const data = command.data!;
      actorIsLive(db, actor);
      const release = readRelease(data.releaseId); if (!release) fail("NOT_FOUND");
      const parsedRelease = PackageReleaseViewSchema.safeParse(release); if (!parsedRelease.success) fail("STORAGE_FAILURE");
      const inspected = [] as Array<Awaited<ReturnType<typeof inspectTarget>>>;
      for (const agentId of data.agentIds) inspected.push(await inspectTarget(data, actor, parsedRelease.data!, agentId));
      const targets = inspected.map(item => ({ agentId: item.agent.id, assignmentRevision: item.assignmentRevision, runnerId: item.runnerId, plannedPreload: data.operation === "SET_PRELOAD" ? data.preload : data.operation === "ENABLE" ? item.priorAssignment?.preload === 1 : false, blocker: item.blocker }));
      const digest = digestFor(data, targets);
      const expectedPlan = ActivationPlanSchema.parse({ planDigest: digest, releaseId: data.releaseId, ...operationOf({ operation: data.operation, preload: data.operation === "SET_PRELOAD" ? (data.preload ? 1 : 0) : null } as RolloutRow), targets });
      const timestamp = now(); const rolloutId = newId();
      if (!id.safeParse(rolloutId).success) fail("STORAGE_FAILURE");
      return db.transaction(() => {
        const existingRaw = db.prepare<[string], unknown>("SELECT rollout_id,release_id,operation,preload,plan_digest,state,actor_kind,actor_human_id,revision,created_at,updated_at,completed_at FROM catalog_rollouts WHERE plan_digest=?").get(digest);
        if (existingRaw !== undefined) {
          const existing = parseRollout(existingRaw);
          if (existing.actor_human_id !== actor.id || existing.actor_kind !== (actor.kind === "HUMAN_ADMIN" ? "ADMIN" : "GRANT") || existing.release_id !== data.releaseId || existing.operation !== data.operation || (existing.preload === 1) !== (data.operation === "SET_PRELOAD" && data.preload === true)) fail("REVISION_CONFLICT");
          const replay = planFromRow(existing);
          if (JSON.stringify(replay) !== JSON.stringify(expectedPlan)) fail("REVISION_CONFLICT");
          return replay;
        }
        db.prepare("INSERT INTO catalog_rollouts (rollout_id,release_id,operation,preload,plan_digest,state,actor_kind,actor_human_id,revision,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,'DRAFT',?,?,1,?,?,NULL)").run(rolloutId, data.releaseId, data.operation, data.operation === "SET_PRELOAD" ? (data.preload ? 1 : 0) : null, digest, actor.kind === "HUMAN_ADMIN" ? "ADMIN" : "GRANT", actor.id, timestamp, timestamp);
        for (let ordinal = 0; ordinal < targets.length; ordinal++) {
          const target = targets[ordinal]!;
          const blockerJson = target.blocker === null ? null : JSON.stringify(target.blocker);
          const prior = inspected[ordinal]?.priorAssignment ?? null;
          const priorJson = JSON.stringify(prior);
          db.prepare("INSERT INTO catalog_rollout_targets (rollout_id,agent_id,captured_runner_id,target_ordinal,expected_assignment_revision,planned_preload,state,attempts,reason_code,blocker_json,prior_assignment_json,revision,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?, ?,0,?,?,?,?,?,?,NULL)").run(rolloutId, target.agentId, target.runnerId, ordinal, target.assignmentRevision, target.plannedPreload ? 1 : 0, target.blocker ? "BLOCKED" : "QUEUED", target.blocker?.code ?? null, blockerJson, priorJson, 1, timestamp, timestamp);
        }
        writeAudit(db, parseCatalogAudit({ type: "audit.catalog.rollout.changed", source: "system", status: "DELIVERED", channelId: null, payload: { actorKind: actor.kind, actorId: actor.id, action: "plan", outcome: "SUCCEEDED", revision: 1, releaseId: data.releaseId, operationId: rolloutId } }));
        const created = planFromRow(readRow(rolloutId));
        if (JSON.stringify(created) !== JSON.stringify(expectedPlan)) fail("STORAGE_FAILURE");
        return created;
      }).immediate();
    } catch (error) { throw fixed(error); }
  }

  async function confirm(raw: unknown, actor: ConsumptionActor): Promise<RolloutView> {
    try {
      const command = ConfirmActivationCommandSchema.safeParse(raw); if (!command.success) fail("INVALID_REQUEST"); const data = command.data!;
      actorIsLive(db, actor);
      const initial = parseRollout(db.prepare<[string], unknown>("SELECT rollout_id,release_id,operation,preload,plan_digest,state,actor_kind,actor_human_id,revision,created_at,updated_at,completed_at FROM catalog_rollouts WHERE plan_digest=?").get(data.planDigest) ?? fail("REVISION_CONFLICT"));
      if (initial.state !== "DRAFT" || initial.actor_human_id !== actor.id) fail("REVISION_CONFLICT");
      const initialTargets = readTargets(initial.rollout_id);
      if (JSON.stringify(data.agentIds) !== JSON.stringify(initialTargets.map(target => target.agent_id))) fail("REVISION_CONFLICT");
      const initialRelease = readRelease(initial.release_id); if (!initialRelease) fail("REVISION_CONFLICT");
      const initialParsedRelease = PackageReleaseViewSchema.safeParse(initialRelease); if (!initialParsedRelease.success) fail("STORAGE_FAILURE");
      const initialOperation = operationOf(initial);
      const initialCommand = { releaseId: initial.release_id, ...initialOperation, agentIds: data.agentIds } as ActivationPlanCommand;
      const reconstructedTargets: ActivationTargetPlan[] = [];
      for (const target of initialTargets) {
        const fresh = await inspectTarget(initialCommand, actor, initialParsedRelease.data!, target.agent_id);
        const plannedPreload = initial.operation === "SET_PRELOAD" ? initial.preload === 1
          : initial.operation === "ENABLE" ? fresh.priorAssignment?.preload === 1 : false;
        const reconstructed: ActivationTargetPlan = { agentId: fresh.agent.id, assignmentRevision: fresh.assignmentRevision,
          runnerId: fresh.runnerId, plannedPreload, blocker: fresh.blocker };
        if (fresh.blocker || JSON.stringify(reconstructed) !== JSON.stringify({ agentId: target.agent_id,
          assignmentRevision: target.expected_assignment_revision, runnerId: target.captured_runner_id,
          plannedPreload: target.planned_preload === 1,
          blocker: target.blocker_json === null ? null : parseBlocker(target.blocker_json) })) fail("REVISION_CONFLICT");
        reconstructedTargets.push(reconstructed);
      }
      if (digestFor(initialCommand, reconstructedTargets) !== initial.plan_digest) fail("REVISION_CONFLICT");
      await beforeImmediateTransaction?.();
      const value = db.transaction(() => {
        actorIsLive(db, actor);
        const planRow = readRow(initial.rollout_id);
        if (planRow.state !== "DRAFT" || planRow.actor_human_id !== actor.id || planRow.revision !== initial.revision) fail("REVISION_CONFLICT");
        const persistedTargets = readTargets(planRow.rollout_id);
        const persistedCommand = { releaseId: planRow.release_id, ...operationOf(planRow), agentIds: persistedTargets.map(target => target.agent_id) } as ActivationPlanCommand;
        const persistedPlanTargets = persistedTargets.map(target => ActivationTargetPlanSchema.parse({ agentId: target.agent_id,
          assignmentRevision: target.expected_assignment_revision, runnerId: target.captured_runner_id, plannedPreload: target.planned_preload === 1,
          blocker: target.blocker_json === null ? null : parseBlocker(target.blocker_json) }));
        if (digestFor(persistedCommand, persistedPlanTargets) !== planRow.plan_digest) fail("REVISION_CONFLICT");
        const releaseRaw = readRelease(planRow.release_id); if (!releaseRaw) fail("REVISION_CONFLICT");
        const parsedRelease = PackageReleaseViewSchema.safeParse(releaseRaw); if (!parsedRelease.success) fail("STORAGE_FAILURE");
        const timestamp = now(); const actorKind = actor.kind === "HUMAN_ADMIN" ? "ADMIN" : "GRANT";
        for (const target of persistedTargets) {
          if (target.state !== "QUEUED" || target.blocker_json !== null || target.reason_code !== null || target.revision >= MAX_REVISION) fail("REVISION_CONFLICT");
          const agent = agentFor(target.agent_id); const runnerId = agent.assigned_runner_id ?? fail("REVISION_CONFLICT");
          if (runnerId !== target.captured_runner_id || !db.prepare<[string], { id: string }>("SELECT id FROM runner_nodes WHERE id=?").get(runnerId)) fail("REVISION_CONFLICT");
          const policyGrantId = readGrantId(actor, planRow.release_id);
          const policyDecision = policy.decide({ action: "ROLLOUT_CREATE", actor, release: parsedRelease.data, agent: { id: agent.id, name: agent.name, ownerHumanId: agent.owner_human_id, assignedRunnerId: agent.assigned_runner_id, revision: agent.revision }, ...(policyGrantId ? { grant: { grantId: policyGrantId, releaseId: planRow.release_id, subject: actor.kind === "AUTHENTICATED_HUMAN" ? { kind: "HUMAN", humanId: actor.id } : { kind: "ORGANIZATION" }, revision: 1, revokedAt: null } } : {}) });
          if (!policyDecision.allow) fail("REVISION_CONFLICT");
          const collision = currentAssignmentsNamed(agent.id, releaseName(parsedRelease.data!));
          if (collision.some(item => item.release_id !== planRow.release_id)) fail("REVISION_CONFLICT");
          const live = db.prepare<[string], { deployment_id: string }>("SELECT deployment_id FROM runner_package_deployments WHERE target_agent_id=? AND state IN ('QUEUED','CLAIMED','STAGED','WAITING_FOR_IDLE') LIMIT 1").get(agent.id);
          if (live) fail("REVISION_CONFLICT");
          const existing = currentAssignmentFor(target.agent_id, planRow.release_id);
          const assignmentRevision = existing?.revision ?? 0;
          const plannedPreload = planRow.operation === "SET_PRELOAD" ? planRow.preload === 1
            : planRow.operation === "ENABLE" ? existing?.preload === 1 : false;
          if (assignmentRevision !== target.expected_assignment_revision || target.planned_preload !== (plannedPreload ? 1 : 0)) fail("REVISION_CONFLICT");
          if (existing && existing.revision >= MAX_REVISION) fail("REVISION_CONFLICT");
          const generation = newId(); const assignmentId = existing?.assignment_id ?? newId(); const deploymentId = newId();
          if (![generation, assignmentId, deploymentId].every(item => id.safeParse(item).success)) fail("STORAGE_FAILURE");
          const desiredState = planRow.operation === "DISABLE" ? "DISABLED" : "ENABLED";
          const preload = target.planned_preload;
          const grantId = readGrantId(actor, planRow.release_id);
          if (actor.kind !== "HUMAN_ADMIN" && !grantId) fail("GRANT_REQUIRED");
          if (existing) {
            db.prepare("UPDATE agent_skill_assignments SET desired_state=?,deployment_state='REQUESTED',preload=?,desired_generation=?,revision=revision+1,actor_kind=?,actor_human_id=?,grant_id=?,updated_at=? WHERE assignment_id=? AND revision=? AND removal_requested=0").run(desiredState, preload, generation, actorKind, actor.id, grantId, timestamp, existing.assignment_id, assignmentRevision);
          } else {
            if (planRow.operation === "DISABLE" || planRow.operation === "SET_PRELOAD") fail("REVISION_CONFLICT");
            db.prepare("INSERT INTO agent_skill_assignments (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,grant_id,created_at,updated_at) VALUES (?,?,?,?,?,'DISABLED','REQUESTED',?,0,NULL,?,1,?,?,?,?,?)").run(assignmentId, agent.id, planRow.release_id, releaseName(parsedRelease.data!), desiredState, preload, generation, actorKind, actor.id, grantId, timestamp, timestamp);
          }
          db.prepare("INSERT INTO runner_package_deployments (deployment_id,rollout_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,revision,failure_code,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?, 'QUEUED',1,NULL,?,?,NULL)").run(deploymentId, planRow.rollout_id, agent.id, planRow.release_id, runnerId, generation, timestamp, timestamp);
          const changed = db.prepare("UPDATE catalog_rollout_targets SET state='QUEUED',attempts=1,reason_code=NULL,revision=revision+1,updated_at=? WHERE rollout_id=? AND agent_id=? AND revision=? AND state='QUEUED'").run(timestamp, planRow.rollout_id, agent.id, target.revision);
          if (changed.changes !== 1) fail("REVISION_CONFLICT");
        }
        if (planRow.revision >= MAX_REVISION) fail("REVISION_CONFLICT");
        const changed = db.prepare("UPDATE catalog_rollouts SET state='QUEUED',revision=revision+1,updated_at=? WHERE rollout_id=? AND state='DRAFT' AND revision=?").run(timestamp, planRow.rollout_id, planRow.revision);
        if (changed.changes !== 1) fail("REVISION_CONFLICT");
        writeAudit(db, parseCatalogAudit({ type: "audit.catalog.rollout.changed", source: "system", status: "DELIVERED", channelId: null, payload: { actorKind: actor.kind, actorId: actor.id, action: "confirm", outcome: "SUCCEEDED", revision: planRow.revision + 1, releaseId: planRow.release_id, operationId: planRow.rollout_id } }));
        return view(readRow(planRow.rollout_id));
      }).immediate();
      return value;
    } catch (error) { throw fixed(error); }
  }

  async function getRollout(rolloutId: string, actor: ConsumptionActor): Promise<RolloutView> {
    try { actorIsLive(db, actor); if (!id.safeParse(rolloutId).success) fail("NOT_FOUND"); const row = readRow(rolloutId); if (row.actor_human_id !== actor.id) { if (actor.kind !== "HUMAN_ADMIN") fail("NOT_FOUND"); } return view(row); } catch (error) { throw fixed(error); }
  }

  async function cancel(raw: unknown, actor: ConsumptionActor) {
    try {
      const command = CancelRolloutCommandSchema.safeParse(raw); if (!command.success) fail("INVALID_REQUEST"); const data = command.data!; actorIsLive(db, actor);
      return db.transaction(() => {
        const row = readRow(data.rolloutId); if ((row.actor_human_id !== actor.id && actor.kind !== "HUMAN_ADMIN")) fail("NOT_FOUND"); if (!["DRAFT", "QUEUED", "RUNNING"].includes(row.state)) fail("STATE_CONFLICT"); if (row.revision !== data.expectedRevision) fail("REVISION_CONFLICT");
        const targets = readTargets(row.rollout_id);
        const candidates = targets.filter(target => ["QUEUED", "BLOCKED"].includes(target.state));
        // Parse every persisted snapshot before making any write so cancellation is all-or-nothing.
        const snapshots = new Map(candidates.map(target => [target.agent_id, parsePriorAssignment(target.prior_assignment_json)]));
        for (const target of candidates) {
          if (target.revision >= MAX_REVISION) fail("REVISION_CONFLICT");
          const deployment = db.prepare<[string, string], { deployment_id: string; revision: number; state: string }>("SELECT deployment_id,revision,state FROM runner_package_deployments WHERE rollout_id=? AND target_agent_id=? AND state='QUEUED'").get(row.rollout_id, target.agent_id);
          if (!deployment) continue;
          if (deployment.revision >= MAX_REVISION) fail("REVISION_CONFLICT");
          const prior = snapshots.get(target.agent_id) ?? null;
          const assignment = currentAssignmentFor(target.agent_id, row.release_id);
          if (prior) {
            const current = assignment ?? fail("REVISION_CONFLICT");
            if (current.assignment_id !== prior.assignment_id || current.revision !== prior.revision + 1 || current.deployment_state !== "REQUESTED") fail("REVISION_CONFLICT");
            if (current.revision >= MAX_REVISION) fail("REVISION_CONFLICT");
          } else if (assignment) {
            if (assignment.revision !== 1 || assignment.deployment_state !== "REQUESTED" || assignment.active_generation !== null || assignment.effective_state !== "DISABLED") fail("REVISION_CONFLICT");
            // Queued deployments may already have frozen participants after a runner poll; they have not staged or activated anything and are safe to supersede.
          }
        }
        const skipped: string[] = []; const timestamp = now();
        for (const target of candidates) {
          const deployment = db.prepare<[string, string], { deployment_id: string; revision: number }>("SELECT deployment_id,revision FROM runner_package_deployments WHERE rollout_id=? AND target_agent_id=? AND state='QUEUED'").get(row.rollout_id, target.agent_id);
          if (deployment) {
            const changed = db.prepare("UPDATE runner_package_deployments SET state='SUPERSEDED',failure_code='DEPLOYMENT_SUPERSEDED',revision=revision+1,updated_at=?,completed_at=? WHERE deployment_id=? AND state='QUEUED' AND revision=?").run(timestamp, timestamp, deployment.deployment_id, deployment.revision); if (changed.changes !== 1) fail("REVISION_CONFLICT");
            const prior = snapshots.get(target.agent_id) ?? null;
            const assignment = currentAssignmentFor(target.agent_id, row.release_id);
            if (assignment) {
              if (prior) {
                const restored = db.prepare("UPDATE agent_skill_assignments SET desired_state=?,effective_state=?,deployment_state=?,removal_requested=?,preload=?,effective_preload=?,active_generation=?,desired_generation=?,revision=revision+1,actor_kind=?,actor_human_id=?,grant_id=?,updated_at=? WHERE assignment_id=? AND revision=? AND deployment_state='REQUESTED' AND removal_requested=0").run(prior.desired_state, prior.effective_state, prior.deployment_state, prior.removal_requested, prior.preload, prior.effective_preload, prior.active_generation, prior.desired_generation, prior.actor_kind, prior.actor_human_id, prior.grant_id, timestamp, assignment.assignment_id, assignment.revision); if (restored.changes !== 1) fail("REVISION_CONFLICT");
              } else {
                db.prepare("DELETE FROM runner_deployment_participants WHERE deployment_id=?").run(deployment.deployment_id);
                const removed = db.prepare("DELETE FROM agent_skill_assignments WHERE assignment_id=? AND revision=1 AND deployment_state='REQUESTED' AND removal_requested=0 AND active_generation IS NULL AND effective_state='DISABLED'").run(assignment!.assignment_id); if (removed.changes !== 1) fail("REVISION_CONFLICT");
              }
            }
          }
          const changedTarget = db.prepare("UPDATE catalog_rollout_targets SET state='SKIPPED',reason_code='DEPLOYMENT_SUPERSEDED',blocker_json=NULL,revision=revision+1,updated_at=?,completed_at=? WHERE rollout_id=? AND agent_id=? AND revision=? AND state IN ('QUEUED','BLOCKED')").run(timestamp, timestamp, row.rollout_id, target.agent_id, target.revision); if (changedTarget.changes !== 1) fail("REVISION_CONFLICT"); skipped.push(target.agent_id);
        }
        if (row.revision >= MAX_REVISION) fail("REVISION_CONFLICT");
        const changed = db.prepare("UPDATE catalog_rollouts SET state='CANCELLED',revision=revision+1,updated_at=?,completed_at=? WHERE rollout_id=? AND state=? AND revision=?").run(timestamp, timestamp, row.rollout_id, row.state, row.revision); if (changed.changes !== 1) fail("REVISION_CONFLICT");
        writeAudit(db, parseCatalogAudit({ type: "audit.catalog.rollout.changed", source: "system", status: "DELIVERED", channelId: null, payload: { actorKind: actor.kind, actorId: actor.id, action: "cancel", outcome: "SUCCEEDED", revision: row.revision + 1, releaseId: row.release_id, operationId: row.rollout_id } }));
        return CancelRolloutResultSchema.parse({ rollout: view(readRow(row.rollout_id)), skippedTargetIds: skipped });
      }).immediate();
    } catch (error) { throw fixed(error); }
  }

  async function retryFailed(raw: unknown, actor: ConsumptionActor) {
    try {
      const command = RetryFailedRolloutCommandSchema.safeParse(raw); if (!command.success) fail("INVALID_REQUEST"); const data = command.data!; actorIsLive(db, actor);
      return db.transaction(() => {
        actorIsLive(db, actor);
        const row = readRow(data.rolloutId); if (row.actor_human_id !== actor.id && actor.kind !== "HUMAN_ADMIN") fail("NOT_FOUND"); if (!["FAILED", "PARTIAL", "CANCELLED"].includes(row.state)) fail("STATE_CONFLICT"); if (row.revision !== data.expectedRevision) fail("REVISION_CONFLICT");
        const release = readRelease(row.release_id); if (!release) fail("REVISION_CONFLICT"); const parsedRelease = PackageReleaseViewSchema.safeParse(release); if (!parsedRelease.success) fail("STORAGE_FAILURE");
        const candidates = readTargets(row.rollout_id).filter(target => target.state === "FAILED"); if (!candidates.length) fail("STATE_CONFLICT");
        for (const target of candidates) {
          if (target.revision >= MAX_REVISION || target.attempts >= MAX_REVISION) fail("REVISION_CONFLICT");
          const blocker = parseBlocker(target.blocker_json);
          const prior = parsePriorAssignment(target.prior_assignment_json);
          const agent = agentFor(target.agent_id);
          if (target.expected_assignment_revision !== (prior?.revision ?? 0)) fail("REVISION_CONFLICT");
          if (!agent.assigned_runner_id || agent.assigned_runner_id !== target.captured_runner_id
            || !db.prepare<[string], { id: string }>("SELECT id FROM runner_nodes WHERE id=?").get(agent.assigned_runner_id)) fail("REVISION_CONFLICT");
          const grantId = readGrantId(actor, row.release_id);
          const decision = policy.decide({ action: "ROLLOUT_CREATE", actor, release: parsedRelease.data, agent: { id: agent.id, name: agent.name, ownerHumanId: agent.owner_human_id, assignedRunnerId: agent.assigned_runner_id, revision: agent.revision }, ...(grantId ? { grant: { grantId, releaseId: row.release_id, subject: actor.kind === "AUTHENTICATED_HUMAN" ? { kind: "HUMAN", humanId: actor.id } : { kind: "ORGANIZATION" }, revision: 1, revokedAt: null } } : {}) });
          if (!decision.allow || (actor.kind !== "HUMAN_ADMIN" && !grantId)) fail("REVISION_CONFLICT");
          const collision = currentAssignmentsNamed(agent.id, releaseName(parsedRelease.data!));
          if (collision.some(item => item.release_id !== row.release_id)) fail("REVISION_CONFLICT");
          if (db.prepare<[string], { deployment_id: string }>("SELECT deployment_id FROM runner_package_deployments WHERE target_agent_id=? AND state IN ('QUEUED','CLAIMED','STAGED','WAITING_FOR_IDLE') LIMIT 1").get(agent.id)) fail("REVISION_CONFLICT");
          const existing = currentAssignmentFor(agent.id, row.release_id);
          if (!existing && row.operation !== "ENABLE") fail("REVISION_CONFLICT");
          if (existing && existing.revision >= MAX_REVISION) fail("REVISION_CONFLICT");
          if (blocker || !target.reason_code) fail("REVISION_CONFLICT");
          const failedRaw = db.prepare<[string, string, string], unknown>(`SELECT d.deployment_id,d.rollout_id,d.target_agent_id,d.release_id,d.bound_runner_id,d.desired_generation,d.state,
            d.attempt_token,d.lease_expires_at,d.revision,d.failure_code,d.desired_roots_json,d.package_set_digest,d.artifact_semantic_digest,d.created_at,d.updated_at,d.completed_at,
            a.name AS agent_name,a.assigned_runner_id FROM runner_package_deployments d JOIN agents a ON a.id=d.target_agent_id
            WHERE d.rollout_id=? AND d.target_agent_id=? AND d.release_id=? AND d.state='FAILED' ORDER BY d.created_at DESC,d.deployment_id DESC`).all(row.rollout_id, target.agent_id, row.release_id);
          if (!failedRaw.length) fail("REVISION_CONFLICT");
          const failed = failedRaw.map(parseFailedDeployment);
          const latest = failed[0]!;
          if (failed.filter(item => item.desired_generation === latest.desired_generation).length !== 1
            || latest.rollout_id !== row.rollout_id || latest.target_agent_id !== target.agent_id || latest.release_id !== row.release_id
            || latest.bound_runner_id !== target.captured_runner_id || latest.bound_runner_id !== agent.assigned_runner_id
            || latest.failure_code !== target.reason_code || latest.completed_at === null) fail("REVISION_CONFLICT");
          const participants = db.prepare<[string], unknown>("SELECT deployment_id,assignment_id,agent_id,release_id,local_skill_name,role,target_state,target_preload,prior_effective_state,prior_effective_preload,prior_active_generation,assignment_revision FROM runner_deployment_participants WHERE deployment_id=? ORDER BY assignment_id").all(latest.deployment_id).map(value => {
            const parsed = RetryParticipantSchema.safeParse(value); return parsed.success ? parsed.data : fail("STATE_CONFLICT");
          });
          const applying = participants.filter(item => item.role === "APPLY_DESIRED");
          if (applying.length !== 1 || participants.some(item => item.agent_id !== target.agent_id || item.deployment_id !== latest.deployment_id)) fail("REVISION_CONFLICT");
          const participant = applying[0]!;
          const expectedPriorState = prior?.effective_state ?? "DISABLED";
          const expectedPriorPreload = prior?.effective_preload ?? 0;
          const expectedPriorGeneration = prior?.active_generation ?? null;
          const expectedParticipantRevision = (prior?.revision ?? 0) + 1;
          const expectedTargetState = row.operation === "DISABLE" ? "DISABLED" : "ENABLED";
          if (participant.assignment_id !== (existing?.assignment_id ?? participant.assignment_id)
            || participant.release_id !== row.release_id || participant.local_skill_name !== releaseName(parsedRelease.data!)
            || participant.assignment_revision !== expectedParticipantRevision || participant.target_state !== expectedTargetState
            || participant.target_preload !== target.planned_preload || participant.prior_effective_state !== expectedPriorState
            || participant.prior_effective_preload !== expectedPriorPreload || participant.prior_active_generation !== expectedPriorGeneration) fail("REVISION_CONFLICT");
          for (const carry of participants.filter(item => item.role === "CARRY_EFFECTIVE")) {
            const carryAssignment = currentAssignmentById(carry.assignment_id) ?? fail("REVISION_CONFLICT");
            if (carryAssignment.agent_id !== target.agent_id || carryAssignment.release_id !== carry.release_id || carryAssignment.local_skill_name !== carry.local_skill_name
              || carryAssignment.revision !== carry.assignment_revision || carryAssignment.effective_state !== carry.prior_effective_state
              || carryAssignment.effective_preload !== carry.prior_effective_preload || carryAssignment.active_generation !== carry.prior_active_generation) fail("REVISION_CONFLICT");
          }
          const canonicalGrantId = row.actor_kind === "ADMIN" ? null : (() => {
            const humanGrant = catalogGrantId(row.release_id, "HUMAN", row.actor_human_id);
            if (db.prepare<[string, string, string], { grant_id: string }>("SELECT grant_id FROM catalog_grants WHERE grant_id=? AND release_id=? AND subject_type='HUMAN' AND human_id=?").get(humanGrant, row.release_id, row.actor_human_id)) return humanGrant;
            const organizationGrant = catalogGrantId(row.release_id, "ORGANIZATION");
            if (db.prepare<[string, string], { grant_id: string }>("SELECT grant_id FROM catalog_grants WHERE grant_id=? AND release_id=? AND subject_type='ORGANIZATION' AND human_id IS NULL").get(organizationGrant, row.release_id)) return organizationGrant;
            return fail("REVISION_CONFLICT");
          })();
          const failureTransition = target.revision - (2 * target.attempts);
          const assignmentDelta = failureTransition === 1 ? 1 : failureTransition === 2 || failureTransition === 3 ? 2 : fail("REVISION_CONFLICT");
          const current = existing ?? fail("REVISION_CONFLICT");
          if (current.assignment_id !== participant.assignment_id || current.agent_id !== target.agent_id
            || current.release_id !== row.release_id || current.local_skill_name !== participant.local_skill_name
            || current.desired_state !== expectedTargetState || current.preload !== target.planned_preload
            || current.desired_generation !== latest.desired_generation || current.deployment_state !== "FAILED"
            || current.effective_state !== expectedPriorState || current.effective_preload !== expectedPriorPreload
            || current.active_generation !== expectedPriorGeneration || current.actor_kind !== row.actor_kind
            || current.actor_human_id !== row.actor_human_id || current.grant_id !== canonicalGrantId
            || current.revision !== participant.assignment_revision + assignmentDelta) fail("REVISION_CONFLICT");
        }
        const retried: string[] = []; const deploymentIds: string[] = []; const timestamp = now();
        for (const target of candidates) {
          const agent = agentFor(target.agent_id); const runnerId = agent.assigned_runner_id!; const prior = parsePriorAssignment(target.prior_assignment_json);
          const existing = currentAssignmentFor(agent.id, row.release_id);
          const generation = newId(); const deploymentId = newId(); if (!id.safeParse(generation).success || !id.safeParse(deploymentId).success) fail("STORAGE_FAILURE");
          const preload = target.planned_preload; const desired = row.operation === "DISABLE" ? "DISABLED" : "ENABLED"; const grantId = readGrantId(actor, row.release_id); if (actor.kind !== "HUMAN_ADMIN" && !grantId) fail("GRANT_REQUIRED");
          if (existing) {
            const changedAssignment = db.prepare("UPDATE agent_skill_assignments SET desired_state=?,deployment_state='REQUESTED',preload=?,desired_generation=?,revision=revision+1,actor_kind=?,actor_human_id=?,grant_id=?,updated_at=? WHERE assignment_id=? AND revision=? AND removal_requested=0").run(desired, preload, generation, actor.kind === "HUMAN_ADMIN" ? "ADMIN" : "GRANT", actor.id, grantId, timestamp, existing.assignment_id, existing.revision);
            if (changedAssignment.changes !== 1) fail("REVISION_CONFLICT");
          }
          else { const assignmentId = newId(); db.prepare("INSERT INTO agent_skill_assignments (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,grant_id,created_at,updated_at) VALUES (?,?,?,?,?,'DISABLED','REQUESTED',?,0,NULL,?,1,?,?,?,?,?)").run(assignmentId, agent.id, row.release_id, releaseName(parsedRelease.data!), desired, preload, generation, actor.kind === "HUMAN_ADMIN" ? "ADMIN" : "GRANT", actor.id, grantId, timestamp, timestamp); }
          db.prepare("INSERT INTO runner_package_deployments (deployment_id,rollout_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,revision,failure_code,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?, 'QUEUED',1,NULL,?,?,NULL)").run(deploymentId, row.rollout_id, agent.id, row.release_id, runnerId, generation, timestamp, timestamp);
          const changed = db.prepare("UPDATE catalog_rollout_targets SET state='QUEUED',attempts=attempts+1,reason_code=NULL,blocker_json=NULL,revision=revision+1,updated_at=?,completed_at=NULL WHERE rollout_id=? AND agent_id=? AND revision=?").run(timestamp, row.rollout_id, target.agent_id, target.revision); if (changed.changes !== 1) fail("REVISION_CONFLICT"); retried.push(target.agent_id); deploymentIds.push(deploymentId);
        }
        if (row.revision >= MAX_REVISION) fail("REVISION_CONFLICT");
        const changed = db.prepare("UPDATE catalog_rollouts SET state='QUEUED',revision=revision+1,updated_at=?,completed_at=NULL WHERE rollout_id=? AND revision=?").run(timestamp, row.rollout_id, row.revision); if (changed.changes !== 1) fail("REVISION_CONFLICT");
        writeAudit(db, parseCatalogAudit({ type: "audit.catalog.rollout.changed", source: "system", status: "DELIVERED", channelId: null, payload: { actorKind: actor.kind, actorId: actor.id, action: "retry-failed", outcome: "SUCCEEDED", revision: row.revision + 1, releaseId: row.release_id, operationId: row.rollout_id } }));
        return RetryFailedRolloutResultSchema.parse({ rollout: view(readRow(row.rollout_id)), targetIds: retried, deploymentIds });
      }).immediate();
    } catch (error) { throw fixed(error); }
  }
  return { plan, confirm, getRollout, cancel, retryFailed };
}
