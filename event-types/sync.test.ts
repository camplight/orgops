import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const EVENT_TYPES_DIR = resolve(REPO_ROOT, "event-types");
const CODE_DIRS = [resolve(REPO_ROOT, "apps"), resolve(REPO_ROOT, "packages")];

function walkFiles(dir: string, out: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(path, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

function extractDocEventTypes(): Set<string> {
  const types = new Set<string>();
  const docs = readdirSync(EVENT_TYPES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);

  for (const doc of docs) {
    const path = join(EVENT_TYPES_DIR, doc);
    const content = readFileSync(path, "utf-8");
    const typeMatch = content.match(/^\s*type:\s*([a-z]+(?:\.[a-z-]+)+)\s*$/m);
    if (!typeMatch) continue;
    const type = typeMatch[1];
    const expectedFile = `${type}.md`;
    expect(doc).toBe(expectedFile);
    types.add(type);
  }
  return types;
}

function extractCodeEventTypes(): Set<string> {
  const types = new Set<string>();
  const files = CODE_DIRS.flatMap((dir) => walkFiles(dir));

  for (const file of files) {
    const source = readFileSync(file, "utf-8");

    for (const match of source.matchAll(/type:\s*["'`]([a-z]+(?:\.[a-z-]+)+)["'`]/g)) {
      types.add(match[1]);
    }
    for (const match of source.matchAll(/emitAudit\(\s*["'`]([a-z]+(?:\.[a-z-]+)+)["'`]/g)) {
      types.add(match[1]);
    }

    if (source.includes("agent.control.${action}")) {
      const actionList = source.match(/\[([^\]]+)\]\.includes\(action\)/);
      if (actionList) {
        for (const action of actionList[1].matchAll(/["'`]([a-z-]+)["'`]/g)) {
          types.add(`agent.control.${action[1]}`);
        }
      }
    }
  }

  return types;
}

describe("event type sync", () => {
  it("keeps documented and emitted event types in sync", () => {
    const docs = extractDocEventTypes();
    const code = extractCodeEventTypes();

    const missingDocs = [...code].filter((type) => !docs.has(type)).sort();
    const staleDocs = [...docs].filter((type) => !code.has(type)).sort();

    expect(missingDocs, `missing event type docs: ${missingDocs.join(", ")}`).toEqual([]);
    expect(staleDocs, `stale event type docs: ${staleDocs.join(", ")}`).toEqual([]);
  });
});
