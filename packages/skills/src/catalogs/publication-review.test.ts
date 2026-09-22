import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { reviewPublicationChanges } from "./publication-review";
import { PUBLICATION_LIMITS as L, type PublicationBytes, type PublicationChange } from "./publication-types";
import { publicationValue as value } from "./publication-fixtures";

function record(text: string | Buffer): PublicationBytes {
  const b = Buffer.from(text);
  return { base64: b.toString("base64"), size: b.length,
    digest: `sha256:${createHash("sha256").update(b).digest("hex")}`, executable: false };
}
function change(text = "heading\npassword=synthetic-review-marker\n", path = "notes.txt"): PublicationChange {
  return { path, before: null, after: record(text), review: { before: "absent", after: "utf8" } };
}
describe("reviewPublicationChanges", () => {
  it("reports a redacted location without losing full human review bytes", () => {
    const c = change(), copy = structuredClone(c);
    const r = value(reviewPublicationChanges([c]));
    expect(r.findings).toEqual([{ ruleId: "CREDENTIAL_ASSIGNMENT", severity: "warning", path: "notes.txt", side: "after", line: 2, column: 1 }]);
    expect(JSON.stringify(r)).not.toContain("synthetic-review-marker");
    expect(c).toEqual(copy);
    expect(Object.isFrozen(c)).toBe(false);
    expect(Object.isFrozen(r.findings[0])).toBe(true);
  });
  it.each([
    ...["p", "o", "u", "s", "r"].map(k => [`gh${k}_${"a".repeat(20)}`, "TOKEN_PREFIX"]),
    [`github_pat_${"_".repeat(20)}`, "TOKEN_PREFIX"], [`sk-${"-".repeat(16)}`, "TOKEN_PREFIX"],
    ...["", "RSA ", "EC ", "OPENSSH "].map(k => [`-----BEGIN ${k}PRIVATE KEY-----`, "PRIVATE_KEY_HEADER"]),
    ...["PASSWORD", "token", "Secret", "api_key", "api-key", "apikey"].map(k => [`${k} : marker`, "CREDENTIAL_ASSIGNMENT"]),
  ])("finds fixed rule in %s", (text, rule) => {
    expect(value(reviewPublicationChanges([change(text)])).findings).toEqual([
      { ruleId: rule, severity: "warning", path: "notes.txt", side: "after", line: 1, column: 1 },
    ]);
  });
  it("uses first matches, Unicode code-point columns, LF boundaries and canonical side/rule ordering", () => {
    const c = change("α😀\r\n😀é password=x password=y\n-----BEGIN PRIVATE KEY-----\nghp_" + "a".repeat(20));
    c.before = c.after; c.review.before = "utf8";
    const r = value(reviewPublicationChanges([c, change("token=x", "A.txt")]));
    expect(r.findings.map(f => [f.path, f.side, f.ruleId, f.line, f.column])).toEqual([
      ["A.txt", "after", "CREDENTIAL_ASSIGNMENT", 1, 1],
      ...["after", "before"].flatMap(side => [
        ["notes.txt", side, "CREDENTIAL_ASSIGNMENT", 2, 4],
        ["notes.txt", side, "PRIVATE_KEY_HEADER", 3, 1],
        ["notes.txt", side, "TOKEN_PREFIX", 4, 1],
      ]),
    ]);
    expect(value(reviewPublicationChanges([change("token=x", "A.txt"), c]))).toEqual(r);
  });
  it("lists binary sides as unscanned, including before, without lossy decoding or logging", () => {
    const c = change(); c.before = record(Buffer.from([255, 0, 128])); c.after = c.before;
    c.review = { before: "binary", after: "binary" };
    const spies = ["log", "warn", "error", "info", "debug"].map(k => vi.spyOn(console, k as "log").mockImplementation(() => { throw new Error("logged"); }));
    try {
      expect(value(reviewPublicationChanges([c]))).toEqual({ findings: [], scan: { kind: "supplementary", version: 1,
        binaryFiles: [{ path: "notes.txt", side: "after" }, { path: "notes.txt", side: "before" }] } });
      spies.forEach(s => expect(s).not.toHaveBeenCalled());
      expect(c.after.base64).toBe("/wCA");
    } finally { spies.forEach(s => s.mockRestore()); }
  });
  it("keeps the supplementary marker on empty/clean input and preserves BOM location", () => {
    expect(value(reviewPublicationChanges([]))).toEqual({ findings: [], scan: { kind: "supplementary", version: 1, binaryFiles: [] } });
    expect(value(reviewPublicationChanges([change("\ufeffpassword=x")])).findings[0]!.column).toBe(2);
    expect(value(reviewPublicationChanges([change("ghp_short sk-short password= \n")])).findings).toEqual([]);
  });
  it.each([
    (c: PublicationChange) => { c.path = "../sensitive-marker"; },
    (c: PublicationChange) => { c.after.size++; },
    (c: PublicationChange) => { c.after.digest = `sha256:${"0".repeat(64)}`; },
    (c: PublicationChange) => { c.after.base64 = "YQ="; },
    (c: PublicationChange) => { c.review.after = "binary"; },
    (c: PublicationChange) => { c.review.before = "utf8"; },
    (c: PublicationChange) => { Object.defineProperty(c.after, "executable", { value: "marker" }); },
    (c: PublicationChange) => { Object.defineProperty(c, "extra", { value: "marker", enumerable: true }); },
    (c: PublicationChange) => { Object.defineProperty(c, "path", { get() { throw new Error("getter executed"); }, enumerable: true }); },
  ])("rejects forged direct input with one redacted issue (%#)", mutate => {
    const c = change(); mutate(c); const r = reviewPublicationChanges([c]);
    expect(r.ok).toBe(false); if (r.ok) throw new Error("fixture");
    expect(r.issues).toHaveLength(1); expect(r).not.toHaveProperty("value");
    expect(JSON.stringify(r)).not.toMatch(/marker|getter/);
  });
  it("rejects duplicate and ancestor paths", () => {
    for (const path of ["notes.txt", "NOTES.txt", "notes.txt/child"]) expect(reviewPublicationChanges([change(), change("", path)]).ok).toBe(false);
  });
  it("accepts exactly 4096 findings and fails closed at 4097", () => {
    const changes = Array.from({ length: L.findings }, (_, i) => change("token=x", `f${i}.txt`));
    expect(value(reviewPublicationChanges(changes)).findings).toHaveLength(4096);
    changes[0]!.before = record("password=x"); changes[0]!.review.before = "utf8";
    expect(reviewPublicationChanges(changes)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "findings" }] });
  });
  it("validates every changed byte before scanning any side", () => {
    const changes = Array.from({ length: 1367 }, (_, i) => change("password=x\nghp_" + "a".repeat(20) + "\n-----BEGIN PRIVATE KEY-----", `f${String(i).padStart(4, "0")}.txt`));
    changes[1366]!.after.digest = `sha256:${"0".repeat(64)}`;
    expect(reviewPublicationChanges(changes)).toEqual({ ok: false, issues: [{ code: "INVENTORY_MISMATCH", at: "changes" }] });
  });
  it("accepts exact output file count and rejects one extra before decoding", () => {
    const changes = Array.from({ length: L.outputFiles }, (_, i) => change("", `f${i}.txt`));
    expect(reviewPublicationChanges(changes).ok).toBe(true);
    changes.push(change("", "extra.txt"));
    expect(reviewPublicationChanges(changes)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "changes" }] });
  });
  it("counts both sides at exact aggregate output bytes and rejects +1 before hash/decoding", () => {
    const c = record("x".repeat(1048576));
    const changes: PublicationChange[] = Array.from({ length: 16 }, (_, i) => ({ path: `f${i}.txt`, before: c, after: c, review: { before: "utf8", after: "utf8" } }));
    expect(reviewPublicationChanges(changes).ok).toBe(true);
    changes.push(change("x", "extra.txt"));
    expect(reviewPublicationChanges(changes)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "changes" }] });
  });
  it("bounds descriptor JSON before inspecting forged values", () => {
    const c = change(); Object.defineProperty(c, "extra", { value: "x".repeat(L.inputJsonBytes), enumerable: true });
    expect(reviewPublicationChanges([c])).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "changes" }] });
  });
});
