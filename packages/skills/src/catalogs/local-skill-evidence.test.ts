import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as nodeFs from "node:fs";
import type { BigIntStats } from "node:fs";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { createLocalSkillFixture } from "./local-skill-fixtures";
import { readLocalSkillEvidence } from "./local-skill-evidence";
import { type LocalSkillEvidenceIssue, type LocalSkillEvidenceResult } from "./local-skill-evidence-types";

vi.mock("node:fs/promises", async original => ({ ...await original<typeof import("node:fs/promises")>() }));
const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
type EvidenceTypesModule = typeof import("./local-skill-evidence-types");
/** Private limit double via vi.doMock: reduced ceilings only, never raised public limits. */
const reducedLimits = (fields: Partial<Record<keyof EvidenceTypesModule["OFFLINE_LOCAL_SKILL_LIMITS"], number>>) =>
  async (original: () => Promise<EvidenceTypesModule>) => {
    const actualTypes = await original();
    const limits = Object.freeze({ ...actualTypes.OFFLINE_LOCAL_SKILL_LIMITS, ...fields }) as unknown as EvidenceTypesModule["OFFLINE_LOCAL_SKILL_LIMITS"];
    return { ...actualTypes, OFFLINE_LOCAL_SKILL_LIMITS: limits };
  };
afterEach(() => { vi.restoreAllMocks(); });

const bad = (code: LocalSkillEvidenceIssue["code"], at: LocalSkillEvidenceIssue["at"]) =>
  ({ ok: false as const, issues: [{ code, at }] as const });
/** Genuine Stats copy with explicitly overridden scalar fields (private metadata double). */
function refield(stat: BigIntStats, fields: Partial<Record<"dev" | "ino" | "mode" | "nlink" | "size" | "mtimeNs" | "ctimeNs", bigint>>): BigIntStats {
  return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, fields);
}
const isDeeplyFrozen = (node: unknown): boolean => {
  if (node && typeof node === "object") {
    if (!Object.isFrozen(node)) return false;
    return Object.values(node).every(isDeeplyFrozen);
  }
  return true;
};
/** Body opens are open calls without O_DIRECTORY; directory verification opens are allowed. */
const bodyOpenPaths = (calls: readonly unknown[][]): string[] =>
  calls.filter(call => typeof call[1] === "number" && ((call[1] as number) & nodeFs.constants.O_DIRECTORY) === 0)
    .map(call => String(call[0]));
const rawChild = (parent: string, bytes: Buffer): Buffer =>
  Buffer.concat([Buffer.from(`${parent}/`, "utf8"), bytes]);

it("local-skill-evidence binds full namespace to exact nominated subtrees", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("unmanaged/SKILL.md", Buffer.from("invalid frontmatter"));
    await f.file("not-a-directory", Buffer.from("never read occupancy body"));
    await f.file("selected/orgops-package.json", Buffer.from([239, 187, 191, 255, 0]));
    await f.file("selected/assets/run", Buffer.from([255, 0, 10]), true);
    await f.directoryAt("selected/empty");
    const r = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["selected", "missing", "not-a-directory"] });
    expect(r).toEqual({ ok: true, value: {
      nominatedNames: ["missing", "not-a-directory", "selected"],
      namespace: { complete: true, entries: [
        { name: "not-a-directory", type: "file" },
        { name: "selected", type: "directory" },
        { name: "unmanaged", type: "directory" },
      ] },
      subtrees: [{ name: "selected", complete: true, entries: [
        { type: "directory", path: "assets" },
        { type: "file", path: "assets/run", base64: "/wAK", executable: true },
        { type: "directory", path: "empty" },
        { type: "file", path: "orgops-package.json", base64: "77u//wA=", executable: false },
      ] }],
    } });
  } finally { await f.dispose(); }
});

it("empty root and empty nominations observe an empty complete namespace", async () => {
  const f = await createLocalSkillFixture();
  try {
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: [] }))
      .toEqual({ ok: true, value: { nominatedNames: [], namespace: { complete: true, entries: [] }, subtrees: [] } });
  } finally { await f.dispose(); }
});

it("absent nominee, empty nominated directory, file nominee and blocked nominee stay occupancy-only", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.directoryAt("empty-dir");
    await f.file("plain", Buffer.from("occupancy body never read"));
    await actual.symlink(join(f.directory, "outside"), join(f.root, "blocked-link"));
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["missing", "empty-dir", "plain", "blocked-link"] }))
      .toEqual({ ok: true, value: {
        nominatedNames: ["blocked-link", "empty-dir", "missing", "plain"],
        namespace: { complete: true, entries: [
          { name: "blocked-link", type: "blocked" },
          { name: "empty-dir", type: "directory" },
          { name: "plain", type: "file" },
        ] },
        subtrees: [{ name: "empty-dir", complete: true, entries: [] }],
      } });
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("casefold nomination alias fails UNSAFE_PATH at nominatedNames before any subtree read", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.directoryAt("SAMPLE");
    await f.file("SAMPLE/secret.bin", Buffer.from("alias subtree bytes"));
    const dirs = vi.spyOn(fs, "opendir"), opens = vi.spyOn(fs, "open");
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["sample"] }))
      .toEqual(bad("UNSAFE_PATH", "nominatedNames"));
    expect(dirs).toHaveBeenCalledTimes(1);
    expect(String(dirs.mock.calls[0]![0])).toBe(f.root);
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("duplicate and casefold duplicate nominations are rejected at nominatedNames without fs calls", async () => {
  const f = await createLocalSkillFixture();
  try {
    const stats = vi.spyOn(fs, "lstat");
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["sample", "sample"] }))
      .toEqual(bad("INVALID_LOCAL_INPUT", "nominatedNames"));
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["sample", "SAMPLE"] }))
      .toEqual(bad("INVALID_LOCAL_INPUT", "nominatedNames"));
    expect(stats).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("unselected directories are never descended or read, even with sensitive or oversized children", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("unselected/oversized.bin", Buffer.alloc(1048577));
    await f.file("unselected/marker.txt", Buffer.from("SECRET-MARKER-BYTES"));
    await actual.mkdir(rawChild(join(f.root, "unselected"), Buffer.from([0xff])));
    await f.file("rootfile.txt", Buffer.from("unrelated root body"));
    const dirs = vi.spyOn(fs, "opendir"), opens = vi.spyOn(fs, "open");
    const result = await readLocalSkillEvidence({ directory: f.root, nominatedNames: [] });
    expect(result).toEqual({ ok: true, value: {
      nominatedNames: [],
      namespace: { complete: true, entries: [
        { name: "rootfile.txt", type: "file" },
        { name: "unselected", type: "directory" },
      ] },
      subtrees: [],
    } });
    expect(dirs).toHaveBeenCalledTimes(1);
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
    expect(opens.mock.calls.some(([path]) => String(path).includes("marker") || String(path).includes("oversized")))
      .toBe(false);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("unselected immediate invalid name or case twin fails globally before any body", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("s/legal.txt", Buffer.from("legal body"));
    await actual.mkdir(rawChild(f.root, Buffer.from([0xff])));
    const opens = vi.spyOn(fs, "open");
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] }))
      .toEqual(bad("UNSAFE_PATH", "namespace"));
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
  const g = await createLocalSkillFixture();
  try {
    await g.directoryAt("Selected");
    await g.directoryAt("selected");
    await g.file("selected/legal.txt", Buffer.from("legal body"));
    const opens = vi.spyOn(fs, "open");
    expect(await readLocalSkillEvidence({ directory: g.root, nominatedNames: ["selected"] }))
      .toEqual(bad("DUPLICATE_PATH", "namespace"));
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
  } finally { vi.restoreAllMocks(); await g.dispose(); }
});

it("late nested invalid name or case twin in a selected tree fails before any body", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("s/legal.txt", Buffer.from("legal body"));
    await actual.mkdir(rawChild(join(f.root, "s"), Buffer.from([0xff])));
    const opens = vi.spyOn(fs, "open");
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] }))
      .toEqual(bad("UNSAFE_PATH", "subtrees"));
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
  const g = await createLocalSkillFixture();
  try {
    await g.file("s/legal.txt", Buffer.from("legal body"));
    await g.file("s/a/x", Buffer.from("twin"));
    await g.file("s/a/X", Buffer.from("twin"));
    const opens = vi.spyOn(fs, "open");
    expect(await readLocalSkillEvidence({ directory: g.root, nominatedNames: ["s"] }))
      .toEqual(bad("DUPLICATE_PATH", "subtrees"));
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
  } finally { vi.restoreAllMocks(); await g.dispose(); }
});

it("rejects nonportable immediate names losslessly; portable ascii name accepted", async () => {
  const cases: [string, Buffer][] = [
    ["raw ff byte", Buffer.from([0xff])],
    ["utf8 e-acute", Buffer.from("é", "utf8")],
    ["high-bit c1 control", Buffer.from([0x85])],
  ];
  for (const [label, name] of cases) {
    const f = await createLocalSkillFixture();
    try {
      await actual.mkdir(rawChild(f.root, name));
      expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: [] }), label)
        .toEqual(bad("UNSAFE_PATH", "namespace"));
    } finally { vi.restoreAllMocks(); await f.dispose(); }
  }
  const f = await createLocalSkillFixture();
  try {
    await f.directoryAt("A");
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: [] })).toEqual({ ok: true, value: {
      nominatedNames: [], namespace: { complete: true, entries: [{ name: "A", type: "directory" }] }, subtrees: [],
    } });
  } finally { await f.dispose(); }
});

it("exact relative path byte, component and depth boundaries at the observed entry", async () => {
  const nested240 = `selected/${Array(4).fill("a".repeat(57)).join("/")}`;
  expect(Buffer.byteLength(nested240)).toBe(240);
  {
    const f = await createLocalSkillFixture();
    try {
      await f.directoryAt(nested240);
      const r = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["selected"] });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const paths = r.value.subtrees[0]!.entries.map(entry => entry.path);
        expect(paths).toHaveLength(4);
        expect(paths[3]!).toBe(nested240.slice("selected/".length));
      }
    } finally { await f.dispose(); }
  }
  const nested241 = `selected/${[57, 57, 57, 58].map(count => "b".repeat(count)).join("/")}`;
  expect(Buffer.byteLength(nested241)).toBe(241);
  {
    const f = await createLocalSkillFixture();
    try {
      await f.file("selected/legal.txt", Buffer.from("legal body"));
      await actual.mkdir(join(f.root, nested241), { recursive: true });
      const opens = vi.spyOn(fs, "open");
      expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["selected"] }))
        .toEqual(bad("UNSAFE_PATH", "subtrees"));
      expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
    } finally { vi.restoreAllMocks(); await f.dispose(); }
  }
  {
    const f = await createLocalSkillFixture();
    try {
      await f.directoryAt(`selected/${"c".repeat(64)}`);
      expect((await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["selected"] })).ok).toBe(true);
      await actual.mkdir(join(f.root, `selected2/${"c".repeat(65)}`), { recursive: true });
      await f.file("selected2/legal.txt", Buffer.from("legal body"));
      const opens = vi.spyOn(fs, "open");
      expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["selected2"] }))
        .toEqual(bad("UNSAFE_PATH", "subtrees"));
      expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
    } finally { vi.restoreAllMocks(); await f.dispose(); }
  }
  {
    const f = await createLocalSkillFixture();
    try {
      await f.directoryAt(`selected/${Array(63).fill("d").join("/")}`);
      expect((await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["selected"] })).ok).toBe(true);
      await f.file("selected2/legal.txt", Buffer.from("legal body"));
      await f.directoryAt(`selected2/${Array(64).fill("d").join("/")}`);
      const opens = vi.spyOn(fs, "open");
      expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["selected2"] }))
        .toEqual(bad("UNSAFE_PATH", "subtrees"));
      expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
    } finally { vi.restoreAllMocks(); await f.dispose(); }
  }
});

it("input directory byte ceiling: 4096 reaches root lstat, 4097 fails before fs", async () => {
  const stats = vi.spyOn(fs, "lstat");
  expect(await readLocalSkillEvidence({ directory: `/${"a".repeat(4095)}`, nominatedNames: [] }))
    .toEqual(bad("LOCAL_IO_FAILED", "directory"));
  expect(stats).toHaveBeenCalledTimes(1);
  stats.mockClear();
  expect(await readLocalSkillEvidence({ directory: `/${"a".repeat(4096)}`, nominatedNames: [] }))
    .toEqual(bad("INVALID_LOCAL_INPUT", "directory"));
  expect(stats).not.toHaveBeenCalled();
});

it("joined absolute path ceiling via private reduced rootPathBytes double", async () => {
  // Linux PATH_MAX keeps real joined paths under 4096, so this guard is exercised through a
  // private reduced rootPathBytes double rather than an impossible real fixture.
  const f = await createLocalSkillFixture();
  try {
    await f.file("s/x", Buffer.from("deep"));
    const joined = join(f.root, "s", "x");
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ rootPathBytes: Buffer.byteLength(joined) }));
    const fresh = await import("./local-skill-evidence");
    expect((await fresh.readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] })).ok).toBe(true);
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ rootPathBytes: Buffer.byteLength(joined) - 1 }));
    const fresh2 = await import("./local-skill-evidence");
    expect(await fresh2.readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] }))
      .toEqual(bad("LIMIT_EXCEEDED", "subtrees"));
  } finally {
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    await f.dispose();
  }
});

it("preserves exact root manifest bytes without parsing, regenerating or filtering", async () => {
  const f = await createLocalSkillFixture();
  try {
    const malformed = Buffer.concat([Buffer.from('{"z":1,"z":2}\r\n  ', "utf8"), Buffer.from([0xff, 0x00])]);
    await f.file("s/orgops-package.json", Buffer.alloc(0));
    await f.file("t/orgops-package.json", malformed);
    // The case alias lives in its own subtree: an exact manifest and its casefold twin as
    // siblings would correctly fail DUPLICATE_PATH globally (verified by the case-twin test).
    await f.file("u/Orgops-Package.json", Buffer.from("case-alias ordinary"));
    await f.file("t/nested/orgops-package.json", Buffer.alloc(300000));
    const r = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s", "t", "u"] });
    expect(r).toEqual({ ok: true, value: {
      nominatedNames: ["s", "t", "u"],
      namespace: { complete: true, entries: [
        { name: "s", type: "directory" },
        { name: "t", type: "directory" },
        { name: "u", type: "directory" },
      ] },
      subtrees: [
        { name: "s", complete: true, entries: [
          { type: "file", path: "orgops-package.json", base64: "", executable: false },
        ] },
        { name: "t", complete: true, entries: [
          { type: "directory", path: "nested" },
          { type: "file", path: "nested/orgops-package.json", base64: Buffer.alloc(300000).toString("base64"), executable: false },
          { type: "file", path: "orgops-package.json", base64: malformed.toString("base64"), executable: false },
        ] },
        { name: "u", complete: true, entries: [
          { type: "file", path: "Orgops-Package.json", base64: Buffer.from("case-alias ordinary").toString("base64"), executable: false },
        ] },
      ],
    } });
    if (r.ok) {
      const manifest = r.value.subtrees[1]!.entries.find(entry => entry.path === "orgops-package.json");
      if (manifest?.type === "file") expect(Buffer.from(manifest.base64, "base64")).toEqual(malformed);
    }
  } finally { await f.dispose(); }
}, 30000);

it("executable root manifest is observed, not rejected or rewritten", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("s/orgops-package.json", Buffer.from("{}"), true);
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] })).toEqual({ ok: true, value: {
      nominatedNames: ["s"],
      namespace: { complete: true, entries: [{ name: "s", type: "directory" }] },
      subtrees: [{ name: "s", complete: true, entries: [
        { type: "file", path: "orgops-package.json", base64: "e30=", executable: true },
      ] }],
    } });
  } finally { await f.dispose(); }
});

it("each executable bit maps to true and a post-read mode change fails at filesystem", async () => {
  const f = await createLocalSkillFixture();
  try {
    // Owner-readable single-bit modes: only group/other or owner exec bits plus owner read.
    const modes: [string, number][] = [
      ["x100-owner", 0o500], ["x010-group", 0o410], ["x001-other", 0o401], ["x000-none", 0o400], ["x644", 0o644],
    ];
    for (const [name, mode] of modes) {
      await f.file(`s/${name}`, Buffer.from("mode-body"));
      await actual.chmod(join(f.root, "s", name), mode);
    }
    const r = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      for (const [name, mode] of modes) {
        const entry = r.value.subtrees[0]!.entries.find(candidate => candidate.path === name);
        expect(entry?.type === "file" && entry.executable).toBe((mode & 0o111) !== 0);
      }
    }
  } finally { vi.restoreAllMocks(); await f.dispose(); }
  const g = await createLocalSkillFixture();
  try {
    await g.file("s/data.bin", Buffer.from("mode-change-body"));
    const target = join(g.root, "s", "data.bin");
    const counts = new Map<string, number>();
    vi.spyOn(fs, "lstat").mockImplementation((async (...args) => {
      const key = String(args[0]);
      const seen = (counts.get(key) ?? 0) + 1; counts.set(key, seen);
      const stat = await actual.lstat(key, { bigint: true });
      // Third lstat of the record path is readFile's post-read check.
      if (key === target && seen === 3) return refield(stat, { mode: stat.mode | 0o111n });
      return stat;
    }) as typeof fs.lstat);
    expect(await readLocalSkillEvidence({ directory: g.root, nominatedNames: ["s"] }))
      .toEqual(bad("LOCAL_EVIDENCE_CHANGED", "filesystem"));
  } finally { vi.restoreAllMocks(); await g.dispose(); }
});

it("malformed SKILL.md inside a selected tree and missing manifest stay structural observations", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("s/SKILL.md", Buffer.from("not: valid: frontmatter:\n\x00"));
    await f.directoryAt("s/empty");
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] })).toEqual({ ok: true, value: {
      nominatedNames: ["s"],
      namespace: { complete: true, entries: [{ name: "s", type: "directory" }] },
      subtrees: [{ name: "s", complete: true, entries: [
        { type: "file", path: "SKILL.md", base64: Buffer.from("not: valid: frontmatter:\n\x00").toString("base64"), executable: false },
        { type: "directory", path: "empty" },
      ] }],
    } });
  } finally { await f.dispose(); }
});

it("links to owned outside targets and hardlinked bodies stay bodyless blocked leaves", async () => {
  const f = await createLocalSkillFixture();
  try {
    const outsideFile = join(f.directory, "outside-secret.bin");
    await actual.writeFile(outsideFile, "target-secret-bytes");
    await f.file("s/twin-a", Buffer.from("hardlinked-body"));
    await actual.link(join(f.root, "s", "twin-a"), join(f.root, "s", "twin-b"));
    await f.file("root-twin", Buffer.from("root hardlink body"));
    await actual.link(join(f.root, "root-twin"), join(f.root, "root-twin-2"));
    await actual.symlink(outsideFile, join(f.root, "s", "link-out"));
    await actual.symlink(f.directory, join(f.root, "s", "link-dir"));
    await actual.symlink(outsideFile, join(f.root, "s", "orgops-package.json"));
    const opens = vi.spyOn(fs, "open");
    const readlinks = vi.spyOn(fs, "readlink");
    const result = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] });
    expect(result).toEqual({ ok: true, value: {
      nominatedNames: ["s"],
      namespace: { complete: true, entries: [
        { name: "root-twin", type: "file" },
        { name: "root-twin-2", type: "file" },
        { name: "s", type: "directory" },
      ] },
      subtrees: [{ name: "s", complete: true, entries: [
        { type: "blocked", path: "link-dir" },
        { type: "blocked", path: "link-out" },
        { type: "blocked", path: "orgops-package.json" },
        { type: "blocked", path: "twin-a" },
        { type: "blocked", path: "twin-b" },
      ] }],
    } });
    expect(readlinks).not.toHaveBeenCalled();
    const opened = opens.mock.calls.map(([path]) => String(path));
    expect(opened.some(path => path === outsideFile || path === f.directory)).toBe(false);
    expect(opened.some(path => path.endsWith("twin-a") || path.endsWith("twin-b"))).toBe(false);
    expect(opened.some(path => /link-(dir|out)/.test(path))).toBe(false);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("all selected metadata completes before any ordinary body is opened", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("s/a-first.txt", Buffer.from("legal first body"));
    await f.file("s/z-oversized.bin", Buffer.alloc(1048577));
    const opens = vi.spyOn(fs, "open");
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] }))
      .toEqual(bad("LIMIT_EXCEEDED", "subtrees"));
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("nomination count ceiling at real values: 4096 absent nominees pass, 4097 fail before fs", async () => {
  const f = await createLocalSkillFixture();
  try {
    const many = Array.from({ length: 4096 }, (_, i) => `n${String(i).padStart(4, "0")}`);
    const r = await readLocalSkillEvidence({ directory: f.root, nominatedNames: many });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.nominatedNames).toEqual([...many].sort());
    const stats = vi.spyOn(fs, "lstat");
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: [...many, "extra"] }))
      .toEqual(bad("LIMIT_EXCEEDED", "nominatedNames"));
    expect(stats).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("namespace count ceiling at real values: 4096 entries pass, one more fails at namespace", async () => {
  const f = await createLocalSkillFixture();
  try {
    const body = Buffer.from("never read before the overflow");
    await f.file("s/body.txt", body);
    for (let i = 0; i < 4095; i++) await f.file(`n${String(i).padStart(4, "0")}`, Buffer.alloc(0));
    const ok = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.namespace.entries).toHaveLength(4096);
      expect(ok.value.namespace.complete).toBe(true);
      expect(ok.value.subtrees[0]!.entries).toEqual([
        { type: "file", path: "body.txt", base64: body.toString("base64"), executable: false },
      ]);
    }
    await f.file("zz-extra", Buffer.alloc(0));
    const opens = vi.spyOn(fs, "open");
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] }))
      .toEqual(bad("LIMIT_EXCEEDED", "namespace"));
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
}, 300000);

it("subtree entry ceilings at real values: 1024 pass and 1025 fail; 8192 aggregate passes and one more fails", async () => {
  const f = await createLocalSkillFixture();
  try {
    for (let i = 0; i < 1024; i++) await f.file(`s/n${String(i).padStart(4, "0")}`, Buffer.alloc(0));
    const ok = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.subtrees[0]!.entries).toHaveLength(1024);
    await f.file("s/extra", Buffer.alloc(0));
    const opens = vi.spyOn(fs, "open");
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] }))
      .toEqual(bad("LIMIT_EXCEEDED", "subtrees"));
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
  const g = await createLocalSkillFixture();
  try {
    for (let tree = 1; tree <= 8; tree++) {
      for (let i = 0; i < 1024; i++) await g.file(`t${tree}/n${String(i).padStart(4, "0")}`, Buffer.alloc(0));
    }
    const ok = await readLocalSkillEvidence({ directory: g.root, nominatedNames: ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"] });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.subtrees).toHaveLength(8);
      for (const tree of ok.value.subtrees) expect(tree.entries).toHaveLength(1024);
    }
    await g.file("t9/extra", Buffer.alloc(0));
    const opens = vi.spyOn(fs, "open");
    expect(await readLocalSkillEvidence({ directory: g.root, nominatedNames: ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"] }))
      .toEqual(bad("LIMIT_EXCEEDED", "subtrees"));
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
  } finally { vi.restoreAllMocks(); await g.dispose(); }
}, 300000);

it("reduced private aggregateFiles ceiling isolates the aggregate file count cap", async () => {
  // At real values the 8192 tree-entry cap binds at the same count as aggregateFiles 8192;
  // a lowered aggregateFiles double isolates the aggregate charge (disclosed proof scope).
  const f = await createLocalSkillFixture();
  try {
    for (let i = 0; i < 5; i++) await f.file(`s/n${i}`, Buffer.alloc(0));
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ aggregateFiles: 4 }));
    const fresh = await import("./local-skill-evidence");
    const promises = await import("node:fs/promises");
    const opens = vi.spyOn(promises, "open");
    expect(await fresh.readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] }))
      .toEqual(bad("LIMIT_EXCEEDED", "subtrees"));
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
  } finally {
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    await f.dispose();
  }
});

it("ordinary and manifest byte caps at real values", async () => {
  const f = await createLocalSkillFixture();
  try {
    const oneMiB = Buffer.alloc(1048576);
    await f.file("s/max.bin", oneMiB);
    const ok = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const entry = ok.value.subtrees[0]!.entries[0]!;
      expect(entry.type === "file" && entry.base64).toBe(oneMiB.toString("base64"));
    }
    await f.file("s/over.bin", Buffer.alloc(1048577));
    const opens = vi.spyOn(fs, "open");
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] }))
      .toEqual(bad("LIMIT_EXCEEDED", "subtrees"));
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
  const g = await createLocalSkillFixture();
  try {
    await g.file("s/orgops-package.json", Buffer.alloc(262144));
    expect((await readLocalSkillEvidence({ directory: g.root, nominatedNames: ["s"] })).ok).toBe(true);
    await g.file("t/orgops-package.json", Buffer.alloc(262145));
    const opens = vi.spyOn(fs, "open");
    expect(await readLocalSkillEvidence({ directory: g.root, nominatedNames: ["t"] }))
      .toEqual(bad("LIMIT_EXCEEDED", "subtrees"));
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
  } finally { vi.restoreAllMocks(); await g.dispose(); }
}, 300000);

it("per-subtree and aggregate ordinary byte caps at real values", async () => {
  const f = await createLocalSkillFixture();
  try {
    const oneMiB = Buffer.alloc(1048576);
    for (let i = 0; i < 8; i++) await f.file(`s/f${i}`, oneMiB);
    await f.file("s/orgops-package.json", Buffer.from("abc"));
    const ok = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] });
    expect(ok.ok).toBe(true);
    await f.file("s/extra.bin", Buffer.from("x"));
    const opens = vi.spyOn(fs, "open");
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] }))
      .toEqual(bad("LIMIT_EXCEEDED", "subtrees"));
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
  const g = await createLocalSkillFixture();
  try {
    const oneMiB = Buffer.alloc(1048576);
    for (let tree = 1; tree <= 4; tree++) for (let i = 0; i < 8; i++) await g.file(`t${tree}/f${i}`, oneMiB);
    const ok = await readLocalSkillEvidence({ directory: g.root, nominatedNames: ["t1", "t2", "t3", "t4"] });
    expect(ok.ok).toBe(true);
    // The root manifest is excluded from the 8MiB per-subtree cap but not from the 32MiB aggregate.
    await g.file("t1/orgops-package.json", Buffer.from("z"));
    const opens = vi.spyOn(fs, "open");
    expect(await readLocalSkillEvidence({ directory: g.root, nominatedNames: ["t1", "t2", "t3", "t4"] }))
      .toEqual(bad("LIMIT_EXCEEDED", "subtrees"));
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
  } finally { vi.restoreAllMocks(); await g.dispose(); }
}, 300000);

it("repeated identical bytes in separate files and subtrees are charged and read per occurrence", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("a/f", Buffer.from("same-bytes"));
    await f.file("b/f", Buffer.from("same-bytes"));
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["b", "a"] })).toEqual({ ok: true, value: {
      nominatedNames: ["a", "b"],
      namespace: { complete: true, entries: [
        { name: "a", type: "directory" },
        { name: "b", type: "directory" },
      ] },
      subtrees: [
        { name: "a", complete: true, entries: [
          { type: "file", path: "f", base64: Buffer.from("same-bytes").toString("base64"), executable: false },
        ] },
        { name: "b", complete: true, entries: [
          { type: "file", path: "f", base64: Buffer.from("same-bytes").toString("base64"), executable: false },
        ] },
      ],
    } });
  } finally { await f.dispose(); }
});

it("output accounting charges exact serialized bytes including punctuation and base64 rounding", async () => {
  const f = await createLocalSkillFixture();
  try {
    for (let i = 1; i <= 6; i++) await f.file(`s/f${i}`, Buffer.from("xyzwvu".slice(0, i)));
    await f.file("s/orgops-package.json", Buffer.from("ab"));
    await f.file("t/f1", Buffer.from("x"));
    await f.directoryAt("s/d");
    await f.file("u", Buffer.alloc(0));
    const expected = {
      nominatedNames: ["s", "t"],
      namespace: { complete: true, entries: [
        { name: "s", type: "directory" },
        { name: "t", type: "directory" },
        { name: "u", type: "file" },
      ] },
      subtrees: [
        { name: "s", complete: true, entries: [
          { type: "directory", path: "d" },
          { type: "file", path: "f1", base64: Buffer.from("x").toString("base64"), executable: false },
          { type: "file", path: "f2", base64: Buffer.from("xy").toString("base64"), executable: false },
          { type: "file", path: "f3", base64: Buffer.from("xyz").toString("base64"), executable: false },
          { type: "file", path: "f4", base64: Buffer.from("xyzw").toString("base64"), executable: false },
          { type: "file", path: "f5", base64: Buffer.from("xyzwv").toString("base64"), executable: false },
          { type: "file", path: "f6", base64: Buffer.from("xyzwvu").toString("base64"), executable: false },
          { type: "file", path: "orgops-package.json", base64: Buffer.from("ab").toString("base64"), executable: false },
        ] },
        { name: "t", complete: true, entries: [
          { type: "file", path: "f1", base64: Buffer.from("x").toString("base64"), executable: false },
        ] },
      ],
    };
    const r = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s", "t"] });
    expect(r).toEqual({ ok: true, value: expected });
    const exact = Buffer.byteLength(JSON.stringify(expected));
    if (r.ok) expect(Buffer.byteLength(JSON.stringify(r.value))).toBe(exact);
    // 64MiB is defense in depth: the exact serialized bound is exercised with reduced doubles.
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ outputJsonBytes: exact }));
    const fresh = await import("./local-skill-evidence");
    expect((await fresh.readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s", "t"] })).ok).toBe(true);
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ outputJsonBytes: exact - 1 }));
    const fresh2 = await import("./local-skill-evidence");
    const promises = await import("node:fs/promises");
    const opens = vi.spyOn(promises, "open");
    expect(await fresh2.readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s", "t"] }))
      .toEqual(bad("LIMIT_EXCEEDED", "subtrees"));
    expect(bodyOpenPaths(opens.mock.calls)).toEqual([]);
  } finally {
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    vi.restoreAllMocks();
    await f.dispose();
  }
});

it("final JSON accounting mismatch faults to LOCAL_IO_FAILED at filesystem without a partial value", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("s/a", Buffer.from("body"));
    // Private fault injection: overreport only the collector's initial empty-envelope byte count.
    const realByteLength = Buffer.byteLength.bind(Buffer);
    let perturbed = false;
    vi.spyOn(Buffer, "byteLength").mockImplementation(((string: string, encoding?: BufferEncoding) => {
      if (!perturbed && typeof string === "string" && string.includes('"subtrees":[]')) {
        perturbed = true;
        return realByteLength(string, encoding) + 1;
      }
      return realByteLength(string, encoding);
    }) as typeof Buffer.byteLength);
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] }))
      .toEqual(bad("LOCAL_IO_FAILED", "filesystem"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("deadline is checked cooperatively around final serialization via a clock spy", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("s/a", Buffer.from("body"));
    let armed = false;
    const realNow = performance.now.bind(performance);
    vi.spyOn(performance, "now").mockImplementation(() => armed ? realNow() + 20000 : realNow());
    const realByteLength = Buffer.byteLength.bind(Buffer);
    vi.spyOn(Buffer, "byteLength").mockImplementation(((string: string, encoding?: BufferEncoding) => {
      // The final accounting serialization is the only call with a non-empty subtrees array.
      if (typeof string === "string" && string.includes('"subtrees":[{')) armed = true;
      return realByteLength(string, encoding);
    }) as typeof Buffer.byteLength);
    const result: LocalSkillEvidenceResult<unknown> =
      await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] });
    expect(result).toEqual(bad("LOCAL_TIMEOUT", "filesystem"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("deadline is checked cooperatively during final freeze via a clock spy", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("s/a", Buffer.from("body"));
    let armed = false;
    const realNow = performance.now.bind(performance);
    vi.spyOn(performance, "now").mockImplementation(() => armed ? realNow() + 20000 : realNow());
    const realFreeze = Object.freeze;
    // Arm when the collector freezes the neutral namespace envelope: only the final freeze
    // phase sees an object with complete:true and an entries array. Owner-issued records,
    // arrays and the reader never match this shape.
    vi.spyOn(Object, "freeze").mockImplementation(((target: object) => {
      if (target && typeof target === "object"
        && (target as { complete?: unknown }).complete === true
        && Array.isArray((target as { entries?: unknown }).entries)) armed = true;
      return realFreeze(target);
    }) as typeof Object.freeze);
    const result = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] });
    expect(result).toEqual(bad("LOCAL_TIMEOUT", "filesystem"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("reduced private fsCalls and workUnits ceilings fail LIMIT_EXCEEDED at filesystem", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("s/a", Buffer.from("body"));
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ fsCalls: 12 }));
    const fresh = await import("./local-skill-evidence");
    expect(await fresh.readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] }))
      .toEqual(bad("LIMIT_EXCEEDED", "filesystem"));
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ workUnits: 10 }));
    const fresh2 = await import("./local-skill-evidence");
    expect(await fresh2.readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] }))
      .toEqual(bad("LIMIT_EXCEEDED", "filesystem"));
  } finally {
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    await f.dispose();
  }
});

it("options pass through: pre-aborted signal fails LOCAL_ABORTED; explicit undefined signal is rejected", async () => {
  const f = await createLocalSkillFixture();
  try {
    const controller = new AbortController();
    controller.abort();
    const stats = vi.spyOn(fs, "lstat");
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: [] }, { signal: controller.signal }))
      .toEqual(bad("LOCAL_ABORTED", "filesystem"));
    expect(stats).not.toHaveBeenCalled();
    // Strict Task 1 envelope decision: an explicitly present undefined signal value is invalid.
    expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: [] }, { signal: undefined }))
      .toEqual(bad("INVALID_LOCAL_INPUT", "$"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("results are detached, frozen, repeatable and survive fixture disposal", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("a/z-first", Buffer.from("created first"));
    await f.file("a/a-last", Buffer.from("created last"));
    await f.file("b/mid", Buffer.from("other subtree"));
    const input = { directory: f.root, nominatedNames: ["b", "a"] };
    const first = await readLocalSkillEvidence(input);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(isDeeplyFrozen(first.value)).toBe(true);
      expect(first.value.nominatedNames).toEqual(["a", "b"]);
      expect(first.value.subtrees[0]!.entries.map(entry => entry.path)).toEqual(["a-last", "z-first"]);
      expect(() => { (first.value.nominatedNames as unknown as string[]).push("c"); }).toThrow();
    }
    // Caller mutation after settlement cannot change the detached result.
    (input.nominatedNames as string[]).push("c");
    if (first.ok) expect(first.value.nominatedNames).toEqual(["a", "b"]);
    // Reversed nomination order yields the identical sorted result.
    const second = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["a", "b"] });
    expect(second).toEqual(first);
  } finally { await f.dispose(); }
  expect(await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["a"] }))
    .toEqual(bad("LOCAL_IO_FAILED", "directory"));
});

it("acquisition performs no mutating calls, no readlink and no work after settlement", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("s/a", Buffer.from("body"));
    await actual.symlink(join(f.root, "s", "a"), join(f.root, "s", "link"));
    const mutations = [
      vi.spyOn(fs, "writeFile"), vi.spyOn(fs, "mkdir"), vi.spyOn(fs, "rm"), vi.spyOn(fs, "rename"),
      vi.spyOn(fs, "chmod"), vi.spyOn(fs, "symlink"), vi.spyOn(fs, "link"), vi.spyOn(fs, "appendFile"),
      vi.spyOn(fs, "truncate"), vi.spyOn(fs, "copyFile"), vi.spyOn(fs, "readlink"),
    ];
    const opens = vi.spyOn(fs, "open");
    const stats = vi.spyOn(fs, "lstat");
    const result = await readLocalSkillEvidence({ directory: f.root, nominatedNames: ["s"] });
    expect(result.ok).toBe(true);
    for (const spy of mutations) expect(spy).not.toHaveBeenCalled();
    const writeFlags = nodeFs.constants.O_WRONLY | nodeFs.constants.O_RDWR
      | nodeFs.constants.O_CREAT | nodeFs.constants.O_TRUNC | nodeFs.constants.O_APPEND;
    for (const [, flags] of opens.mock.calls) {
      expect(typeof flags === "number" && (flags & writeFlags) === 0).toBe(true);
    }
    const opensAfter = opens.mock.calls.length, statsAfter = stats.mock.calls.length;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(opens.mock.calls.length).toBe(opensAfter);
    expect(stats.mock.calls.length).toBe(statsAfter);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});
