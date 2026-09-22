import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { OrgOpsDb } from "@orgops/db";
import type { CatalogAuditEvent, CatalogIndex, CatalogAuthorityCommand, PackageManifest } from "@orgops/schemas";
import type { PackageSnapshot } from "@orgops/skills";
import { adminActor, openCatalogFixture } from "./test-fixtures";
import {
  createCatalogAuthority,
  type AuditWriter,
  type FetchSource,
  type SourceFetchObservation,
} from "./authority";

const masterKey = Buffer.alloc(32, 7).toString("base64");
let previousMasterKey: string | undefined;
beforeAll(() => {
  previousMasterKey = process.env.ORGOPS_MASTER_KEY;
  process.env.ORGOPS_MASTER_KEY = masterKey;
});
afterAll(() => {
  if (previousMasterKey === undefined) delete process.env.ORGOPS_MASTER_KEY;
  else process.env.ORGOPS_MASTER_KEY = previousMasterKey;
});
afterEach(() => vi.restoreAllMocks());

const digest = (label: string) => `sha256:${createHash("sha256").update(label).digest("hex")}`;
const commit = (label: string) => createHash("sha1").update(label).digest("hex");

function catalogIndexFixture(label: string): { index: CatalogIndex; indexJson: string; release: PackageSnapshot } {
  const packageDigest = digest(`package:${label}`);
  const packageCommit = commit("package-v1");
  const manifest: PackageManifest = {
    formatVersion: 1,
    kind: "skill",
    name: "demo-skill",
    version: "1.0.0",
    description: "Inert fixture package.",
    author: "OrgOps",
    license: "MIT",
    compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] },
    secrets: [],
    dependencies: [],
    files: [],
    executables: [],
    digest: packageDigest,
    skill: { entrypoint: "SKILL.md" },
  };
  const index: CatalogIndex = {
    formatVersion: 1,
    entries: [{
      kind: "skill",
      name: "demo-skill",
      version: "1.0.0",
      digest: packageDigest,
      location: { type: "catalog", path: "skills/demo-skill", revision: { type: "exact", commit: packageCommit } },
    }],
  };
  return {
    index,
    indexJson: JSON.stringify(index),
    release: {
      manifest,
      files: [{ path: "SKILL.md", base64: Buffer.from("# inert\n").toString("base64"), executable: false, size: 8, digest: digest("# inert\n") }],
      execution: { apiEventShapes: [], runnerScripts: [], wrappedCommands: [], externalSources: [] },
      warnings: [],
    },
  };
}

function sourceCommand(sourceId = "source-team"): CatalogAuthorityCommand {
  return {
    kind: "source.create",
    source: {
      sourceId,
      displayName: "Team packages",
      repository: { url: "https://github.com/example/team-packages" },
      ref: "main",
      enabled: true,
      allowPackages: false,
    },
  };
}

type FailureMode = "fetch" | "inspection" | "identity" | "promotion" | "transaction" | "cleanup";

type FixtureOptions = { fetchSource?: FetchSource; writeAudit?: AuditWriter };
function makeAuthorityFixture(options: FixtureOptions = {}) {
  const opened = openCatalogFixture();
  const { db } = opened;
  let failure: FailureMode | null = null;
  const published: CatalogAuditEvent[] = [];
  const fixture = catalogIndexFixture("good-commit");
  const sourceCommit = commit("good-commit");
  const fetchSource: FetchSource = options.fetchSource ?? (async (): Promise<SourceFetchObservation> => {
    if (failure === "fetch") { failure = null; throw new Error("secret fetch detail"); }
    return {
      commit: sourceCommit,
      observedRef: "main",
      async promote(exactCommit) {
        expect(exactCommit).toBe(sourceCommit);
        if (failure === "promotion") { failure = null; throw new Error("secret promotion detail"); }
      },
      async cleanup() {
        if (failure === "cleanup") { failure = null; throw new Error("secret cleanup detail"); }
      },
      inspectionContext: { kind: "fixture", sourceId: "source-team" },
    };
  });
  const normalWriteAudit: AuditWriter = (tx, event) => {
    expect(tx.inTransaction).toBe(true);
    tx.prepare(`INSERT INTO events
      (id,type,payload_json,source,channel_id,parent_event_id,deliver_at,status,fail_count,last_error,idempotency_key,created_at)
      VALUES (?,?,?,?,NULL,NULL,NULL,'DELIVERED',0,NULL,NULL,?)`)
      .run(`audit-${crypto.randomUUID()}`, event.type, JSON.stringify(event.payload), "system", Date.now());
  };
  const writeAudit: AuditWriter = options.writeAudit ?? ((tx, event) => {
    if (failure === "transaction") { failure = null; throw new Error("secret sqlite detail"); }
    normalWriteAudit(tx, event);
  });
  const authority = createCatalogAuthority({
    db,
    fetchSource,
    inspectIndex: async () => {
      if (failure === "inspection") { failure = null; throw new Error("secret authored bytes"); }
      return { index: fixture.index, indexJson: fixture.indexJson, indexDigest: digest(fixture.indexJson) };
    },
    inspectRelease: async () => {
      if (failure === "identity") {
        failure = null;
        return { ...fixture.release, execution: { ...fixture.release.execution, runnerScripts: ["changed.sh"] } };
      }
      return fixture.release;
    },
    writeAudit,
    publishAudit(event) {
      expect(db.inTransaction).toBe(false);
      published.push(event);
    },
  });
  return {
    authority,
    db,
    close: opened.close,
    auditEvents: () => db.prepare("SELECT type,payload_json FROM events WHERE type LIKE 'audit.catalog.%' ORDER BY created_at").all(),
    published,
    seedSource() {
      const now = Date.now();
      db.prepare(`INSERT INTO catalog_sources
        (source_id,display_name,canonical_url,ssh_user,repository_identity,ref,enabled,allow_packages,revision,removed_at,current_snapshot_id,created_at,updated_at)
        VALUES ('source-team','Team packages','https://github.com/example/team-packages',NULL,?,'main',1,0,1,NULL,NULL,?,?)`)
        .run(JSON.stringify(["https://github.com/example/team-packages", null]), now, now);
    },
    failNextSync(mode: FailureMode) { failure = mode; },
    currentSnapshotId() {
      return (db.prepare("SELECT current_snapshot_id AS id FROM catalog_sources WHERE source_id='source-team'").get() as { id: string | null }).id;
    },
    snapshotCount() {
      return (db.prepare("SELECT count(*) AS n FROM catalog_snapshots WHERE source_id='source-team'").get() as { n: number }).n;
    },
  };
}

async function establishLastKnownGood(fixture: ReturnType<typeof makeAuthorityFixture>) {
  fixture.seedSource();
  const success = await fixture.authority.execute(
    { kind: "source.sync", sourceId: "source-team", expectedRevision: 1 },
    adminActor(),
  );
  expect(success).toMatchObject({ kind: "sync", syncAttempt: { state: "SUCCEEDED" } });
  const first = fixture.currentSnapshotId();
  expect(first).toEqual(expect.any(String));
  expect(fixture.snapshotCount()).toBe(1);
  return first;
}

describe("CatalogAuthority transaction ownership", () => {
  it("commits a successful Source mutation and its audit in one transaction", async () => {
    const fixture = makeAuthorityFixture();
    try {
      await fixture.authority.execute(sourceCommand(), adminActor());
      expect(fixture.db.prepare("SELECT count(*) AS n FROM catalog_sources").get()).toEqual({ n: 1 });
      expect(fixture.auditEvents()).toHaveLength(1);
      expect(fixture.published).toHaveLength(1);
    } finally { fixture.close(); }
  });

  it("rolls back the control mutation when audit insertion fails", async () => {
    const fixture = makeAuthorityFixture({ writeAudit: () => { throw new Error("audit failure"); } });
    try {
      await expect(fixture.authority.execute(sourceCommand(), adminActor())).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
      expect(fixture.db.prepare("SELECT count(*) AS n FROM catalog_sources").get()).toEqual({ n: 0 });
      expect(fixture.published).toEqual([]);
    } finally { fixture.close(); }
  });

  it("publishes only after the source and audit commit is visible", async () => {
    const fixture = makeAuthorityFixture();
    try {
      await fixture.authority.execute(sourceCommand(), adminActor());
      expect(fixture.published[0]).toMatchObject({ type: "audit.catalog.source.changed", payload: { action: "source.create" } });
      expect(fixture.auditEvents()).toHaveLength(1);
    } finally { fixture.close(); }
  });
});

describe("CatalogAuthority synchronization", () => {
  it.each(["fetch", "inspection", "identity", "promotion", "transaction", "cleanup"] as const)(
    "keeps a non-null last-known-good snapshot after %s failure",
    async (failureMode) => {
      const fixture = makeAuthorityFixture();
      try {
        const first = await establishLastKnownGood(fixture);
        fixture.failNextSync(failureMode);
        const failed = await fixture.authority.execute(
          { kind: "source.sync", sourceId: "source-team", expectedRevision: 1 },
          adminActor(),
        );
        expect(failed).toMatchObject({ kind: "sync", syncAttempt: { state: "FAILED" } });
        expect(fixture.currentSnapshotId()).toBe(first);
        expect(fixture.snapshotCount()).toBe(1);
        const attempt = fixture.db.prepare("SELECT state,failure_code,resolved_commit FROM catalog_sync_attempts ORDER BY rowid DESC LIMIT 1").get();
        expect(attempt).toMatchObject({ state: "FAILED", failure_code: expect.any(String) });
        expect(JSON.stringify(attempt)).not.toContain("secret");
      } finally { fixture.close(); }
    },
  );

  it("persists RUNNING before fetch and never holds a SQLite transaction during external work", async () => {
    const opened = openCatalogFixture();
    const observations: Array<{ inTransaction: boolean; state: string | undefined }> = [];
    const fixtureData = catalogIndexFixture("good-commit");
    const authority = createCatalogAuthority({
      db: opened.db,
      fetchSource: async () => {
        observations.push({
          inTransaction: opened.db.inTransaction,
          state: (opened.db.prepare("SELECT state FROM catalog_sync_attempts").get() as { state?: string } | undefined)?.state,
        });
        return { commit: commit("good-commit"), observedRef: "main", inspectionContext: {}, promote: async () => {}, cleanup: async () => {} };
      },
      inspectIndex: async () => {
        observations.push({ inTransaction: opened.db.inTransaction, state: undefined });
        return { index: fixtureData.index, indexJson: fixtureData.indexJson, indexDigest: digest(fixtureData.indexJson) };
      },
      inspectRelease: async () => fixtureData.release,
      writeAudit: () => {},
      publishAudit: () => {},
    });
    try {
      const now = Date.now();
      opened.db.prepare(`INSERT INTO catalog_sources
        (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
        VALUES ('source-team','Team','https://github.com/example/team',?,'main',1,0,1,?,?)`)
        .run(JSON.stringify(["https://github.com/example/team", null]), now, now);
      await authority.execute({ kind: "source.sync", sourceId: "source-team", expectedRevision: 1 }, adminActor());
      expect(observations).toEqual([
        { inTransaction: false, state: "RUNNING" },
        { inTransaction: false, state: undefined },
      ]);
    } finally { opened.close(); }
  });

  it("rejects a stale revision before fetch", async () => {
    const fetchSource = vi.fn<FetchSource>();
    const fixture = makeAuthorityFixture({ fetchSource });
    try {
      fixture.seedSource();
      await expect(fixture.authority.execute(
        { kind: "source.sync", sourceId: "source-team", expectedRevision: 2 },
        adminActor(),
      )).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      expect(fetchSource).not.toHaveBeenCalled();
      expect(fixture.db.prepare("SELECT count(*) AS n FROM catalog_sync_attempts").get()).toEqual({ n: 0 });
    } finally { fixture.close(); }
  });

  it("enforces one running attempt per Source", async () => {
    let releaseFetch!: () => void;
    const wait = new Promise<void>(resolve => { releaseFetch = resolve; });
    const data = catalogIndexFixture("good-commit");
    const fixture = makeAuthorityFixture({
      fetchSource: async () => {
        await wait;
        return { commit: commit("good-commit"), observedRef: "main", inspectionContext: data, promote: async () => {}, cleanup: async () => {} };
      },
    });
    try {
      fixture.seedSource();
      const first = fixture.authority.execute({ kind: "source.sync", sourceId: "source-team", expectedRevision: 1 }, adminActor());
      await vi.waitFor(() => expect(fixture.db.prepare("SELECT state FROM catalog_sync_attempts").get()).toEqual({ state: "RUNNING" }));
      await expect(fixture.authority.execute(
        { kind: "source.sync", sourceId: "source-team", expectedRevision: 1 }, adminActor(),
      )).rejects.toMatchObject({ code: "OPERATION_IN_PROGRESS" });
      releaseFetch();
      await first;
    } finally { fixture.close(); }
  });

  it("rechecks live administrator authority after fetch", async () => {
    const fixture = makeAuthorityFixture({
      fetchSource: async () => {
        fixture.db.prepare("UPDATE humans SET is_admin=0 WHERE id='human-a'").run();
        return { commit: commit("good-commit"), observedRef: "main", inspectionContext: {}, promote: async () => {}, cleanup: async () => {} };
      },
    });
    try {
      fixture.seedSource();
      const result = await fixture.authority.execute({ kind: "source.sync", sourceId: "source-team", expectedRevision: 1 }, adminActor());
      expect(result).toMatchObject({ kind: "sync", syncAttempt: { state: "FAILED", failureCode: "SOURCE_NOT_ALLOWED" } });
      expect(fixture.currentSnapshotId()).toBeNull();
    } finally { fixture.close(); }
  });

  it("rechecks the Source revision after fetch before committing an observation", async () => {
    const fixture = makeAuthorityFixture({
      fetchSource: async () => {
        fixture.db.prepare("UPDATE catalog_sources SET revision=2 WHERE source_id='source-team'").run();
        return { commit: commit("good-commit"), observedRef: "main", inspectionContext: {}, promote: async () => {}, cleanup: async () => {} };
      },
    });
    try {
      fixture.seedSource();
      const result = await fixture.authority.execute({ kind: "source.sync", sourceId: "source-team", expectedRevision: 1 }, adminActor());
      expect(result).toMatchObject({ kind: "sync", syncAttempt: { state: "FAILED", failureCode: "SYNC_FAILED" } });
      expect(fixture.currentSnapshotId()).toBeNull();
      expect(fixture.snapshotCount()).toBe(0);
    } finally { fixture.close(); }
  });

  it("rechecks the immutable repository and ref binding after fetch", async () => {
    const fixture = makeAuthorityFixture({
      fetchSource: async () => {
        fixture.db.prepare("UPDATE catalog_sources SET ref='changed-ref' WHERE source_id='source-team'").run();
        return { commit: commit("good-commit"), observedRef: "main", inspectionContext: {}, promote: async () => {}, cleanup: async () => {} };
      },
    });
    try {
      fixture.seedSource();
      const result = await fixture.authority.execute({ kind: "source.sync", sourceId: "source-team", expectedRevision: 1 }, adminActor());
      expect(result).toMatchObject({ kind: "sync", syncAttempt: { state: "FAILED", failureCode: "IDENTITY_CONFLICT" } });
      expect(fixture.currentSnapshotId()).toBeNull();
      expect(fixture.snapshotCount()).toBe(0);
    } finally { fixture.close(); }
  });

  it("rejects changed immutable release content for the complete sync", async () => {
    const fixture = makeAuthorityFixture();
    try {
      const first = await establishLastKnownGood(fixture);
      fixture.failNextSync("identity");
      const result = await fixture.authority.execute({ kind: "source.sync", sourceId: "source-team", expectedRevision: 1 }, adminActor());
      expect(result).toMatchObject({ kind: "sync", syncAttempt: { state: "FAILED", failureCode: "IDENTITY_CONFLICT" } });
      expect(fixture.currentSnapshotId()).toBe(first);
      expect(fixture.db.prepare("SELECT count(*) AS n FROM catalog_package_releases").get()).toEqual({ n: 1 });
    } finally { fixture.close(); }
  });

  it("rechecks external content Source permission after inspection before committing", async () => {
    const opened = openCatalogFixture();
    const local = catalogIndexFixture("last-known-good");
    const externalDigest = digest("external-package");
    const externalRelease: PackageSnapshot = {
      ...local.release,
      manifest: { ...local.release.manifest, name: "external-skill", digest: externalDigest },
    };
    const externalIndex: CatalogIndex = {
      formatVersion: 1,
      entries: [{
        kind: "skill",
        name: "external-skill",
        version: "1.0.0",
        digest: externalDigest,
        location: {
          type: "source",
          sourceId: "source-external",
          commit: commit("external-package"),
          path: "skills/external-skill",
        },
      }],
    };
    const externalIndexJson = JSON.stringify(externalIndex);
    let syncNumber = 0;
    const authority = createCatalogAuthority({
      db: opened.db,
      fetchSource: async () => {
        syncNumber += 1;
        const sourceCommit = commit(syncNumber === 1 ? "last-known-good" : "external-observation");
        return {
          commit: sourceCommit,
          observedRef: "main",
          inspectionContext: { syncNumber },
          promote: async () => {},
          cleanup: async () => {
            if (syncNumber === 2) {
              opened.db.prepare(`UPDATE catalog_sources SET allow_packages=0,revision=revision+1
                WHERE source_id='source-external'`).run();
            }
          },
        };
      },
      inspectIndex: async () => syncNumber === 1
        ? { index: local.index, indexJson: local.indexJson, indexDigest: digest(local.indexJson) }
        : { index: externalIndex, indexJson: externalIndexJson, indexDigest: digest(externalIndexJson) },
      inspectRelease: async (_observation, entry) => entry.name === "external-skill" ? externalRelease : local.release,
      writeAudit: () => {},
      publishAudit: () => {},
    });
    try {
      const now = Date.now();
      opened.db.prepare(`INSERT INTO catalog_sources
        (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
        VALUES
        ('source-team','Team','https://github.com/example/team',?,'main',1,0,1,?,?),
        ('source-external','External','https://github.com/example/external',?,'main',1,1,1,?,?)`)
        .run(JSON.stringify(["https://github.com/example/team", null]), now, now,
          JSON.stringify(["https://github.com/example/external", null]), now, now);
      const first = await authority.execute({ kind: "source.sync", sourceId: "source-team", expectedRevision: 1 }, adminActor());
      expect(first).toMatchObject({ kind: "sync", syncAttempt: { state: "SUCCEEDED" }, source: { currentSnapshotId: expect.any(String) } });
      const lastKnownGood = (first.kind === "sync" ? first.source.currentSnapshotId : null)!;
      expect(lastKnownGood).toEqual(expect.any(String));
      expect(opened.db.prepare("SELECT count(*) AS n FROM catalog_snapshots").get()).toEqual({ n: 1 });
      expect(opened.db.prepare("SELECT count(*) AS n FROM catalog_package_releases").get()).toEqual({ n: 1 });

      const raced = await authority.execute({ kind: "source.sync", sourceId: "source-team", expectedRevision: 1 }, adminActor());

      expect(raced).toMatchObject({ kind: "sync", syncAttempt: { state: "FAILED", failureCode: "SOURCE_NOT_ALLOWED" } });
      expect(raced.kind === "sync" && raced.source.currentSnapshotId).toBe(lastKnownGood);
      expect(opened.db.prepare("SELECT count(*) AS n FROM catalog_snapshots").get()).toEqual({ n: 1 });
      expect(opened.db.prepare("SELECT count(*) AS n FROM catalog_package_releases").get()).toEqual({ n: 1 });
      expect(opened.db.prepare("SELECT count(*) AS n FROM catalog_package_releases WHERE content_source_id='source-external'").get()).toEqual({ n: 0 });
    } finally { opened.close(); }
  });
});

describe("CatalogAuthority Source lifecycle and credential privacy", () => {
  it("patches, removes, and restores without changing immutable repository identity or ref", async () => {
    const fixture = makeAuthorityFixture();
    try {
      const created = await fixture.authority.execute(sourceCommand(), adminActor());
      expect(created).toMatchObject({ kind: "source", source: { revision: 1, ref: "main" } });
      const patched = await fixture.authority.execute({
        kind: "source.patch", sourceId: "source-team",
        patch: { expectedRevision: 1, displayName: "Renamed", allowPackages: true },
      }, adminActor());
      expect(patched).toMatchObject({ kind: "source", source: { displayName: "Renamed", allowPackages: true, revision: 2, ref: "main" } });
      const removed = await fixture.authority.execute({ kind: "source.remove", sourceId: "source-team", expectedRevision: 2 }, adminActor());
      expect(removed).toMatchObject({ kind: "source", source: { enabled: false, allowPackages: false, revision: 3, removedAt: expect.any(Number) } });
      const restored = await fixture.authority.execute({ kind: "source.restore", sourceId: "source-team", expectedRevision: 3 }, adminActor());
      expect(restored).toMatchObject({ kind: "source", source: { enabled: false, allowPackages: false, revision: 4, removedAt: null, ref: "main" } });
      expect((await fixture.authority.query({ kind: "source.detail", sourceId: "source-team" }, adminActor()))).not.toHaveProperty("repository");
    } finally { fixture.close(); }
  });

  it("stores a source-bound encrypted credential and exposes metadata only", async () => {
    const fixture = makeAuthorityFixture();
    try {
      await fixture.authority.execute(sourceCommand(), adminActor());
      const secret = "fixture-password-do-not-leak";
      const result = await fixture.authority.execute({
        kind: "source.credential.put", sourceId: "source-team", expectedRevision: 1,
        username: "reader", password: secret,
      }, adminActor());
      expect(result).toMatchObject({ kind: "source", source: { hasReadCredential: true, revision: 2 } });
      const row = fixture.db.prepare("SELECT source_id,credential_ref,ciphertext_b64 FROM catalog_source_read_credentials").get() as Record<string, string>;
      expect(row.source_id).toBe("source-team");
      expect(row.credential_ref).toEqual(expect.any(String));
      expect(row.ciphertext_b64).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(await fixture.authority.query({ kind: "source.list" }, adminActor()))).not.toContain("credential_ref");
      expect(JSON.stringify(fixture.auditEvents())).not.toContain(secret);
    } finally { fixture.close(); }
  });
});
