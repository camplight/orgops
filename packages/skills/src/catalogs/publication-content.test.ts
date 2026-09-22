import { describe, it, expect } from "vitest";
import { validatePublicationCandidate, publicationBytes } from "./publication-content";
import { publicationInput, bytes } from "./publication-fixtures";
describe("validatePublicationCandidate", () => {
    it("rejects forged extra proposedFiles, even with a valid snapshot", () => {
        const c = structuredClone(publicationInput().selections[0]!.candidate);
        c.proposedFiles = [...c.proposedFiles, { path: ".env", base64: bytes("not-a-real-secret"), executable: false }];
        expect(validatePublicationCandidate(c).ok).toBe(false);
    });
    it("re-exports a detached allowed candidate", () => {
        const c = publicationInput().selections[0]!.candidate, r = validatePublicationCandidate(c);
        expect(r).toEqual({ ok: true, value: c });
        if (!r.ok)
            return;
        expect(r.value).not.toBe(c);
        expect(Object.isFrozen(r.value.snapshot.files)).toBe(true);
        expect(Object.isFrozen(c)).toBe(false);
    });
});
describe("publicationBytes", () => {
    it("measures exact bytes and accepts the chosen boundary", () => {
        expect(publicationBytes("YQ==", true, 1)).toEqual({ ok: true, value: { base64: "YQ==", executable: true, size: 1, digest: "sha256:ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb" } });
        expect(publicationBytes("YWI=", false, 1).ok).toBe(false);
    });
    it.each(["YQ", "YR==", "YQ==\n", "!!!!"])("rejects noncanonical base64 %s", value => {
        expect(publicationBytes(value, false, 64).ok).toBe(false);
    });
});
import { vi } from "vitest";
import * as content from "./content";
import * as exporters from "./export";
import { classicManifest, rlmManifest, wrappedManifest, must, skillEntries } from "./fixtures";
import { PUBLICATION_LIMITS } from "./publication-types";
import { preflightPublicationBytes } from "./publication-content";
it.each([classicManifest, rlmManifest, wrappedManifest])("reconstructs the $name portable exporter subset", manifest => {
    const m = structuredClone(manifest);
    const metadata = { formatVersion: m.formatVersion, name: m.name, version: m.version, description: m.description, author: m.author, license: m.license, compatibility: m.compatibility, secrets: m.secrets };
    const raw = m.kind === "native-agent" ? { mode: m.native.mode, systemInstructions: m.native.systemInstructions, ...(m.native.soulContents === undefined ? {} : { soulContents: m.native.soulContents }), ...m.native.runtime, enabledSkills: m.dependencies.map(d => d.name), alwaysPreloadedSkills: m.native.alwaysPreloadedSkills } : { mode: "WRAPPED", wrappedConfig: (({ resourceWiring: _, ...r }) => r)(m.wrapped) };
    const c = must(exporters.exportAgentPackage(raw, { metadata, dependencies: m.dependencies, ...(m.kind === "native-agent" && m.native.suggestedModel ? { suggestedModel: m.native.suggestedModel } : {}) }));
    expect(validatePublicationCandidate(c)).toEqual({ ok: true, value: c });
});
it.each(["size", "digest", "base64", "executable"])("rejects forged snapshot %s", field => {
    const c = publicationInput().selections[0]!.candidate;
    Object.assign(c.snapshot.files[0]!, { [field]: field === "size" ? 1 : field === "digest" ? `sha256:${"0".repeat(64)}` : field === "executable" ? true : bytes("different") });
    expect(validatePublicationCandidate(c).ok).toBe(false);
});
it("discards forged semantic execution and warnings instead of trusting them", () => {
    const c = publicationInput().selections[0]!.candidate;
    c.snapshot.execution.apiEventShapes = [];
    c.snapshot.warnings = [];
    const r = validatePublicationCandidate(c);
    expect(r.ok).toBe(true);
    if (!r.ok)
        return;
    expect(r.value.snapshot.execution.apiEventShapes).toEqual(["event-shapes.ts"]);
    expect(r.value.snapshot.warnings).toContainEqual({ code: "MANUAL_REVIEW_REQUIRED", at: "$" });
});
it.each(["extra", "missing", "changed", "mode", "duplicate"])("rejects %s proposed file forgery", kind => {
    const c = publicationInput().selections[0]!.candidate;
    if (kind === "missing")
        c.proposedFiles = c.proposedFiles.slice(1);
    else if (kind === "duplicate")
        c.proposedFiles = [...c.proposedFiles, c.proposedFiles[0]!];
    else if (kind === "extra")
        Object.assign(c.proposedFiles[0]!, { credential: "inert" });
    else
        Object.assign(c.proposedFiles[0]!, kind === "changed" ? { base64: bytes("different") } : { executable: true });
    expect(validatePublicationCandidate(c).ok).toBe(false);
});
it("permits proposed file order variation but preserves authored bytes", () => {
    const c = publicationInput().selections[0]!.candidate;
    c.proposedFiles = [...c.proposedFiles].reverse();
    const r = validatePublicationCandidate(c);
    expect(r.ok).toBe(true);
    if (!r.ok)
        return;
    expect(r.value.proposedFiles.map(f => f.path)).toEqual(["SKILL.md", "event-shapes.ts", "orgops-package.json"]);
});
it("rejects accessors without invoking them in direct candidate calls", () => {
    const c = publicationInput().selections[0]!.candidate;
    let reads = 0;
    Object.defineProperty(c, "snapshot", { enumerable: true, get() { reads++; throw new Error("private"); } });
    expect(validatePublicationCandidate(c).ok).toBe(false);
    expect(reads).toBe(0);
});
it.each(["env", "wiring"])("rejects unsupported wrapped %s without export passthrough", field => {
    const c = publicationInput().selections[0]!.candidate;
    const m = structuredClone(wrappedManifest);
    Object.assign(m.wrapped, field === "env" ? { env: { TOKEN: "synthetic" } } : { resourceWiring: "native" });
    c.snapshot.manifest = m;
    c.snapshot.files = [];
    expect(validatePublicationCandidate(c).ok).toBe(false);
});
it("rejects native auxiliary files even when they are valid inspected package content", () => {
    const m = structuredClone(classicManifest), entries = skillEntries.filter(e => e.path === "SKILL.md");
    m.files = [structuredClone(publicationInput().selections[0]!.candidate.snapshot.files[0]!)].map(({ path, size, digest, executable }) => ({ path, size, digest, executable }));
    m.digest = must(content.computePackageDigest(m, entries));
    const c = publicationInput().selections[0]!.candidate;
    c.snapshot = must(content.inspectPackage(m, entries));
    expect(validatePublicationCandidate(c).ok).toBe(false);
});
it("rejects selected credential files despite valid manifest and snapshot digests", () => {
    const c = publicationInput().selections[0]!.candidate, m = structuredClone(c.snapshot.manifest);
    const f = { path: ".env", base64: bytes("synthetic-only"), executable: false, size: 14, digest: "sha256:ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb" };
    const measured = publicationBytes(f.base64, false, 1024);
    expect(measured.ok).toBe(true);
    if (!measured.ok)
        return;
    Object.assign(f, measured.value);
    m.files.push({ path: f.path, size: f.size, digest: f.digest, executable: false });
    const entries = [...skillEntries, { type: "file" as const, path: f.path, base64: f.base64, executable: false }];
    m.digest = must(content.computePackageDigest(m, entries));
    c.snapshot = must(content.inspectPackage(m, entries));
    expect(validatePublicationCandidate(c).ok).toBe(false);
});
it("preflights all proposed bytes before inspection or export", () => {
    const c = publicationInput().selections[0]!.candidate;
    c.proposedFiles = [...c.proposedFiles, { path: "extra", base64: "A".repeat(1398105), executable: false }];
    const inspect = vi.spyOn(content, "inspectPackage"), exported = vi.spyOn(exporters, "exportSkillPackage");
    try {
        expect(validatePublicationCandidate(c)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "candidate" }] });
        expect(inspect).not.toHaveBeenCalled();
        expect(exported).not.toHaveBeenCalled();
    }
    finally {
        vi.restoreAllMocks();
    }
});
it.each(["files", "bytes"] as const)("honors aggregate %s boundary and +1 before decode", field => {
    const budget = { files: 0, bytes: 0 };
    budget[field] = (field === "files" ? PUBLICATION_LIMITS.aggregateFiles : PUBLICATION_LIMITS.decodedBytes) - 1;
    expect(preflightPublicationBytes("YQ==", 1, budget, "candidate").ok).toBe(true);
    expect(preflightPublicationBytes("YQ==", 1, budget, "candidate")).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "candidate" }] });
});
it.each([NaN, -1, 2097153])("rejects invalid internal byte budget %s", max => expect(publicationBytes("", false, max).ok).toBe(false));
it("accepts empty bytes with a zero budget", () => expect(publicationBytes("", false, 0).ok).toBe(true));
it("redacts non-string warning codes without invoking object conversion", () => {
    const c = publicationInput().selections[0]!.candidate;
    Object.assign(c.snapshot.warnings[0]!, { code: { toString: null } });
    expect(() => validatePublicationCandidate(c)).not.toThrow();
    expect(validatePublicationCandidate(c).ok).toBe(false);
});
