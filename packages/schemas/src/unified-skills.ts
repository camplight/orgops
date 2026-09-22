import { z } from "zod";
import { DigestSchema, PackageNameSchema, VersionSchema } from "./catalogs/primitives";
import { PackageReleaseIdSchema, SkillDeploymentFailureCodeSchema, SkillDeploymentOperationSchema, SkillDeploymentStateSchema } from "./catalogs/source-library";

export const TrustedLocalSkillRefSchema = z.object({ kind: z.literal("LOCAL"), name: z.string().min(1).max(64), localOrigin: z.enum(["BUILT_IN", "WORKSPACE"]), trustedRootKey: z.string().min(1).max(128) }).strict();
export const SkillRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LOCAL"), name: z.string().min(1).max(64), localOrigin: z.enum(["BUILT_IN", "WORKSPACE"]) }).strict(),
  z.object({ kind: z.literal("CATALOG"), packageReleaseId: PackageReleaseIdSchema, name: PackageNameSchema, version: VersionSchema, digest: DigestSchema }).strict(),
]);
export const InventoryActorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("HUMAN_ADMIN"), id: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal("AUTHENTICATED_HUMAN"), id: z.string().min(1).max(200) }).strict(),
]);
export const InventoryFiltersSchema = z.object({ query: z.string().max(200).optional(), origin: z.enum(["ALL", "LOCAL", "CATALOG"]).default("ALL"), availability: z.enum(["ALL", "INSTALLED", "AVAILABLE"]).default("ALL") }).strict();
export const InventoryRouteQuerySchema = z.object({ agentId: z.string().min(1).max(200).optional(), filters: InventoryFiltersSchema }).strict();
export const SkillCommandSchema = z.union([
  z.discriminatedUnion("operation", [
    z.object({ kind: z.literal("LOCAL"), operation: z.literal("ADD"), agentId: z.string().min(1).max(200), name: z.string().min(1).max(64), preload: z.boolean(), expectedAgentRevision: z.number().finite().int().min(1).max(2147483647) }).strict(),
    z.object({ kind: z.literal("LOCAL"), operation: z.literal("REMOVE"), agentId: z.string().min(1).max(200), name: z.string().min(1).max(64), expectedAgentRevision: z.number().finite().int().min(1).max(2147483647) }).strict(),
    z.object({ kind: z.literal("LOCAL"), operation: z.literal("SET_PRELOAD"), agentId: z.string().min(1).max(200), name: z.string().min(1).max(64), preload: z.boolean(), expectedAgentRevision: z.number().finite().int().min(1).max(2147483647) }).strict(),
    z.object({ kind: z.literal("LOCAL"), operation: z.enum(["ENABLE", "DISABLE"]), agentId: z.string().min(1).max(200), name: z.string().min(1).max(64), expectedAgentRevision: z.number().finite().int().min(1).max(2147483647) }).strict(),
  ]),
  z.discriminatedUnion("operation", [
    z.object({ kind: z.literal("CATALOG"), operation: z.literal("ASSIGN"), agentId: z.string().min(1).max(200), packageReleaseId: PackageReleaseIdSchema, preload: z.boolean(), expectedAgentRevision: z.number().finite().int().min(1).max(2147483647), expectedAssignmentRevision: z.number().finite().int().min(0).max(2147483647) }).strict(),
    z.object({ kind: z.literal("CATALOG"), operation: z.literal("REMOVE"), agentId: z.string().min(1).max(200), packageReleaseId: PackageReleaseIdSchema, expectedAgentRevision: z.number().finite().int().min(1).max(2147483647), expectedAssignmentRevision: z.number().finite().int().min(0).max(2147483647) }).strict(),
    z.object({ kind: z.literal("CATALOG"), operation: z.enum(["ENABLE", "DISABLE"]), agentId: z.string().min(1).max(200), packageReleaseId: PackageReleaseIdSchema, preload: z.boolean().optional(), expectedAgentRevision: z.number().finite().int().min(1).max(2147483647), expectedAssignmentRevision: z.number().finite().int().min(0).max(2147483647) }).strict(),
    z.object({ kind: z.literal("CATALOG"), operation: z.literal("SET_PRELOAD"), agentId: z.string().min(1).max(200), packageReleaseId: PackageReleaseIdSchema, preload: z.boolean(), expectedAgentRevision: z.number().finite().int().min(1).max(2147483647), expectedAssignmentRevision: z.number().finite().int().min(0).max(2147483647) }).strict(),
  ]),
]);
export type SkillCommand = z.infer<typeof SkillCommandSchema>;
export const SkillDeploymentGenerationSchema = z.object({
  agentId: z.string().min(1).max(200), generation: z.string().min(1).max(200),
  assignments: z.array(z.object({ packageReleaseId: PackageReleaseIdSchema, desired: z.enum(["ENABLED", "DISABLED"]), preload: z.boolean() }).strict()).max(256),
}).strict();
export const SkillDeploymentEventSchema = z.object({
  eventId: z.string().min(1).max(200), operation: SkillDeploymentOperationSchema,
  state: SkillDeploymentStateSchema,
  desiredGeneration: z.string().min(1).max(200), effectiveGeneration: z.string().min(1).max(200).nullable(),
  failureCode: SkillDeploymentFailureCodeSchema.nullable(), revision: z.number().int().min(1).max(2147483647), createdAt: z.number().int().nonnegative(),
}).strict().superRefine((event, ctx) => {
  if (event.state === "FAILED" && !["INSPECTION_FAILED", "STORAGE_FAILURE"].includes(event.failureCode ?? "")) ctx.addIssue({ code: "custom", message: "failure code/state mismatch" });
  else if (event.state === "SUPERSEDED" && event.failureCode !== "DEPLOYMENT_SUPERSEDED") ctx.addIssue({ code: "custom", message: "failure code/state mismatch" });
  else if (event.state !== "FAILED" && event.state !== "SUPERSEDED" && event.failureCode !== null) ctx.addIssue({ code: "custom", message: "failure code/state mismatch" });
});
export const SkillAuditEventSchema = z.object({
  id: z.string().min(1).max(200), type: z.literal("audit.skill.changed"), source: z.literal("system"),
  channelId: z.null(), status: z.literal("DELIVERED"), createdAt: z.number().int().nonnegative(),
  payload: z.object({
    actorKind: z.enum(["HUMAN_ADMIN", "AUTHENTICATED_HUMAN"]), actorId: z.string().min(1).max(200), agentId: z.string().min(1).max(200),
    ref: z.object({ kind: z.literal("LOCAL"), name: z.string().min(1).max(64), localOrigin: z.enum(["BUILT_IN", "WORKSPACE"]) }).strict().optional(),
    refs: z.array(z.object({ kind: z.literal("LOCAL"), name: z.string().min(1).max(64), localOrigin: z.enum(["BUILT_IN", "WORKSPACE"]) }).strict()).max(256).optional(),
    operation: z.enum(["ADD", "REMOVE", "ENABLE", "DISABLE", "SET_PRELOAD"]), deploymentId: z.string().min(1).max(200).nullable().optional(),
    revision: z.number().int().min(1).max(2147483647), outcome: z.enum(["SUCCEEDED", "FAILED"]),
  }).strict().superRefine((payload, ctx) => { if (!payload.ref && (!payload.refs || payload.refs.length === 0)) ctx.addIssue({ code: "custom", message: "skill ref required" }); }),
}).strict();
export type SkillAuditEvent = z.infer<typeof SkillAuditEventSchema>;
export const SkillSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LOCAL"), name: z.string().min(1).max(64), preload: z.boolean() }).strict(),
  z.object({ kind: z.literal("CATALOG"), packageReleaseId: PackageReleaseIdSchema, preload: z.boolean() }).strict(),
]);
export type SkillSelection = z.infer<typeof SkillSelectionSchema>;

export const OpaqueSecretReferenceSchema = z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/);
export type OpaqueSecretReference = z.infer<typeof OpaqueSecretReferenceSchema>;
export const SealedSecretBindingSchema = z.object({
  requirementName: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  secretReferenceId: OpaqueSecretReferenceSchema,
}).strict();
export type SealedSecretBinding = z.infer<typeof SealedSecretBindingSchema>;

const ProvisionNameSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const ProvisionIdempotencyKeySchema = z.string().uuid();
const ProvisionLocalSkillsSchema = z.array(z.object({ name: z.string().min(1).max(64), preload: z.boolean() }).strict()).max(64)
  .refine(items => new Set(items.map(item => item.name)).size === items.length);
const ProvisionCatalogSkillsSchema = z.array(z.object({ packageReleaseId: PackageReleaseIdSchema, preload: z.boolean() }).strict()).max(64)
  .refine(items => new Set(items.map(item => item.packageReleaseId)).size === items.length);
const ProvisionBaseSchema = z.object({
  name: ProvisionNameSchema,
  idempotencyKey: ProvisionIdempotencyKeySchema,
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
  workspacePath: z.string().min(1).max(4096),
  runnerId: z.string().min(1).max(200),
  modelId: z.string().min(1).max(200),
  localSkills: ProvisionLocalSkillsSchema.default([]),
  catalogSkills: ProvisionCatalogSkillsSchema.default([]),
}).strict();
export const ProvisionAgentSchema = z.discriminatedUnion("kind", [
  ProvisionBaseSchema.extend({ kind: z.literal("BLANK"), mode: z.enum(["CLASSIC", "RLM_REPL", "WRAPPED"]), desiredState: z.enum(["RUNNING", "STOPPED"]).default("RUNNING") }).strict(),
  ProvisionBaseSchema.extend({
    kind: z.literal("TEMPLATE"), packageReleaseId: PackageReleaseIdSchema,
    secretBindings: z.array(SealedSecretBindingSchema).max(64)
      .refine(items => new Set(items.map(item => item.requirementName)).size === items.length),
  }).strict(),
]);
export type ProvisionAgentHttpInput = z.infer<typeof ProvisionAgentSchema>;

export const AgentCreationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("BLANK"), local: ProvisionBaseSchema.extend({ mode: z.enum(["CLASSIC", "RLM_REPL", "WRAPPED"]), desiredState: z.enum(["RUNNING", "STOPPED"]) }).strict(), localSkills: ProvisionLocalSkillsSchema, catalogSkills: ProvisionCatalogSkillsSchema }).strict(),
  z.object({ kind: z.literal("TEMPLATE"), packageReleaseId: PackageReleaseIdSchema, local: ProvisionBaseSchema, secretBindings: z.array(SealedSecretBindingSchema).max(64), localSkills: ProvisionLocalSkillsSchema, catalogSkills: ProvisionCatalogSkillsSchema }).strict(),
]);
export type AgentCreation = z.infer<typeof AgentCreationSchema>;
export type AgentConfigSnapshot = Readonly<Record<string, unknown>>;
export const AgentProvisioningBlockerSchema = z.object({ code: z.string().min(1).max(200), item: z.string().max(200).optional(), requirement: z.string().max(200).optional() }).strict();
export const AgentProvisioningPreflightSchema = z.object({
  ok: z.boolean(), creationBlockers: z.array(AgentProvisioningBlockerSchema).max(64).readonly(), startBlockers: z.array(AgentProvisioningBlockerSchema).max(64).readonly(),
  exactSkillRefs: z.array(SkillRefSchema).max(64).readonly(), exactConfig: z.record(z.unknown()).optional(),
}).strict();
export type AgentProvisioningPreflight = z.infer<typeof AgentProvisioningPreflightSchema>;
export const AgentProvisioningReceiptSchema = z.object({
  id: z.string().min(1).max(200), name: ProvisionNameSchema, desiredState: z.enum(["RUNNING", "STOPPED"]), runtimeState: z.enum(["STOPPED", "STARTING", "RUNNING", "CRASHED"]),
  queuedDeploymentIds: z.array(z.string().min(1).max(200)).max(64), startBlockers: z.array(AgentProvisioningBlockerSchema).max(64), requirements: z.array(z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), state: z.enum(["SATISFIED", "MISSING"]) }).strict()).max(64).optional(),
}).strict();
export type AgentProvisioningReceipt = z.infer<typeof AgentProvisioningReceiptSchema>;
export const ProvisioningTemplateOptionsSchema = z.object({
  runners: z.array(z.object({ id: z.string().min(1).max(200) }).strict()).max(256).readonly(),
  models: z.array(z.object({ id: z.string().min(1).max(200) }).strict()).max(256).readonly(),
  secretReferences: z.array(z.object({ name: z.string().max(256), secretReferenceId: OpaqueSecretReferenceSchema }).strict()).max(256).readonly(),
  templates: z.array(z.object({
    packageReleaseId: PackageReleaseIdSchema,
    name: PackageNameSchema,
    version: VersionSchema,
    digest: DigestSchema,
    description: z.string().min(1).max(4096),
    readiness: z.lazy(() => SkillReadinessSchema),
    mode: z.enum(["CLASSIC", "RLM_REPL", "WRAPPED"]),
    exactConfig: z.record(z.unknown()),
    skillRefs: z.array(SkillRefSchema).max(64).readonly(),
    requirements: z.array(z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), required: z.boolean() }).strict()).max(64).readonly(),
  }).strict()).max(256).readonly(),
}).strict();
export type ProvisioningTemplateOptions = z.infer<typeof ProvisioningTemplateOptionsSchema>;
export const AgentStartReadinessSchema = z.object({
  ready: z.boolean(),
  queuedDeployment: z.boolean(),
  blockers: z.array(z.object({ code: z.string().min(1).max(64), requirement: z.string().min(1).max(64).optional() }).strict()).max(64).readonly(),
}).strict().superRefine((value, ctx) => { if (value.ready && (value.queuedDeployment || value.blockers.length > 0)) ctx.addIssue({ code: "custom", message: "ready state cannot have blockers or queued deployment" }); });
export type AgentStartReadiness = z.infer<typeof AgentStartReadinessSchema>;

export const SkillPreflightBlockerSchema = z.object({ code: z.string().min(1).max(200), requirement: z.string().max(200).optional() }).strict();
export const SkillPreflightResultSchema = z.object({ ok: z.boolean(), exactSkillRefs: z.array(SkillRefSchema).max(64).readonly(), creationBlockers: z.array(SkillPreflightBlockerSchema).max(64).readonly(), startBlockers: z.array(SkillPreflightBlockerSchema).max(64).readonly() }).strict();
export type SkillPreflightResult = z.infer<typeof SkillPreflightResultSchema>;
export const SkillPreflightSchema = z.object({
  selection: z.array(SkillSelectionSchema).max(64).readonly(),
}).strict();
export const SkillHistoryQuerySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LOCAL"), name: z.string().min(1).max(64), localOrigin: z.enum(["BUILT_IN", "WORKSPACE"]) }).strict(),
  z.object({ kind: z.literal("CATALOG"), packageReleaseId: PackageReleaseIdSchema }).strict(),
]);
export const SkillReadinessSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("READY") }).strict(),
  z.object({ state: z.literal("BLOCKED"), blockers: z.array(z.object({ code: z.enum(["GRANT_REQUIRED", "INSTALLATION_REQUIRED", "INCOMPATIBLE", "SOURCE_UNAVAILABLE", "RUNNER_REQUIRED", "REQUIREMENT_MISSING", "CONFLICT"]), requirement: z.string().max(200).optional() }).strict()).max(16).readonly() }).strict(),
]);
export const SkillAssignmentProjectionSchema = z.object({ desired: z.enum(["ENABLED", "DISABLED", "ABSENT"]), effective: z.enum(["ENABLED", "DISABLED"]), preload: z.boolean(), deployment: z.enum(["STABLE", "REQUESTED", "DEPLOYING", "FAILED"]), revision: z.number().int().min(0).max(2147483647) }).strict();
const SourceLibraryLinkSchema = z.string().min(1).max(2048).regex(/^\/\?screen=source-library&/);
export const AdminSkillProvenanceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LOCAL") }).strict(),
  z.object({
    kind: z.literal("CATALOG"), authoritySourceId: z.string().min(1).max(200), contentSourceId: z.string().min(1).max(200),
    catalogCommit: z.string().min(1).max(64), packageCommit: z.string().min(1).max(64), packagePath: z.string().min(1).max(1024),
    sourceReadiness: z.enum(["READY", "UNAVAILABLE", "REMOVED"]), reviewState: z.enum(["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]),
    installationState: z.enum(["ABSENT", "INSTALLED", "QUARANTINED"]),
    apiActivation: z.object({ approvalState: z.enum(["NOT_REQUIRED", "AWAITING_APPROVAL", "APPROVED", "REVOKED"]), runtimeState: z.enum(["INACTIVE", "ACTIVATING", "ACTIVE", "DEACTIVATING", "FAILED"]) }).strict(),
    grantCount: z.number().int().min(0).max(1000000),
    compatibility: z.object({ orgops: z.object({ min: z.string().min(1).max(64), maxExclusive: z.string().min(1).max(64).optional() }).strict(), platforms: z.array(z.string().min(1).max(64)).max(32).readonly(), tools: z.array(z.string().min(1).max(128)).max(64).readonly() }).strict(),
    links: z.object({ overview: SourceLibraryLinkSchema, contents: SourceLibraryLinkSchema, security: SourceLibraryLinkSchema }).strict(),
  }).strict(),
]);
export const SkillInventoryItemSchema = z.object({ ref: SkillRefSchema, description: z.string().min(1).max(4096), version: VersionSchema.optional(), readiness: SkillReadinessSchema, assignment: SkillAssignmentProjectionSchema.optional(), provenance: z.enum(["FULL_ADMIN", "BOUNDED_HUMAN"]), adminProvenance: AdminSkillProvenanceSchema.optional() }).strict().superRefine((item, ctx) => { if (item.provenance === "FULL_ADMIN" && !item.adminProvenance) ctx.addIssue({ code: "custom", message: "admin provenance required" }); if (item.provenance === "BOUNDED_HUMAN" && item.adminProvenance) ctx.addIssue({ code: "custom", message: "bounded projection cannot contain admin provenance" }); });
export const AgentSkillInventorySchema = z.object({ items: z.array(SkillInventoryItemSchema).readonly(), agentRevision: z.number().int().min(1).max(2147483647) }).strict();
export type TrustedLocalSkillRef = z.infer<typeof TrustedLocalSkillRefSchema>;
export type SkillRef = z.infer<typeof SkillRefSchema>;
export type InventoryActor = z.infer<typeof InventoryActorSchema>;
export type InventoryFilters = z.infer<typeof InventoryFiltersSchema>;
export type InventoryQuery = InventoryFilters;
export type InventoryRouteQuery = z.infer<typeof InventoryRouteQuerySchema>;
export type SkillHistoryQuery = z.infer<typeof SkillHistoryQuerySchema>;
export type SkillReadiness = z.infer<typeof SkillReadinessSchema>;
export type SkillAssignmentProjection = z.infer<typeof SkillAssignmentProjectionSchema>;
export type AdminSkillProvenance = z.infer<typeof AdminSkillProvenanceSchema>;
export type SkillInventoryItem = z.infer<typeof SkillInventoryItemSchema>;
export type AgentSkillInventory = z.infer<typeof AgentSkillInventorySchema>;
export type UnifiedSkillInventory = {
  list(actor: InventoryActor, filters?: Partial<InventoryFilters>): Promise<readonly SkillInventoryItem[]>;
  listForAgent(actor: InventoryActor, agentId: string, filters?: Partial<InventoryFilters>): Promise<AgentSkillInventory>;
};
