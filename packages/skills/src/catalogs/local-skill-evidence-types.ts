import type { ImportLocalEntry } from "./import-types";

// Exact public neutral offline-local-evidence contract: frozen ceilings and detached
// per-root observation types only. No import authority types live here; the collector
// (local-skill-evidence.ts) implements readLocalSkillEvidence against these shapes.
export const OFFLINE_LOCAL_SKILL_LIMITS = Object.freeze({
  operationMs: 10000,
  rootPathBytes: 4096, hostPathDepth: 64,
  nameBytes: 64, relativePathBytes: 240, relativePathDepth: 64,
  nominatedNames: 4096, namespaceEntries: 4096,
  entriesPerSubtree: 1024, localTreeEntries: 8192,
  fileBytes: 1048576, manifestBytes: 262144,
  ordinaryBytesPerSubtree: 8388608,
  aggregateFiles: 8192, decodedBytes: 33554432,
  inputJsonBytes: 1048576, outputJsonBytes: 67108864,
  chunkBytes: 65536, concurrentHandles: 2,
  fsCalls: 350000, workUnits: 524288, yieldEvery: 64, yields: 8192,
} as const);
export type LocalSkillEvidenceInput = {
  directory: string;
  nominatedNames: readonly string[];
};
export type LocalSkillEvidenceOptions = { signal?: AbortSignal };
export type LocalSkillNamespaceEntry = {
  name: string;
  type: "directory" | "file" | "blocked";
};
export type LocalSkillSubtree = {
  name: string;
  complete: true;
  entries: readonly ImportLocalEntry[];
};
export type LocalSkillEvidence = {
  nominatedNames: readonly string[];
  namespace: { complete: true; entries: readonly LocalSkillNamespaceEntry[] };
  subtrees: readonly LocalSkillSubtree[];
};
export type LocalSkillEvidenceIssue = {
  code: "INVALID_LOCAL_INPUT" | "UNSUPPORTED_LOCAL_STORAGE" | "UNSAFE_PATH"
    | "DUPLICATE_PATH" | "LIMIT_EXCEEDED" | "LOCAL_IO_FAILED"
    | "LOCAL_EVIDENCE_CHANGED" | "LOCAL_ABORTED" | "LOCAL_TIMEOUT"
    | "LOCAL_CLEANUP_FAILED";
  at: "$" | "directory" | "nominatedNames" | "namespace" | "subtrees" | "filesystem";
};
export type LocalSkillEvidenceResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: LocalSkillEvidenceIssue[] };
