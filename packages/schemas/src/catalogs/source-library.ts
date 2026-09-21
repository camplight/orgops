import { z } from "zod";
import { CompatibilitySchema, PackageManifestSchema, SecretRequirementSchema, type PackageManifest } from "./manifest";
import {
  CATALOG_LIMITS,
  DigestSchema,
  PackageKindSchema,
  PackageNameSchema,
  PositiveIntegerSchema,
  RelativePathSchema,
  SourceIdSchema,
  VersionSchema,
  type ReviewWarning,
} from "./primitives";

const boundedId = z.string().min(1).max(200);
export const PackageReleaseIdSchema = boundedId.regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const timestamp = z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER);
const nullableTimestamp = timestamp.nullable();
const boundedText = (max: number) => z.string().min(1).max(max);

export const HumanAdminSchema = z.object({ kind: z.literal("HUMAN_ADMIN"), id: boundedId }).strict();
export const DelegatedHumanSchema = z.object({ kind: z.literal("AUTHENTICATED_HUMAN"), id: boundedId }).strict();
export const ConsumptionActorSchema = z.discriminatedUnion("kind", [HumanAdminSchema, DelegatedHumanSchema]);
export const RunnerPrincipalSchema = z.object({ kind: z.literal("RUNNER"), runnerId: boundedId }).strict();
export const AgentPrincipalSchema = z.object({ kind: z.literal("AGENT"), agentName: boundedId }).strict();
export const AuthenticatedPrincipalSchema = z.discriminatedUnion("kind", [HumanAdminSchema, DelegatedHumanSchema, RunnerPrincipalSchema, AgentPrincipalSchema]);

export type HumanAdmin = z.infer<typeof HumanAdminSchema>;
export type DelegatedHuman = z.infer<typeof DelegatedHumanSchema>;
export type ConsumptionActor = z.infer<typeof ConsumptionActorSchema>;
export type AuthenticatedHuman = ConsumptionActor;
export type RunnerPrincipal = z.infer<typeof RunnerPrincipalSchema>;
export type AgentPrincipal = z.infer<typeof AgentPrincipalSchema>;
export type AuthenticatedPrincipal = z.infer<typeof AuthenticatedPrincipalSchema>;

export const SourceCreateSchema = z.object({
  sourceId: SourceIdSchema,
  displayName: boundedText(200),
  repository: z.object({ url: z.string().url().max(2048) }).strict(),
  ref: boundedText(1024),
  enabled: z.boolean(),
  allowPackages: z.boolean(),
}).strict();
export const SourcePatchSchema = z.object({
  expectedRevision: PositiveIntegerSchema,
  displayName: boundedText(200).optional(),
  enabled: z.boolean().optional(),
  allowPackages: z.boolean().optional(),
}).strict().refine(value => value.displayName !== undefined || value.enabled !== undefined || value.allowPackages !== undefined);
export const SourceViewSchema = z.object({
  sourceId: SourceIdSchema,
  displayName: boundedText(200),
  canonicalUrl: z.string().url().max(2048),
  repositoryIdentity: boundedText(4096),
  ref: boundedText(1024),
  enabled: z.boolean(),
  allowPackages: z.boolean(),
  revision: PositiveIntegerSchema,
  removedAt: nullableTimestamp,
  currentSnapshotId: boundedId.nullable(),
  hasReadCredential: z.boolean(),
}).strict();
export type SourceCreate = z.infer<typeof SourceCreateSchema>;
export type SourcePatch = z.infer<typeof SourcePatchSchema>;
export type SourceView = z.infer<typeof SourceViewSchema>;

export const SyncFailureCodeSchema = z.enum(["SOURCE_UNAVAILABLE", "SOURCE_NOT_ALLOWED", "IDENTITY_CONFLICT", "INSPECTION_FAILED", "STORAGE_FAILURE", "SYNC_FAILED"]);
export const InstallFailureCodeSchema = z.enum(["RELEASE_NOT_APPROVED", "SOURCE_NOT_ALLOWED", "SOURCE_UNAVAILABLE", "IDENTITY_CONFLICT", "INSPECTION_FAILED", "STORAGE_FAILURE"]);
export const ApiActivationFailureCodeSchema = z.enum(["INSTALLATION_REQUIRED", "API_ACTIVATION_REQUIRED", "INSPECTION_FAILED", "STORAGE_FAILURE"]);
export const DeploymentFailureCodeSchema = z.enum(["DEPLOYMENT_SUPERSEDED", "INSPECTION_FAILED", "STORAGE_FAILURE"]);
export type SyncFailureCode = z.infer<typeof SyncFailureCodeSchema>;
export type InstallFailureCode = z.infer<typeof InstallFailureCodeSchema>;
export type ApiActivationFailureCode = z.infer<typeof ApiActivationFailureCodeSchema>;
export type DeploymentFailureCode = z.infer<typeof DeploymentFailureCodeSchema>;

export const SyncAttemptViewSchema = z.object({
  attemptId: boundedId,
  sourceId: SourceIdSchema,
  state: z.enum(["RUNNING", "SUCCEEDED", "FAILED", "ABANDONED"]),
  snapshotId: boundedId.nullable(),
  failureCode: SyncFailureCodeSchema.nullable(),
  revision: PositiveIntegerSchema,
}).strict();
export type SyncAttemptView = z.infer<typeof SyncAttemptViewSchema>;
export type ReviewAction = "APPROVE" | "REJECT" | "WITHDRAW" | "REOPEN";

export const CatalogLibraryErrorCodeSchema = z.enum([
  "INVALID_REQUEST", "PAYLOAD_TOO_LARGE", "FORBIDDEN", "NOT_FOUND", "REMOVED", "REVISION_CONFLICT",
  "STATE_CONFLICT", "IDENTITY_CONFLICT", "SOURCE_NOT_ALLOWED", "SOURCE_UNAVAILABLE", "RELEASE_NOT_APPROVED",
  "GRANT_REQUIRED", "INSTALLATION_REQUIRED", "API_ACTIVATION_REQUIRED", "REQUIREMENTS_UNSATISFIED",
  "OPERATION_IN_PROGRESS", "DEPLOYMENT_SUPERSEDED", "INSPECTION_FAILED", "STORAGE_FAILURE", "SYNC_FAILED",
  "CATALOG_RESOURCE_RETIRED",
]);
export type CatalogLibraryErrorCode = z.infer<typeof CatalogLibraryErrorCodeSchema>;

export const LibraryPackageSchema = z.object({
  packageReleaseId: PackageReleaseIdSchema, kind: z.enum(["skill", "native-agent", "wrapped-agent"]),
  name: PackageNameSchema, version: VersionSchema, digest: DigestSchema,
}).strict();
export type LibraryPackage = z.infer<typeof LibraryPackageSchema>;
// Human-only projections deliberately omit source, host, credential, review, and human-principal data.
export const LibraryDependencySummarySchema = z.object({ name: PackageNameSchema, version: VersionSchema, digest: DigestSchema }).strict();
export const LibraryPackageDetailSchema = z.object({
  package: LibraryPackageSchema, description: boundedText(4096), author: boundedText(256), license: boundedText(256),
  compatibility: CompatibilitySchema,
  dependencies: z.array(LibraryDependencySummarySchema).max(CATALOG_LIMITS.dependencies).readonly(),
  secretRequirements: z.array(SecretRequirementSchema).max(64).readonly(),
}).strict();
export type LibraryDependencySummary = z.infer<typeof LibraryDependencySummarySchema>;
export type LibraryPackageDetail = z.infer<typeof LibraryPackageDetailSchema>;
export const ManageableAgentSchema = z.object({
  id: boundedId, name: boundedId, assignedRunnerId: boundedId.nullable(), agentRevision: PositiveIntegerSchema,
  assignmentRevision: z.number().int().min(0).max(2147483647), desiredState: z.enum(["RUNNING", "STOPPED"]),
  effectiveState: z.enum(["ENABLED", "DISABLED"]), deploymentState: z.enum(["STABLE", "REQUESTED", "DEPLOYING", "FAILED"]), preload: z.boolean(),
}).strict();
export type ManageableAgent = z.infer<typeof ManageableAgentSchema>;
export const SafeRunnerOptionSchema = z.object({ id: boundedId }).strict();
export const SafeModelOptionSchema = z.object({ id: boundedId }).strict();
export const SafeSecretReferenceSchema = z.object({ id: boundedId, name: boundedText(256) }).strict();
export const TemplateOptionsSchema = z.object({
  runners: z.array(SafeRunnerOptionSchema).max(256).readonly(), models: z.array(SafeModelOptionSchema).max(256).readonly(),
  secretReferences: z.array(SafeSecretReferenceSchema).max(256).readonly(),
}).strict();
export type TemplateOptions = z.infer<typeof TemplateOptionsSchema>;
export const UserTemplateInstantiationResultSchema = z.object({
  agent: z.object({ id: boundedId, name: boundedId, visibility: z.enum(["PUBLIC", "PRIVATE"]), assignedRunnerId: boundedId,
    modelId: boundedId, mode: z.enum(["CLASSIC", "RLM_REPL", "WRAPPED"]), desiredState: z.literal("STOPPED"), runtimeState: z.literal("STOPPED"), channelIds: z.tuple([]) }).strict(),
  origin: z.object({ packageReleaseId: PackageReleaseIdSchema, mode: z.enum(["CLASSIC", "RLM_REPL", "WRAPPED"]), actorKind: z.enum(["ADMIN", "GRANT"]), createdAt: timestamp }).strict(),
  requirements: z.array(z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), state: z.enum(["SATISFIED", "MISSING"]) }).strict()).max(64).readonly(),
}).strict();
export type UserTemplateInstantiationResult = z.infer<typeof UserTemplateInstantiationResultSchema>;

export const SnapshotViewSchema = z.object({
  snapshotId: boundedId,
  sourceId: SourceIdSchema,
  sourceCommit: boundedText(64),
  indexDigest: DigestSchema,
  observedRef: boundedText(1024),
  createdAt: timestamp,
}).strict();
export type SnapshotView = z.infer<typeof SnapshotViewSchema>;

export const ReleaseExecutionPreviewSchema = z.object({
  apiEventShapes: z.array(RelativePathSchema).max(CATALOG_LIMITS.contentEntries).readonly(),
  runnerScripts: z.array(RelativePathSchema).max(CATALOG_LIMITS.contentEntries).readonly(),
  wrappedCommands: z.array(z.object({
    at: RelativePathSchema,
    command: boundedText(16384),
    args: z.array(z.string().max(4096)).max(128).readonly(),
  }).strict()).max(64).readonly(),
  externalSources: z.array(z.object({
    type: z.literal("github"),
    repo: boundedText(256),
    ref: boundedText(1024).optional(),
  }).strict()).max(64).readonly(),
}).strict();
export const ReleaseFileViewSchema = z.object({
  path: RelativePathSchema,
  mode: z.union([z.literal(0o644), z.literal(0o755)]),
  size: z.number().finite().int().min(0).max(CATALOG_LIMITS.fileBytes),
  digest: DigestSchema,
}).strict();
export const ApiActivationStateViewSchema = z.object({
  approvalState: z.enum(["NOT_REQUIRED", "AWAITING_APPROVAL", "APPROVED", "REVOKED"]),
  runtimeState: z.enum(["INACTIVE", "ACTIVATING", "ACTIVE", "DEACTIVATING", "FAILED"]),
  revision: PositiveIntegerSchema,
  failureCode: ApiActivationFailureCodeSchema.nullable(),
}).strict();
const ReviewWarningSchema = z.object({
  code: z.enum(["SENSITIVE_TEXT", "MANUAL_REVIEW_REQUIRED", "EXTERNAL_RUNTIME_NOT_PINNED"]),
  at: boundedText(1024),
}).strict();
export const PackageReleaseViewSchema = z.object({
  packageReleaseId: PackageReleaseIdSchema,
  authoritySourceId: SourceIdSchema,
  contentSourceId: SourceIdSchema,
  kind: PackageKindSchema,
  name: PackageNameSchema,
  version: VersionSchema,
  digest: DigestSchema,
  catalogCommit: boundedText(64),
  packageCommit: boundedText(64),
  packagePath: RelativePathSchema,
  manifest: PackageManifestSchema,
  executionPreview: ReleaseExecutionPreviewSchema,
  warnings: z.array(ReviewWarningSchema).max(256).readonly(),
  files: z.array(ReleaseFileViewSchema).max(CATALOG_LIMITS.contentEntries).readonly(),
  reviewState: z.enum(["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]),
  reviewDigest: DigestSchema.nullable(),
  reviewer: z.object({ humanId: boundedId, reviewedAt: timestamp }).strict().nullable(),
  installationState: z.enum(["ABSENT", "INSTALLED", "QUARANTINED"]),
  apiActivation: ApiActivationStateViewSchema,
  revision: PositiveIntegerSchema,
}).strict();
export type ReleaseExecutionPreview = z.infer<typeof ReleaseExecutionPreviewSchema>;
export type ReleaseFileView = z.infer<typeof ReleaseFileViewSchema>;
export type ApiActivationStateView = z.infer<typeof ApiActivationStateViewSchema>;
export type PackageReleaseView = z.infer<typeof PackageReleaseViewSchema>;

export const GrantSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ORGANIZATION") }).strict(),
  z.object({ kind: z.literal("HUMAN"), humanId: boundedId }).strict(),
]);
export const GrantViewSchema = z.object({
  grantId: boundedId,
  releaseId: boundedId,
  subject: GrantSubjectSchema,
  revision: PositiveIntegerSchema,
  revokedAt: nullableTimestamp,
}).strict();
export const AgentViewSchema = z.object({
  id: boundedId,
  name: boundedId,
  ownerHumanId: boundedId.nullable(),
  assignedRunnerId: boundedId.nullable(),
  revision: PositiveIntegerSchema,
}).strict();
export const RunnerViewSchema = z.object({ id: boundedId }).strict();
export type GrantSubject = z.infer<typeof GrantSubjectSchema>;
export type GrantView = z.infer<typeof GrantViewSchema>;
export type AgentView = z.infer<typeof AgentViewSchema>;
export type RunnerView = z.infer<typeof RunnerViewSchema>;

export const SkillDeploymentOperationSchema = z.enum(["ADD", "REMOVE", "ENABLE", "DISABLE", "SET_PRELOAD", "ASSIGN"]);
export const SkillDeploymentStateSchema = z.enum(["REQUESTED", "DEPLOYING", "STABLE", "FAILED", "SUPERSEDED"]);
export const SkillDeploymentFailureCodeSchema = z.enum(["DEPLOYMENT_SUPERSEDED", "INSPECTION_FAILED", "STORAGE_FAILURE"]);
export const CatalogAssignmentAuditEventSchema = z.object({
  type: z.literal("audit.catalog.assignment.changed"), source: z.literal("system"), status: z.literal("DELIVERED"), channelId: z.null(),
  payload: z.object({
    actorKind: z.enum(["HUMAN_ADMIN", "AUTHENTICATED_HUMAN"]), actorId: boundedId, agentId: boundedId, releaseId: boundedId,
    operation: SkillDeploymentOperationSchema, outcome: z.literal("SUCCEEDED"), revision: PositiveIntegerSchema,
    deploymentId: boundedId, desiredGeneration: boundedId, effectiveGeneration: boundedId.nullable(),
    state: SkillDeploymentStateSchema, failureCode: SkillDeploymentFailureCodeSchema.nullable(),
  }).strict().superRefine((payload, ctx) => {
    if (payload.state === "FAILED" && !["INSPECTION_FAILED", "STORAGE_FAILURE"].includes(payload.failureCode ?? "")) ctx.addIssue({ code: "custom", message: "failure code/state mismatch" });
    else if (payload.state === "SUPERSEDED" && payload.failureCode !== "DEPLOYMENT_SUPERSEDED") ctx.addIssue({ code: "custom", message: "failure code/state mismatch" });
    else if (payload.state !== "FAILED" && payload.state !== "SUPERSEDED" && payload.failureCode !== null) ctx.addIssue({ code: "custom", message: "failure code/state mismatch" });
  }),
}).strict();
const GenericCatalogAuditEventSchema = z.object({
  type: z.enum([
    "audit.catalog.source.changed", "audit.catalog.sync.completed", "audit.catalog.sync.failed",
    "audit.catalog.release.reviewed", "audit.catalog.grant.changed", "audit.catalog.installation.changed",
    "audit.catalog.api_activation.changed", "audit.catalog.template.instantiated", "audit.catalog.assignment.changed",
    "audit.catalog.secret_binding.changed", "audit.catalog.rollout.changed", "audit.catalog.deployment.reported",
  ]),
  source: z.literal("system"), status: z.literal("DELIVERED"), channelId: z.null(),
  payload: z.object({
    actorKind: z.enum(["HUMAN_ADMIN", "AUTHENTICATED_HUMAN", "RUNNER"]), actorId: boundedId,
    action: boundedText(200), outcome: z.enum(["SUCCEEDED", "FAILED"]), revision: PositiveIntegerSchema,
    sourceId: SourceIdSchema.optional(), releaseId: boundedId.optional(), operationId: boundedId.optional(), agentId: boundedId.optional(),
    runnerId: boundedId.optional(), digest: DigestSchema.optional(), failureCode: CatalogLibraryErrorCodeSchema.optional(),
  }).strict(),
}).strict();
export const CatalogAuditEventSchema = z.union([CatalogAssignmentAuditEventSchema, GenericCatalogAuditEventSchema]);
export type CatalogAssignmentAuditEvent = z.infer<typeof CatalogAssignmentAuditEventSchema>;
// General catalog writers retain the long-lived generic audit type; assignment commands use the dedicated exact schema.
export type CatalogAuditEvent = z.infer<typeof GenericCatalogAuditEventSchema>;
export const SecretBindingMutationRequestSchema = z.object({
  expectedAgentRevision: PositiveIntegerSchema,
  secretId: boundedId,
}).strict();
export const SecretBindingMutationResultSchema = z.object({
  agentId: boundedId, requirementName: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  revision: PositiveIntegerSchema, state: z.literal("SATISFIED"),
}).strict();
export type SecretBindingMutationRequest = z.infer<typeof SecretBindingMutationRequestSchema>;
export type SecretBindingMutationResult = z.infer<typeof SecretBindingMutationResultSchema>;

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

export const AssignmentMutationResultSchema = z.object({
  assignmentId: boundedId, desiredState: z.enum(["DISABLED", "ENABLED"]), effectiveState: z.enum(["DISABLED", "ENABLED"]),
  deploymentState: z.enum(["STABLE", "REQUESTED", "DEPLOYING", "FAILED"]), activeGeneration: boundedId.nullable(),
  desiredGeneration: boundedId, revision: PositiveIntegerSchema,
}).strict();
export type AssignmentMutationResult = z.infer<typeof AssignmentMutationResultSchema>;
export type AssignmentCommand = { kind: "assignment.enable" | "assignment.disable"; agentId: string; releaseId: string; expectedAgentRevision: number; expectedAssignmentRevision: number; preload: boolean };
export type CatalogConsumption = { assignSkill(command: AssignmentCommand, actor: ConsumptionActor): Promise<AssignmentMutationResult> };

export type InstallExactCommand = { packageReleaseId: string; dependencyReleaseIds: readonly string[] };
export type InstallResult = { ok: true; packages: readonly { packageReleaseId: string; action: "installed" | "reused" }[]; activated: false } | { ok: false; code: CatalogLibraryErrorCode };
export type Availability = { installed: boolean; state: "ABSENT" | "INSTALLED" | "QUARANTINED" };
export type PackageInstallation = { installExact(command: InstallExactCommand, actor: HumanAdmin): Promise<InstallResult>; inspectAvailability(packageReleaseId: string): Availability };

export type PolicyDecision = { allow: true } | { allow: false; reasonCode: CatalogLibraryErrorCode };
export type PolicyDecisionInput = { action: PolicyAction; actor: AuthenticatedPrincipal; release?: PackageReleaseView; grant?: GrantView; agent?: AgentView; runner?: RunnerView };
export type PolicyAction = "SOURCE_MANAGE" | "RELEASE_REVIEW" | "RELEASE_INSTALL" | "GRANT_MANAGE" | "API_EXECUTION_APPROVE" | "LIBRARY_VIEW" | "TEMPLATE_INSTANTIATE" | "SKILL_ASSIGN" | "ROLLOUT_CREATE" | "RUNNER_DEPLOY";
export type CatalogPolicy = { decide(input: PolicyDecisionInput): PolicyDecision };

export const RequirementReasonCodeSchema = z.enum([
  "INSTALLATION_REQUIRED", "DEPLOYMENT_REQUIRED", "API_ACTIVATION_REQUIRED", "SECRET_BINDING_MISSING",
  "RUNNER_BINDING_MISSING", "MODEL_BINDING_MISSING", "WORKSPACE_BINDING_MISSING", "WRAPPED_WIRING_MISSING", "QUARANTINED",
]);
export const RequirementReasonSchema = z.object({
  code: RequirementReasonCodeSchema,
  packageReleaseId: PackageReleaseIdSchema.optional(),
  requirementName: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).optional(),
}).strict().superRefine((reason, context) => {
  const packageRequired = reason.code === "INSTALLATION_REQUIRED" || reason.code === "API_ACTIVATION_REQUIRED"
    || reason.code === "SECRET_BINDING_MISSING" || reason.code === "QUARANTINED";
  const requirementRequired = reason.code === "SECRET_BINDING_MISSING";
  if (packageRequired !== (reason.packageReleaseId !== undefined)) context.addIssue({ code: "custom", message: "package release field mismatch" });
  if (requirementRequired !== (reason.requirementName !== undefined)) context.addIssue({ code: "custom", message: "requirement field mismatch" });
});
export type RequirementReasonCode = z.infer<typeof RequirementReasonCodeSchema>;
export type RequirementReason = z.infer<typeof RequirementReasonSchema>;

export const ActivationOperationSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("ENABLE") }).strict(),
  z.object({ operation: z.literal("DISABLE") }).strict(),
  z.object({ operation: z.literal("SET_PRELOAD"), preload: z.boolean() }).strict(),
]);
export type ActivationOperation = z.infer<typeof ActivationOperationSchema>;
const CanonicalCatalogIdSchema = boundedId.regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/);
const AgentIdsSchema = z.array(CanonicalCatalogIdSchema).min(1).max(256).refine(ids => new Set(ids).size === ids.length);
const ActivationPlanFields = { releaseId: PackageReleaseIdSchema, agentIds: AgentIdsSchema };
export const ActivationPlanCommandSchema = z.discriminatedUnion("operation", [
  z.object({ ...ActivationPlanFields, operation: z.literal("ENABLE") }).strict(),
  z.object({ ...ActivationPlanFields, operation: z.literal("DISABLE") }).strict(),
  z.object({ ...ActivationPlanFields, operation: z.literal("SET_PRELOAD"), preload: z.boolean() }).strict(),
]);
export type ActivationPlanCommand = z.infer<typeof ActivationPlanCommandSchema>;
export const ActivationTargetPlanSchema = z.object({ agentId: CanonicalCatalogIdSchema, assignmentRevision: z.number().int().min(0).max(2147483647), runnerId: boundedId.nullable(), plannedPreload: z.boolean(), blocker: RequirementReasonSchema.nullable() }).strict();
export type ActivationTargetPlan = z.infer<typeof ActivationTargetPlanSchema>;
const ActivationPlanFieldsView = { planDigest: DigestSchema, releaseId: PackageReleaseIdSchema, targets: z.array(ActivationTargetPlanSchema).min(1).max(256).readonly() };
export const ActivationPlanSchema = z.discriminatedUnion("operation", [
  z.object({ ...ActivationPlanFieldsView, operation: z.literal("ENABLE") }).strict(),
  z.object({ ...ActivationPlanFieldsView, operation: z.literal("DISABLE") }).strict(),
  z.object({ ...ActivationPlanFieldsView, operation: z.literal("SET_PRELOAD"), preload: z.boolean() }).strict(),
]).superRefine((value, context) => {
  const ids = value.targets.map(target => target.agentId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "duplicate activation targets" });
});
export type ActivationPlan = z.infer<typeof ActivationPlanSchema>;
export const ConfirmActivationCommandSchema = z.object({ planDigest: DigestSchema, agentIds: AgentIdsSchema }).strict();
export type ConfirmActivationCommand = z.infer<typeof ConfirmActivationCommandSchema>;
export const CancelRolloutCommandSchema = z.object({ rolloutId: CanonicalCatalogIdSchema, expectedRevision: PositiveIntegerSchema }).strict();
export type CancelRolloutCommand = z.infer<typeof CancelRolloutCommandSchema>;
export const RetryFailedRolloutCommandSchema = CancelRolloutCommandSchema;
export type RetryFailedRolloutCommand = z.infer<typeof RetryFailedRolloutCommandSchema>;
export type RolloutTargetState = "QUEUED" | "BLOCKED" | "STAGING" | "VERIFYING" | "WAITING_FOR_IDLE" | "ACTIVATING" | "SUCCEEDED" | "FAILED" | "SKIPPED" | "SUPERSEDED";
export const RolloutTargetStateSchema = z.enum(["QUEUED", "BLOCKED", "STAGING", "VERIFYING", "WAITING_FOR_IDLE", "ACTIVATING", "SUCCEEDED", "FAILED", "SKIPPED", "SUPERSEDED"]);
export type RolloutReasonCode = "FORBIDDEN" | "REVISION_CONFLICT" | "STATE_CONFLICT" | "GRANT_REQUIRED" | "INSTALLATION_REQUIRED" | "DEPLOYMENT_REQUIRED" | "API_ACTIVATION_REQUIRED" | "SECRET_BINDING_MISSING" | "RUNNER_BINDING_MISSING" | "MODEL_BINDING_MISSING" | "WORKSPACE_BINDING_MISSING" | "WRAPPED_WIRING_MISSING" | "QUARANTINED" | "REQUIREMENTS_UNSATISFIED" | "DEPLOYMENT_SUPERSEDED" | "INSPECTION_FAILED" | "STORAGE_FAILURE";
export const RolloutReasonCodeSchema = z.enum(["FORBIDDEN", "REVISION_CONFLICT", "STATE_CONFLICT", "GRANT_REQUIRED", "INSTALLATION_REQUIRED", "DEPLOYMENT_REQUIRED", "API_ACTIVATION_REQUIRED", "SECRET_BINDING_MISSING", "RUNNER_BINDING_MISSING", "MODEL_BINDING_MISSING", "WORKSPACE_BINDING_MISSING", "WRAPPED_WIRING_MISSING", "QUARANTINED", "REQUIREMENTS_UNSATISFIED", "DEPLOYMENT_SUPERSEDED", "INSPECTION_FAILED", "STORAGE_FAILURE"]);
export const RolloutTargetViewSchema = z.object({ agentId: boundedId, state: RolloutTargetStateSchema, attempts: z.number().int().min(0).max(2147483647), reasonCode: RolloutReasonCodeSchema.nullable() }).strict();
export type RolloutTargetView = z.infer<typeof RolloutTargetViewSchema>;
const RolloutViewFields = { id: boundedId, releaseId: PackageReleaseIdSchema, state: z.enum(["DRAFT", "QUEUED", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"]), revision: PositiveIntegerSchema, targetIds: AgentIdsSchema.readonly(), targets: z.array(RolloutTargetViewSchema).max(256).readonly() };
export const RolloutViewSchema = z.discriminatedUnion("operation", [
  z.object({ ...RolloutViewFields, operation: z.literal("ENABLE") }).strict(),
  z.object({ ...RolloutViewFields, operation: z.literal("DISABLE") }).strict(),
  z.object({ ...RolloutViewFields, operation: z.literal("SET_PRELOAD"), preload: z.boolean() }).strict(),
]).superRefine((value, context) => {
  const targetIds = value.targets.map(target => target.agentId);
  if (value.targetIds.length !== targetIds.length || value.targetIds.some((id, index) => id !== targetIds[index])) {
    context.addIssue({ code: "custom", message: "rollout target correspondence" });
  }
});
export type RolloutView = z.infer<typeof RolloutViewSchema>;
export const CancelRolloutResultSchema = z.object({ rollout: RolloutViewSchema, skippedTargetIds: z.array(boundedId).max(256).readonly() }).strict().superRefine((value, context) => {
  const targetIds = value.rollout.targets.map(target => target.agentId);
  const skipped = value.skippedTargetIds;
  if (new Set(skipped).size !== skipped.length || skipped.some(id => !targetIds.includes(id)
    || value.rollout.targets.find(target => target.agentId === id)?.state !== "SKIPPED")) {
    context.addIssue({ code: "custom", message: "cancelled target correspondence" });
  }
});
export type CancelRolloutResult = z.infer<typeof CancelRolloutResultSchema>;
export const RetryFailedRolloutResultSchema = z.object({ rollout: RolloutViewSchema, targetIds: z.array(boundedId).min(1).max(256).readonly(), deploymentIds: z.array(boundedId).min(1).max(256).readonly() }).strict().superRefine((value, context) => {
  if (value.targetIds.length !== value.deploymentIds.length || new Set(value.targetIds).size !== value.targetIds.length
    || new Set(value.deploymentIds).size !== value.deploymentIds.length
    || value.targetIds.some(id => !value.rollout.targetIds.includes(id))) {
    context.addIssue({ code: "custom", message: "retry target/deployment correspondence" });
  }
});
export type RetryFailedRolloutResult = z.infer<typeof RetryFailedRolloutResultSchema>;
export const ApiExecutionApprovalCommandSchema = z.object({
  releaseId: PackageReleaseIdSchema,
  expectedRevision: PositiveIntegerSchema,
  digest: DigestSchema,
}).strict();
export const ApiExecutionActivationCommandSchema = z.object({
  releaseId: PackageReleaseIdSchema,
  expectedRevision: PositiveIntegerSchema,
}).strict();
export const ApiExecutionDeactivationCommandSchema = ApiExecutionActivationCommandSchema;
export const ApiActivationResultSchema = ApiActivationStateViewSchema.extend({ releaseId: PackageReleaseIdSchema }).strict();
export type ApiExecutionApprovalCommand = z.infer<typeof ApiExecutionApprovalCommandSchema>;
export type ApiExecutionActivationCommand = z.infer<typeof ApiExecutionActivationCommandSchema>;
export type ApiExecutionDeactivationCommand = z.infer<typeof ApiExecutionDeactivationCommandSchema>;
export type ApiActivationResult = z.infer<typeof ApiActivationResultSchema>;
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

export const ReleaseIdentitySchema = z.object({
  packageReleaseId: PackageReleaseIdSchema,
  authoritySourceId: SourceIdSchema,
  contentSourceId: SourceIdSchema,
  kind: PackageKindSchema,
  name: PackageNameSchema,
  version: VersionSchema,
  catalogCommit: boundedText(64),
  packageCommit: boundedText(64),
  packagePath: RelativePathSchema,
  digest: DigestSchema,
}).strict();
export const ArtifactDependencySchema = z.object({ release: ReleaseIdentitySchema, direct: z.boolean() }).strict();
const canonicalBase64 = z.string().max(Math.ceil(CATALOG_LIMITS.fileBytes / 3) * 4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  .refine(value => Buffer.from(value, "base64").toString("base64") === value)
  .refine(value => Buffer.from(value, "base64").byteLength <= CATALOG_LIMITS.fileBytes);
export const ArtifactPackageSchema = z.object({
  release: ReleaseIdentitySchema,
  manifest: PackageManifestSchema,
  direct: z.boolean(),
  namespace: RelativePathSchema.refine(value => /^packages\/[0-9]{3}-[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)),
}).strict().superRefine((value, context) => {
  if (value.release.kind !== value.manifest.kind || value.release.name !== value.manifest.name
    || value.release.version !== value.manifest.version || value.release.digest !== value.manifest.digest) {
    context.addIssue({ code: "custom", message: "package identity mismatch" });
  }
});
export const ArtifactFileSchema = z.object({
  packageReleaseId: PackageReleaseIdSchema,
  path: RelativePathSchema,
  mode: z.union([z.literal(0o644), z.literal(0o755)]),
  bytesBase64: canonicalBase64,
}).strict();
export const VerifiedArtifactEnvelopeSchema = z.object({
  deploymentId: boundedId,
  agentId: boundedId,
  generation: boundedText(200),
  release: ReleaseIdentitySchema,
  manifest: PackageManifestSchema,
  dependencies: z.array(ArtifactDependencySchema).max(CATALOG_LIMITS.resolvedPackages).readonly(),
  packages: z.array(ArtifactPackageSchema).max(CATALOG_LIMITS.resolvedPackages).readonly(),
  semanticDigest: DigestSchema,
  files: z.array(ArtifactFileSchema).max(CATALOG_LIMITS.contentEntries).readonly(),
}).strict().superRefine((value, context) => {
  const packageIds = value.packages.map(pkg => pkg.release.packageReleaseId);
  const packageNames = value.packages.map(pkg => pkg.release.name.toLowerCase());
  const namespaces = value.packages.map(pkg => pkg.namespace.toLowerCase());
  const filePaths = value.files.map(file => {
    const pkg = value.packages.find(item => item.release.packageReleaseId === file.packageReleaseId);
    return `${pkg?.namespace ?? "missing"}/${file.path}`.toLowerCase();
  });
  const totalBytes = value.files.reduce((total, file) => total + Buffer.from(file.bytesBase64, "base64").byteLength, 0);
  const oversizedManifest = value.packages.some(pkg => Buffer.byteLength(JSON.stringify(pkg.manifest), "utf8") > CATALOG_LIMITS.manifestJsonBytes);
  if (new Set(packageIds).size !== packageIds.length || new Set(packageNames).size !== packageNames.length
    || new Set(namespaces).size !== namespaces.length || new Set(filePaths).size !== filePaths.length
    || totalBytes > CATALOG_LIMITS.totalContentBytes || oversizedManifest
    || value.files.some(file => !packageIds.includes(file.packageReleaseId))) {
    context.addIssue({ code: "custom", message: "ambiguous artifact inventory" });
  }
  const trigger = value.packages.find(pkg => pkg.release.packageReleaseId === value.release.packageReleaseId);
  if (trigger && (JSON.stringify(trigger.release) !== JSON.stringify(value.release)
    || JSON.stringify(trigger.manifest) !== JSON.stringify(value.manifest))) {
    context.addIssue({ code: "custom", message: "trigger package mismatch" });
  }
});
export type ReleaseIdentity = z.infer<typeof ReleaseIdentitySchema>;
export type ArtifactDependency = z.infer<typeof ArtifactDependencySchema>;
export type ArtifactPackage = z.infer<typeof ArtifactPackageSchema>;
export type ArtifactFile = z.infer<typeof ArtifactFileSchema>;
export type VerifiedArtifactEnvelope = z.infer<typeof VerifiedArtifactEnvelopeSchema>;
export const DeploymentCommandSchema = z.object({
  deploymentId: boundedId, agentId: boundedId, agentName: boundedId, assignedRunnerId: boundedId,
  releaseId: PackageReleaseIdSchema, desiredGeneration: boundedText(200),
  desiredRoots: z.array(ReleaseIdentitySchema).max(CATALOG_LIMITS.resolvedPackages).readonly(),
  packageSetDigest: DigestSchema,
}).strict();
export const RunnerContextSchema = z.object({ runnerId: boundedId, allowedAgentName: boundedId.optional() }).strict();
export const DeploymentClaimContextSchema = RunnerContextSchema.extend({ deploymentId: boundedId }).strict();
export const AttemptTokenSchema = z.string().length(43).regex(/^[A-Za-z0-9_-]{43}$/);
export const DeploymentContextSchema = DeploymentClaimContextSchema.extend({ attemptToken: AttemptTokenSchema }).strict();
export const DeploymentClaimSchema = z.object({
  deploymentId: boundedId, attemptToken: AttemptTokenSchema, leaseExpiresAt: timestamp,
}).strict();
export const DeploymentReportSchema = z.object({
  state: z.enum(["STAGED", "WAITING_FOR_IDLE", "ACTIVE", "FAILED"]),
  generation: boundedText(200),
  failureCode: DeploymentFailureCodeSchema.optional(),
}).strict().superRefine((value, context) => {
  if ((value.state === "FAILED") !== (value.failureCode !== undefined)) {
    context.addIssue({ code: "custom", message: "failure code/state mismatch" });
  }
});
export const DeploymentReceiptSchema = z.object({
  deploymentId: boundedId,
  state: z.enum(["STAGED", "WAITING_FOR_IDLE", "ACTIVE", "FAILED", "SUPERSEDED"]),
  revision: PositiveIntegerSchema,
}).strict();
export type DeploymentCommand = z.infer<typeof DeploymentCommandSchema>;
export type RunnerContext = z.infer<typeof RunnerContextSchema>;
export type DeploymentClaimContext = z.infer<typeof DeploymentClaimContextSchema>;
export type DeploymentContext = z.infer<typeof DeploymentContextSchema>;
export type DeploymentClaim = z.infer<typeof DeploymentClaimSchema>;
export type DeploymentReport = z.infer<typeof DeploymentReportSchema>;
export type DeploymentReceipt = z.infer<typeof DeploymentReceiptSchema>;
export const StartRequirementsResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), code: z.literal("REQUIREMENTS_UNSATISFIED"),
    reasons: z.array(RequirementReasonSchema).min(1).max(64).readonly() }).strict(),
]);
export type StartRequirementsResult = z.infer<typeof StartRequirementsResultSchema>;
export const RunnerStartRequirementsContextSchema = RunnerContextSchema.extend({ agentName: boundedId }).strict();
export type RunnerStartRequirementsContext = z.infer<typeof RunnerStartRequirementsContextSchema>;
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
};

export const RuntimeGenerationSchema = z.object({
  generation: boundedText(200), skillRoot: boundedText(4096), promptRoot: boundedText(4096), eventShapeRoot: boundedText(4096),
}).strict();
export const StagedGenerationSchema = z.object({
  agentId: boundedId, deploymentId: boundedId, generation: RuntimeGenerationSchema, stagedRoot: boundedText(4096),
  packageSetDigest: DigestSchema, semanticDigest: DigestSchema,
}).strict();
export const ActivationResultSchema = z.object({ agentId: boundedId, deploymentId: boundedId, generation: boundedText(200) }).strict();
export type RuntimeGeneration = z.infer<typeof RuntimeGenerationSchema>;
export type TurnLease = { agentId: string; generation: RuntimeGeneration; release(): void };
export type StagedGeneration = z.infer<typeof StagedGenerationSchema>;
export type ActivationResult = z.infer<typeof ActivationResultSchema>;
export type AgentRuntimeGeneration = {
  captureForTurn(agentId: string): Promise<TurnLease>;
  stage(deployment: DeploymentCommand, artifact: VerifiedArtifactEnvelope): Promise<StagedGeneration>;
  activateWhenIdle(staged: StagedGeneration): Promise<ActivationResult>;
};
export type CatalogStartGate = { validateCatalogStart(agentId: string, actor: AuthenticatedPrincipal): Promise<StartRequirementsResult>; setDesiredAgentState(agentId: string, desired: "RUNNING" | "STOPPED", actor: AuthenticatedPrincipal): Promise<StartRequirementsResult> };

export type PackageKind = z.infer<typeof PackageKindSchema>;
export type { PackageManifest, ReviewWarning };
