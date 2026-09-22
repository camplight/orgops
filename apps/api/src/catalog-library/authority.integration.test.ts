import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptSecret, parseMasterKey } from "@orgops/crypto";
import type { CatalogIndex, PackageManifest } from "@orgops/schemas";
import { createLocalFixtureRepo } from "../catalog-sync/fixtures.test-helper";
import { CATALOG_SYNC_CURRENT_REF } from "../catalog-sync/git-fetch";
import { adminActor, openCatalogFixture } from "./test-fixtures";
import { createCatalogAuthority } from "./authority";
import { createSourceFetchAdapter } from "./source-fetch";

const masterKey = Buffer.alloc(32, 9).toString("base64");
let previousMasterKey: string | undefined;
beforeAll(() => {
  previousMasterKey = process.env.ORGOPS_MASTER_KEY;
  process.env.ORGOPS_MASTER_KEY = masterKey;
});
afterAll(() => {
  if (previousMasterKey === undefined) delete process.env.ORGOPS_MASTER_KEY;
  else process.env.ORGOPS_MASTER_KEY = previousMasterKey;
});

const skillMd = Buffer.from("---\nname: echo-skill\ndescription: Echo instructions.\nlicense: MIT\n---\nReturn a short acknowledgement.\n", "utf8");
const eventShapes = Buffer.from('throw new Error("catalog inspection executed");\n', "utf8");
const manifest: PackageManifest = {
  formatVersion: 1,
  name: "echo-skill",
  version: "1.0.0",
  description: "Echo instructions.",
  author: "Example Authors",
  license: "MIT",
  compatibility: { orgops: { min: "0.0.1", maxExclusive: "0.1.0" }, platforms: ["linux", "darwin", "win32"], tools: ["node"] },
  secrets: [],
  dependencies: [],
  files: [
    { path: "SKILL.md", size: 102, digest: "sha256:d1e1ad27fad5df70172dc3dd6595a6a2cc4192b5dcc3f52587458e564f80b7d1", executable: false },
    { path: "event-shapes.ts", size: 48, digest: "sha256:9c345d9d0d5348cad82dfc0b82a56508c97bda41ff299a8b0b684b18c40c3f97", executable: false },
  ],
  executables: [{ path: "event-shapes.ts", execution: "api-event-shapes" }],
  kind: "skill",
  skill: { entrypoint: "SKILL.md" },
  digest: "sha256:83dafd61312f34e2d3aee6630783ecf2b611a632adde9aff318d2fad39ead800",
};
const index: CatalogIndex = {
  formatVersion: 1,
  entries: [{
    kind: "skill", name: "echo-skill", version: "1.0.0", digest: manifest.digest,
    location: { type: "catalog", path: "packages/echo-skill", revision: { type: "catalog-revision" } },
  }],
};

describe("Source fetch/inspection adapter", () => {
  it("uses only the selected Source credential, fixed index, offline inspection, and exact promotion", async () => {
    const opened = openCatalogFixture();
    const mirrorsRoot = await mkdtemp(join(tmpdir(), "catalog-authority-mirrors-"));
    const repo = await createLocalFixtureRepo(JSON.stringify(index), "/usr/bin/git", [
      { path: "packages/echo-skill/orgops-package.json", contents: `${JSON.stringify(manifest, null, 2)}\n` },
      { path: "packages/echo-skill/SKILL.md", contents: skillMd.toString("utf8") },
      { path: "packages/echo-skill/event-shapes.ts", contents: eventShapes.toString("utf8") },
    ]);
    const calls: { fetch: { credential: { username: string; password: string } | undefined }[] } = { fetch: [] };
    try {
      const now = Date.now();
      const repositoryIdentity = JSON.stringify(["https://github.com/example/team-packages", null]);
      opened.db.prepare(`INSERT INTO catalog_sources
        (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
        VALUES ('source-team','Team','https://github.com/example/team-packages',?,'main',1,0,1,?,?)`).run(repositoryIdentity, now, now);
      const credentialRef = "credential-team";
      const ciphertext = encryptSecret(parseMasterKey(masterKey), JSON.stringify({
        version: 1, kind: "https-basic", sourceId: "source-team", repositoryIdentity,
        credentialRef, username: "team-reader", password: "team-secret",
      }));
      opened.db.prepare(`INSERT INTO catalog_source_read_credentials
        (source_id,credential_ref,kind,ciphertext_b64,revision,created_at,updated_at)
        VALUES ('source-team',?,'https-basic',?,1,?,?)`).run(credentialRef, ciphertext, now, now);

      const adapter = createSourceFetchAdapter({
        db: opened.db,
        mirrorsRoot,
        gitExecutable: "/usr/bin/git",
        transport: repo.transport(calls),
        getMasterKey: () => masterKey,
      });
      const audits: string[] = [];
      const authority = createCatalogAuthority({
        db: opened.db,
        ...adapter,
        writeAudit(tx, event) {
          expect(tx.inTransaction).toBe(true);
          audits.push(JSON.stringify(event));
        },
        publishAudit() {},
      });
      const result = await authority.execute({ kind: "source.sync", sourceId: "source-team", expectedRevision: 1 }, adminActor());
      expect(result).toMatchObject({ kind: "sync", syncAttempt: { state: "SUCCEEDED" }, source: { currentSnapshotId: expect.any(String) } });
      expect(calls.fetch).toEqual([{ credential: { username: "team-reader", password: "team-secret" } }]);
      expect(await adapter.resolvePromotedCommit("source-team", CATALOG_SYNC_CURRENT_REF)).toBe(repo.commit);
      expect(opened.db.prepare("SELECT name,version,digest FROM catalog_package_releases").all()).toEqual([
        { name: "echo-skill", version: "1.0.0", digest: manifest.digest },
      ]);
      expect(audits.join("\n")).not.toContain("team-secret");
      expect(audits.join("\n")).not.toContain("github.com");
    } finally {
      opened.close();
      await repo.dispose();
      await rm(mirrorsRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("refuses a credential envelope copied from another Source before transport fetch", async () => {
    const opened = openCatalogFixture();
    const mirrorsRoot = await mkdtemp(join(tmpdir(), "catalog-authority-scope-"));
    const repo = await createLocalFixtureRepo(JSON.stringify({ formatVersion: 1, entries: [] }));
    const calls: { fetch: { credential: { username: string; password: string } | undefined }[] } = { fetch: [] };
    try {
      const now = Date.now();
      const repositoryIdentity = JSON.stringify(["https://github.com/example/team-packages", null]);
      opened.db.prepare(`INSERT INTO catalog_sources
        (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
        VALUES ('source-team','Team','https://github.com/example/team-packages',?,'main',1,0,1,?,?)`).run(repositoryIdentity, now, now);
      const ciphertext = encryptSecret(parseMasterKey(masterKey), JSON.stringify({
        version: 1, kind: "https-basic", sourceId: "source-other", repositoryIdentity,
        credentialRef: "credential-other", username: "other-reader", password: "other-secret",
      }));
      opened.db.prepare(`INSERT INTO catalog_source_read_credentials
        (source_id,credential_ref,kind,ciphertext_b64,revision,created_at,updated_at)
        VALUES ('source-team','credential-team','https-basic',?,1,?,?)`).run(ciphertext, now, now);
      const adapter = createSourceFetchAdapter({ db: opened.db, mirrorsRoot, gitExecutable: "/usr/bin/git", transport: repo.transport(calls), getMasterKey: () => masterKey });
      await expect(adapter.fetchSource({
        sourceId: "source-team", canonicalUrl: "https://github.com/example/team-packages",
        repositoryIdentity, ref: "main",
      })).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
      expect(calls.fetch).toEqual([]);
    } finally {
      opened.close();
      await repo.dispose();
      await rm(mirrorsRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
