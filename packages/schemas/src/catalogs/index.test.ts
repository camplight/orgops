import { expect, it } from "vitest";
import { RelativePathSchema, VersionSchema, CommitSchema, DigestSchema } from "./primitives";
import { CatalogIndexSchema, ResolvedIdentitySchema, parseCatalogIndex, validateCatalogIndex } from "./index";
import { DependencyPinSchema } from "./manifest";
const digest = `sha256:${"0".repeat(64)}`;
const commit = "1".repeat(40);
const entry = { kind: "skill", name: "echo-skill", version: "1.0.0", digest, location: { type: "catalog", path: "packages/echo-skill", revision: { type: "catalog-revision" } } };
it.each(["../x", "/x", "C:/x", "a\\b", "a//b", "a/./b", "a/%2e/b", "a/CON.txt", "a/.git/x", "a/node_modules/x", "a.", "a/", "a/..", "a/.orgops-data/x", "a/NuL", "a/COM9.ext", "a/LPT1", "a ", "é", "x".repeat(65), ["x".repeat(60), "x".repeat(60), "x".repeat(60), "x".repeat(60)].join("/")])("rejects unsafe portable path %s", path => expect(RelativePathSchema.safeParse(path).success).toBe(false));
it.each(["SKILL.md", "a/.hidden", "packages/a-1.0", "a/COM10", "a/orgops-package.json"])("accepts safe path %s", path => expect(RelativePathSchema.safeParse(path).success).toBe(true));
it.each(["v1.0.0", "1.0", "01.0.0", "1.0.0-beta", "1.0.0+build", "^1.0.0", "1000000.0.0", "main"])("rejects nonexact version %s", version => expect(VersionSchema.safeParse(version).success).toBe(false));
it("accepts numeric version endpoints and exact lowercase pins only", () => {
  for (const v of ["0.0.0", "999999.999999.999999"]) expect(VersionSchema.safeParse(v).success).toBe(true);
  for (const c of [commit, "a".repeat(64)]) expect(CommitSchema.safeParse(c).success).toBe(true);
  for (const c of ["A".repeat(40), "a".repeat(39), "main"]) expect(CommitSchema.safeParse(c).success).toBe(false);
  expect(DigestSchema.safeParse(digest).success).toBe(true);
  expect(DigestSchema.safeParse(`sha256:${"A".repeat(64)}`).success).toBe(false);
});
it("accepts contextual, historical and external locations without mutation", () => {
  for (const location of [entry.location, { type: "catalog", path: "pkg", revision: { type: "exact", commit } }, { type: "source", sourceId: "other-source", commit, path: "pkg" }]) {
    const input = { formatVersion: 1, entries: [{ ...entry, location }] };
    const before = structuredClone(input);
    expect(validateCatalogIndex(input)).toEqual({ ok: true, value: input });
    expect(input).toEqual(before);
  }
});
it("rejects duplicate release and location identities", () => {
  for (const second of [entry, { ...entry, kind: "native-agent" }, { ...entry, version: "2.0.0" }]) {
    expect(CatalogIndexSchema.safeParse({ formatVersion: 1, entries: [entry, second] }).success).toBe(false);
  }
  expect(CatalogIndexSchema.safeParse({ formatVersion: 1, entries: [entry, { ...entry, version: "2.0.0", location: { ...entry.location, revision: { type: "exact", commit } } }] }).success).toBe(true);
});
it.each([
  { type: "catalog", path: "pkg" }, { type: "catalog", path: "pkg", commit },
  { type: "catalog", path: "pkg", revision: { type: "catalog-revision", commit } },
  { type: "source", url: "https://example.invalid/repo", path: "pkg" },
  { type: "source", sourceId: "other", commit: "main", path: "pkg" },
  { type: "catalog", path: ".", revision: { type: "catalog-revision" } },
])("rejects unpinned or implicit-source location %#", location => expect(CatalogIndexSchema.safeParse({ formatVersion: 1, entries: [{ ...entry, location }] }).success).toBe(false));
it("rejects unknown publisher fields, entry fields, future format and oversized lists", () => {
  for (const input of [{ formatVersion: 2, entries: [] }, { formatVersion: 1, entries: [], catalogId: "self" }, { formatVersion: 1, entries: [{ ...entry, author: "hidden" }] }, { formatVersion: 1, entries: Array(4097).fill(entry) }]) expect(validateCatalogIndex(input).ok).toBe(false);
});
it("accepts both dependency revisions but no branch, source URL or extra revision keys", () => {
  const pin = { catalogId: "team", sourceId: "team-source", name: "echo-skill", version: "1.0.0", digest };
  for (const revision of [{ type: "exact", commit }, { type: "same-package-revision" }]) expect(DependencyPinSchema.safeParse({ ...pin, revision }).success).toBe(true);
  for (const revision of [{ type: "exact", commit: "main" }, { type: "same-package-revision", commit }, { type: "branch", ref: "main" }]) expect(DependencyPinSchema.safeParse({ ...pin, revision }).success).toBe(false);
  expect(DependencyPinSchema.safeParse({ ...pin, sourceUrl: "hidden", revision: { type: "exact", commit } }).success).toBe(false);
});
it("requires fully expanded resolved identity", () => {
  const identity = { catalogId: "team", catalogCommit: commit, sourceId: "source", packageCommit: commit, path: "pkg", kind: "skill", name: "echo-skill", version: "1.0.0", digest };
  expect(ResolvedIdentitySchema.safeParse(identity).success).toBe(true);
  expect(ResolvedIdentitySchema.safeParse({ ...identity, packageCommit: "catalog-revision" }).success).toBe(false);
  expect(ResolvedIdentitySchema.safeParse({ ...identity, url: "hidden" }).success).toBe(false);
});
it("enforces index raw byte boundary and returns only sanitized issues", () => {
  const json = JSON.stringify({ formatVersion: 1, entries: [entry] });
  expect(parseCatalogIndex(json.padEnd(2097152)).ok).toBe(true);
  expect(parseCatalogIndex(json.padEnd(2097153))).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "$" }] });
  expect(parseCatalogIndex("hidden")).toEqual({ ok: false, issues: [{ code: "INVALID_JSON", at: "$" }] });
  expect(validateCatalogIndex({ credential: "hidden" })).toEqual({ ok: false, issues: [{ code: "INVALID_INDEX", at: "$" }] });
});
it("rejects final newlines rather than accepting regex end-of-line matches", () => {
  for (const [schema, value] of [[VersionSchema, "1.0.0\n"], [CommitSchema, `${commit}\n`], [DigestSchema, `${digest}\n`], [RelativePathSchema, "a\n"]] as const) expect(schema.safeParse(value).success).toBe(false);
  expect(validateCatalogIndex({ formatVersion: 1, entries: [{ ...entry, name: "echo-skill\n" }] }).ok).toBe(false);
  expect(DependencyPinSchema.safeParse({ catalogId: "team\n", sourceId: "source", name: "skill", version: "1.0.0", digest, revision: { type: "exact", commit } }).success).toBe(false);
});
