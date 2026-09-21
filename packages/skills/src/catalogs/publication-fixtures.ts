import { createHash } from "node:crypto";
import { exportAgentPackage, exportSkillPackage, type ExportCandidate } from "./export";
import type { DependencyPin, ResolvedIdentity } from "@orgops/schemas";
import type { PublicationComposition } from "./publication";
import type { PublicationResult, PublicationTreeEntry } from "./publication-types";
import { must, skillEntries, skillManifest } from "./fixtures";
import type { PublicationInput } from "./publication-types";
export const BASE = "1".repeat(40);
export const bytes = (text: string) => Buffer.from(text).toString("base64");
export const digest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
export function publicationInput(): PublicationInput {
    const m = skillManifest;
    const candidate = must(exportSkillPackage(skillEntries, {
        metadata: { formatVersion: 1, name: m.name, version: m.version,
            description: m.description, author: m.author, license: m.license,
            compatibility: structuredClone(m.compatibility), secrets: [] },
        dependencies: [], executables: structuredClone(m.executables),
        selectedPaths: ["SKILL.md", "event-shapes.ts"],
    }));
    const index = '{ "formatVersion": 1, "entries": [] }\n';
    const repository = { url: "https://example.invalid/team/catalog.git" };
    return structuredClone({
        base: { catalogId: "team", sourceId: "team-source", repository,
            enabled: true, commit: BASE, indexPath: "catalog/index.json", indexBase64: bytes(index),
            inventory: { complete: true, entries: [
                    { type: "directory", path: "catalog" },
                    { type: "file", path: "catalog/index.json", size: Buffer.byteLength(index),
                        digest: digest(index), executable: false },
                ] }, history: { complete: true, releases: [] } },
        selections: [{ destinationPath: "packages/echo-skill/1.0.0", candidate,
                intent: "new-release", origin: null }],
        sources: [{ sourceId: "team-source", repository, enabled: true, allowPackages: false }],
        catalogs: [], packages: [], knownReleases: [],
        target: { orgopsVersion: "0.0.1", platform: "linux", tools: ["node"] },
    });
}

export function publicationValue<T>(r: PublicationResult<T>): T {
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    return r.value;
}
export function publicationSkill(name = "echo-skill", version = "1.0.0", dependencies: DependencyPin[] = [], extraFiles: { path: string; base64: string; executable: boolean }[] = []): ExportCandidate {
    const m = skillManifest;
    const entries = [{ type: "file" as const, path: "SKILL.md", executable: false,
        base64: bytes(`---\nname: ${name}\ndescription: Echo instructions.\nlicense: MIT\n---\nReturn a short acknowledgement.\n`) },
        ...extraFiles.map(f => ({ type: "file" as const, ...f }))];
    return must(exportSkillPackage(entries, { metadata: { formatVersion: 1, name, version,
        description: m.description, author: m.author, license: m.license, compatibility: structuredClone(m.compatibility), secrets: [] },
        dependencies, executables: extraFiles.filter(f => f.executable).map(f => ({ path: f.path, execution: "runner-script" as const })),
        selectedPaths: entries.map(e => e.path) }));
}
export function publicationPin(candidate: ExportCandidate, revision: DependencyPin["revision"] = { type: "same-package-revision" }): DependencyPin {
    const m = candidate.snapshot.manifest;
    return { catalogId: "team", sourceId: "team-source", name: m.name, version: m.version, digest: m.digest, revision };
}
export function publicationNative(dependencies: DependencyPin[], mode: "CLASSIC" | "RLM_REPL" = "CLASSIC", prompt = "Inert instructions."): ExportCandidate {
    const m = skillManifest;
    return must(exportAgentPackage({ mode, systemInstructions: prompt, soulContents: "Inert soul.", enabledSkills: dependencies.map(d => d.name) }, {
        metadata: { formatVersion: 1, name: "echo-agent", version: "1.0.0", description: m.description,
            author: m.author, license: m.license, compatibility: structuredClone(m.compatibility), secrets: [] }, dependencies,
    }));
}
// Simulate a later trusted evidence acquisition entirely in memory. This does not
// grant publication authority or touch a repository; the commit is a fixture literal.
export function promotePublication(input: PublicationInput, composition: PublicationComposition, commit = "2".repeat(40)): PublicationInput {
    const v = structuredClone(input);
    const tree = new Map<string, PublicationTreeEntry>(v.base.inventory.entries.map(e => [e.path, e]));
    for (const c of composition.changes) {
        tree.set(c.path, { type: "file", path: c.path, size: c.after.size, digest: c.after.digest, executable: c.after.executable });
        const parts = c.path.split("/");
        for (let n = 1; n < parts.length; n++) { const path = parts.slice(0, n).join("/"); tree.set(path, { type: "directory", path }); }
        if (c.path === v.base.indexPath) v.base.indexBase64 = c.after.base64;
    }
    v.base.commit = commit;
    v.base.inventory.entries = [...tree.values()];
    const history = new Map(v.base.history.releases.map(i => [JSON.stringify([i.catalogId, i.name, i.version]), i]));
    const packages = new Map(v.packages.map(p => [JSON.stringify([p.sourceId, p.commit, p.path]), p]));
    for (const r of composition.releases) {
        const { catalogRevision, packageRevision, ...identity } = r.identity;
        const i: ResolvedIdentity = { ...identity, catalogCommit: catalogRevision.type === "proposal" ? commit : catalogRevision.commit,
            packageCommit: packageRevision.type === "proposal" ? commit : packageRevision.commit };
        if (i.catalogId === v.base.catalogId) history.set(JSON.stringify([i.catalogId, i.name, i.version]), i);
        packages.set(JSON.stringify([i.sourceId, i.packageCommit, i.path]), { sourceId: i.sourceId, commit: i.packageCommit, path: i.path, snapshot: structuredClone(r.snapshot) });
    }
    v.base.history.releases = [...history.values()];
    v.packages = [...packages.values()];
    return v;
}
