import { afterEach, expect, it, vi } from "vitest";
import childProcess from "node:child_process";
import http from "node:http";
import https from "node:https";
import nodeFs from "node:fs";
import * as fsPromises from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedIdentity } from "@orgops/schemas";
import * as publicSkills from "../index";
import { computePackageDigest, type ContentEntry } from "./content";
import { createLocalSkillFixture, type LocalSkillFixture } from "./local-skill-fixtures";
import { must, skillManifest } from "./fixtures";
import { importInput, measuredSkill } from "./import-fixtures";
import { OFFLINE_LOCAL_SKILL_LIMITS } from "./local-skill-evidence-types";
import {
  prepareImport, readLocalSkillEvidence,
  type ImportInstalledEntry, type ImportInput, type ImportLocalEntry,
} from "../index";

// Same passthrough mock as the collector suite: production fs/promises imports stay
// interceptable so read-spy and open/opendir flag-observation assertions are meaningful.
vi.mock("node:fs/promises", async original => ({ ...await original<typeof import("node:fs/promises")>() }));
const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
type FileHandle = import("node:fs/promises").FileHandle;
afterEach(() => { vi.restoreAllMocks(); });

type EvidenceValue = Extract<Awaited<ReturnType<typeof readLocalSkillEvidence>>, { ok: true }>["value"];
/** Separately recorded synthetic original identity, retained before any acquisition. */
type Retained = { origin: ResolvedIdentity; manifest: Buffer };

const measuredFile = (path: string): { bytes: Buffer; executable: boolean } => {
  const local = measuredSkill();
  if (local.state !== "measured") throw new Error("Synthetic fixture kind");
  const entry = local.content.entries.find(e => e.path === path);
  if (!entry || entry.type !== "file") throw new Error("Synthetic fixture file");
  return { bytes: Buffer.from(entry.base64, "base64"), executable: entry.executable };
};
const syntheticOrigin = (): ResolvedIdentity => {
  const local = measuredSkill();
  if (local.state !== "measured") throw new Error("Synthetic fixture kind");
  return structuredClone(local.origin);
};
/** Lexically altered (whitespace/CRLF-wrapped) but semantically unchanged manifest bytes. */
const lexicalManifest = (): Buffer =>
  Buffer.from(" \r\n" + measuredFile("orgops-package.json").bytes.toString("utf8") + "\r\n");
/** A validly resealed local edit: changed metadata, recomputed digest, same file set. */
const resealedManifest = (): Buffer => {
  const m = structuredClone(skillManifest);
  m.author = "Local edit.";
  const entries: ContentEntry[] = (["SKILL.md", "event-shapes.ts"] as const).map(path => {
    const { bytes, executable } = measuredFile(path);
    return { type: "file", path, base64: bytes.toString("base64"), executable };
  });
  m.digest = must(computePackageDigest(m, entries));
  return Buffer.from(JSON.stringify(m, null, 2) + "\n");
};

/** Writes the synthetic measured skill tree. Fixture construction only, never installation. */
async function writeSkillTree(f: LocalSkillFixture, manifest: Buffer | null, dir = "echo-skill"): Promise<Retained> {
  const originFixture = measuredSkill();
  if (originFixture.state !== "measured") throw new Error("Synthetic origin required");
  const origin = structuredClone(originFixture.origin);
  for (const entry of originFixture.content.entries) {
    if (entry.type !== "file") throw new Error("Synthetic ordinary fixture expected");
    if (entry.path === "orgops-package.json") {
      if (manifest !== null) await f.file(`${dir}/orgops-package.json`, manifest, entry.executable);
      continue;
    }
    await f.file(`${dir}/${entry.path}`, Buffer.from(entry.base64, "base64"), entry.executable);
  }
  return { origin, manifest: manifest ?? Buffer.alloc(0) };
}
const writeMeasuredSkill = (f: LocalSkillFixture): Promise<Retained> => writeSkillTree(f, lexicalManifest());

/** Caller-owned mapping of neutral namespace evidence into ImportInstalledEntry values. */
function mapSelectedMeasured(value: EvidenceValue, selected: string, origin: ResolvedIdentity): ImportInstalledEntry[] {
  return value.namespace.entries.map(n => {
    const tree = value.subtrees.find(t => t.name === n.name);
    return n.name === selected && n.type === "directory" && tree
      ? { state: "measured" as const, name: n.name, origin,
          content: { complete: true as const, entries: tree.entries } }
      : { state: "occupied" as const, name: n.name };
  });
}
const mapAllOccupied = (value: EvidenceValue): ImportInstalledEntry[] =>
  value.namespace.entries.map(n => ({ state: "occupied" as const, name: n.name }));
const withInstalled = (input: ImportInput, entries: readonly ImportInstalledEntry[]): ImportInput =>
  ({ ...input, installed: { complete: true, entries } });

it("exposes only the offline local skill evidence API additions", () => {
  expect(publicSkills.readLocalSkillEvidence).toBeTypeOf("function");
  expect(Object.isFrozen(publicSkills.OFFLINE_LOCAL_SKILL_LIMITS)).toBe(true);
  expect(publicSkills.OFFLINE_LOCAL_SKILL_LIMITS).toBe(OFFLINE_LOCAL_SKILL_LIMITS);
  expect(publicSkills.OFFLINE_LOCAL_SKILL_LIMITS.operationMs).toBe(10000);
  // Private owner, reader/record seam and test fixture factory are not root exports.
  for (const name of ["withLocalSkillRoot", "LocalSkillRootReader", "createLocalSkillFixture"])
    expect(publicSkills).not.toHaveProperty(name);
});

it("public local evidence composes with independently recorded fixture origin", async () => {
  const f = await createLocalSkillFixture();
  try {
    const originFixture = measuredSkill();
    if (originFixture.state !== "measured") throw new Error("Synthetic origin required");
    const retainedOrigin = structuredClone(originFixture.origin);
    let lexical = "";
    for (const entry of originFixture.content.entries) {
      if (entry.type !== "file") throw new Error("Synthetic ordinary fixture expected");
      const bytes = entry.path === "orgops-package.json"
        ? Buffer.from(" \r\n" + Buffer.from(entry.base64, "base64").toString("utf8") + "\r\n")
        : Buffer.from(entry.base64, "base64");
      if (entry.path === "orgops-package.json") lexical = bytes.toString("base64");
      await f.file(`echo-skill/${entry.path}`, bytes, entry.executable);
    }
    await f.file("unmanaged/SKILL.md", Buffer.from("invalid unmanaged instructions"));
    await f.file("not-a-skill", Buffer.from("occupancy only"));
    const evidence = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["echo-skill"] });
    expect(evidence.ok).toBe(true); if (!evidence.ok) throw new Error("Synthetic observation failed");
    const entries: ImportInstalledEntry[] = evidence.value.namespace.entries.map(n => {
      const tree = evidence.value.subtrees.find(t => t.name === n.name);
      return n.name === "echo-skill" && n.type === "directory" && tree
        ? { state: "measured", name: n.name, origin: retainedOrigin, content: { complete: true, entries: tree.entries } }
        : { state: "occupied", name: n.name };
    });
    const input = importInput();
    input.installed = { complete: true, entries }; // Fixture declares ONE relevant root, independently of adapter.
    const result = prepareImport(input);
    expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic preview failed");
    const skill = result.value.packages.find(p => p.identity.name === "echo-skill")!;
    expect(skill.action).toBe("reuse");
    expect(skill.manifestBytes).toBe("current-installed-manifest");
    expect(skill.files.find(p => p.path === "orgops-package.json")!.base64).toBe(lexical);
    expect(result.value.authority).toBe("none"); expect(result.value.reviewRequired).toBe(true);
    expect(Object.keys(evidence.value).sort()).toEqual(["namespace", "nominatedNames", "subtrees"]);
    // Throwing event-shapes.ts fixture was read as bytes, never evaluated.
  } finally { await f.dispose(); }
});

// Supplemental composition matrix (the collector/owner behavior already exists): every
// case proves the UNCHANGED pure consumer decision, never a new adapter semantic.
type MatrixCase = {
  name: string;
  nominations: readonly string[];
  setup: (f: LocalSkillFixture) => Promise<Retained>;
  map: (value: EvidenceValue, retained: Retained) => ImportInstalledEntry[];
};
const measuredMap = (value: EvidenceValue, retained: Retained): ImportInstalledEntry[] =>
  mapSelectedMeasured(value, "echo-skill", retained.origin);
const occupiedMap = (value: EvidenceValue): ImportInstalledEntry[] => mapAllOccupied(value);
const matrix: MatrixCase[] = [
  { name: "edited SKILL.md bytes with retained origin", nominations: ["echo-skill"],
    setup: async f => { const r = await writeMeasuredSkill(f);
      await f.file("echo-skill/SKILL.md", Buffer.from("locally edited instructions")); return r; },
    map: measuredMap },
  { name: "executable-bit change on SKILL.md", nominations: ["echo-skill"],
    setup: async f => { const r = await writeMeasuredSkill(f);
      const { bytes } = measuredFile("SKILL.md"); await f.file("echo-skill/SKILL.md", bytes, true); return r; },
    map: measuredMap },
  { name: "resealed manifest metadata retaining original origin", nominations: ["echo-skill"],
    setup: async f => { const r = await writeMeasuredSkill(f);
      await f.file("echo-skill/orgops-package.json", resealedManifest()); return r; },
    map: measuredMap },
  { name: "missing root manifest", nominations: ["echo-skill"],
    setup: f => writeSkillTree(f, null), map: measuredMap },
  { name: "empty root manifest", nominations: ["echo-skill"],
    setup: f => writeSkillTree(f, Buffer.alloc(0)), map: measuredMap },
  { name: "BOM root manifest", nominations: ["echo-skill"],
    setup: f => writeSkillTree(f, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), lexicalManifest()])), map: measuredMap },
  { name: "binary root manifest", nominations: ["echo-skill"],
    setup: f => writeSkillTree(f, Buffer.from([0xff, 0x00, 0x01])), map: measuredMap },
  { name: "malformed root manifest", nominations: ["echo-skill"],
    setup: f => writeSkillTree(f, Buffer.from("{ not json")), map: measuredMap },
  { name: "executable root manifest", nominations: ["echo-skill"],
    setup: async f => { const r = await writeMeasuredSkill(f);
      await f.file("echo-skill/orgops-package.json", lexicalManifest(), true); return r; },
    map: measuredMap },
  { name: "extra empty directory in the selected tree", nominations: ["echo-skill"],
    setup: async f => { const r = await writeMeasuredSkill(f); await f.directoryAt("echo-skill/extra"); return r; },
    map: measuredMap },
  { name: "known blocked symlink leaf in the selected tree", nominations: ["echo-skill"],
    setup: async f => { const r = await writeMeasuredSkill(f);
      await f.linkAt("echo-skill/link", "echo-skill/SKILL.md"); return r; },
    map: measuredMap },
  { name: "extra ordinary file in the selected tree", nominations: ["echo-skill"],
    setup: async f => { const r = await writeMeasuredSkill(f);
      await f.file("echo-skill/extra.txt", Buffer.from("undeclared local file")); return r; },
    map: measuredMap },
  { name: "matching bytes without an independently recorded origin", nominations: ["echo-skill"],
    setup: f => writeMeasuredSkill(f), map: occupiedMap },
  { name: "selected name occupied by an ordinary file", nominations: ["echo-skill"],
    setup: async f => { await f.file("echo-skill", Buffer.from("occupancy only"));
      return { origin: syntheticOrigin(), manifest: Buffer.alloc(0) }; },
    map: occupiedMap },
  { name: "unmanaged selected directory without a manifest", nominations: ["echo-skill"],
    setup: async f => { await f.file("echo-skill/SKILL.md", Buffer.from("invalid unmanaged instructions"));
      return { origin: syntheticOrigin(), manifest: Buffer.alloc(0) }; },
    map: measuredMap },
  { name: "uppercase occupied alias of the selected name", nominations: ["Echo-Skill"],
    setup: f => writeSkillTree(f, lexicalManifest(), "Echo-Skill"), map: occupiedMap },
];
it.each(matrix.map(c => [c.name, c] as const))("supplemental composition: %s conflicts without overwrite", async (_name, case_) => {
  const f = await createLocalSkillFixture();
  try {
    const retained = await case_.setup(f);
    const evidence = await readLocalSkillEvidence({ directory: f.root, nominatedNames: case_.nominations });
    expect(evidence.ok).toBe(true); if (!evidence.ok) throw new Error("Structural observation must succeed");
    const input = withInstalled(importInput(), case_.map(evidence.value, retained));
    expect(prepareImport(input)).toEqual({ ok: false, issues: [{ code: "SKILL_CONFLICT", at: "installed" }] });
  } finally { await f.dispose(); }
});

it("supplemental composition: unrelated occupancy never blocks a valid closure", async () => {
  const f = await createLocalSkillFixture();
  try {
    const retained = await writeMeasuredSkill(f);
    await f.file("legacy/SKILL.md", Buffer.from("no frontmatter at all"));
    await f.file("notes.txt", Buffer.from("occupancy only"));
    await f.directoryAt("broken");
    const evidence = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["echo-skill"] });
    expect(evidence.ok).toBe(true); if (!evidence.ok) throw new Error("Synthetic observation failed");
    const result = prepareImport(withInstalled(importInput(), mapSelectedMeasured(evidence.value, "echo-skill", retained.origin)));
    expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic preview failed");
    expect(result.value.packages.map(p => [p.identity.name, p.action]))
      .toEqual([["echo-skill", "reuse"], ["echo-agent", "include"]]);
  } finally { await f.dispose(); }
});

it.each(["omitted", "incomplete-false"] as const)(
  "supplemental composition: unknown second root forbids claiming all-location completeness (%s)", async (variant) => {
    const f = await createLocalSkillFixture();
    try {
      await f.file("unrelated", Buffer.from("occupancy only"));
      const evidence = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["echo-skill"] });
      expect(evidence.ok).toBe(true); if (!evidence.ok) throw new Error("Synthetic observation failed");
      // Absence of echo-skill is bound to THIS root only; a second required root is unknown,
      // so the caller must not assert installed.complete over all locations.
      const claimed = withInstalled(importInput(), mapAllOccupied(evidence.value));
      const input: unknown = variant === "omitted"
        ? (() => { const copy: Record<string, unknown> = { ...claimed }; delete copy.installed; return copy; })()
        : { ...claimed, installed: { complete: false, entries: claimed.installed.entries } };
      expect(prepareImport(input as ImportInput))
        .toEqual({ ok: false, issues: [{ code: "INSTALLED_EVIDENCE_REQUIRED", at: "installed" }] });
    } finally { await f.dispose(); }
  });

it.each(["edited-copy", "unknown-origin"] as const)(
  "supplemental composition: two owned roots with one name reconcile to occupied, no merger helper (%s)", async (variant) => {
    const first = await createLocalSkillFixture();
    const second = await createLocalSkillFixture();
    try {
      await writeMeasuredSkill(first);
      await writeMeasuredSkill(second);
      const firstEvidence = await readLocalSkillEvidence({ directory: first.root, nominatedNames: ["echo-skill"] });
      expect(firstEvidence.ok).toBe(true); if (!firstEvidence.ok) throw new Error("First observation failed");
      if (variant === "edited-copy") {
        // Test-owned mutation between separate quiescent acquisitions, never concurrently.
        await second.file("echo-skill/SKILL.md", Buffer.from("divergent copy"));
      }
      const secondEvidence = await readLocalSkillEvidence({ directory: second.root, nominatedNames: ["echo-skill"] });
      expect(secondEvidence.ok).toBe(true); if (!secondEvidence.ok) throw new Error("Second observation failed");
      const fileOf = (value: EvidenceValue, path: string): ImportLocalEntry => {
        const tree = value.subtrees.find(t => t.name === "echo-skill");
        const entry = tree?.entries.find(e => e.path === path);
        if (!entry || entry.type !== "file") throw new Error("Synthetic tree file");
        return entry;
      };
      const a = fileOf(firstEvidence.value, "SKILL.md"), b = fileOf(secondEvidence.value, "SKILL.md");
      if (variant === "edited-copy") expect(b).not.toEqual(a);
      else expect(b).toEqual(a); // Equal bytes still do not certify an unrecorded origin.
      // No adapter-side all-host merger exists; reconciliation is caller-owned and maps occupied.
      expect(publicSkills).not.toHaveProperty("mergeLocalSkillEvidence");
      expect(prepareImport(withInstalled(importInput(), [{ state: "occupied", name: "echo-skill" }])))
        .toEqual({ ok: false, issues: [{ code: "SKILL_CONFLICT", at: "installed" }] });
    } finally { await first.dispose(); await second.dispose(); }
  });

it("supplemental composition: lexical whitespace, key order and duplicate keys reuse with exact bytes retained", async () => {
  const f = await createLocalSkillFixture();
  try {
    // Same semantic content, different lexical form: reversed key order, four-space indent,
    // CRLF and a duplicate "secrets" key (standard JSON last-key semantics keep it equal).
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(skillManifest).reverse()) reordered[key] = (skillManifest as Record<string, unknown>)[key];
    let text = JSON.stringify(reordered, null, 4) + "\r\n";
    text = text.replace('"secrets": [],', '"secrets": [],\n    "secrets": [],');
    const bytes = Buffer.from(text, "utf8");
    const retained = await writeSkillTree(f, bytes);
    const evidence = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["echo-skill"] });
    expect(evidence.ok).toBe(true); if (!evidence.ok) throw new Error("Synthetic observation failed");
    const result = prepareImport(withInstalled(importInput(), mapSelectedMeasured(evidence.value, "echo-skill", retained.origin)));
    expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic preview failed");
    const skill = result.value.packages.find(p => p.identity.name === "echo-skill")!;
    expect(skill.action).toBe("reuse");
    expect(skill.identity.digest).toBe(skillManifest.digest); // semantic equivalence, no normalization
    expect(skill.manifestBytes).toBe("current-installed-manifest");
    expect(skill.files.find(p => p.path === "orgops-package.json")!.base64).toBe(bytes.toString("base64"));
  } finally { await f.dispose(); }
});

/** Read-only snapshot of the owned fixture tree: names/types/content/modes/identity, atime excluded. */
async function snapshotTree(root: string, relative = ""): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const entry of await fsPromises.readdir(join(root, relative), { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    const stat = await fsPromises.lstat(join(root, rel), { bigint: true });
    const record: Record<string, unknown> = {
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      size: stat.size, mode: stat.mode, dev: stat.dev, ino: stat.ino,
      mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs,
    };
    if (entry.isFile()) record.content = (await fsPromises.readFile(join(root, rel))).toString("base64");
    out[rel] = record;
    if (entry.isDirectory()) Object.assign(out, await snapshotTree(root, rel));
  }
  return out;
}

it("supplemental no-effect: public acquisition is read-only with no host effect beyond owned reads", async () => {
  const f = await createLocalSkillFixture();
  try {
    // Includes the authored marker-producing event-shapes.ts module text, read as bytes only.
    const retained = await writeMeasuredSkill(f);
    await f.file("unmanaged/SKILL.md", Buffer.from("invalid unmanaged instructions"));
    await f.file("not-a-skill", Buffer.from("occupancy only"));
    // Node exports no runtime FileHandle binding: resolve the class from an owned probe handle.
    const probe = await actual.open(join(f.root, "not-a-skill"), nodeFs.constants.O_RDONLY);
    const HandleClass = probe.constructor as unknown as { prototype: FileHandle };
    await probe.close();
    const before = await snapshotTree(f.root);
    const forbidden = (): never => { throw new Error("Unexpected host effect"); };
    const mutations = [
      ...(["writeFile", "appendFile", "mkdir", "rm", "unlink", "rename", "chmod", "chown", "truncate", "copyFile"] as const)
        .map(k => vi.spyOn(fsPromises, k).mockImplementation(forbidden)),
      ...(["writeFileSync", "appendFileSync", "mkdirSync", "rmSync", "unlinkSync", "renameSync", "chmodSync", "chownSync", "truncateSync"] as const)
        .map(k => vi.spyOn(nodeFs, k).mockImplementation(forbidden)),
      ...(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"] as const)
        .map(k => vi.spyOn(childProcess, k).mockImplementation(forbidden)),
      vi.spyOn(globalThis, "fetch").mockImplementation(forbidden),
      vi.spyOn(http, "request").mockImplementation(forbidden), vi.spyOn(http, "get").mockImplementation(forbidden),
      vi.spyOn(https, "request").mockImplementation(forbidden), vi.spyOn(https, "get").mockImplementation(forbidden),
      ...(["log", "warn", "error", "info", "debug", "trace"] as const).map(k => vi.spyOn(console, k).mockImplementation(forbidden)),
      ...(["resolveSkillRoot", "listSkills", "loadSkillMeta", "loadSkillEventShapes"] as const)
        .map(k => vi.spyOn(publicSkills, k).mockImplementation(forbidden)),
    ];
    // Observation-only spies on the allowed acquisition calls and their exact planned flags.
    // Node defines close() per handle instance (no prototype binding), so each opened
    // handle's close is wrapped to count awaited cleanup attempts.
    let closes = 0;
    const opens = vi.spyOn(fsPromises, "open").mockImplementation(async (path, flags, mode) => {
      const handle = await actual.open(path, flags, mode);
      const closeHandle = handle.close.bind(handle);
      handle.close = async () => { closes++; return closeHandle(); };
      return handle;
    });
    const opendirs = vi.spyOn(fsPromises, "opendir");
    const handleStats = vi.spyOn(HandleClass.prototype, "stat");
    const handleReads = vi.spyOn(HandleClass.prototype, "read");
    const evidence = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["echo-skill"] });
    expect(evidence.ok).toBe(true); if (!evidence.ok) throw new Error("Synthetic observation failed");
    for (const spy of mutations) expect(spy).not.toHaveBeenCalled();
    const flags = nodeFs.constants;
    const allowedOpen = flags.O_RDONLY | flags.O_NOFOLLOW | flags.O_NONBLOCK | flags.O_DIRECTORY;
    for (const [, openFlags] of opens.mock.calls) {
      expect(typeof openFlags === "number" && (openFlags & ~allowedOpen) === 0).toBe(true);
    }
    for (const [, options] of opendirs.mock.calls) {
      expect(options).toEqual({ encoding: "latin1", bufferSize: 1, recursive: false });
    }
    for (const [options] of handleStats.mock.calls) expect(options).toEqual({ bigint: true });
    // FileHandle.read's last typed overload is options-object; the adapter uses the
    // positional (buffer, offset, length, position) form, so cast the observed calls.
    const reads = handleReads.mock.calls as unknown as Array<[unknown, unknown, number, unknown]>;
    for (const call of reads) {
      expect(call[2]).toBeLessThanOrEqual(OFFLINE_LOCAL_SKILL_LIMITS.chunkBytes);
    }
    expect(opens.mock.calls.length).toBeGreaterThan(0);
    expect(closes).toBe(opens.mock.calls.length); // every opened handle was closed
    // The marker-producing event module was read as exact bytes and never evaluated.
    const tree = evidence.value.subtrees.find(t => t.name === "echo-skill");
    const module = tree?.entries.find(e => e.path === "event-shapes.ts");
    if (!module || module.type !== "file") throw new Error("Synthetic module entry");
    expect(module.base64).toBe(measuredFile("event-shapes.ts").bytes.toString("base64"));
    expect(Buffer.from(module.base64, "base64").toString("utf8"))
      .toContain('throw new Error("catalog inspection executed")');
    // No work after public settlement, even after one extra macrotask.
    const settled = { opens: opens.mock.calls.length, opendirs: opendirs.mock.calls.length,
      stats: handleStats.mock.calls.length, reads: reads.length, closes };
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(opens.mock.calls.length).toBe(settled.opens);
    expect(opendirs.mock.calls.length).toBe(settled.opendirs);
    expect(handleStats.mock.calls.length).toBe(settled.stats);
    expect(reads.length).toBe(settled.reads);
    expect(closes).toBe(settled.closes);
    // Failures carry only a fixed code/pointer: no host path, authored bytes or exception text.
    const missing = await readLocalSkillEvidence({ directory: join(f.root, "does-not-exist"), nominatedNames: [] });
    expect(missing).toEqual({ ok: false, issues: [{ code: "LOCAL_IO_FAILED", at: "directory" }] });
    expect(JSON.stringify(missing)).not.toContain(f.root);
    expect(JSON.stringify(missing)).not.toContain("does-not-exist");
    vi.restoreAllMocks();
    // The synchronous pure consumer performs zero reads of its own (acquisition is not zero-read).
    const readForbidden = (): never => { throw new Error("Unexpected host read"); };
    const readSpies = [
      ...(["readFile", "lstat", "readdir", "opendir", "open"] as const).map(k => vi.spyOn(fsPromises, k).mockImplementation(readForbidden)),
      ...(["readFileSync", "readdirSync", "existsSync", "lstatSync"] as const).map(k => vi.spyOn(nodeFs, k).mockImplementation(readForbidden)),
    ];
    try {
      const input = withInstalled(importInput(), mapSelectedMeasured(evidence.value, "echo-skill", retained.origin));
      const result = prepareImport(input);
      expect(result).not.toBeInstanceOf(Promise);
      expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic preview failed");
      for (const spy of readSpies) expect(spy).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); }
    const after = await snapshotTree(f.root);
    expect(after).toEqual(before); // names/types/content/modes/identity unchanged, atime excluded
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});
