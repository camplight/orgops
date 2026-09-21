import type { GitRepository, ResolvedIdentity, ContractIssue } from "@orgops/schemas";
import type { PackageSnapshot, InspectedFile } from "./content";
import type { CatalogSnapshot, SuppliedPackage, ResolveInput, InstalledSkill } from "./resolve";

export const IMPORT_LIMITS = Object.freeze({
  inputJsonBytes: 67108864, validatedJsonBytes: 67108864,
  sources: 128, catalogs: 32, suppliedPackages: 4096,
  knownReleases: 4096, installedEntries: 4096, localTreeEntries: 8192,
  localEntriesPerSkill: 1024, totalIndexEntries: 8192,
  aggregateFiles: 8192, decodedBytes: 33554432,
  outputFiles: 8192, outputDecodedBytes: 33554432, outputJsonBytes: 67108864,
  snapshotWarnings: 4096,
} as const);
export type ImportSource = {
  sourceId: string; repository: GitRepository; enabled: boolean; allowPackages: boolean;
};
export type ImportLocalEntry =
  | { type: "directory"; path: string }
  | { type: "file"; path: string; base64: string; executable: boolean }
  | { type: "blocked"; path: string };
export type ImportInstalledEntry =
  | { state: "occupied"; name: string }
  | { state: "measured"; name: string; origin: ResolvedIdentity;
      content: { complete: true; entries: readonly ImportLocalEntry[] } };
export type ImportInput = {
  root: ResolveInput["roots"][number];
  sources: readonly ImportSource[];
  catalogs: readonly CatalogSnapshot[];
  packages: readonly SuppliedPackage[];
  target: ResolveInput["target"];
  installed: { complete: true; entries: readonly ImportInstalledEntry[] };
  knownReleases: readonly ResolvedIdentity[];
};
export type ImportIssue = {
  code: ContractIssue["code"] | "INVALID_IMPORT_INPUT" | "INSTALLED_EVIDENCE_REQUIRED";
  at: "$" | "root" | "sources" | "catalogs" | "packages" | "target" | "installed" | "knownReleases" | "review";
};
export type ImportResult<T> = { ok: true; value: T } | { ok: false; issues: ImportIssue[] };
export type ImportReviewFile = InspectedFile & { encoding: "utf8" | "binary" };
export type ImportReviewPackage = {
  identity: ResolvedIdentity; snapshot: PackageSnapshot; action: "include" | "reuse";
  dependencies: readonly ResolvedIdentity[];
  files: readonly ImportReviewFile[];
  manifestBytes: "normalized-package-manifest" | "current-installed-manifest";
};
export type ImportPreview = {
  kind: "offline-import-preview";
  root: ResolvedIdentity;
  preconditions: Pick<ImportInput, "root" | "sources" | "catalogs" | "target" | "installed" | "knownReleases">;
  packages: readonly ImportReviewPackage[];
  reviewRequired: true;
  authority: "none";
};

// Private module types/functions; never root-export these.
export type ValidatedImport = {
  input: ImportInput; // canonical, detached, deeply frozen; supplied previews regenerated
  installedSkills: readonly InstalledSkill[]; // only actual successfully inspected local bytes
  blockedNames: readonly string[]; // folded occupied or non-equivalent/uninspectable local names
  installedFiles: readonly { name: string; files: readonly ImportReviewFile[] }[];
};
