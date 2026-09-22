import { z } from "zod";
export * from "./event-shapes";

export const EventStatusSchema = z.enum([
  "PENDING",
  "DELIVERED",
  "ACKED",
  "FAILED",
  "DEAD",
]);

export const EventSchema = z.object({
  id: z.string().optional(),
  type: z.string(),
  payload: z.unknown(),
  source: z.string(),
  channelId: z.string().optional(),
  parentEventId: z.string().optional(),
  deliverAt: z.number().optional(),
  status: EventStatusSchema.optional(),
  idempotencyKey: z.string().optional(),
});

export const AgentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  icon: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  modelId: z.string(),
  systemInstructions: z.string().optional().default(""),
  soulPath: z.string(),
  workspacePath: z.string(),
  allowOutsideWorkspace: z.boolean().optional().default(false),
  llmCallTimeoutMs: z.number().int().positive().optional().nullable(),
  classicMaxModelSteps: z.number().int().positive().optional().nullable(),
  contextSessionGapMs: z.number().int().positive().optional().nullable(),
  memoryContextMode: z
    .enum(["PER_CHANNEL_CROSS_CHANNEL", "FULL_CHANNEL_EVENTS", "OFF"])
    .optional(),
  desiredState: z.enum(["RUNNING", "STOPPED"]).optional(),
  runtimeState: z
    .enum(["STARTING", "RUNNING", "STOPPED", "CRASHED"])
    .optional(),
});

export const ModelSchema = z.object({
  id: z.string(),
  provider: z.string(),
  modelName: z.string(),
  enabled: z.boolean(),
  defaults: z.record(z.unknown()).default({}),
});

export const AuthLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type EventInput = z.infer<typeof EventSchema>;
export type AgentInput = z.infer<typeof AgentSchema>;
export type ModelInput = z.infer<typeof ModelSchema>;

export {
  CATALOG_LIMITS, PackageNameSchema, SourceIdSchema, CatalogIdSchema,
  RelativePathSchema, VersionSchema, DigestSchema, CommitSchema, validateCatalogJson,
  type PackageName, type SourceId, type CatalogId, type RelativePath, type Version, type Digest, type Commit,
  type ContractIssue, type ContractResult, type ReviewWarning,
} from "./catalogs/primitives";
export {
  PackageManifestSchema, DependencyPinSchema, PortableWrappedRecipeSchema,
  CompatibilitySchema, SecretRequirementSchema, FileInventoryEntrySchema, ExecutableDeclarationSchema,
  PackageMetadataSchema, NativeTemplateSchema, PortableCommandSchema,
  validatePackageManifest, parsePackageManifest,
  type Compatibility, type SecretRequirement, type DependencyPin, type FileInventoryEntry,
  type ExecutableDeclaration, type PackageMetadata, type PackageBase, type SkillManifest,
  type NativeTemplate, type NativeAgentManifest, type PortableCommand, type PortableWrappedRecipe,
  type WrappedAgentManifest, type PackageManifest,
} from "./catalogs/manifest";
export {
  CatalogIndexSchema, ResolvedIdentitySchema, validateCatalogIndex, parseCatalogIndex,
  type CatalogEntry, type CatalogIndex, type ResolvedIdentity,
} from "./catalogs/index";
export * from "./catalogs/source-library";
export * from "./unified-skills";

export {
  SourceUpdateSchema, CatalogCreateSchema, CatalogUpdateSchema,
  RevisionRequestSchema, ReadCredentialSetSchema, GitRepositorySchema, CatalogRefSchema,
  CatalogConfigurationAuditSchema, CatalogSyncRequestSchema,
  type SourceUpdate, type CatalogCreate, type CatalogUpdate,
  type RevisionRequest, type ReadCredentialSet, type GitRepository, type CatalogRef,
  type CatalogConfigurationAudit, type CatalogSyncRequest,
} from "./catalogs/configuration";
