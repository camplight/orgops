import { z } from "zod";
export * from "./source-library";
import {
  CATALOG_LIMITS, CatalogIdSchema, SourceIdSchema, PackageNameSchema, PackageKindSchema,
  VersionSchema, DigestSchema, CommitSchema, RelativePathSchema, uniqueBy,
  validateCatalogJson, parseCatalogJson, contractFailure, type ContractResult,
} from "./primitives";

const CatalogEntrySchema = z.object({
  kind: PackageKindSchema, name: PackageNameSchema, version: VersionSchema, digest: DigestSchema,
  location: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("catalog"), path: RelativePathSchema,
      revision: z.discriminatedUnion("type", [
        z.object({ type: z.literal("exact"), commit: CommitSchema }).strict(),
        z.object({ type: z.literal("catalog-revision") }).strict(),
      ]),
    }).strict(),
    z.object({ type: z.literal("source"), sourceId: SourceIdSchema, commit: CommitSchema, path: RelativePathSchema }).strict(),
  ]),
}).strict();

export const CatalogIndexSchema = z.object({
  formatVersion: z.literal(1),
  entries: z.array(CatalogEntrySchema).max(CATALOG_LIMITS.indexEntries)
    .refine(entries => uniqueBy(entries, entry => JSON.stringify([entry.name, entry.version])))
    .refine(entries => uniqueBy(entries, entry => {
      const location = entry.location;
      return JSON.stringify(location.type === "source"
        ? ["source", location.sourceId, location.commit, location.path]
        : ["catalog", location.revision.type === "exact" ? location.revision.commit : "catalog-revision", location.path]);
    })),
}).strict();
export const ResolvedIdentitySchema = z.object({
  catalogId: CatalogIdSchema, catalogCommit: CommitSchema, sourceId: SourceIdSchema, packageCommit: CommitSchema,
  path: RelativePathSchema, kind: PackageKindSchema, name: PackageNameSchema, version: VersionSchema, digest: DigestSchema,
}).strict();
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
export type CatalogIndex = z.infer<typeof CatalogIndexSchema>;
export type ResolvedIdentity = z.infer<typeof ResolvedIdentitySchema>;

export function validateCatalogIndex(value: unknown): ContractResult<CatalogIndex> {
  const json = validateCatalogJson(value, CATALOG_LIMITS.indexJsonBytes);
  if (!json.ok) return json;
  const parsed = CatalogIndexSchema.safeParse(json.value);
  return parsed.success ? { ok: true, value: parsed.data } : contractFailure("INVALID_INDEX");
}
export function parseCatalogIndex(json: string): ContractResult<CatalogIndex> {
  const parsed = parseCatalogJson(json, CATALOG_LIMITS.indexJsonBytes);
  return parsed.ok ? validateCatalogIndex(parsed.value) : parsed;
}
