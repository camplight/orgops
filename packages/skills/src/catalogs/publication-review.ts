import { createHash } from "node:crypto";
import { CATALOG_LIMITS, RelativePathSchema, DigestSchema, validateCatalogJson } from "@orgops/schemas";
import { decodePublicationBytes, preflightPublicationBytes, publicationFields as fields,
  publicationFailure as failure, publicationCompare as compare, publicationFreeze as freeze } from "./publication-content";
import { PUBLICATION_LIMITS as L, type PublicationChange, type PublicationFinding,
  type PublicationProposal, type PublicationResult } from "./publication-types";

// Fixed supplementary heuristics only; no provider checks or author-supplied regex.
const rules: readonly [PublicationFinding["ruleId"], RegExp][] = [
  ["TOKEN_PREFIX", /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}/i],
  ["PRIVATE_KEY_HEADER", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ["CREDENTIAL_ASSIGNMENT", /(?:password|token|secret|api[_-]?key)\s*[:=]\s*\S+/i],
];
type Review = Pick<PublicationProposal, "findings" | "scan">;
function review(changes: readonly PublicationChange[]): PublicationResult<Review> {
  const json = validateCatalogJson(changes, L.inputJsonBytes);
  if (!json.ok) return failure(json.issues[0]!.code, "changes");
  if (!Array.isArray(changes)) return failure("INVALID_PUBLICATION_INPUT", "changes");
  if (changes.length > L.outputFiles) return failure("LIMIT_EXCEEDED", "changes");
  const budget = { files: 0, bytes: 0 };
  // Every occurrence passes encoded-length preflight before any decode or hash.
  for (const c of changes) {
    if (!fields(c, ["path", "before", "after", "review"])) return failure("INVALID_PUBLICATION_INPUT", "changes");
    for (const side of ["before", "after"] as const) {
      const b = c[side];
      if (side === "before" && b === null) continue;
      if (!fields(b, ["base64", "size", "digest", "executable"])) return failure("INVALID_PUBLICATION_INPUT", "changes");
      const checked = preflightPublicationBytes(b.base64, CATALOG_LIMITS.indexJsonBytes, budget, "changes");
      if (!checked.ok) return checked;
    }
  }
  if (budget.bytes > L.outputBytes) return failure("LIMIT_EXCEEDED", "changes");
  for (const c of changes) {
    if (!RelativePathSchema.safeParse(c.path).success || !fields(c.review, ["before", "after"]) ||
      !["absent", "utf8", "binary"].includes(c.review.before) || !["utf8", "binary"].includes(c.review.after) ||
      (c.before === null) !== (c.review.before === "absent")) return failure("INVALID_PUBLICATION_INPUT", "changes");
    for (const b of [c.before, c.after]) if (b !== null &&
      (!Number.isSafeInteger(b.size) || b.size < 0 || !DigestSchema.safeParse(b.digest).success || typeof b.executable !== "boolean"))
      return failure("INVALID_PUBLICATION_INPUT", "changes");
  }
  const paths = new Set<string>(changes.map((c: PublicationChange) => c.path.toLowerCase()));
  if (paths.size !== changes.length || [...paths].some(path => {
    const parts = path.split("/");
    return parts.some((_, n) => n > 0 && paths.has(parts.slice(0, n).join("/")));
  })) return failure("INVALID_PUBLICATION_INPUT", "changes");
  const texts: { path: string; side: "before" | "after"; text: string }[] = [];
  const findings: PublicationFinding[] = [], binaryFiles: Review["scan"]["binaryFiles"][number][] = [];
  for (const c of [...changes].sort((a, b) => compare(a.path, b.path))) {
    for (const side of ["after", "before"] as const) {
      const b = c[side]; if (b === null) continue;
      const decoded = decodePublicationBytes(b.base64, CATALOG_LIMITS.indexJsonBytes);
      if (!decoded.ok) return failure(decoded.issues[0]!.code, "changes");
      if (decoded.value.length !== b.size || `sha256:${createHash("sha256").update(decoded.value).digest("hex")}` !== b.digest)
        return failure("INVENTORY_MISMATCH", "changes");
      let text: string | undefined;
      try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(decoded.value); } catch { /* binary is explicitly unscanned */ }
      if (c.review[side] !== (text === undefined ? "binary" : "utf8")) return failure("INVALID_PUBLICATION_INPUT", "changes");
      if (text === undefined) { binaryFiles.push({ path: c.path, side }); continue; }
      texts.push({ path: c.path, side, text });
    }
  }
  // No scan work precedes complete byte/hash/classification validation.
  for (const { path, side, text } of texts) {
    for (const [ruleId, pattern] of rules) {
      const match = pattern.exec(text); if (!match) continue;
      if (findings.length >= L.findings) return failure("LIMIT_EXCEEDED", "findings");
      let line = 1, column = 1;
      for (let i = 0; i < match.index;) {
        const point = text.codePointAt(i)!;
        if (point === 10) { line++; column = 1; } else column++;
        i += point > 0xffff ? 2 : 1;
      }
      findings.push({ ruleId, severity: "warning", path, side, line, column });
    }
  }
  findings.sort((a, b) => compare(a.path, b.path) || compare(a.side, b.side) || compare(a.ruleId, b.ruleId));
  return { ok: true, value: freeze({ findings, scan: { kind: "supplementary" as const, version: 1 as const, binaryFiles } }) };
}
/** Private scanner: validates direct calls too, and never returns incomplete findings. */
export function reviewPublicationChanges(changes: readonly PublicationChange[]): PublicationResult<Review> {
  try { return review(changes); } catch { return failure("INVALID_PUBLICATION_INPUT", "changes"); }
}
