import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { OrgOpsDb } from "@orgops/db";
import {
  AgentViewSchema,
  CatalogAuditEventSchema,
  PackageManifestSchema,
  PackageReleaseIdSchema,
  PackageReleaseViewSchema,
  type AgentView,
  type AssignmentCommand,
  type AssignmentMutationResult,
  type AuthenticatedHuman,
  type CatalogAuditEvent,
  type CatalogConsumption,
  type CatalogLibraryErrorCode,
  type CatalogPolicy,
  type GrantView,
  type PackageReleaseView,
} from "@orgops/schemas";
import { catalogGrantId, parseCanonicalCatalogGrant } from "./grant-identity";
import type { AgentSkillManagement } from "../unified-skills/management";

const INT32_MAX = 2_147_483_647;
const AssignmentCommandSchema: z.ZodType<AssignmentCommand> = z.object({
  kind: z.enum(["assignment.enable", "assignment.disable"]),
  agentId: z.string().min(1).max(200),
  releaseId: PackageReleaseIdSchema,
  expectedAgentRevision: z.number().finite().int().min(1).max(INT32_MAX),
  expectedAssignmentRevision: z.number().finite().int().min(0).max(INT32_MAX),
  preload: z.boolean(),
}).strict();
const ManageableAssignmentTargetDecisionSchema = z.object({
  allow: z.literal(false),
  reasonCode: z.literal("NOT_FOUND"),
}).strict();
const AssignmentMutationResultSchema: z.ZodType<AssignmentMutationResult> = z.object({
  assignmentId: z.string().min(1).max(200),
  desiredState: z.enum(["DISABLED", "ENABLED"]),
  effectiveState: z.enum(["DISABLED", "ENABLED"]),
  deploymentState: z.enum(["STABLE", "REQUESTED", "DEPLOYING", "FAILED"]),
  activeGeneration: z.string().min(1).max(200).nullable(),
  desiredGeneration: z.string().min(1).max(200),
  revision: z.number().finite().int().min(1).max(INT32_MAX),
}).strict();

export class CatalogConsumptionError extends Error {
  constructor(readonly code: CatalogLibraryErrorCode) { super(code); }
}
const fail = (code: CatalogLibraryErrorCode): never => { throw new CatalogConsumptionError(code); };

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
};
type AgentRow = {
  id: string; name: string; owner_human_id: string | null; assigned_runner_id: string | null;
  revision: number; enabled_skills_json: string; always_preloaded_skills_json: string;
};
type AssignmentRow = {
  assignment_id: string; agent_id: string; release_id: string; local_skill_name: string;
  desired_state: "DISABLED" | "ENABLED"; effective_state: "DISABLED" | "ENABLED";
  deployment_state: "STABLE" | "REQUESTED" | "DEPLOYING" | "FAILED";
  removal_requested: number;
  preload: number; effective_preload: number; active_generation: string | null; desired_generation: string;
  revision: number; actor_kind: "ADMIN" | "GRANT"; actor_human_id: string; grant_id: string | null;
};

const boundedAssignmentId = z.string().min(1).max(200);
const NormalizedAssignmentRowSchema = z.object({
  assignment_id: boundedAssignmentId,
  agent_id: boundedAssignmentId,
  release_id: PackageReleaseIdSchema,
  local_skill_name: boundedAssignmentId,
  desired_state: z.enum(["DISABLED", "ENABLED"]),
  effective_state: z.enum(["DISABLED", "ENABLED"]),
  deployment_state: z.enum(["STABLE", "REQUESTED", "DEPLOYING", "FAILED"]),
  removal_requested: z.union([z.literal(0), z.literal(1)]),
  preload: z.union([z.literal(0), z.literal(1)]),
  effective_preload: z.union([z.literal(0), z.literal(1)]),
  active_generation: boundedAssignmentId.nullable(),
  desired_generation: boundedAssignmentId,
  revision: z.number().finite().int().min(1).max(INT32_MAX),
  actor_kind: z.enum(["ADMIN", "GRANT"]),
  actor_human_id: boundedAssignmentId,
  grant_id: boundedAssignmentId.nullable(),
}).strict().superRefine((row, ctx) => {
  const invalidProvenance = (row.actor_kind === "ADMIN") !== (row.grant_id === null);
  const invalidEffective = (row.effective_state === "ENABLED" && row.active_generation === null)
    || (row.effective_state === "DISABLED" && row.effective_preload !== 0);
  const invalidStable = row.deployment_state === "STABLE" && (
    row.active_generation !== row.desired_generation
    || row.effective_state !== row.desired_state
    || row.effective_preload !== row.preload
  );
  if (invalidProvenance || invalidEffective || invalidStable) {
    ctx.addIssue({ code: "custom", message: "inconsistent normalized assignment" });
  }
});

function parseAssignmentRow(row: unknown): AssignmentRow {
  const parsed = NormalizedAssignmentRowSchema.safeParse({ ...(row as Record<string, unknown>), removal_requested: (row as Record<string, unknown>).removal_requested ?? 0 });
  return parsed.success ? parsed.data : fail("STATE_CONFLICT");
}

export type BoundDeploymentCommand = Readonly<{
  deploymentId: string; agentId: string; releaseId: string; runnerId: string; desiredGeneration: string; createdAt: number;
}>;
export type EnqueueBoundDeployment = (tx: OrgOpsDb, command: BoundDeploymentCommand) => void;
type AuditWriter = (tx: OrgOpsDb, event: CatalogAuditEvent) => void;

export type CatalogConsumptionDeps = Readonly<{
  db: OrgOpsDb;
  policy: CatalogPolicy;
  enqueueBoundDeployment: EnqueueBoundDeployment;
  writeAudit: AuditWriter;
  now?: () => number;
  newId?: () => string;
  management: Pick<AgentSkillManagement, "executeLegacyCatalog">;
}>;

const releaseSelect = `SELECT r.package_release_id,r.authority_source_id,r.content_source_id,r.kind,r.name,r.version,r.digest,
  r.catalog_commit,r.package_commit,r.package_path,r.manifest_json,r.execution_preview_json,r.warnings_json,
  c.review_state,c.review_digest,c.reviewed_by_human_id,c.reviewed_at,c.revision AS control_revision,
  i.state AS installation_state,i.artifact_digest AS installation_digest,
  a.approval_state AS activation_approval_state,a.runtime_state AS activation_runtime_state,
  a.revision AS activation_revision,a.failure_code AS activation_failure_code
  FROM catalog_package_releases r
  JOIN catalog_release_controls c ON c.package_release_id=r.package_release_id
  LEFT JOIN catalog_installations i ON i.release_id=r.package_release_id
  LEFT JOIN catalog_api_activations a ON a.release_id=r.package_release_id
  WHERE r.package_release_id=?`;

function parseRelease(row: ReleaseRow): { view: PackageReleaseView; localSkillName: string } {
  try {
    const manifest = PackageManifestSchema.parse(JSON.parse(row.manifest_json));
    if (row.kind !== "skill" || manifest.kind !== "skill" || manifest.name !== row.name
      || manifest.version !== row.version || manifest.digest !== row.digest) fail("STATE_CONFLICT");
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
      } : { approvalState: row.activation_approval_state, runtimeState: row.activation_runtime_state,
        revision: row.activation_revision, failureCode: row.activation_failure_code },
      revision: row.control_revision,
    });
    return { view, localSkillName: manifest.name };
  } catch (error) {
    if (error instanceof CatalogConsumptionError) throw error;
    return fail("STATE_CONFLICT");
  }
}

function parseLegacySkills(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some(name => typeof name !== "string" || name.length < 1 || name.length > 200)
      || new Set(parsed).size !== parsed.length) fail("STATE_CONFLICT");
    return parsed as string[];
  } catch (error) {
    if (error instanceof CatalogConsumptionError) throw error;
    return fail("STATE_CONFLICT");
  }
}

function fixedFailure(error: unknown): CatalogConsumptionError {
  return error instanceof CatalogConsumptionError ? error : new CatalogConsumptionError("STORAGE_FAILURE");
}

export function createCatalogConsumption({ db, management, policy }: CatalogConsumptionDeps): CatalogConsumption {

  function requireLiveActor(actor: AuthenticatedHuman): void {
    if (!actor || (actor.kind !== "HUMAN_ADMIN" && actor.kind !== "AUTHENTICATED_HUMAN")) fail("FORBIDDEN");
    const row = db.prepare<[string], { is_admin: number; must_change_password: number }>(
      "SELECT is_admin,must_change_password FROM humans WHERE id=?",
    ).get(actor.id);
    if (!row || row.must_change_password !== 0 || (actor.kind === "HUMAN_ADMIN") !== (row.is_admin === 1)) fail("FORBIDDEN");
  }

  function requireManageableAssignmentTarget(actor: AuthenticatedHuman, row: AgentRow): AgentView {
    const parsed = AgentViewSchema.safeParse({
      id: row.id, name: row.name, ownerHumanId: row.owner_human_id,
      assignedRunnerId: row.assigned_runner_id, revision: row.revision,
    });
    const agent = parsed.success ? parsed.data : fail("FORBIDDEN");
    let decision: unknown;
    try {
      decision = policy.decide({ action: "SKILL_ASSIGN", actor, agent });
    } catch {
      fail("FORBIDDEN");
    }
    // A no-release SKILL_ASSIGN can never authorize: only the exact NOT_FOUND denial proves central manageability passed.
    if (!ManageableAssignmentTargetDecisionSchema.safeParse(decision).success) fail("FORBIDDEN");
    return agent;
  }

  function currentGrant(actor: AuthenticatedHuman, releaseId: string): GrantView | undefined {
    if (actor.kind === "HUMAN_ADMIN") return undefined;
    const humanGrantId = catalogGrantId(releaseId, "HUMAN", actor.id);
    const organizationGrantId = catalogGrantId(releaseId, "ORGANIZATION");
    const rows = db.prepare<[string, string, string, string, string], {
      grant_id: string; release_id: string; subject_type: "ORGANIZATION" | "HUMAN";
      human_id: string | null; revision: number; revoked_at: number | null;
    }>(`SELECT grant_id,release_id,subject_type,human_id,revision,revoked_at FROM catalog_grants WHERE revoked_at IS NULL AND
      ((grant_id=? AND release_id=? AND subject_type='HUMAN' AND human_id=?) OR
       (grant_id=? AND release_id=? AND subject_type='ORGANIZATION' AND human_id IS NULL))
      ORDER BY CASE subject_type WHEN 'HUMAN' THEN 0 ELSE 1 END LIMIT 2`)
      .all(humanGrantId, releaseId, actor.id, organizationGrantId, releaseId);
    for (const row of rows) {
      const grant = parseCanonicalCatalogGrant({
        grantId: row.grant_id, releaseId: row.release_id,
        subject: row.subject_type === "HUMAN" ? { kind: "HUMAN", humanId: row.human_id } : { kind: "ORGANIZATION" },
        revision: row.revision, revokedAt: row.revoked_at,
      });
      if (grant) return grant;
    }
    return undefined;
  }

  async function assignSkill(rawCommand: AssignmentCommand, actor: AuthenticatedHuman): Promise<AssignmentMutationResult> {
    try {
      const parsed = AssignmentCommandSchema.safeParse(rawCommand);
      if (!parsed.success) throw new CatalogConsumptionError("INVALID_REQUEST");
      const command = parsed.data;
      const result = await management.executeLegacyCatalog({
        kind: "CATALOG",
        operation: command.kind === "assignment.enable" ? "ENABLE" : "DISABLE",
        agentId: command.agentId,
        packageReleaseId: command.releaseId,
        preload: command.preload,
        expectedAgentRevision: command.expectedAgentRevision,
        expectedAssignmentRevision: command.expectedAssignmentRevision,
      }, actor);
      const ref = result.ref as { assignmentId?: string; desiredGeneration?: string; activeGeneration?: string | null };
      return AssignmentMutationResultSchema.parse({
        assignmentId: ref.assignmentId ?? command.releaseId,
        desiredState: result.desired === "ABSENT" ? "DISABLED" : result.desired,
        effectiveState: result.effective,
        deploymentState: result.deployment,
        activeGeneration: ref.activeGeneration ?? null,
        desiredGeneration: ref.desiredGeneration ?? "pending",
        revision: result.revision,
      });
    } catch (error) {
      throw error instanceof CatalogConsumptionError ? error : new CatalogConsumptionError(
        error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: CatalogLibraryErrorCode }).code : "STORAGE_FAILURE",
      );
    }
  }

  return { assignSkill };
}

export type EffectiveSkillProjection = Readonly<{ enabledSkills: readonly string[]; alwaysPreloadedSkills: readonly string[] }>;

export function projectEffectiveAgentSkills(db: OrgOpsDb, agent: {
  id: string; enabled_skills_json: string; always_preloaded_skills_json: string;
}): EffectiveSkillProjection {
  const enabled = parseLegacySkills(agent.enabled_skills_json);
  const preloaded = parseLegacySkills(agent.always_preloaded_skills_json);
  if (preloaded.some(name => !enabled.includes(name))) fail("STATE_CONFLICT");
  const seen = new Set(enabled);
  const preloadSet = new Set(preloaded);
  const rows = db.prepare<[string], AssignmentRow>(`SELECT assignment_id,agent_id,release_id,local_skill_name,
    desired_state,effective_state,deployment_state,removal_requested,preload,effective_preload,active_generation,desired_generation,revision,
    actor_kind,actor_human_id,grant_id FROM agent_skill_assignments
    WHERE agent_id=? ORDER BY local_skill_name,assignment_id`).all(agent.id);
  const normalizedNames = new Set<string>();
  for (const rawRow of rows) {
    const row = parseAssignmentRow(rawRow);
    if (row.agent_id !== agent.id || normalizedNames.has(row.local_skill_name)) fail("STATE_CONFLICT");
    normalizedNames.add(row.local_skill_name);
    if (row.removal_requested === 1 || row.effective_state !== "ENABLED") continue;
    if (seen.has(row.local_skill_name)) fail("STATE_CONFLICT");
    seen.add(row.local_skill_name);
    enabled.push(row.local_skill_name);
    if (row.effective_preload === 1) preloadSet.add(row.local_skill_name);
  }
  return { enabledSkills: [...enabled].sort(), alwaysPreloadedSkills: [...preloadSet].sort() };
}
