import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FORBIDDEN_RETIREMENT_MARKERS, verifyRetirement } from "../scripts/verify-retirement";

const tempRoots: string[] = [];
const retiredModule = ["Library", "Screen"].join("");

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(source: string, assets: Record<string, string>, manifest: unknown = { main: { file: "assets/main.js", isEntry: true } }) {
  const root = await mkdtemp(join(tmpdir(), "orgops-user-ui-retirement-"));
  tempRoots.push(root);
  await mkdir(join(root, "src", "nested"), { recursive: true });
  await mkdir(join(root, "dist", ".vite"), { recursive: true });
  await writeFile(join(root, "src", "nested", "module.ts"), source);
  await writeFile(join(root, "dist", "index.html"), '<script type="module" src="/assets/main.js"></script>');
  for (const [name, body] of Object.entries(assets)) {
    await mkdir(join(root, "dist", name, ".."), { recursive: true });
    await writeFile(join(root, "dist", name), body);
  }
  await writeFile(join(root, "dist", ".vite", "manifest.json"), JSON.stringify(manifest));
  return root;
}

describe("user-ui retirement verifier", () => {
  it("passes clean recursive source and manifest-reachable assets", async () => {
    const root = await fixture("export const conversation = true;", { "assets/main.js": "console.log('conversation');" });
    await expect(verifyRetirement(root)).resolves.toEqual({ sourceFiles: 1, assetFiles: 1 });
  });

  it("rejects every retired source marker in nested modules", async () => {
    for (const marker of FORBIDDEN_RETIREMENT_MARKERS) {
      const root = await fixture(`export const marker = ${JSON.stringify(marker)};`, { "assets/main.js": "console.log('conversation');" });
      await expect(verifyRetirement(root)).rejects.toThrow(/forbidden source marker/);
    }
  });

  it("rejects stale unreferenced chunks and every retired control marker", async () => {
    const root = await fixture("export const conversation = true;", {
      "assets/main.js": "console.log('conversation');",
      "assets/stale.js": "console.log('old');"
    });
    await expect(verifyRetirement(root)).rejects.toThrow(/unreferenced/);

    for (const marker of FORBIDDEN_RETIREMENT_MARKERS) {
      const markedRoot = await fixture("export const conversation = true;", { "assets/main.js": `console.log(${JSON.stringify(marker)});` });
      await expect(verifyRetirement(markedRoot)).rejects.toThrow(/forbidden/);
    }
  });

  it.each([
    "../outside.js",
    "/tmp/outside.js",
    "C:/outside.js",
    "..\\\\outside.js",
    "%2e%2e%2foutside.js"
  ])("rejects manifest path escaping or malformed path %s", async (file) => {
    const root = await fixture("export const conversation = true;", { "assets/main.js": "console.log('conversation');" }, { main: { file, isEntry: true } });
    await writeFile(join(root, "outside.js"), "console.log('outside');");
    await expect(verifyRetirement(root)).rejects.toThrow(/outside|invalid|absolute|traversal|contain/i);
  });

  it.each(["file", "css", "assets", "imports", "dynamicImports"] as const)("validates manifest %s paths", async (field) => {
    const entry: Record<string, unknown> = { file: "assets/main.js", isEntry: true };
    if (field === "file") entry.file = "../outside.js";
    else if (field === "css" || field === "assets") entry[field] = ["../outside.js"];
    else entry[field] = ["../outside.js"];
    const root = await fixture("export const conversation = true;", { "assets/main.js": "console.log('conversation');" }, { main: entry });
    await expect(verifyRetirement(root)).rejects.toThrow(/path|entry/i);
  });

  it("rejects source and dist symlinks, including internal and broken links", async () => {
    const sourceRoot = await fixture("export const conversation = true;", { "assets/main.js": "console.log('conversation');" });
    await symlink("module.ts", join(sourceRoot, "src", "nested", "internal.ts"));
    await expect(verifyRetirement(sourceRoot)).rejects.toThrow(/symbolic link|symlink/i);

    const distRoot = await fixture("export const conversation = true;", { "assets/main.js": "console.log('conversation');" });
    await symlink("main.js", join(distRoot, "dist", "assets", "stale.js"));
    await expect(verifyRetirement(distRoot)).rejects.toThrow(/symbolic link|symlink/i);

    const brokenRoot = await fixture("export const conversation = true;", { "assets/main.js": "console.log('conversation');" });
    await symlink("missing.js", join(brokenRoot, "dist", "assets", "broken.js"));
    await expect(verifyRetirement(brokenRoot)).rejects.toThrow(/symbolic link|symlink/i);
  });

  it("rejects orphan manifest entries, missing files, and orphan cycles", async () => {
    const missing = await fixture("export const conversation = true;", { "assets/main.js": "console.log('conversation');" }, {
      main: { file: "assets/main.js", isEntry: true }, orphan: { file: "assets/orphan.js" }
    });
    await expect(verifyRetirement(missing)).rejects.toThrow(/orphan|unreachable manifest entry/i);

    const existing = await fixture("export const conversation = true;", { "assets/main.js": "console.log('conversation');", "assets/orphan.js": "console.log('orphan');" }, {
      main: { file: "assets/main.js", isEntry: true }, orphan: { file: "assets/orphan.js" }
    });
    await expect(verifyRetirement(existing)).rejects.toThrow(/orphan|unreachable manifest entry/i);

    const cycleMissing = await fixture("export const conversation = true;", { "assets/main.js": "console.log('conversation');" }, {
      main: { file: "assets/main.js", isEntry: true }, orphanA: { file: "assets/a.js", imports: ["orphanB"] }, orphanB: { file: "assets/b.js", imports: ["orphanA"] }
    });
    await expect(verifyRetirement(cycleMissing)).rejects.toThrow(/orphan|unreachable manifest entry|cycle/i);

    const cyclePresent = await fixture("export const conversation = true;", { "assets/main.js": "console.log('conversation');", "assets/a.js": "console.log('a');", "assets/b.js": "console.log('b');" }, {
      main: { file: "assets/main.js", isEntry: true }, orphanA: { file: "assets/a.js", imports: ["orphanB"] }, orphanB: { file: "assets/b.js", imports: ["orphanA"] }
    });
    await expect(verifyRetirement(cyclePresent)).rejects.toThrow(/orphan|unreachable manifest entry|cycle/i);
  });

  it("accepts shared reachable entries from multiple roots", async () => {
    const root = await fixture("export const conversation = true;", {
      "assets/main.js": "console.log('main');", "assets/second.js": "console.log('second');", "assets/shared.js": "console.log('shared');"
    }, {
      main: { file: "assets/main.js", isEntry: true, imports: ["shared"] },
      second: { file: "assets/second.js", isEntry: true, imports: ["shared"] },
      shared: { file: "assets/shared.js" }
    });
    await expect(verifyRetirement(root)).resolves.toEqual({ sourceFiles: 1, assetFiles: 3 });
  });

  it("exempts only the root index and rejects an unreferenced nested index", async () => {
    const root = await fixture("export const conversation = true;", {
      "assets/main.js": "console.log('conversation');",
      "stale/index.html": "<main>clean but stale</main>"
    });
    await expect(verifyRetirement(root)).rejects.toThrow(/unreferenced dist asset stale\/index\.html/);
  });

  it("accepts the root index and manifest-referenced nested HTML", async () => {
    const root = await fixture("export const conversation = true;", {
      "assets/main.js": "console.log('conversation');",
      "pages/active/index.html": "<main>active</main>"
    }, {
      main: { file: "assets/main.js", isEntry: true, assets: ["pages/active/index.html"] }
    });
    await expect(verifyRetirement(root)).resolves.toEqual({ sourceFiles: 1, assetFiles: 2 });
  });

  it("accepts nested valid manifest assets", async () => {
    const root = await fixture("export const conversation = true;", { "assets/nested/main.js": "console.log('conversation');" }, { main: { file: "assets/nested/main.js", isEntry: true } });
    await expect(verifyRetirement(root)).resolves.toEqual({ sourceFiles: 1, assetFiles: 1 });
  });
});
