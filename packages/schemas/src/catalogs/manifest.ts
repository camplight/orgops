import { z } from "zod";
import {
  CATALOG_LIMITS, CatalogIdSchema, SourceIdSchema, PackageNameSchema, VersionSchema,
  DigestSchema, CommitSchema, ContentPathSchema, RelativePathSchema, PositiveIntegerSchema,
  jsonString, nonblank, compareVersions, uniqueBy, collisionFreePaths,
  validateCatalogJson, parseCatalogJson, contractFailure, type ContractResult,
} from "./primitives";

export const CompatibilitySchema = z.object({
  orgops: z.object({ min: VersionSchema, maxExclusive: VersionSchema.optional() }).strict()
    .refine(value => value.maxExclusive === undefined || compareVersions(value.min, value.maxExclusive) < 0),
  platforms: z.array(z.enum(["linux", "darwin", "win32"])).min(1).max(3).refine(values => uniqueBy(values, value => value)),
  tools: z.array(PackageNameSchema).max(64).refine(values => uniqueBy(values, value => value)),
}).strict();
export const SecretRequirementSchema = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), description: nonblank(1024), required: z.boolean(),
}).strict();
export const DependencyPinSchema = z.object({
  catalogId: CatalogIdSchema, sourceId: SourceIdSchema, name: PackageNameSchema, version: VersionSchema,
  revision: z.discriminatedUnion("type", [
    z.object({ type: z.literal("exact"), commit: CommitSchema }).strict(),
    z.object({ type: z.literal("same-package-revision") }).strict(),
  ]),
  digest: DigestSchema,
}).strict();
export const FileInventoryEntrySchema = z.object({
  path: ContentPathSchema, size: z.number().finite().int().min(0).max(CATALOG_LIMITS.fileBytes),
  digest: DigestSchema, executable: z.boolean(),
}).strict();
export const ExecutableDeclarationSchema = z.object({
  path: ContentPathSchema, execution: z.enum(["api-event-shapes", "runner-script"]),
}).strict();
export const PackageMetadataSchema = z.object({
  formatVersion: z.literal(1), name: PackageNameSchema, version: VersionSchema,
  description: nonblank(4096), author: nonblank(256), license: nonblank(256),
  compatibility: CompatibilitySchema,
  secrets: z.array(SecretRequirementSchema).max(64).refine(values => uniqueBy(values, value => value.name)),
}).strict();
const baseShape = {
  ...PackageMetadataSchema.shape,
  dependencies: z.array(DependencyPinSchema).max(CATALOG_LIMITS.dependencies)
    .refine(values => uniqueBy(values, value => JSON.stringify([value.catalogId, value.sourceId, value.name]))),
  files: z.array(FileInventoryEntrySchema).max(CATALOG_LIMITS.contentEntries)
    .refine(values => collisionFreePaths(values.map(value => value.path)))
    .refine(values => values.reduce((total, value) => total + value.size, 0) <= CATALOG_LIMITS.totalContentBytes),
  executables: z.array(ExecutableDeclarationSchema).max(CATALOG_LIMITS.contentEntries)
    .refine(values => uniqueBy(values, value => value.path.toLowerCase())),
  digest: DigestSchema,
};
const PackageBaseSchema = z.object(baseShape).strict();
export const NativeTemplateSchema = z.object({
  mode: z.enum(["CLASSIC", "RLM_REPL"]), systemInstructions: jsonString(65536), soulContents: jsonString(65536).optional(),
  runtime: z.object({
    llmCallTimeoutMs: PositiveIntegerSchema.optional(), classicMaxModelSteps: PositiveIntegerSchema.optional(),
    contextSessionGapMs: PositiveIntegerSchema.optional(), emitAuditEvents: z.boolean().optional(),
    memoryContextMode: z.enum(["PER_CHANNEL_CROSS_CHANNEL", "FULL_CHANNEL_EVENTS", "OFF"]).optional(),
  }).strict(),
  suggestedModel: z.object({
    provider: nonblank(256).optional(), modelName: nonblank(256).optional(),
    temperature: z.number().finite().min(0).max(2).optional(), maxTokens: PositiveIntegerSchema.optional(),
  }).strict().refine(value => Object.values(value).some(item => item !== undefined)).optional(),
  alwaysPreloadedSkills: z.array(PackageNameSchema).max(64).refine(values => uniqueBy(values, value => value)),
}).strict().refine(value => value.mode !== "RLM_REPL" || value.runtime.classicMaxModelSteps === undefined);

const commandShape = {
  command: jsonString(16384, 1), args: z.array(jsonString(4096)).max(128).optional(),
  cwd: z.union([z.literal("."), RelativePathSchema]).refine(value => !value.toLowerCase().startsWith(".orgops-data")).optional(),
  timeoutMs: PositiveIntegerSchema.optional(),
};
export const PortableCommandSchema = z.object(commandShape).strict();
const repoSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/)
  .refine(value => value.split("/").every(segment => segment !== "." && segment !== ".."));
const refSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine(value => !value.includes("..") && !value.includes("//") && !value.endsWith("/") && !value.endsWith(".")
    && value.split("/").every(segment => !segment.endsWith(".lock")));
export const PortableWrappedRecipeSchema = z.object({
  kind: PackageNameSchema, harness: z.literal("command"),
  source: z.object({ type: z.literal("github"), repo: repoSchema, ref: refSchema.optional(), updateOnStart: z.literal(false) }).strict().optional(),
  setup: z.object({ ...commandShape, checkCommand: jsonString(16384, 1).optional() }).strict().optional(),
  sidecars: z.array(z.object({
    ...commandShape, name: PackageNameSchema, checkCommand: jsonString(16384, 1).optional(),
    restart: z.boolean().optional(), restartDelayMs: PositiveIntegerSchema.optional(),
  }).strict()).max(16).refine(values => uniqueBy(values, value => value.name)),
  runtime: z.object({ ...commandShape, parse: z.enum(["text", "json-payloads"]).optional() }).strict(),
  session: z.object({ scope: z.enum(["per-channel", "per-agent"]) }).strict(),
  resourceWiring: z.literal("none"),
}).strict();

const SkillManifestSchema = z.object({ ...baseShape, kind: z.literal("skill"), skill: z.object({ entrypoint: z.literal("SKILL.md") }).strict() }).strict();
const NativeAgentManifestSchema = z.object({ ...baseShape, kind: z.literal("native-agent"), native: NativeTemplateSchema }).strict();
const WrappedAgentManifestSchema = z.object({ ...baseShape, kind: z.literal("wrapped-agent"), wrapped: PortableWrappedRecipeSchema }).strict();
export const PackageManifestSchema = z.discriminatedUnion("kind", [SkillManifestSchema, NativeAgentManifestSchema, WrappedAgentManifestSchema])
  .superRefine((value, context) => {
    if (value.executables.some(declaration => !value.files.some(file => file.path === declaration.path))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["executables"], message: "Invalid inventory reference" });
    }
    if (value.kind === "native-agent" && value.native.alwaysPreloadedSkills.some(name => !value.dependencies.some(dependency => dependency.name === name))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["native", "alwaysPreloadedSkills"], message: "Invalid dependency reference" });
    }
    if (value.kind === "wrapped-agent" && (value.files.length || value.executables.length || value.dependencies.length)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["wrapped"], message: "Unsupported resource wiring" });
    }
  });

export type Compatibility = z.infer<typeof CompatibilitySchema>;
export type SecretRequirement = z.infer<typeof SecretRequirementSchema>;
export type DependencyPin = z.infer<typeof DependencyPinSchema>;
export type FileInventoryEntry = z.infer<typeof FileInventoryEntrySchema>;
export type ExecutableDeclaration = z.infer<typeof ExecutableDeclarationSchema>;
export type PackageMetadata = z.infer<typeof PackageMetadataSchema>;
export type PackageBase = z.infer<typeof PackageBaseSchema>;
export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type NativeTemplate = z.infer<typeof NativeTemplateSchema>;
export type NativeAgentManifest = z.infer<typeof NativeAgentManifestSchema>;
export type PortableCommand = z.infer<typeof PortableCommandSchema>;
export type PortableWrappedRecipe = z.infer<typeof PortableWrappedRecipeSchema>;
export type WrappedAgentManifest = z.infer<typeof WrappedAgentManifestSchema>;
export type PackageManifest = z.infer<typeof PackageManifestSchema>;

// Read only after the JSON-only boundary has rejected accessors and non-data values.
function unsupportedWiring(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  if (manifest.kind !== "wrapped-agent") return false;
  if ([manifest.files, manifest.executables, manifest.dependencies].some(items => Array.isArray(items) && items.length > 0)) return true;
  const recipe = manifest.wrapped;
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) return false;
  const wrapped = recipe as Record<string, unknown>;
  return ("resourceWiring" in wrapped && wrapped.resourceWiring !== "none")
    || "alwaysPreloadedSkills" in wrapped || "enabledSkills" in wrapped || "systemInstructions" in wrapped || "soulContents" in wrapped;
}
export function validatePackageManifest(value: unknown): ContractResult<PackageManifest> {
  const json = validateCatalogJson(value, CATALOG_LIMITS.manifestJsonBytes);
  if (!json.ok) return json;
  if (unsupportedWiring(json.value)) return contractFailure("UNSUPPORTED_WIRING", "wrapped");
  const parsed = PackageManifestSchema.safeParse(json.value);
  return parsed.success ? { ok: true, value: parsed.data } : contractFailure("INVALID_MANIFEST");
}
export function parsePackageManifest(json: string): ContractResult<PackageManifest> {
  const parsed = parseCatalogJson(json, CATALOG_LIMITS.manifestJsonBytes);
  return parsed.ok ? validatePackageManifest(parsed.value) : parsed;
}
