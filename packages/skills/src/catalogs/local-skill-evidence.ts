import type { ImportLocalEntry } from "./import-types";
import { withLocalSkillRoot, type LocalSkillRecord } from "./local-skill-root";
import { OFFLINE_LOCAL_SKILL_LIMITS as L, type LocalSkillEvidenceInput,
  type LocalSkillEvidenceOptions, type LocalSkillEvidence, type LocalSkillEvidenceResult,
  type LocalSkillNamespaceEntry, type LocalSkillSubtree } from "./local-skill-evidence-types";

// Public catalog-specific collector: one trusted quiescent local skill root, its complete
// immediate neutral namespace and complete subtrees for exact nominated ordinary child
// directories only. Neutral detached frozen observations; origins, relevant-host
// reconciliation and authority stay with the caller. No semantic inspection, active
// discovery or import evaluation happens here.
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export function readLocalSkillEvidence(
  input: LocalSkillEvidenceInput, options?: LocalSkillEvidenceOptions,
): Promise<LocalSkillEvidenceResult<LocalSkillEvidence>> {
  return withLocalSkillRoot(input, options, async reader => {
    // The reader's validated nominations snapshot, sorted by code unit: the public
    // nominatedNames value and the deterministic visit order.
    const nominations = [...reader.input.nominatedNames].sort(compare);
    const namespace: LocalSkillNamespaceEntry[] = [], subtrees: LocalSkillSubtree[] = [];
    const value: LocalSkillEvidence = { nominatedNames: nominations, namespace: { complete: true, entries: namespace }, subtrees };
    let outputBytes = Buffer.byteLength(JSON.stringify(value));
    function charge(bytes: number): void {
      if (outputBytes + bytes > L.outputJsonBytes) reader.fail("LIMIT_EXCEEDED", "subtrees");
      outputBytes += bytes;
    }
    charge(0);
    const top = await reader.listDirectory(reader.root, L.namespaceEntries);
    for (const record of top) {
      await reader.checkpoint();
      const item: LocalSkillNamespaceEntry = { name: record.path, type: record.type };
      charge(Buffer.byteLength(JSON.stringify(item)) + (namespace.length ? 1 : 0));
      namespace.push(item);
    }
    const exact = new Map(top.map(record => [record.path, record] as const));
    const folded = new Map(top.map(record => [record.path.toLowerCase(), record] as const));
    // A casefold-only namespace match is an unsafe nomination alias, never an absence.
    for (const name of nominations) {
      await reader.checkpoint();
      if (!exact.has(name) && folded.has(name.toLowerCase())) reader.fail("UNSAFE_PATH", "nominatedNames");
    }
    let totalEntries = 0, totalFiles = 0, totalBytes = 0;
    const bodies: { record: LocalSkillRecord; entry: Extract<ImportLocalEntry, { type: "file" }> }[] = [];
    for (const name of nominations) {
      await reader.checkpoint();
      const selected = exact.get(name);
      if (selected === undefined || selected.type !== "directory") continue;
      const entries: ImportLocalEntry[] = [], tree: LocalSkillSubtree = { name, complete: true, entries };
      charge(Buffer.byteLength(JSON.stringify(tree)) + (subtrees.length ? 1 : 0));
      subtrees.push(tree);
      let ordinaryBytes = 0, treeEntries = 0;
      async function visit(directory: LocalSkillRecord): Promise<void> {
        const remaining = Math.min(L.entriesPerSubtree - treeEntries, L.localTreeEntries - totalEntries);
        const children = await reader.listDirectory(directory, remaining);
        // Reserve the entire sibling list before descent, including not-yet-visited siblings.
        treeEntries += children.length; totalEntries += children.length;
        if (treeEntries > L.entriesPerSubtree || totalEntries > L.localTreeEntries) reader.fail("LIMIT_EXCEEDED", "subtrees");
        for (const record of children) {
          await reader.checkpoint();
          // Per-record output projection asserts the exact issued directory prefix.
          if (!record.path.startsWith(`${name}/`)) reader.fail("INVALID_LOCAL_INPUT", "filesystem");
          const path = record.path.slice(name.length + 1);
          let entry: ImportLocalEntry;
          let base64Bytes = 0;
          if (record.type === "file" && record.stat.nlink === 1n) {
            const rootManifest = path === "orgops-package.json";
            const max = rootManifest ? L.manifestBytes : L.fileBytes;
            if (record.stat.size > BigInt(max)) reader.fail("LIMIT_EXCEEDED", "subtrees");
            const size = Number(record.stat.size);
            totalFiles++; totalBytes += size; if (!rootManifest) ordinaryBytes += size;
            if (totalFiles > L.aggregateFiles || totalBytes > L.decodedBytes || ordinaryBytes > L.ordinaryBytesPerSubtree) {
              reader.fail("LIMIT_EXCEEDED", "subtrees");
            }
            entry = { type: "file", path, base64: "", executable: (record.stat.mode & 0o111n) !== 0n };
            base64Bytes = 4 * Math.ceil(size / 3);
          } else {
            entry = { type: record.type === "directory" ? "directory" : "blocked", path };
          }
          charge(Buffer.byteLength(JSON.stringify(entry)) + base64Bytes + (entries.length ? 1 : 0));
          entries.push(entry);
          if (entry.type === "file") bodies.push({ record, entry });
          if (record.type === "directory") await visit(record);
        }
      }
      await visit(selected);
      entries.sort((a, b) => compare(a.path, b.path));
    }
    // All metadata traversal across all nominations completed; bodies are read afterwards
    // in root/path code-unit order, so every output preflight charge precedes the first body.
    bodies.sort((a, b) => compare(a.record.path, b.record.path));
    for (const { record, entry } of bodies) {
      await reader.checkpoint();
      const bytes = await reader.readFile(record);
      entry.base64 = bytes.toString("base64");
      await reader.checkpoint();
    }
    await reader.checkpoint();
    const actual = Buffer.byteLength(JSON.stringify(value));
    await reader.checkpoint();
    if (actual > L.outputJsonBytes) reader.fail("LIMIT_EXCEEDED", "subtrees");
    if (actual !== outputBytes) reader.fail("LOCAL_IO_FAILED", "filesystem");
    async function freeze(node: unknown): Promise<void> {
      if (node && typeof node === "object") {
        await reader.checkpoint();
        for (const child of Object.values(node)) await freeze(child);
        Object.freeze(node);
      }
    }
    await freeze(value);
    await reader.checkpoint();
    return value;
  });
}
