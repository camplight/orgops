import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import type { PackageManifest } from "@orgops/schemas";
import { computePackageDigest, inspectPackage, type ContentEntry } from "./content";
import { must, expectCode, skillManifest, skillEntries, classicManifest, rlmManifest, wrappedManifest, fixtureDigests } from "./fixtures";

const clone = <T>(value: T): T => structuredClone(value);
const file = (path: string, bytes: string | Buffer = "", executable = false): ContentEntry => ({ type: "file", path, base64: Buffer.from(bytes).toString("base64"), executable });
function draft(entries: ContentEntry[], manifest: PackageManifest = skillManifest): PackageManifest {
  return { ...clone(manifest), files: entries.flatMap(entry => {
    if (entry.type !== "file") return [];
    const bytes = Buffer.from(entry.base64, "base64");
    return [{ path: entry.path, size: bytes.length, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, executable: entry.executable }];
  }) };
}
function seal(manifest: PackageManifest, entries: ContentEntry[]) {
  return { ...manifest, digest: must(computePackageDigest(manifest, entries)) };
}
it.each([[skillManifest, skillEntries, fixtureDigests.skill], [classicManifest, [], fixtureDigests.classic], [rlmManifest, [], fixtureDigests.rlm], [wrappedManifest, [], fixtureDigests.wrapped]] as const)("matches independent fixed digest oracle %#", (manifest, entries, digest) => {
  expect(must(computePackageDigest(manifest, entries))).toBe(digest);
  expect(must(inspectPackage(manifest, entries)).manifest.digest).toBe(digest);
});
it("inspects throwing API module as bytes without execution and freezes detached data", () => {
  const manifest = clone(skillManifest), entries = clone(skillEntries);
  const before = clone({ manifest, entries });
  const snapshot = must(inspectPackage(manifest, entries));
  expect(snapshot.execution).toEqual({ apiEventShapes: ["event-shapes.ts"], runnerScripts: [], wrappedCommands: [], externalSources: [] });
  expect(snapshot.warnings).toContainEqual({ code: "MANUAL_REVIEW_REQUIRED", at: "$" });
  expect({ manifest, entries }).toEqual(before);
  function frozen(value: unknown) {
    if (value && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen); }
  }
  frozen(snapshot);
  manifest.author = "Changed"; entries[0] = file("other");
  expect(snapshot.manifest.author).toBe("Example Authors");
  expect(snapshot.files.find(f => f.path === "SKILL.md")?.base64).toBe(skillEntries[0]?.type === "file" ? skillEntries[0].base64 : "");
});
it("normalizes semantic set order and object key order but covers authored metadata", () => {
  const m = clone(skillManifest);
  m.files.reverse(); m.executables.reverse(); m.compatibility.platforms.reverse();
  expect(must(computePackageDigest(m, [...skillEntries].reverse()))).toBe(fixtureDigests.skill);
  expect(must(computePackageDigest({ ...m, author: "Other Authors" }, skillEntries))).not.toBe(fixtureDigests.skill);
  expectCode(inspectPackage({ ...m, author: "Other Authors" }, skillEntries), "DIGEST_MISMATCH");
  m.digest = `sha256:${"0".repeat(64)}`;
  expect(must(computePackageDigest(m, skillEntries))).toBe(fixtureDigests.skill);
  expectCode(inspectPackage(m, skillEntries), "DIGEST_MISMATCH");
});
it.each(["symlink", "hardlink", "directory", "device", "fifo", "socket"] as const)("rejects %s without dereference", kind => {
  const entry: ContentEntry = kind === "symlink" || kind === "hardlink" ? { type: kind, path: "alias", target: "SKILL.md" } : { type: "special", path: "alias", specialType: kind };
  expectCode(inspectPackage(skillManifest, [...skillEntries, entry]), "UNSUPPORTED_ENTRY");
});
it.each(["../escape", "/root", "a\\b", "a//b", "a/CON.txt", "node_modules/x", ".git/x", "orgops-package.json", "ORGOPS-PACKAGE.JSON", "a%20b"])("rejects unsafe path %s", path => {
  expectCode(inspectPackage(skillManifest, [...skillEntries, file(path)]), "UNSAFE_PATH");
});
it.each(["orgops-package.json/notes.txt", "ORGOPS-PACKAGE.JSON/notes.txt"])("rejects reserved manifest ancestors in compute and inspection: %s", path => {
  const entries = [...skillEntries, file(path, "notes")];
  const manifest = draft(entries);
  expectCode(computePackageDigest(manifest, entries), "UNSAFE_PATH");
  expectCode(inspectPackage(manifest, entries), "UNSAFE_PATH");
});
it.each(["assets/orgops-package.json", "assets/ORGOPS-PACKAGE.JSON", "orgops-package.json-assets/notes.txt"])("computes and inspects legitimate nonreserved content %s", path => {
  const entries = [...skillEntries, file(path, "notes")];
  const snapshot = must(inspectPackage(seal(draft(entries), entries), entries));
  expect(snapshot.files.find(entry => entry.path === path)?.base64).toBe(Buffer.from("notes").toString("base64"));
});
it.each([["a", "a/b"], ["A/b", "a"], ["a", "A"]])("rejects content collisions %j", (a, b) => {
  expectCode(inspectPackage(skillManifest, [file(a!), file(b!)]), "DUPLICATE_PATH");
});
it.each(["Zg", "Zg=", "Zh==", "Zg===", "Z g==", "____", "Zg==\n"])("rejects noncanonical base64 %j", base64 => {
  expectCode(inspectPackage(skillManifest, [{ type: "file", path: "x", executable: false, base64 }]), "UNSUPPORTED_ENTRY");
});
it("rejects counts and decoded budgets before inventory/hash work", () => {
  expectCode(inspectPackage({}, Array.from({ length: 257 }, (_, i) => file(`f${i}`))), "LIMIT_EXCEEDED");
  expectCode(inspectPackage({}, [file("large", Buffer.alloc(1048577))]), "LIMIT_EXCEEDED");
  expectCode(inspectPackage({}, [...Array.from({ length: 8 }, (_, i) => file(`f${i}`, Buffer.alloc(1048576))), file("extra", "x")]), "LIMIT_EXCEEDED");
  expectCode(inspectPackage({}, [{ type: "file", path: "x", executable: false, base64: "A".repeat(12582912) }]), "LIMIT_EXCEEDED");
});
it("validates both JSON boundaries before discriminator or entry reads", () => {
  let calls = 0;
  const bad = Object.defineProperty({}, "kind", { enumerable: true, get() { calls++; throw Error("called"); } });
  expectCode(inspectPackage(bad, []), "INVALID_JSON");
  const entry = Object.defineProperty({}, "base64", { enumerable: true, get() { calls++; throw Error("called"); } });
  expectCode(computePackageDigest(skillManifest, [entry as ContentEntry]), "INVALID_JSON");
  expect(calls).toBe(0);
  expectCode(inspectPackage({ text: "x".repeat(262144) }, []), "LIMIT_EXCEEDED");
  expectCode(inspectPackage(skillManifest, [undefined as unknown as ContentEntry]), "INVALID_JSON");
});
it.each(["missing", "extra", "size", "hash", "executable"])("rejects %s inventory mismatch", change => {
  const m = clone(skillManifest), entries = clone(skillEntries);
  if (change === "missing") entries.pop();
  if (change === "extra") entries.push(file("extra"));
  if (change === "size") m.files[0]!.size++;
  if (change === "hash") m.files[0]!.digest = `sha256:${"0".repeat(64)}`;
  if (change === "executable") m.files[0]!.executable = true;
  expectCode(inspectPackage(m, entries), "INVENTORY_MISMATCH");
});
it.each(["event-shapes.ts", "event-shapes.js", "Event-Shapes.ts", "x.TS", "x.js", "x.mjs", "x.cjs", "x.sh", "x.bash", "x.zsh", "x.py", "x.rb", "x.ps1", "x.cmd", "x.bat", "x.exe", "x.com", "x.wasm", "shebang", "chmod"])("requires matching execution declaration for %s", path => {
  const entries = [skillEntries[0]!, file(path, path === "shebang" ? "#!/anything" : "", path === "chmod")];
  const m = draft(entries); m.executables = [];
  expectCode(computePackageDigest(m, entries), "EXECUTABLE_MISMATCH");
  m.executables = [{ path, execution: path.startsWith("event-shapes.") ? "api-event-shapes" : "runner-script" }];
  if (path === "Event-Shapes.ts") expectCode(computePackageDigest(m, entries), "EXECUTABLE_MISMATCH");
  else {
    const snapshot = must(inspectPackage(seal(m, entries), entries));
    expect([...snapshot.execution.apiEventShapes, ...snapshot.execution.runnerScripts]).toEqual([path]);
  }
});
it("rejects wrong API declarations and allows explicitly declared additional scripts", () => {
  const m = clone(skillManifest); m.executables[0]!.execution = "runner-script";
  expectCode(computePackageDigest(m, skillEntries), "EXECUTABLE_MISMATCH");
  const entries = [skillEntries[0]!, file("notes.txt")];
  const n = draft(entries); n.executables = [{ path: "notes.txt", execution: "api-event-shapes" }];
  expectCode(computePackageDigest(n, entries), "EXECUTABLE_MISMATCH");
  n.executables[0]!.execution = "runner-script";
  expect(must(inspectPackage(seal(n, entries), entries)).execution.runnerScripts).toEqual(["notes.txt"]);
});
it.each([Buffer.from([0xff]), Buffer.from("---\nname: echo-skill\ndescription: Different\n---\n"), Buffer.from("---\nname: echo-skill\ndescription: Echo instructions.\nlicense: Other\n---\n")])("rejects invalid UTF8 or metadata mismatch %#", bytes => {
  const entries = [file("SKILL.md", bytes)]; const m = draft(entries); m.executables = [];
  expectCode(computePackageDigest(m, entries), "INVALID_SKILL");
});
it("accepts frontmatter-only without license and empty/binary auxiliary files", () => {
  const entries = [file("SKILL.md", "---\nname: echo-skill\ndescription: Echo instructions.\n---"), file("empty"), file("binary", Buffer.from([255]))];
  const m = draft(entries); m.executables = [];
  expect(must(inspectPackage(seal(m, entries), entries)).files).toHaveLength(3);
});
it("previews wrapped commands and check args in execution order without altering source hints", () => {
  const m = clone(wrappedManifest);
  m.wrapped.setup!.args = ["second", "first"];
  m.wrapped.sidecars[0]!.args = ["inherited"]; m.wrapped.sidecars[0]!.checkCommand = "check helper";
  m.wrapped.source = { type: "github", repo: "example/runtime", ref: "release/one", updateOnStart: false };
  const snapshot = must(inspectPackage(seal(m, []), []));
  expect(snapshot.execution.wrappedCommands).toEqual([
    { at: "wrapped.setup.command", command: "printf setup", args: ["second", "first"] },
    { at: "wrapped.setup.checkCommand", command: "test -f ready", args: ["second", "first"] },
    { at: "wrapped.sidecars.0.command", command: m.wrapped.sidecars[0]!.command, args: ["inherited"] },
    { at: "wrapped.sidecars.0.checkCommand", command: "check helper", args: ["inherited"] },
    { at: "wrapped.runtime.command", command: "printf", args: ["acknowledged"] },
  ]);
  expect(snapshot.execution.externalSources).toEqual([{ type: "github", repo: "example/runtime", ref: "release/one" }]);
  expect(snapshot.warnings).toContainEqual({ code: "EXTERNAL_RUNTIME_NOT_PINNED", at: "wrapped" });
  expect(must(inspectPackage(wrappedManifest, [])).warnings).toContainEqual({ code: "EXTERNAL_RUNTIME_NOT_PINNED", at: "wrapped" });
  const original = must(computePackageDigest(m, [])); m.wrapped.setup!.args.reverse();
  expect(must(computePackageDigest(m, []))).not.toBe(original);
});
it.each(["ghp_" + "a".repeat(20), "github_pat_" + "a".repeat(20), "sk-" + "a".repeat(16), "-----BEGIN PRIVATE KEY-----", "API_KEY=synthetic", "Password: fabricated"])("warns without leaking synthetic matching text %#", text => {
  const m = clone(classicManifest); m.native.systemInstructions = text + " " + text;
  const snapshot = must(inspectPackage(seal(m, []), []));
  expect(snapshot.warnings.filter(w => w.code === "SENSITIVE_TEXT")).toEqual([{ code: "SENSITIVE_TEXT", at: "native.systemInstructions" }]);
  expect(JSON.stringify(snapshot.warnings)).not.toContain(text);
  expect(snapshot.manifest.kind === "native-agent" && snapshot.manifest.native.systemInstructions).toBe(text + " " + text);
  const entries = [...skillEntries, file("notes.txt", text)]; const s = draft(entries);
  expect(must(inspectPackage(seal(s, entries), entries)).warnings).toContainEqual({ code: "SENSITIVE_TEXT", at: "notes.txt" });
});
it("rejects unsupported wrapped wiring before generic manifest failure", () => {
  expectCode(inspectPackage({ ...wrappedManifest, dependencies: skillManifest.files }, []), "UNSUPPORTED_WIRING");
});
it("accepts exact total/per-file limits without regex stack overflow", () => {
  const entries = Array.from({ length: 8 }, (_, i) => file(`file${i}`, Buffer.alloc(1048576, 65)));
  const m = draft(entries, classicManifest);
  expect(must(inspectPackage(seal(m, entries), entries)).files).toHaveLength(8);
});
it("hashes all semantic sets independently of order while preserving strings and sequence semantics", () => {
  const m = clone(classicManifest);
  m.dependencies.push({ ...m.dependencies[0]!, name: "another-skill" });
  m.native.alwaysPreloadedSkills.push("another-skill");
  m.secrets = [{ name: "SECOND", description: "Second", required: true }, { name: "FIRST", description: "First", required: false }];
  m.compatibility.tools = ["node", "bash"];
  const digest = must(computePackageDigest(m, []));
  m.dependencies.reverse(); m.native.alwaysPreloadedSkills.reverse(); m.secrets.reverse(); m.compatibility.tools.reverse();
  const reversedKeys = Object.fromEntries(Object.entries(m).reverse());
  expect(must(computePackageDigest(reversedKeys, []))).toBe(digest);
  m.native.systemInstructions += " "; expect(must(computePackageDigest(m, []))).not.toBe(digest);
  const w = clone(wrappedManifest);
  w.wrapped.sidecars.push({ name: "second", command: "second" });
  const first = must(computePackageDigest(w, [])); w.wrapped.sidecars.reverse();
  expect(must(computePackageDigest(w, []))).not.toBe(first);
});
it("covers changed file bytes and executable bits after inventory rebuild", () => {
  const entries = [...skillEntries, file("notes", "one")];
  const original = draft(entries); original.executables.push({ path: "notes", execution: "runner-script" });
  const digest = must(computePackageDigest(original, entries));
  entries[2] = file("notes", "two");
  expect(must(computePackageDigest(draft(entries, original), entries))).not.toBe(digest);
  entries[2] = file("notes", "one", true);
  expect(must(computePackageDigest(draft(entries, original), entries))).not.toBe(digest);
  const reordered = clone(original); reordered.executables.reverse(); reordered.files.reverse();
  expect(must(computePackageDigest(reordered, [...skillEntries, file("notes", "one")]))).toBe(digest);
});
it.each([null, {}, { type: "file", path: "x", base64: "", executable: false, extra: true }, { type: "file", path: "x", base64: 123, executable: false }])("rejects malformed entry %# without leaking values", entry => {
  const result = inspectPackage(skillManifest, [entry as ContentEntry]);
  expectCode(result, "UNSUPPORTED_ENTRY");
  expect(result).toEqual({ ok: false, issues: [{ code: "UNSUPPORTED_ENTRY", at: "entries" }] });
});
it("accepts the entry count boundary", () => {
  const entries = Array.from({ length: 256 }, (_, i) => file(`f${i}`));
  expect(must(inspectPackage(seal(draft(entries, classicManifest), entries), entries)).files).toHaveLength(256);
});
