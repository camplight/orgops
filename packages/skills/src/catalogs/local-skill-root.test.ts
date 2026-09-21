import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as nodeFs from "node:fs";
import type { BigIntStats, Dirent, Dir } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { createLocalSkillFixture } from "./local-skill-fixtures";
import { withLocalSkillRoot, type LocalSkillRecord, type LocalSkillRootReader } from "./local-skill-root";
import {
  OFFLINE_LOCAL_SKILL_LIMITS,
  type LocalSkillEvidenceInput, type LocalSkillEvidenceIssue, type LocalSkillEvidenceOptions,
  type LocalSkillEvidenceResult,
} from "./local-skill-evidence-types";

vi.mock("node:fs/promises", async original => ({ ...await original<typeof import("node:fs/promises")>() }));
vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>() }));
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
const invoke = (input: unknown, options?: unknown): Promise<LocalSkillEvidenceResult<boolean>> =>
  withLocalSkillRoot(input as LocalSkillEvidenceInput, options as LocalSkillEvidenceOptions | undefined, async () => true);
const listRoot = async (r: LocalSkillRootReader): Promise<boolean> => {
  await r.listDirectory(r.root, 4096);
  return true;
};
/** Genuine Stats copy with explicitly overridden scalar fields (private metadata double). */
function refield(stat: BigIntStats, fields: Partial<Record<"dev" | "ino" | "mode" | "nlink" | "size" | "mtimeNs" | "ctimeNs", bigint>>): BigIntStats {
  return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, fields);
}
/** Genuine Stats copy with exactly one overridden type method (private metadata double). */
function retype(stat: BigIntStats, kind: "fifo" | "socket" | "block" | "unknown" | "contradictory"): BigIntStats {
  const clone = Object.assign(Object.create(Object.getPrototypeOf(stat)), stat) as BigIntStats & Record<string, unknown>;
  const methods = ["isFile", "isDirectory", "isSymbolicLink", "isFIFO", "isSocket", "isCharacterDevice", "isBlockDevice"];
  for (const method of methods) clone[method] = () => false;
  if (kind === "fifo") clone.isFIFO = () => true;
  if (kind === "socket") clone.isSocket = () => true;
  if (kind === "block") clone.isBlockDevice = () => true;
  if (kind === "contradictory") { clone.isFile = () => true; clone.isFIFO = () => true; }
  return clone;
}

it("local-skill-root enumerates namespace and reads exact issued file bytes", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/data.bin", Buffer.from([0, 255, 10]), true);
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      expect(top.map(x => [x.path, x.type])).toEqual([["sample", "directory"]]);
      const files = await r.listDirectory(top[0]!, 1024);
      expect(files.map(x => [x.path, x.type])).toEqual([["sample/data.bin", "file"]]);
      return (await r.readFile(files[0]!)).toString("base64");
    });
    expect(result).toEqual({ ok: true, value: "AP8K" });
  } finally {
    vi.restoreAllMocks();
    await f.dispose();
  }
});

it("rejects null, missing, extra, symbol and non-plain input envelopes at $ without fs calls", async () => {
  const stats = vi.spyOn(fs, "lstat"), opens = vi.spyOn(fs, "open"), dirs = vi.spyOn(fs, "opendir");
  const withSymbol = { directory: "/DO_NOT_READ", nominatedNames: [] } as Record<PropertyKey, unknown>;
  withSymbol[Symbol("extra")] = 1;
  const cases: unknown[] = [
    null, undefined, 5, "x", [], {},
    { directory: "/DO_NOT_READ" },
    { directory: "/DO_NOT_READ", nominatedNames: [], extra: 1 },
    Object.assign(Object.create({ poisoned: true }), { directory: "/DO_NOT_READ", nominatedNames: [] }),
    withSymbol,
  ];
  for (const input of cases) expect(await invoke(input)).toEqual(bad("INVALID_LOCAL_INPUT", "$"));
  expect(stats).not.toHaveBeenCalled();
  expect(opens).not.toHaveBeenCalled();
  expect(dirs).not.toHaveBeenCalled();
});

it("rejects accessor properties without invoking getters", async () => {
  const f = await createLocalSkillFixture();
  try {
    let directoryReads = 0, indexReads = 0, signalReads = 0;
    const envelope: Record<string, unknown> = {};
    Object.defineProperty(envelope, "directory", { enumerable: true, get: () => { directoryReads++; return f.root; } });
    Object.defineProperty(envelope, "nominatedNames", { enumerable: true, get: () => { indexReads++; return ["sample"]; } });
    expect(await invoke(envelope)).toEqual(bad("INVALID_LOCAL_INPUT", "directory"));
    const list = ["sample"];
    Object.defineProperty(list, 0, { enumerable: true, get: () => { indexReads++; return "sample"; } });
    expect(await invoke({ directory: f.root, nominatedNames: list })).toEqual(bad("INVALID_LOCAL_INPUT", "nominatedNames"));
    const options: Record<string, unknown> = {};
    Object.defineProperty(options, "signal", { enumerable: true, get: () => { signalReads++; return new AbortController().signal; } });
    expect(await invoke({ directory: f.root, nominatedNames: [] }, options)).toEqual(bad("INVALID_LOCAL_INPUT", "$"));
    expect(directoryReads).toBe(0);
    expect(indexReads).toBe(0);
    expect(signalReads).toBe(0);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("rejects sparse, symbolic, extra, non-array and non-string nominations at nominatedNames", async () => {
  const f = await createLocalSkillFixture();
  try {
    const withSymbolIndex = ["sample"] as unknown as Record<PropertyKey, unknown>;
    withSymbolIndex[Symbol("extra")] = 1;
    const withExtraProperty = ["sample"] as unknown as Record<PropertyKey, unknown>;
    withExtraProperty.extra = 1;
    const cases: unknown[] = [
      "sample", {}, { length: 1, 0: "sample" },
      ["a", , "b"], withSymbolIndex, withExtraProperty,
      [1], [null], ["a/b"], ["a b"], [""], ["CON"], ["."], ["a".repeat(65)],
    ];
    for (const nominatedNames of cases) {
      expect(await invoke({ directory: f.root, nominatedNames })).toEqual(bad("INVALID_LOCAL_INPUT", "nominatedNames"));
    }
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("rejects duplicate and casefold duplicate nominations at nominatedNames", async () => {
  const f = await createLocalSkillFixture();
  try {
    expect(await invoke({ directory: f.root, nominatedNames: ["a", "a"] })).toEqual(bad("INVALID_LOCAL_INPUT", "nominatedNames"));
    expect(await invoke({ directory: f.root, nominatedNames: ["a", "A"] })).toEqual(bad("INVALID_LOCAL_INPUT", "nominatedNames"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("rejects malformed options at $ and accepts a genuine optional signal", async () => {
  const f = await createLocalSkillFixture();
  try {
    expect(await invoke({ directory: f.root, nominatedNames: [] }, "x")).toEqual(bad("INVALID_LOCAL_INPUT", "$"));
    expect(await invoke({ directory: f.root, nominatedNames: [] }, { signal: {} })).toEqual(bad("INVALID_LOCAL_INPUT", "$"));
    expect(await invoke({ directory: f.root, nominatedNames: [] }, { signal: undefined })).toEqual(bad("INVALID_LOCAL_INPUT", "$"));
    expect(await invoke({ directory: f.root, nominatedNames: [] }, { signal: new AbortController().signal, extra: 1 })).toEqual(bad("INVALID_LOCAL_INPUT", "$"));
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, {}, async r =>
      (await r.listDirectory(r.root, 4096)).length);
    expect(result).toEqual({ ok: true, value: 0 });
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it.each([
  ["relative", "tmp/root"],
  ["root itself", "/"],
  ["repeated leading separators", "//"],
  ["repeated inner separators", "/a//b"],
  ["trailing separator", "/a/"],
  ["dot segment", "/a/./b"],
  ["dotdot segment", "/a/../b"],
  ["NUL", "/a\u0000b"],
  ["lone surrogate", "/a\uD800b"],
  ["control character", "/a\u0001b"],
  ["C1 control", "/a\u0080b"],
  ["backslash", "/a\\b"],
  ["4097 bytes", `/${"a".repeat(4096)}`],
  ["65 host components", `/${Array(65).fill("a").join("/")}`],
])("rejects invalid host path (%s) at directory without fs calls", async (_label, directory) => {
  const stats = vi.spyOn(fs, "lstat"), opens = vi.spyOn(fs, "open"), dirs = vi.spyOn(fs, "opendir");
  expect(await invoke({ directory, nominatedNames: [] })).toEqual(bad("INVALID_LOCAL_INPUT", "directory"));
  expect(stats).not.toHaveBeenCalled();
  expect(opens).not.toHaveBeenCalled();
  expect(dirs).not.toHaveBeenCalled();
});

it("accepts non-ASCII and reasonably deep host directory paths losslessly", async () => {
  const f = await createLocalSkillFixture();
  try {
    const unicodeRoot = join(f.directory, "café");
    await fs.mkdir(unicodeRoot);
    expect(await withLocalSkillRoot({ directory: unicodeRoot, nominatedNames: [] }, undefined, async r =>
      (await r.listDirectory(r.root, 4096)).length)).toEqual({ ok: true, value: 0 });
    const deepRoot = join(f.directory, ...Array(50).fill("d"));
    await fs.mkdir(deepRoot, { recursive: true });
    expect(await withLocalSkillRoot({ directory: deepRoot, nominatedNames: [] }, undefined, async r =>
      (await r.listDirectory(r.root, 4096)).length)).toEqual({ ok: true, value: 0 });
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("pre-aborted signal fails LOCAL_ABORTED at filesystem before any fs call", async () => {
  const stats = vi.spyOn(fs, "lstat"), opens = vi.spyOn(fs, "open");
  const controller = new AbortController();
  controller.abort();
  expect(await invoke({ directory: "/DO_NOT_READ", nominatedNames: [] }, { signal: controller.signal }))
    .toEqual(bad("LOCAL_ABORTED", "filesystem"));
  expect(stats).not.toHaveBeenCalled();
  expect(opens).not.toHaveBeenCalled();
});

it("clock initially beyond the deadline fails LOCAL_TIMEOUT at filesystem before any fs call", async () => {
  const stats = vi.spyOn(fs, "lstat"), opens = vi.spyOn(fs, "open");
  const now = performance.now.bind(performance);
  let calls = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now() - (calls++ === 0 ? 20000 : 0));
  expect(await invoke({ directory: "/DO_NOT_READ", nominatedNames: [] }))
    .toEqual(bad("LOCAL_TIMEOUT", "filesystem"));
  expect(stats).not.toHaveBeenCalled();
  expect(opens).not.toHaveBeenCalled();
});

it("unsupported platform and missing numeric open flags fail UNSUPPORTED_LOCAL_STORAGE at directory before any fs call", async () => {
  const stats = vi.spyOn(fs, "lstat"), opens = vi.spyOn(fs, "open");
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  expect(await invoke({ directory: "/DO_NOT_READ", nominatedNames: [] }))
    .toEqual(bad("UNSUPPORTED_LOCAL_STORAGE", "directory"));
  vi.restoreAllMocks();
  const stats2 = vi.spyOn(fs, "lstat"), opens2 = vi.spyOn(fs, "open");
  const mockedNodeFs = nodeFs as unknown as { constants: typeof nodeFs.constants };
  const originalConstants = mockedNodeFs.constants;
  mockedNodeFs.constants = Object.assign({}, originalConstants, { O_NOFOLLOW: undefined });
  try {
    expect(await invoke({ directory: "/DO_NOT_READ", nominatedNames: [] }))
      .toEqual(bad("UNSUPPORTED_LOCAL_STORAGE", "directory"));
  } finally {
    mockedNodeFs.constants = originalConstants;
  }
  expect(stats).not.toHaveBeenCalled();
  expect(opens).not.toHaveBeenCalled();
  expect(stats2).not.toHaveBeenCalled();
  expect(opens2).not.toHaveBeenCalled();
});

it("missing root fails LOCAL_IO_FAILED at directory", async () => {
  const f = await createLocalSkillFixture();
  try {
    expect(await invoke({ directory: join(f.directory, "missing"), nominatedNames: [] }))
      .toEqual(bad("LOCAL_IO_FAILED", "directory"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it.each(["file", "symlink"] as const)("non-directory %s root fails UNSUPPORTED_LOCAL_STORAGE at directory without opendir", async kind => {
  const f = await createLocalSkillFixture();
  try {
    const target = join(f.directory, "occupied");
    if (kind === "file") await fs.writeFile(target, Buffer.from("x"));
    else await fs.symlink(f.root, target);
    const dirs = vi.spyOn(fs, "opendir");
    expect(await invoke({ directory: target, nominatedNames: [] }))
      .toEqual(bad("UNSUPPORTED_LOCAL_STORAGE", "directory"));
    expect(dirs).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it.each([
  ["raw ff byte", Buffer.from([0xff])],
  ["UTF8 é", Buffer.from("é", "utf8")],
  ["high-bit c1", Buffer.from([0x80])],
  ["CON", Buffer.from("CON")],
  [".git", Buffer.from(".git")],
  ["trailing dot", Buffer.from("a.")],
  ["space", Buffer.from("a b")],
  ["65 chars", Buffer.from("a".repeat(65))],
])("unsafe immediate disk name (%s) fails globally at namespace before any body", async (_label, name) => {
  const f = await createLocalSkillFixture();
  try {
    const prefix = Buffer.from(`${f.root}/`, "utf8");
    await fs.mkdir(Buffer.concat([prefix, name]));
    const opens = vi.spyOn(fs, "open");
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async r => {
      await r.listDirectory(r.root, 4096);
      return true;
    });
    expect(result).toEqual(bad("UNSAFE_PATH", "namespace"));
    expect(opens.mock.calls.filter(([path]) => String(path) !== f.root)).toHaveLength(0);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("casefold duplicate immediate names fail DUPLICATE_PATH at namespace without bodies", async () => {
  const f = await createLocalSkillFixture();
  try {
    await fs.mkdir(join(f.root, "A"));
    await fs.mkdir(join(f.root, "a"));
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async r => {
      await r.listDirectory(r.root, 4096);
      return true;
    });
    expect(result).toEqual(bad("DUPLICATE_PATH", "namespace"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("casefold duplicate nested names fail DUPLICATE_PATH at subtrees without bodies", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("tree/A/x", Buffer.from("x"));
    await f.file("tree/a/y", Buffer.from("y"));
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["tree"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      await r.listDirectory(top[0]!, 1024);
      return true;
    });
    expect(result).toEqual(bad("DUPLICATE_PATH", "subtrees"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("duplicate yielded exact names fail DUPLICATE_PATH at namespace", async () => {
  const f = await createLocalSkillFixture();
  const originalOpenDir = fs.opendir;
  try {
    await fs.mkdir(join(f.root, "a"));
    vi.spyOn(fs, "opendir").mockImplementationOnce(async (...args) => {
      const dir = await originalOpenDir(...args);
      const realRead = dir.read.bind(dir);
      let first: Dirent | null = null;
      let calls = 0;
      vi.spyOn(dir, "read").mockImplementation(async () => {
        const entry = await realRead();
        calls++;
        if (calls === 1) { first = entry; return entry; }
        if (calls === 2) return first;
        return entry;
      });
      return dir;
    });
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async r => {
      await r.listDirectory(r.root, 4096);
      return true;
    });
    expect(result).toEqual(bad("DUPLICATE_PATH", "namespace"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("returns deterministic sorted records regardless of enumeration order", async () => {
  const f = await createLocalSkillFixture();
  try {
    for (const name of ["m", "a", "z", "b"]) await fs.mkdir(join(f.root, name));
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async r =>
      (await r.listDirectory(r.root, 4096)).map(record => record.path));
    expect(result).toEqual({ ok: true, value: ["a", "b", "m", "z"] });
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("uses the captured input snapshot; caller objects stay mutable", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/data.bin", Buffer.from([1]));
    const input = { directory: f.root, nominatedNames: ["sample"] };
    const pending = withLocalSkillRoot(input, undefined, async r => {
      expect(r.input.directory).toBe(f.root);
      expect(r.input.nominatedNames).toEqual(["sample"]);
      input.directory = "/DO_NOT_READ";
      (input.nominatedNames as string[]).push("zzz");
      expect(r.input.nominatedNames).toEqual(["sample"]);
      expect(Object.isFrozen(r.input.nominatedNames)).toBe(true);
      return true;
    });
    const result = await pending;
    expect(result).toEqual({ ok: true, value: true });
    expect(input.directory).toBe("/DO_NOT_READ");
    expect(input.nominatedNames).toEqual(["sample", "zzz"]);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.nominatedNames)).toBe(false);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("observes genuine directory nlink>1 and refuses hardlinked bodies without opening them", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/data.bin", Buffer.from("target-bytes"));
    const outside = join(f.directory, "outside.bin");
    await fs.link(join(f.root, "sample", "data.bin"), outside);
    const opens = vi.spyOn(fs, "open");
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      expect(top[0]!.type).toBe("directory");
      expect(top[0]!.stat.nlink).toBeGreaterThan(1n);
      const files = await r.listDirectory(top[0]!, 1024);
      const record = files[0]!;
      expect(record.type).toBe("file");
      expect(record.stat.nlink).toBe(2n);
      let refused = false;
      try { await r.readFile(record); } catch { refused = true; }
      expect(refused).toBe(true);
      return true;
    });
    expect(result).toEqual(bad("UNSUPPORTED_LOCAL_STORAGE", "subtrees"));
    expect(opens.mock.calls.some(([path]) => String(path) === join(f.root, "sample", "data.bin"))).toBe(false);
    expect(await fs.readFile(outside, "utf8")).toBe("target-bytes");
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("classifies symlink leaves as blocked without opening bodies, following targets or descending", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/real.bin", Buffer.from("real"));
    await f.directoryAt("other");
    await fs.symlink(join(f.root, "sample", "real.bin"), join(f.root, "sample", "link-file"));
    await fs.symlink(join(f.root, "other"), join(f.root, "sample", "link-dir"));
    await fs.symlink(join(f.root, "sample", "missing"), join(f.root, "sample", "broken"));
    const opens = vi.spyOn(fs, "open");
    const readlinks = vi.spyOn(fs, "readlink");
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const entries = await r.listDirectory(top[0]!, 1024);
      expect(entries.map(record => [record.path, record.type])).toEqual([
        ["sample/broken", "blocked"],
        ["sample/link-dir", "blocked"],
        ["sample/link-file", "blocked"],
        ["sample/real.bin", "file"],
      ]);
      let refused = false;
      try { await r.listDirectory(entries[1]!, 1024); } catch { refused = true; }
      expect(refused).toBe(true);
      return true;
    });
    expect(result).toEqual(bad("INVALID_LOCAL_INPUT", "filesystem"));
    expect(readlinks).not.toHaveBeenCalled();
    expect(opens.mock.calls.some(([path]) => /link|broken/.test(String(path)))).toBe(false);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it.each(["fifo", "socket", "block"] as const)("doubled %s metadata classifies blocked without a body open", async kind => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/special.bin", Buffer.from("body"));
    const specialPath = join(f.root, "sample", "special.bin");
    vi.spyOn(fs, "lstat").mockImplementation((async (...args) => {
      const stat = await actual.lstat(String(args[0]), { bigint: true });
      if (String(args[0]) === specialPath) return retype(stat, kind);
      return stat;
    }) as typeof fs.lstat);
    const opens = vi.spyOn(fs, "open");
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const entries = await r.listDirectory(top[0]!, 1024);
      expect(entries[0]!.type).toBe("blocked");
      let refused = false;
      try { await r.readFile(entries[0]!); } catch { refused = true; }
      expect(refused).toBe(true);
      return true;
    });
    expect(result).toEqual(bad("UNSUPPORTED_LOCAL_STORAGE", "subtrees"));
    expect(opens.mock.calls.some(([path]) => String(path) === specialPath)).toBe(false);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it.each(["unknown", "contradictory"] as const)("doubled %s storage form fails UNSUPPORTED_LOCAL_STORAGE at filesystem", async kind => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/special.bin", Buffer.from("body"));
    const specialPath = join(f.root, "sample", "special.bin");
    vi.spyOn(fs, "lstat").mockImplementation((async (...args) => {
      const stat = await actual.lstat(String(args[0]), { bigint: true });
      if (String(args[0]) === specialPath) return retype(stat, kind);
      return stat;
    }) as typeof fs.lstat);
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      await r.listDirectory(top[0]!, 1024);
      return true;
    });
    expect(result).toEqual(bad("UNSUPPORTED_LOCAL_STORAGE", "filesystem"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("directory handle metadata mismatch fails LOCAL_EVIDENCE_CHANGED at filesystem", async () => {
  const f = await createLocalSkillFixture();
  const originalOpen = fs.open;
  try {
    await f.directoryAt("sample");
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) === join(f.root, "sample")) {
        const realStat = handle.stat.bind(handle);
        vi.spyOn(handle, "stat").mockImplementationOnce((async () => {
          const stat = await realStat({ bigint: true });
          return refield(stat, { ino: stat.ino + 1n });
        }) as typeof handle.stat);
      }
      return handle;
    });
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      await r.listDirectory(top[0]!, 1024);
      return true;
    });
    expect(result).toEqual(bad("LOCAL_EVIDENCE_CHANGED", "filesystem"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("file handle metadata mismatch fails LOCAL_EVIDENCE_CHANGED at filesystem without exposing bytes", async () => {
  const f = await createLocalSkillFixture();
  const originalOpen = fs.open;
  try {
    await f.file("sample/data.bin", Buffer.from("secret-bytes"));
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) === join(f.root, "sample", "data.bin")) {
        const realStat = handle.stat.bind(handle);
        vi.spyOn(handle, "stat").mockImplementationOnce((async () => {
          const stat = await realStat({ bigint: true });
          return refield(stat, { size: stat.size + 1n });
        }) as typeof handle.stat);
      }
      return handle;
    });
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const files = await r.listDirectory(top[0]!, 1024);
      await r.readFile(files[0]!);
      return true;
    });
    expect(result).toEqual(bad("LOCAL_EVIDENCE_CHANGED", "filesystem"));
    expect(JSON.stringify(result)).not.toContain("secret-bytes");
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("selected cross-device metadata fails UNSUPPORTED_LOCAL_STORAGE at filesystem", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/cross/data.bin", Buffer.from("x"));
    const crossPath = join(f.root, "sample", "cross");
    vi.spyOn(fs, "lstat").mockImplementation((async (...args) => {
      const stat = await actual.lstat(String(args[0]), { bigint: true });
      if (String(args[0]) === crossPath) return refield(stat, { dev: stat.dev + 1n });
      return stat;
    }) as typeof fs.lstat);
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      await r.listDirectory(top[0]!, 1024);
      return true;
    });
    expect(result).toEqual(bad("UNSUPPORTED_LOCAL_STORAGE", "filesystem"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("replaced nominated ordinary files fail LOCAL_EVIDENCE_CHANGED without body exposure", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/data.bin", Buffer.from("v1"));
    const target = join(f.root, "sample", "data.bin");
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const files = await r.listDirectory(top[0]!, 1024);
      await fs.rm(target);
      await fs.writeFile(target, Buffer.from("REPLACED_SECRET"));
      await r.readFile(files[0]!);
      return true;
    });
    expect(result).toEqual(bad("LOCAL_EVIDENCE_CHANGED", "filesystem"));
    expect(JSON.stringify(result)).not.toContain("REPLACED_SECRET");
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("late final recheck detects mutation after the consumer completes", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/data.bin", Buffer.from("v1"));
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const files = await r.listDirectory(top[0]!, 1024);
      expect((await r.readFile(files[0]!)).toString()).toBe("v1");
      await fs.writeFile(join(f.root, "sample", "data.bin"), Buffer.from("v2-mutated-longer"));
      return true;
    });
    expect(result).toEqual(bad("LOCAL_EVIDENCE_CHANGED", "filesystem"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it.each([
  ["root Dir.read", "directory", "root"],
  ["selected Dir.read", "subtrees", "sample"],
] as const)("redacted %s rejection maps to LOCAL_IO_FAILED at %s", async (_label, at, target) => {
  const f = await createLocalSkillFixture();
  const originalOpenDir = fs.opendir;
  try {
    await f.directoryAt("sample");
    const targetPath = target === "root" ? f.root : join(f.root, "sample");
    vi.spyOn(fs, "opendir").mockImplementation(async (...args) => {
      const dir = await originalOpenDir(...args);
      if (String(args[0]) === targetPath) {
        vi.spyOn(dir, "read").mockRejectedValueOnce(Object.assign(new Error(`SENSITIVE ${targetPath}`), { code: "EIO" }));
      }
      return dir;
    });
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      if (target !== "root") await r.listDirectory(top[0]!, 1024);
      return true;
    });
    expect(result).toEqual(bad("LOCAL_IO_FAILED", at));
    expect(JSON.stringify(result)).not.toContain("SENSITIVE");
    expect(JSON.stringify(result)).not.toContain(targetPath);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it.each([
  ["immediate entry lstat", "namespace", false],
  ["nested entry lstat", "subtrees", true],
] as const)("redacted %s rejection maps to LOCAL_IO_FAILED at %s", async (_label, at, nested) => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/data.bin", Buffer.from("x"));
    const entryPath = nested ? join(f.root, "sample", "data.bin") : join(f.root, "sample");
    vi.spyOn(fs, "lstat").mockImplementation((async (...args) => {
      if (String(args[0]) === entryPath) {
        throw Object.assign(new Error(`SENSITIVE ${entryPath}`), { code: "EIO" });
      }
      return actual.lstat(String(args[0]), { bigint: true });
    }) as typeof fs.lstat);
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: nested ? ["sample"] : [] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      if (nested) await r.listDirectory(top[0]!, 1024);
      return true;
    });
    expect(result).toEqual(bad("LOCAL_IO_FAILED", at));
    expect(JSON.stringify(result)).not.toContain("SENSITIVE");
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("redacted open rejection of an unreadable nominated ordinary maps to LOCAL_IO_FAILED at subtrees", async () => {
  const f = await createLocalSkillFixture();
  const originalOpen = fs.open;
  try {
    await f.file("sample/data.bin", Buffer.from("secret-body"));
    const target = join(f.root, "sample", "data.bin");
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      if (String(args[0]) === target) {
        throw Object.assign(new Error(`SENSITIVE ${target}`), { code: "EACCES" });
      }
      return originalOpen(...args);
    });
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const files = await r.listDirectory(top[0]!, 1024);
      await r.readFile(files[0]!);
      return true;
    });
    expect(result).toEqual(bad("LOCAL_IO_FAILED", "subtrees"));
    expect(JSON.stringify(result)).not.toContain("SENSITIVE");
    expect(JSON.stringify(result)).not.toContain("secret-body");
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("redacted handle read rejection maps to LOCAL_IO_FAILED at subtrees", async () => {
  const f = await createLocalSkillFixture();
  const originalOpen = fs.open;
  try {
    await f.file("sample/data.bin", Buffer.from("body"));
    const target = join(f.root, "sample", "data.bin");
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) === target) {
        vi.spyOn(handle, "read").mockRejectedValueOnce(Object.assign(new Error(`SENSITIVE ${target}`), { code: "EIO" }));
      }
      return handle;
    });
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const files = await r.listDirectory(top[0]!, 1024);
      await r.readFile(files[0]!);
      return true;
    });
    expect(result).toEqual(bad("LOCAL_IO_FAILED", "subtrees"));
    expect(JSON.stringify(result)).not.toContain("SENSITIVE");
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it.each([0, 1, 65536, 65537, 1048576])("reads exact stable bytes of a %d-byte ordinary file", async size => {
  const f = await createLocalSkillFixture();
  const originalOpen = fs.open;
  try {
    const body = Buffer.alloc(size, 7);
    await f.file("sample/data.bin", body);
    const target = join(f.root, "sample", "data.bin");
    let reads = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) === target) {
        const realRead = handle.read.bind(handle);
        vi.spyOn(handle, "read").mockImplementation(async (...readArgs) => {
          reads++;
          return realRead(...(readArgs as Parameters<typeof realRead>));
        });
      }
      return handle;
    });
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const files = await r.listDirectory(top[0]!, 1024);
      return await r.readFile(files[0]!);
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.equals(body)).toBe(true);
    expect(reads).toBe(Math.ceil(size / OFFLINE_LOCAL_SKILL_LIMITS.chunkBytes) + 1);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it.each([
  ["zero bytesRead", { bytesRead: 0 }],
  ["positive short chunk", { bytesRead: 2 }],
] as const)("inconsistent %s fails LOCAL_EVIDENCE_CHANGED at filesystem", async (_label, fault) => {
  const f = await createLocalSkillFixture();
  const originalOpen = fs.open;
  try {
    await f.file("sample/data.bin", Buffer.alloc(16, 7));
    const target = join(f.root, "sample", "data.bin");
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) === target) {
        vi.spyOn(handle, "read").mockImplementationOnce(
          (async (buffer: Buffer) => ({ bytesRead: fault.bytesRead, buffer: buffer as Buffer })) as unknown as typeof handle.read);
      }
      return handle;
    });
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const files = await r.listDirectory(top[0]!, 1024);
      await r.readFile(files[0]!);
      return true;
    });
    expect(result).toEqual(bad("LOCAL_EVIDENCE_CHANGED", "filesystem"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("growth detected by the EOF probe fails LOCAL_EVIDENCE_CHANGED at filesystem", async () => {
  const f = await createLocalSkillFixture();
  const originalOpen = fs.open;
  try {
    await f.file("sample/data.bin", Buffer.alloc(16, 7));
    const target = join(f.root, "sample", "data.bin");
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) === target) {
        const realRead = handle.read.bind(handle);
        let calls = 0;
        vi.spyOn(handle, "read").mockImplementation(
          (async (...readArgs: unknown[]) => {
            calls++;
            if (calls === 1) return await (realRead as (...a: unknown[]) => Promise<{ bytesRead: number; buffer: Buffer }>)(...readArgs);
            // Second call is the one-byte EOF probe: report growth with the genuine probe buffer.
            return { bytesRead: 1, buffer: readArgs[0] as Buffer };
          }) as unknown as typeof handle.read);
      }
      return handle;
    });
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const files = await r.listDirectory(top[0]!, 1024);
      await r.readFile(files[0]!);
      return true;
    });
    expect(result).toEqual(bad("LOCAL_EVIDENCE_CHANGED", "filesystem"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it.each([
  ["negative bytesRead", { bytesRead: -1, buffer: Buffer.alloc(0) }],
  ["non-integer bytesRead", { bytesRead: 1.5, buffer: Buffer.alloc(0) }],
  ["mismatched buffer", { bytesRead: 16, buffer: Buffer.alloc(16) }],
] as const)("impossible read response (%s) fails LOCAL_IO_FAILED at subtrees", async (_label, fault) => {
  const f = await createLocalSkillFixture();
  const originalOpen = fs.open;
  try {
    await f.file("sample/data.bin", Buffer.alloc(16, 7));
    const target = join(f.root, "sample", "data.bin");
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) === target) {
        vi.spyOn(handle, "read").mockImplementationOnce((async () => fault) as unknown as typeof handle.read);
      }
      return handle;
    });
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const files = await r.listDirectory(top[0]!, 1024);
      await r.readFile(files[0]!);
      return true;
    });
    expect(result).toEqual(bad("LOCAL_IO_FAILED", "subtrees"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("exact root manifest byte ceiling is allowed and 262145 fails LIMIT_EXCEEDED at subtrees before the body", async () => {
  const f = await createLocalSkillFixture();
  const originalOpen = fs.open;
  try {
    await f.file("sample/orgops-package.json", Buffer.alloc(262144, 0x20));
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const files = await r.listDirectory(top[0]!, 1024);
      return (await r.readFile(files[0]!)).length;
    });
    expect(result).toEqual({ ok: true, value: 262144 });
    vi.restoreAllMocks();
    const f2 = await createLocalSkillFixture();
    try {
      await f2.file("sample/orgops-package.json", Buffer.alloc(262145, 0x20));
      const opens = vi.spyOn(fs, "open");
      const result2 = await withLocalSkillRoot({ directory: f2.root, nominatedNames: ["sample"] }, undefined, async r => {
        const top = await r.listDirectory(r.root, 4096);
        const files = await r.listDirectory(top[0]!, 1024);
        await r.readFile(files[0]!);
        return true;
      });
      expect(result2).toEqual(bad("LIMIT_EXCEEDED", "subtrees"));
      expect(opens.mock.calls.some(([path]) => String(path) === join(f2.root, "sample", "orgops-package.json"))).toBe(false);
    } finally { vi.restoreAllMocks(); await f2.dispose(); }
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("ordinary byte ceiling is allowed at 1048576 and 1048577 fails LIMIT_EXCEEDED at subtrees before the body", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/big.bin", Buffer.alloc(1048576, 1));
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const files = await r.listDirectory(top[0]!, 1024);
      return (await r.readFile(files[0]!)).length;
    });
    expect(result).toEqual({ ok: true, value: 1048576 });
    vi.restoreAllMocks();
    const f2 = await createLocalSkillFixture();
    try {
      await f2.file("sample/big.bin", Buffer.alloc(1048577, 1));
      const opens = vi.spyOn(fs, "open");
      const result2 = await withLocalSkillRoot({ directory: f2.root, nominatedNames: ["sample"] }, undefined, async r => {
        const top = await r.listDirectory(r.root, 4096);
        const files = await r.listDirectory(top[0]!, 1024);
        await r.readFile(files[0]!);
        return true;
      });
      expect(result2).toEqual(bad("LIMIT_EXCEEDED", "subtrees"));
      expect(opens.mock.calls.some(([path]) => String(path) === join(f2.root, "sample", "big.bin"))).toBe(false);
    } finally { vi.restoreAllMocks(); await f2.dispose(); }
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("nested and aliased manifests are ordinary files under the 1MiB ceiling", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/sub/orgops-package.json", Buffer.alloc(300000, 0x20));
    await f.file("sample/ORGOPS-PACKAGE.json", Buffer.alloc(300000, 0x20));
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const entries = await r.listDirectory(top[0]!, 1024);
      let bytes = 0;
      for (const record of entries) {
        if (record.type === "file") bytes += (await r.readFile(record)).length;
        else for (const nested of await r.listDirectory(record, 1024)) {
          bytes += (await r.readFile(nested)).length;
        }
      }
      return bytes;
    });
    expect(result).toEqual({ ok: true, value: 600000 });
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("rejects forged, cross-operation and re-used records at filesystem without extra I/O", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/data.bin", Buffer.from("x"));
    const first = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const files = await r.listDirectory(top[0]!, 1024);
      await r.readFile(files[0]!);
      return { root: r.root, sample: top[0]!, file: files[0]! } as { root: LocalSkillRecord; sample: LocalSkillRecord; file: LocalSkillRecord };
    });
    expect(first.ok).toBe(true);
    const captured = first.ok ? first.value : undefined;
    expect(captured).toBeDefined();
    // Misuse is terminal: each malformed reader use fails the whole operation.
    const forged = Object.freeze({ path: "", type: "directory", stat: captured!.root.stat }) as LocalSkillRecord;
    expect(await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      await r.listDirectory(forged, 4096);
      return true;
    })).toEqual(bad("INVALID_LOCAL_INPUT", "filesystem"));
    expect(await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      await r.listDirectory(captured!.root, 4096);
      return true;
    })).toEqual(bad("INVALID_LOCAL_INPUT", "filesystem"));
    expect(await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      await r.readFile(captured!.file);
      return true;
    })).toEqual(bad("INVALID_LOCAL_INPUT", "filesystem"));
    const stats = vi.spyOn(fs, "lstat");
    const opens = vi.spyOn(fs, "open");
    expect(await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async r => {
      await r.listDirectory(r.root, 4096);
      await r.listDirectory(r.root, 4096);
      return true;
    })).toEqual(bad("INVALID_LOCAL_INPUT", "filesystem"));
    expect(opens.mock.calls.length).toBe(1); // one full root listing; the duplicate is refused before its own I/O
    vi.restoreAllMocks();
    const opens2 = vi.spyOn(fs, "open");
    expect(await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const files = await r.listDirectory(top[0]!, 1024);
      await r.readFile(files[0]!);
      await r.readFile(files[0]!);
      return true;
    })).toEqual(bad("INVALID_LOCAL_INPUT", "filesystem"));
    expect(opens2.mock.calls.length).toBe(3); // root dir, sample dir, file body, then refused re-read
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it.each([-1, 1.5, 4097])("rejects invalid maxEntries %d at filesystem without extra I/O", async maxEntries => {
  const f = await createLocalSkillFixture();
  try {
    const opens = vi.spyOn(fs, "open");
    expect(await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async r => {
      await r.listDirectory(r.root, maxEntries);
      return true;
    })).toEqual(bad("INVALID_LOCAL_INPUT", "filesystem"));
    expect(opens.mock.calls.length).toBe(0);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("listDirectory maxEntries 0 and 1: complete empty and single allowed; +1 fails at namespace or subtrees", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/a", Buffer.from("a"));
    await f.file("sample/b", Buffer.from("b"));
    await fs.mkdir(join(f.root, "empty"));
    await fs.mkdir(join(f.directory, "one"));
    await fs.writeFile(join(f.directory, "one", "only"), Buffer.from("x"));
    expect(await withLocalSkillRoot({ directory: join(f.root, "empty"), nominatedNames: [] }, undefined, async r =>
      (await r.listDirectory(r.root, 0)).length)).toEqual({ ok: true, value: 0 });
    expect(await withLocalSkillRoot({ directory: join(f.directory, "one"), nominatedNames: [] }, undefined, async r =>
      (await r.listDirectory(r.root, 1)).map(record => record.path))).toEqual({ ok: true, value: ["only"] });
    expect(await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async r => {
      await r.listDirectory(r.root, 0);
      return true;
    })).toEqual(bad("LIMIT_EXCEEDED", "namespace"));
    expect(await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async r => {
      await r.listDirectory(r.root, 1);
      return true;
    })).toEqual(bad("LIMIT_EXCEEDED", "namespace"));
    expect(await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const sample = top.find(record => record.path === "sample")!;
      await r.listDirectory(sample, 1);
      return true;
    })).toEqual(bad("LIMIT_EXCEEDED", "subtrees"));
    expect(await withLocalSkillRoot({ directory: f.root, nominatedNames: ["empty"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const empty = top.find(record => record.path === "empty")!;
      return (await r.listDirectory(empty, 0)).length;
    })).toEqual({ ok: true, value: 0 });
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("the +1 overflow entry is inspected but not validated or retained", async () => {
  const f = await createLocalSkillFixture();
  try {
    await fs.mkdir(join(f.root, "ok"));
    const prefix = Buffer.from(`${f.root}/`, "utf8");
    await fs.mkdir(Buffer.concat([prefix, Buffer.from([0xff])]));
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async r => {
      await r.listDirectory(r.root, 1);
      return true;
    });
    expect(result).toEqual(bad("LIMIT_EXCEEDED", "namespace"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("relative path depth beyond 64 components fails UNSAFE_PATH at subtrees at the observed entry", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.directoryAt(`sample/${Array(64).fill("d").join("/")}`);
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      let record: LocalSkillRecord = top[0]!;
      for (let i = 0; i < 70; i++) {
        const entries = await r.listDirectory(record, 1024);
        if (!entries.length) break;
        record = entries[0]!;
      }
      return true;
    });
    expect(result).toEqual(bad("UNSAFE_PATH", "subtrees"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("absolute joined path beyond the root byte ceiling fails LIMIT_EXCEEDED at namespace at the observed entry", async () => {
  // Linux PATH_MAX keeps real joined paths under 4096, so this guard is exercised through a
  // private reduced rootPathBytes double rather than an impossible real deep fixture.
  const f = await createLocalSkillFixture();
  try {
    await fs.mkdir(join(f.root, "samples"));
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ rootPathBytes: f.root.length + 7 }));
    const fresh = await import("./local-skill-root");
    expect(await fresh.withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async r => {
      await r.listDirectory(r.root, 4096);
      return true;
    })).toEqual(bad("LIMIT_EXCEEDED", "namespace"));
  } finally {
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    await f.dispose();
  }
});

it("local-skill-root awaits a late-opened owned handle after abort", async () => {
  const f = await createLocalSkillFixture();
  const controller = new AbortController();
  let release!: () => void;
  let h: FileHandle | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  const opened = vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
    h = await actual.open(...(args as Parameters<typeof actual.open>));
    await gate;
    return h;
  });
  try {
    const pending = withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, { signal: controller.signal }, async r => {
      await r.listDirectory(r.root, 4096);
      return true;
    }).then(r => { settled = true; return r; });
    await vi.waitFor(() => expect(h).toBeDefined());
    controller.abort();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    release();
    expect(await pending).toEqual(bad("LOCAL_ABORTED", "filesystem"));
    expect(h!.fd).toBe(-1);
    expect(opened).toHaveBeenCalledTimes(1);
  } finally {
    release();
    vi.restoreAllMocks();
    if (h && h.fd !== -1) await h.close();
    await f.dispose();
  }
});

it("awaits a late-opened directory enumerator after abort and closes both owned handles", async () => {
  const f = await createLocalSkillFixture();
  const controller = new AbortController();
  const originalOpen = fs.open, originalOpenDir = fs.opendir;
  let release!: () => void;
  let h: FileHandle | undefined;
  let d: Dir | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  try {
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      h = await originalOpen(...args);
      return h;
    });
    vi.spyOn(fs, "opendir").mockImplementationOnce(async (...args) => {
      d = await originalOpenDir(...args);
      await gate;
      return d;
    });
    const pending = withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, { signal: controller.signal }, async r => {
      await r.listDirectory(r.root, 4096);
      return true;
    }).then(r => { settled = true; return r; });
    await vi.waitFor(() => expect(d).toBeDefined());
    controller.abort();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    release();
    expect(await pending).toEqual(bad("LOCAL_ABORTED", "filesystem"));
    expect(h!.fd).toBe(-1);
    const dir = d as unknown as { closed?: boolean };
    expect(dir.closed).toBeUndefined();
  } finally {
    release();
    vi.restoreAllMocks();
    if (h && h.fd !== -1) await h.close();
    await f.dispose();
  }
});

it("awaits a deferred Dir.read after abort without early settlement", async () => {
  const f = await createLocalSkillFixture();
  const controller = new AbortController();
  const originalOpenDir = fs.opendir;
  let release!: () => void;
  let d: Dir | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  try {
    vi.spyOn(fs, "opendir").mockImplementationOnce(async (...args) => {
      const dir = await originalOpenDir(...args);
      const realRead = dir.read.bind(dir);
      vi.spyOn(dir, "read").mockImplementationOnce(async () => { await gate; return await realRead(); });
      d = dir;
      return dir;
    });
    const pending = withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, { signal: controller.signal }, async r => {
      await r.listDirectory(r.root, 4096);
      return true;
    }).then(r => { settled = true; return r; });
    await vi.waitFor(() => expect(d).toBeDefined());
    controller.abort();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    release();
    expect(await pending).toEqual(bad("LOCAL_ABORTED", "filesystem"));
  } finally {
    release();
    vi.restoreAllMocks();
    await f.dispose();
  }
});

it("awaits a pending owned FileHandle close after abort and never settles early", async () => {
  const f = await createLocalSkillFixture();
  const controller = new AbortController();
  const originalOpen = fs.open;
  let release!: () => void;
  let h: FileHandle | undefined;
  let closeStarted = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  try {
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      h = await originalOpen(...args);
      const realClose = h.close.bind(h);
      h.close = async () => { closeStarted = true; await gate; await realClose(); };
      return h;
    });
    const pending = withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, { signal: controller.signal }, async r => {
      await r.listDirectory(r.root, 4096);
      return true;
    }).then(r => { settled = true; return r; });
    await vi.waitFor(() => expect(closeStarted).toBe(true));
    controller.abort();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    release();
    expect(await pending).toEqual(bad("LOCAL_ABORTED", "filesystem"));
    expect(h!.fd).toBe(-1);
  } finally {
    release();
    vi.restoreAllMocks();
    if (h && h.fd !== -1) await h.close();
    await f.dispose();
  }
});

it("suppresses success when the deadline passes during a pending close", async () => {
  const f = await createLocalSkillFixture();
  const originalOpen = fs.open;
  const now = performance.now.bind(performance);
  let offset = 0;
  let first = true;
  let release!: () => void;
  let h: FileHandle | undefined;
  let closeStarted = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  try {
    vi.spyOn(performance, "now").mockImplementation(() => now() + (first ? (first = false, 0) : offset));
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      h = await originalOpen(...args);
      const realClose = h.close.bind(h);
      h.close = async () => { closeStarted = true; await gate; await realClose(); };
      return h;
    });
    const pending = withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async r => {
      await r.listDirectory(r.root, 4096);
      return true;
    }).then(r => { settled = true; return r; });
    await vi.waitFor(() => expect(closeStarted).toBe(true));
    offset = 20000;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    release();
    expect(await pending).toEqual(bad("LOCAL_TIMEOUT", "filesystem"));
    expect(h!.fd).toBe(-1);
  } finally {
    release();
    vi.restoreAllMocks();
    if (h && h.fd !== -1) await h.close();
    await f.dispose();
  }
});

it("FileHandle close throwing after a confirmed real close selects LOCAL_IO_FAILED at filesystem", async () => {
  const f = await createLocalSkillFixture();
  const originalOpen = fs.open;
  let h: FileHandle | undefined;
  let realClose: (() => Promise<void>) | undefined;
  try {
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      h = await originalOpen(...args);
      realClose = h.close.bind(h);
      h.close = async () => { await realClose!(); throw new Error("SENSITIVE_CLOSE_ERROR"); };
      return h;
    });
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, listRoot);
    expect(result).toEqual(bad("LOCAL_IO_FAILED", "filesystem"));
    expect(JSON.stringify(result)).not.toContain("SENSITIVE_CLOSE_ERROR");
  } finally {
    vi.restoreAllMocks();
    if (realClose && h && h.fd !== -1) await realClose();
    await f.dispose();
  }
});

it("FileHandle close throwing without a confirmed close selects LOCAL_CLEANUP_FAILED at filesystem", async () => {
  const f = await createLocalSkillFixture();
  const originalOpen = fs.open;
  let h: FileHandle | undefined;
  let realClose: (() => Promise<void>) | undefined;
  try {
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      h = await originalOpen(...args);
      realClose = h.close.bind(h);
      h.close = async () => { throw new Error("SENSITIVE_CLOSE_ERROR"); };
      return h;
    });
    expect(await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, listRoot))
      .toEqual(bad("LOCAL_CLEANUP_FAILED", "filesystem"));
  } finally {
    vi.restoreAllMocks();
    if (realClose && h && h.fd !== -1) await realClose();
    await f.dispose();
  }
});

it("Dir close rejecting with ERR_DIR_CLOSED selects LOCAL_IO_FAILED; ambiguous rejections select LOCAL_CLEANUP_FAILED", async () => {
  const f = await createLocalSkillFixture();
  const originalOpenDir = fs.opendir;
  try {
    vi.spyOn(fs, "opendir").mockImplementationOnce(async (...args) => {
      const dir = await originalOpenDir(...args);
      const realClose = dir.close.bind(dir);
      dir.close = async () => {
        await realClose();
        throw Object.assign(new Error("SENSITIVE_DIR_CLOSE"), { code: "ERR_DIR_CLOSED" });
      };
      return dir;
    });
    expect(await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, listRoot))
      .toEqual(bad("LOCAL_IO_FAILED", "filesystem"));
    vi.restoreAllMocks();
    vi.spyOn(fs, "opendir").mockImplementationOnce(async (...args) => {
      const dir = await originalOpenDir(...args);
      const realClose = dir.close.bind(dir);
      dir.close = async () => { throw new Error("SENSITIVE_DIR_CLOSE"); };
      void realClose;
      return dir;
    });
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, listRoot);
    expect(result).toEqual(bad("LOCAL_CLEANUP_FAILED", "filesystem"));
    expect(JSON.stringify(result)).not.toContain("SENSITIVE_DIR_CLOSE");
  } finally {
    vi.restoreAllMocks();
    await f.dispose();
  }
});

it("an unconfirmed close overrides success, abort, timeout and earlier errors; other closes are still attempted", async () => {
  const f = await createLocalSkillFixture();
  const originalOpen = fs.open, originalOpenDir = fs.opendir;
  try {
    // Pending success: the listing completes, but its handle close is unconfirmed.
    let dirCloseAttempts = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      handle.close = async () => { throw new Error("SENSITIVE_CLOSE_ERROR"); };
      return handle;
    });
    vi.spyOn(fs, "opendir").mockImplementation(async (...args) => {
      const dir = await originalOpenDir(...args);
      const realClose = dir.close.bind(dir);
      dir.close = async () => { dirCloseAttempts++; await realClose(); };
      return dir;
    });
    expect(await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, listRoot))
      .toEqual(bad("LOCAL_CLEANUP_FAILED", "filesystem"));
    expect(dirCloseAttempts).toBe(1);
    vi.restoreAllMocks();
    // Earlier read error: Dir.read rejects and the pending handle close is unconfirmed.
    let dirCloseAttempts2 = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      handle.close = async () => { throw new Error("SENSITIVE_CLOSE_ERROR"); };
      return handle;
    });
    vi.spyOn(fs, "opendir").mockImplementation(async (...args) => {
      const dir = await originalOpenDir(...args);
      const realClose = dir.close.bind(dir);
      dir.close = async () => { dirCloseAttempts2++; await realClose(); };
      vi.spyOn(dir, "read").mockRejectedValueOnce(Object.assign(new Error("SENSITIVE_READ"), { code: "EIO" }));
      return dir;
    });
    expect(await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, listRoot))
      .toEqual(bad("LOCAL_CLEANUP_FAILED", "filesystem"));
    expect(dirCloseAttempts2).toBe(1);
    vi.restoreAllMocks();
    // Abort and timeout noticed while a poisoned close is pending still lose to cleanup.
    for (const mode of ["abort", "timeout"] as const) {
      const controller = new AbortController();
      const now = performance.now.bind(performance);
      let offset = 0;
      let first = true;
      let dirCloseAttempts3 = 0;
      let release!: () => void;
      let closeStarted = false;
      let gatedHandle: FileHandle | undefined;
      let gatedRealClose: (() => Promise<void>) | undefined;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let settled = false;
      if (mode === "timeout") {
        vi.spyOn(performance, "now").mockImplementation(() => now() + (first ? (first = false, 0) : offset));
      }
      vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
        const handle = await originalOpen(...args);
        const realClose = handle.close.bind(handle);
        gatedHandle = handle;
        gatedRealClose = realClose;
        handle.close = async () => { closeStarted = true; await gate; void realClose; throw new Error("SENSITIVE_CLOSE_ERROR"); };
        return handle;
      });
      vi.spyOn(fs, "opendir").mockImplementationOnce(async (...args) => {
        const dir = await originalOpenDir(...args);
        const realClose = dir.close.bind(dir);
        dir.close = async () => { dirCloseAttempts3++; await realClose(); };
        return dir;
      });
      const pending = withLocalSkillRoot(
        { directory: f.root, nominatedNames: [] },
        mode === "abort" ? { signal: controller.signal } : undefined,
        listRoot,
      ).then(r => { settled = true; return r; });
      await vi.waitFor(() => expect(closeStarted).toBe(true));
      if (mode === "abort") controller.abort();
      else offset = 20000;
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(settled).toBe(false);
      release();
      expect(await pending).toEqual(bad("LOCAL_CLEANUP_FAILED", "filesystem"));
      expect(dirCloseAttempts3).toBe(1);
      if (gatedRealClose && gatedHandle && gatedHandle.fd !== -1) await gatedRealClose();
      vi.restoreAllMocks();
    }
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("abort wins when abort and timeout are first noticed together", async () => {
  const stats = vi.spyOn(fs, "lstat");
  const controller = new AbortController();
  controller.abort();
  const now = performance.now.bind(performance);
  let calls = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now() - (calls++ === 0 ? 20000 : 0));
  expect(await invoke({ directory: "/DO_NOT_READ", nominatedNames: [] }, { signal: controller.signal }))
    .toEqual(bad("LOCAL_ABORTED", "filesystem"));
  expect(stats).not.toHaveBeenCalled();
});

it("deadline reached during the final recheck suppresses success", async () => {
  const f = await createLocalSkillFixture();
  const now = performance.now.bind(performance);
  let offset = 0;
  let first = true;
  try {
    vi.spyOn(performance, "now").mockImplementation(() => now() + (first ? (first = false, 0) : offset));
    await f.file("sample/data.bin", Buffer.from("x"));
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const files = await r.listDirectory(top[0]!, 1024);
      await r.readFile(files[0]!);
      offset = 20000;
      return true;
    });
    expect(result).toEqual(bad("LOCAL_TIMEOUT", "filesystem"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("a prior selected issue is retained over a later abort", async () => {
  const f = await createLocalSkillFixture();
  const controller = new AbortController();
  try {
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, { signal: controller.signal }, async r => {
      let rejected = false;
      try { r.fail("UNSAFE_PATH", "subtrees"); } catch { rejected = true; }
      expect(rejected).toBe(true);
      controller.abort();
      return true;
    });
    expect(result).toEqual(bad("UNSAFE_PATH", "subtrees"));
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("keeps at most one pending operation and two live handles, with nothing after settlement", async () => {
  const f = await createLocalSkillFixture();
  const originalOpen = fs.open, originalOpenDir = fs.opendir;
  try {
    await f.file("sample/data.bin", Buffer.from([1, 2, 3]));
    let pendingOps = 0, maxPending = 0, liveHandles = 0, maxHandles = 0;
    const enter = () => { pendingOps++; maxPending = Math.max(maxPending, pendingOps); };
    const exit = () => { pendingOps--; };
    const opened = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      enter();
      const handle = await originalOpen(...args);
      exit();
      liveHandles++; maxHandles = Math.max(maxHandles, liveHandles);
      const realClose = handle.close.bind(handle);
      handle.close = async () => { try { await realClose(); } finally { liveHandles--; } };
      const realStat = handle.stat.bind(handle);
      handle.stat = (async (...statArgs: unknown[]) => {
        enter();
        try { return await (realStat as (...a: unknown[]) => Promise<BigIntStats>)(...statArgs); }
        finally { exit(); }
      }) as typeof handle.stat;
      const realRead = handle.read.bind(handle);
      handle.read = (async (...readArgs: unknown[]) => {
        enter();
        try { return await (realRead as (...a: unknown[]) => Promise<{ bytesRead: number; buffer: Buffer }>)(...readArgs); }
        finally { exit(); }
      }) as typeof handle.read;
      return handle;
    });
    const opendirSpy = vi.spyOn(fs, "opendir").mockImplementation(async (...args) => {
      enter();
      const dir = await originalOpenDir(...args);
      exit();
      liveHandles++; maxHandles = Math.max(maxHandles, liveHandles);
      const realClose = dir.close.bind(dir);
      dir.close = async () => { try { await realClose(); } finally { liveHandles--; } };
      const realRead = dir.read.bind(dir);
      dir.read = (async () => { enter(); try { return await realRead(); } finally { exit(); } }) as typeof dir.read;
      return dir;
    });
    const stats = vi.spyOn(fs, "lstat").mockImplementation((async (...args) => {
      enter();
      try { return await actual.lstat(String(args[0]), { bigint: true }); }
      finally { exit(); }
    }) as typeof fs.lstat);
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const files = await r.listDirectory(top[0]!, 1024);
      return (await r.readFile(files[0]!)).toString("hex");
    });
    expect(result).toEqual({ ok: true, value: "010203" });
    const counts = () => [opened, opendirSpy, stats].map(spy => spy.mock.calls.length);
    const before = counts();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(counts()).toEqual(before);
    expect(pendingOps).toBe(0);
    expect(liveHandles).toBe(0);
    expect(maxPending).toBe(1);
    expect(maxHandles).toBeLessThanOrEqual(2);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("acquisition performs no mutating filesystem calls and no readlink", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("sample/data.bin", Buffer.from("x"));
    await fs.symlink(join(f.root, "sample", "data.bin"), join(f.root, "sample", "link"));
    const mutations = [
      vi.spyOn(fs, "writeFile"), vi.spyOn(fs, "mkdir"), vi.spyOn(fs, "rm"), vi.spyOn(fs, "rename"),
      vi.spyOn(fs, "chmod"), vi.spyOn(fs, "symlink"), vi.spyOn(fs, "link"), vi.spyOn(fs, "appendFile"),
      vi.spyOn(fs, "truncate"), vi.spyOn(fs, "copyFile"), vi.spyOn(fs, "readlink"),
    ];
    const result = await withLocalSkillRoot({ directory: f.root, nominatedNames: ["sample"] }, undefined, async r => {
      const top = await r.listDirectory(r.root, 4096);
      const entries = await r.listDirectory(top[0]!, 1024);
      for (const record of entries) {
        if (record.type === "file") await r.readFile(record);
      }
      return true;
    });
    expect(result).toEqual({ ok: true, value: true });
    for (const spy of mutations) expect(spy).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it("public limits are frozen and cannot be raised", () => {
  expect(Object.isFrozen(OFFLINE_LOCAL_SKILL_LIMITS)).toBe(true);
  expect(() => { (OFFLINE_LOCAL_SKILL_LIMITS as { fsCalls?: number }).fsCalls = 999999; }).toThrow();
  expect(OFFLINE_LOCAL_SKILL_LIMITS.fsCalls).toBe(350000);
  expect(OFFLINE_LOCAL_SKILL_LIMITS.workUnits).toBe(524288);
  expect(OFFLINE_LOCAL_SKILL_LIMITS.yields).toBe(8192);
});

it("reduced private fsCalls ceiling: exact boundary succeeds, one below fails at filesystem", async () => {
  const f = await createLocalSkillFixture();
  try {
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ fsCalls: 3 }));
    const fresh = await import("./local-skill-root");
    // Minimal successful flow: root lstat plus final recheck lstat, reservation included.
    expect(await fresh.withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async () => true))
      .toEqual({ ok: true, value: true });
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ fsCalls: 2 }));
    const fresh2 = await import("./local-skill-root");
    expect(await fresh2.withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async () => true))
      .toEqual(bad("LIMIT_EXCEEDED", "filesystem"));
  } finally {
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    await f.dispose();
  }
});

it("reduced private fsCalls failure still attempts owned closes", async () => {
  const f = await createLocalSkillFixture();
  try {
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ fsCalls: 6 }));
    const fresh = await import("./local-skill-root");
    const freshPromises = await import("node:fs/promises");
    let capturedHandle: FileHandle | undefined;
    let dirCloseAttempts = 0;
    vi.spyOn(freshPromises, "open").mockImplementation(async (...args) => {
      capturedHandle = await actual.open(...(args as Parameters<typeof actual.open>));
      return capturedHandle;
    });
    vi.spyOn(freshPromises, "opendir").mockImplementation(async (...args) => {
      const dir = await actual.opendir(...(args as Parameters<typeof actual.opendir>));
      const realClose = dir.close.bind(dir);
      dir.close = async () => { dirCloseAttempts++; await realClose(); };
      return dir;
    });
    expect(await fresh.withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async r => {
      await r.listDirectory(r.root, 4096);
      return true;
    })).toEqual(bad("LIMIT_EXCEEDED", "filesystem"));
    expect(dirCloseAttempts).toBe(1);
    expect(capturedHandle!.fd).toBe(-1);
  } finally {
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    vi.restoreAllMocks();
    await f.dispose();
  }
});

it("reduced private workUnits ceiling: exact boundary succeeds, one below fails at filesystem", async () => {
  const f = await createLocalSkillFixture();
  try {
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ workUnits: 7 }));
    const fresh = await import("./local-skill-root");
    // Minimal flow work units: entry checkpoint, root lstat pair, final recheck pair plus final check.
    expect(await fresh.withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async () => true))
      .toEqual({ ok: true, value: true });
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ workUnits: 6 }));
    const fresh2 = await import("./local-skill-root");
    expect(await fresh2.withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async () => true))
      .toEqual(bad("LIMIT_EXCEEDED", "filesystem"));
  } finally {
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    await f.dispose();
  }
});

it("reduced private yields ceiling: exact boundary succeeds, one below fails at filesystem", async () => {
  const f = await createLocalSkillFixture();
  try {
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ yields: 2 }));
    const fresh = await import("./local-skill-root");
    // 129 explicit checkpoints give 7 + 129 = 136 units, crossing the 64 and 128 yield marks exactly twice.
    expect(await fresh.withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async r => {
      for (let i = 0; i < 129; i++) await r.checkpoint();
      return true;
    })).toEqual({ ok: true, value: true });
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ yields: 1 }));
    const fresh2 = await import("./local-skill-root");
    expect(await fresh2.withLocalSkillRoot({ directory: f.root, nominatedNames: [] }, undefined, async r => {
      for (let i = 0; i < 129; i++) await r.checkpoint();
      return true;
    })).toEqual(bad("LIMIT_EXCEEDED", "filesystem"));
  } finally {
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    await f.dispose();
  }
});

it("reduced private record registry bound fails LIMIT_EXCEEDED at filesystem", async () => {
  const f = await createLocalSkillFixture();
  try {
    await f.file("s1/a", Buffer.from("a"));
    await f.file("s1/b", Buffer.from("b"));
    await f.file("s1/c", Buffer.from("c"));
    await f.file("s1/d", Buffer.from("d"));
    await f.file("s2/a", Buffer.from("a"));
    await f.file("s2/b", Buffer.from("b"));
    await f.file("s2/c", Buffer.from("c"));
    vi.resetModules();
    vi.doMock("./local-skill-evidence-types", reducedLimits({ namespaceEntries: 4, localTreeEntries: 4 }));
    const fresh = await import("./local-skill-root");
    // Registry bound 4 + 4 + 1 = 9: root, two nominated dirs, four s1 files, two s2 files; the ninth is refused.
    expect(await fresh.withLocalSkillRoot({ directory: f.root, nominatedNames: ["s1", "s2"] }, undefined, async (r: LocalSkillRootReader) => {
      const top = await r.listDirectory(r.root, 4);
      const s1 = await r.listDirectory(top[0]!, 4);
      for (const record of s1) await r.readFile(record);
      await r.listDirectory(top[1]!, 4);
      return true;
    })).toEqual(bad("LIMIT_EXCEEDED", "filesystem"));
  } finally {
    vi.doUnmock("./local-skill-evidence-types");
    vi.resetModules();
    await f.dispose();
  }
});
