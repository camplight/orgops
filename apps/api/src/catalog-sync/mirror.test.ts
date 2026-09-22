import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readGitCatalogIndex } from "@orgops/skills";
import { CATALOG_SYNC_CURRENT_REF, CATALOG_SYNC_STAGING_REF, type CatalogGitTransport } from "./git-fetch";
import { ensureCatalogMirror } from "./mirror";
import { createLocalFixtureRepo } from "./fixtures.test-helper";
import { parseGitHubDestination } from "./github-destination";

const CONFIG_FILEMODE_TRUE = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n";
const CONFIG_FILEMODE_FALSE = "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = true\n";

async function withRoot(run: (mirrorsRoot: string) => Promise<void>): Promise<void> {
  const parent = await mkdtemp(join(tmpdir(), "catalog-mirror-"));
  try { await run(join(parent, "catalog-mirrors")); } finally { await rm(parent, { recursive: true, force: true }); }
}

/** Hand-built valid mirror layout (the only accepted shapes) for rejection fixtures. */
async function buildMirror(mirrorsRoot: string, sourceId: string, config = CONFIG_FILEMODE_TRUE): Promise<string> {
  const directory = join(mirrorsRoot, sourceId);
  await mkdir(join(directory, "objects", "pack"), { recursive: true });
  await mkdir(join(directory, "objects", "info"), { recursive: true });
  await mkdir(join(directory, "refs"), { recursive: true });
  await writeFile(join(directory, "config"), config);
  await writeFile(join(directory, "HEAD"), "ref: refs/heads/main\n");
  return directory;
}

describe("ensureCatalogMirror", () => {
  it("creates the owned bare mirror with the exact accepted layout", async () => withRoot(async mirrorsRoot => {
    const result = await ensureCatalogMirror(mirrorsRoot, "fixture-source");
    expect(result).toEqual({ ok: true, directory: join(mirrorsRoot, "fixture-source") });
    if (!result.ok) throw new Error("unreachable");
    expect(await readFile(join(result.directory, "config"), "utf8")).toBe(CONFIG_FILEMODE_TRUE);
    expect(await readFile(join(result.directory, "HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
    for (const name of ["objects", "objects/info", "objects/pack", "refs"]) {
      expect((await lstat(join(result.directory, name))).isDirectory()).toBe(true);
    }
    expect((await lstat(mirrorsRoot)).mode & 0o777).toBe(0o700);
  }));

  it("reuses an existing valid mirror idempotently", async () => withRoot(async mirrorsRoot => {
    const directory = await buildMirror(mirrorsRoot, "fixture-source", CONFIG_FILEMODE_FALSE);
    const first = await ensureCatalogMirror(mirrorsRoot, "fixture-source");
    expect(first).toEqual({ ok: true, directory });
    expect(await ensureCatalogMirror(mirrorsRoot, "fixture-source")).toEqual(first);
    expect(await readFile(join(directory, "config"), "utf8")).toBe(CONFIG_FILEMODE_FALSE);
  }));

  it("rejects a symlinked source directory", async () => withRoot(async mirrorsRoot => {
    await mkdir(mirrorsRoot, { recursive: true });
    const target = join(mirrorsRoot, "real-target");
    await mkdir(target);
    await symlink(target, join(mirrorsRoot, "linked"));
    expect(await ensureCatalogMirror(mirrorsRoot, "linked")).toEqual({ ok: false, code: "MIRROR_INVALID" });
  }));

  it("rejects a symlinked mirrors root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "catalog-mirror-"));
    try {
      const real = join(parent, "real-root");
      await mkdir(real);
      await symlink(real, join(parent, "link-root"));
      expect(await ensureCatalogMirror(join(parent, "link-root"), "fixture-source"))
        .toEqual({ ok: false, code: "MIRROR_INVALID" });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects a foreign config containing a remote", async () => withRoot(async mirrorsRoot => {
    await buildMirror(mirrorsRoot, "fixture-source",
      `${CONFIG_FILEMODE_TRUE}[remote "origin"]\n\turl = https://example.invalid/x.git\n`);
    expect(await ensureCatalogMirror(mirrorsRoot, "fixture-source")).toEqual({ ok: false, code: "MIRROR_INVALID" });
  }));

  it("rejects a non-bare config", async () => withRoot(async mirrorsRoot => {
    await buildMirror(mirrorsRoot, "fixture-source", "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n");
    expect(await ensureCatalogMirror(mirrorsRoot, "fixture-source")).toEqual({ ok: false, code: "MIRROR_INVALID" });
  }));

  it("rejects commdir present", async () => withRoot(async mirrorsRoot => {
    const directory = await buildMirror(mirrorsRoot, "fixture-source");
    await writeFile(join(directory, "commondir"), "../elsewhere\n");
    expect(await ensureCatalogMirror(mirrorsRoot, "fixture-source")).toEqual({ ok: false, code: "MIRROR_INVALID" });
  }));

  it("rejects objects/info/alternates present", async () => withRoot(async mirrorsRoot => {
    const directory = await buildMirror(mirrorsRoot, "fixture-source");
    await writeFile(join(directory, "objects", "info", "alternates"), "/elsewhere/objects\n");
    expect(await ensureCatalogMirror(mirrorsRoot, "fixture-source")).toEqual({ ok: false, code: "MIRROR_INVALID" });
  }));

  it("rejects a .promisor file in objects/pack", async () => withRoot(async mirrorsRoot => {
    const directory = await buildMirror(mirrorsRoot, "fixture-source");
    await writeFile(join(directory, "objects", "pack", "pack-0123456789abcdef.promisor"), "");
    expect(await ensureCatalogMirror(mirrorsRoot, "fixture-source")).toEqual({ ok: false, code: "MIRROR_INVALID" });
  }));

  it("rejects a config larger than 4096 bytes", async () => withRoot(async mirrorsRoot => {
    await buildMirror(mirrorsRoot, "fixture-source", `# padding\n${"#".repeat(5000)}`);
    expect(await ensureCatalogMirror(mirrorsRoot, "fixture-source")).toEqual({ ok: false, code: "MIRROR_INVALID" });
  }));

  it("rejects an invalid sourceId before any filesystem write", async () => {
    const parent = await mkdtemp(join(tmpdir(), "catalog-mirror-"));
    try {
      const absent = join(parent, "never-created");
      for (const sourceId of ["../escape", "UPPER", "with/slash", "", "a".repeat(65)]) {
        expect(await ensureCatalogMirror(absent, sourceId)).toEqual({ ok: false, code: "MIRROR_INVALID" });
      }
      await expect(lstat(absent)).rejects.toThrow();
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("reports MIRROR_IO when the mirrors root cannot be created", async () => {
    const parent = await mkdtemp(join(tmpdir(), "catalog-mirror-"));
    try {
      const blocker = join(parent, "blocker");
      await writeFile(blocker, "not a directory\n");
      expect(await ensureCatalogMirror(join(blocker, "catalog-mirrors"), "fixture-source"))
        .toEqual({ ok: false, code: "MIRROR_IO" });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("never writes in verify-only mode: an absent root or source directory is not created", async () => withRoot(async mirrorsRoot => {
    // Read views call with create:false; absence must stay absent (no writes, ever).
    expect(await ensureCatalogMirror(mirrorsRoot, "fixture-source", { create: false }))
      .toEqual({ ok: false, code: "MIRROR_INVALID" });
    expect(await ensureCatalogMirror(join(mirrorsRoot, "missing-root"), "fixture-source", { create: false }))
      .toEqual({ ok: false, code: "MIRROR_INVALID" });
    // An existing valid mirror is still accepted in verify-only mode.
    const directory = await buildMirror(mirrorsRoot, "fixture-source");
    expect(await ensureCatalogMirror(mirrorsRoot, "fixture-source", { create: false }))
      .toEqual({ ok: true, directory });
  }));
});

describe("compose: mirror + local fixture transport + existing offline inspection", () => {
  it("fetches a real shallow mirror, promotes atomically, and inspects it offline", async () => {
    const entry = {
      kind: "skill", name: "demo-skill", version: "1.0.0",
      digest: `sha256:${"a".repeat(64)}`,
      location: { type: "source", sourceId: "fixture-source", commit: "0123456789abcdef0123456789abcdef01234567", path: "skills/demo-skill" },
    };
    const fixture = await createLocalFixtureRepo(JSON.stringify({ formatVersion: 1, entries: [entry] }));
    const parent = await mkdtemp(join(tmpdir(), "catalog-mirror-"));
    const mirrorsRoot = join(parent, "catalog-mirrors");
    const calls = { fetch: [] as { credential: { username: string; password: string } | undefined }[] };
    try {
      const transport = fixture.transport(calls);
      const parsed = parseGitHubDestination("https://github.com/org/repo");
      if (!parsed.ok) throw new Error("fixture destination rejected");
      const mirrorResult = await ensureCatalogMirror(mirrorsRoot, "fixture-source");
      expect(mirrorResult.ok).toBe(true);
      if (!mirrorResult.ok) throw new Error("mirror rejected");
      const mirror = mirrorResult.directory;
      // First sync: public fetch (no credential) into the staging ref of the owned mirror.
      expect(await transport.fetch(parsed.value, "main", mirror, undefined)).toEqual({ ok: true, value: true });
      expect(calls.fetch).toEqual([{ credential: undefined }]);
      // --depth=1 over file:// genuinely produced a SHALLOW mirror (no-network proof).
      expect((await readFile(join(mirror, "shallow"), "utf8")).trim()).toBe(fixture.commit);
      expect(await transport.resolveRef(mirror, CATALOG_SYNC_STAGING_REF)).toEqual({ ok: true, value: fixture.commit });
      // Atomic promotion with the must-not-exist guard, then a readable current ref.
      expect(await transport.updateRef(mirror, CATALOG_SYNC_CURRENT_REF, fixture.commit, null)).toEqual({ ok: true, value: true });
      expect(await transport.resolveRef(mirror, CATALOG_SYNC_CURRENT_REF)).toEqual({ ok: true, value: fixture.commit });
      // Second run with the correct previous commit as the old-value guard succeeds.
      expect(await transport.fetch(parsed.value, "main", mirror, undefined)).toEqual({ ok: true, value: true });
      expect(await transport.resolveRef(mirror, CATALOG_SYNC_STAGING_REF)).toEqual({ ok: true, value: fixture.commit });
      expect(await transport.updateRef(mirror, CATALOG_SYNC_CURRENT_REF, fixture.commit, fixture.commit)).toEqual({ ok: true, value: true });
      // A WRONG old value fails the guard and leaves the promoted current ref untouched.
      expect(await transport.updateRef(mirror, CATALOG_SYNC_CURRENT_REF, fixture.commit, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"))
        .toEqual({ ok: false, issue: { code: "GIT_FAILED" } });
      expect(await transport.resolveRef(mirror, CATALOG_SYNC_CURRENT_REF)).toEqual({ ok: true, value: fixture.commit });
      expect(await transport.deleteRef(mirror, CATALOG_SYNC_STAGING_REF)).toEqual({ ok: true, value: true });
      // The EXISTING offline inspection accepts the produced SHALLOW mirror + commit + index path.
      const index = await readGitCatalogIndex(
        { repository: { directory: mirror, gitExecutable: "/usr/bin/git" }, commit: fixture.commit, indexPath: fixture.indexPath });
      expect(index).toEqual({ ok: true, value: { formatVersion: 1, entries: [entry] } });
      // The mirror remains verifiable after real fetches wrote untrusted content into it.
      expect(await ensureCatalogMirror(mirrorsRoot, "fixture-source")).toEqual({ ok: true, directory: mirror });
      // Best-effort staging cleanup: a confirmed promotion followed by an injected
      // deleteRef failure still leaves the promoted current ref in place.
      const failingCleanup: CatalogGitTransport = { ...transport, deleteRef: async () => ({ ok: false, issue: { code: "GIT_FAILED" } }) };
      expect(await failingCleanup.deleteRef(mirror, CATALOG_SYNC_STAGING_REF)).toEqual({ ok: false, issue: { code: "GIT_FAILED" } });
      expect(await transport.resolveRef(mirror, CATALOG_SYNC_CURRENT_REF)).toEqual({ ok: true, value: fixture.commit });
    } finally {
      await fixture.dispose();
      await rm(parent, { recursive: true, force: true });
    }
  }, 30000);
});
