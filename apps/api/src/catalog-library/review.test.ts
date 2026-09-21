import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { CatalogAuditEvent, PackageManifest, PackageReleaseView } from "@orgops/schemas";
import { adminActor, humanActor, openCatalogFixture } from "./test-fixtures";
import { createCatalogAuthority, type AuditWriter } from "./authority";

const releaseDigest = `sha256:${"a".repeat(64)}`;
const fileDigest = `sha256:${"b".repeat(64)}`;
const firstReviewDigest = `sha256:${"c".repeat(64)}`;
const secondReviewDigest = `sha256:${"d".repeat(64)}`;
const commit = "a".repeat(40);
const sha256 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const manifest: PackageManifest = {
  formatVersion: 1,
  kind: "skill",
  name: "demo-skill",
  version: "1.0.0",
  description: "Review fixture.",
  author: "OrgOps",
  license: "MIT",
  compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] },
  secrets: [],
  dependencies: [],
  files: [{ path: "SKILL.md", size: 12, digest: fileDigest, executable: false }],
  executables: [],
  digest: releaseDigest,
  skill: { entrypoint: "SKILL.md" },
};
const executionPreview = {
  apiEventShapes: ["event-shapes.ts"],
  runnerScripts: [],
  wrappedCommands: [],
  externalSources: [],
};
const warnings = [{ code: "MANUAL_REVIEW_REQUIRED", at: "event-shapes.ts" }] as const;

function seedRelease(db: ReturnType<typeof openCatalogFixture>["db"], state: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" = "PENDING", revision = 1, reviewDigest: string | null = state === "PENDING" ? null : firstReviewDigest) {
  db.prepare(`INSERT INTO catalog_sources
    (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
    VALUES ('source-team','Team','https://github.com/example/team',?,'main',1,0,1,1,1)`)
    .run(JSON.stringify(["github", "example", "team"]));
  db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,
     manifest_json,execution_preview_json,warnings_json,created_at)
    VALUES ('release-skill','source-team','source-team','skill','demo-skill','1.0.0',?,?,?,?,?,?,?,1)`)
    .run(releaseDigest, commit, commit, "skills/demo-skill", JSON.stringify(manifest), JSON.stringify(executionPreview), JSON.stringify(warnings));
  db.prepare(`INSERT INTO catalog_release_controls
    (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
    VALUES ('release-skill',?,?,?, ?,?,1,1)`)
    .run(state, reviewDigest, state === "PENDING" ? null : "human-a", state === "PENDING" ? null : 1, revision);
}

function makeAuthorityFixture(options: { state?: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN"; revision?: number; reviewDigest?: string | null; writeAudit?: AuditWriter } = {}) {
  const opened = openCatalogFixture();
  seedRelease(opened.db, options.state, options.revision, options.reviewDigest);
  const published: CatalogAuditEvent[] = [];
  const writeAudit: AuditWriter = options.writeAudit ?? ((tx, event) => {
    expect(tx.inTransaction).toBe(true);
    tx.prepare(`INSERT INTO events
      (id,type,payload_json,source,channel_id,parent_event_id,deliver_at,status,fail_count,last_error,idempotency_key,created_at)
      VALUES (?,?,?,?,NULL,NULL,NULL,'DELIVERED',0,NULL,NULL,?)`)
      .run(`audit-${crypto.randomUUID()}`, event.type, JSON.stringify(event.payload), "system", Date.now());
  });
  const authority = createCatalogAuthority({
    db: opened.db,
    fetchSource: async () => { throw new Error("not used"); },
    inspectIndex: async () => { throw new Error("not used"); },
    inspectRelease: async () => { throw new Error("not used"); },
    writeAudit,
    publishAudit(event) {
      expect(opened.db.inTransaction).toBe(false);
      expect(opened.db.prepare("SELECT count(*) AS n FROM events WHERE type='audit.catalog.release.reviewed'").get()).toEqual({ n: 1 });
      published.push(event);
    },
  });
  return { ...opened, authority, published };
}

const opened: Array<ReturnType<typeof makeAuthorityFixture>> = [];
afterEach(() => {
  while (opened.length) opened.pop()!.close();
});
function trackedFixture(options?: Parameters<typeof makeAuthorityFixture>[0]) {
  const fixture = makeAuthorityFixture(options);
  opened.push(fixture);
  return fixture;
}

function reviewCommand(action: "APPROVE" | "REJECT" | "WITHDRAW" | "REOPEN", expectedRevision = 1, reviewDigest = firstReviewDigest) {
  return { kind: "release.review" as const, releaseId: "release-skill", action, expectedRevision, digest: releaseDigest, reviewDigest };
}

describe("CatalogAuthority release discovery and projection", () => {
  it("preserves a reviewed control when sync reuses the same immutable release", async () => {
    const openedDb = openCatalogFixture();
    const sourceCommit = "f".repeat(40);
    const index = {
      formatVersion: 1 as const,
      entries: [{
        kind: "skill" as const,
        name: "demo-skill",
        version: "1.0.0",
        digest: releaseDigest,
        location: { type: "catalog" as const, path: "skills/demo-skill", revision: { type: "exact" as const, commit: sourceCommit } },
      }],
    };
    const indexJson = JSON.stringify(index);
    openedDb.db.prepare(`INSERT INTO catalog_sources
      (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
      VALUES ('source-team','Team','https://github.com/example/team',?,'main',1,0,1,1,1)`)
      .run(JSON.stringify(["github", "example", "team"]));
    const authority = createCatalogAuthority({
      db: openedDb.db,
      fetchSource: async () => ({ commit: sourceCommit, observedRef: "main", inspectionContext: {}, promote: async () => {}, cleanup: async () => {} }),
      inspectIndex: async () => ({ index, indexJson, indexDigest: sha256(indexJson) }),
      inspectRelease: async () => ({
        manifest,
        files: [{ path: "SKILL.md", base64: Buffer.from("fixture").toString("base64"), executable: false, size: 12, digest: fileDigest }],
        execution: executionPreview,
        warnings,
      }),
      writeAudit: () => {},
      publishAudit: () => {},
    });
    try {
      await authority.execute({ kind: "source.sync", sourceId: "source-team", expectedRevision: 1 }, adminActor());
      const discovered = openedDb.db.prepare<[], { package_release_id: string }>(
        "SELECT package_release_id FROM catalog_package_releases",
      ).get()!;
      const immutableBefore = openedDb.db.prepare("SELECT * FROM catalog_package_releases WHERE package_release_id=?")
        .get(discovered.package_release_id);
      const snapshotBefore = openedDb.db.prepare("SELECT current_snapshot_id FROM catalog_sources WHERE source_id='source-team'").get();
      const reviewedResult = await authority.execute({
        kind: "release.review",
        releaseId: discovered.package_release_id,
        action: "APPROVE",
        expectedRevision: 1,
        digest: releaseDigest,
        reviewDigest: secondReviewDigest,
      }, adminActor());
      expect(reviewedResult).toMatchObject({
        kind: "review",
        release: {
          reviewState: "APPROVED",
          reviewDigest: secondReviewDigest,
          reviewer: { humanId: "human-a", reviewedAt: expect.any(Number) },
          revision: 2,
        },
      });
      if (reviewedResult.kind !== "review") throw new Error("expected release review result");
      const reviewedBeforeReuse = reviewedResult.release;

      await authority.execute({ kind: "source.sync", sourceId: "source-team", expectedRevision: 1 }, adminActor());

      const afterReuse = await authority.query(
        { kind: "release.detail", packageReleaseId: discovered.package_release_id },
        adminActor(),
      ) as PackageReleaseView;
      expect(afterReuse).toMatchObject({
        reviewState: "APPROVED",
        reviewDigest: secondReviewDigest,
        reviewer: reviewedBeforeReuse.reviewer,
        revision: 2,
      });
      expect({
        reviewState: afterReuse.reviewState,
        reviewDigest: afterReuse.reviewDigest,
        reviewer: afterReuse.reviewer,
        revision: afterReuse.revision,
      }).toEqual({
        reviewState: reviewedBeforeReuse.reviewState,
        reviewDigest: reviewedBeforeReuse.reviewDigest,
        reviewer: reviewedBeforeReuse.reviewer,
        revision: reviewedBeforeReuse.revision,
      });
      expect(openedDb.db.prepare("SELECT * FROM catalog_package_releases WHERE package_release_id=?")
        .get(discovered.package_release_id)).toEqual(immutableBefore);
      expect(openedDb.db.prepare("SELECT current_snapshot_id FROM catalog_sources WHERE source_id='source-team'").get())
        .toEqual(snapshotBefore);
      expect(openedDb.db.prepare("SELECT count(*) AS n FROM catalog_snapshots").get()).toEqual({ n: 1 });
      expect(openedDb.db.prepare("SELECT count(*) AS n FROM catalog_package_releases").get()).toEqual({ n: 1 });
      expect(openedDb.db.prepare("SELECT count(*) AS n FROM catalog_release_controls").get()).toEqual({ n: 1 });
    } finally { openedDb.close(); }
  });

  it("starts each immutable release with one pending control hidden from non-administrators", async () => {
    const fixture = trackedFixture();
    const detail = await fixture.authority.query({ kind: "release.detail", packageReleaseId: "release-skill" }, adminActor());
    expect(detail).toMatchObject({ packageReleaseId: "release-skill", reviewState: "PENDING", revision: 1 });
    expect(await fixture.authority.query({ kind: "release.list" }, adminActor())).toEqual([detail]);
    expect(fixture.db.prepare("SELECT count(*) AS n FROM catalog_release_controls WHERE package_release_id='release-skill'").get()).toEqual({ n: 1 });
    await expect(fixture.authority.query({ kind: "release.list" }, humanActor())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(fixture.authority.query({ kind: "release.detail", packageReleaseId: "release-skill" }, humanActor())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns the complete immutable review and execution projection without private or executable content", async () => {
    const fixture = trackedFixture();
    const detail = await fixture.authority.query({ kind: "release.detail", packageReleaseId: "release-skill" }, adminActor());
    expect(detail).toEqual({
      packageReleaseId: "release-skill",
      authoritySourceId: "source-team",
      contentSourceId: "source-team",
      kind: "skill",
      name: "demo-skill",
      version: "1.0.0",
      digest: releaseDigest,
      catalogCommit: commit,
      packageCommit: commit,
      packagePath: "skills/demo-skill",
      manifest,
      executionPreview,
      warnings,
      files: [{ path: "SKILL.md", mode: 0o644, size: 12, digest: fileDigest }],
      reviewState: "PENDING",
      reviewDigest: null,
      reviewer: null,
      installationState: "ABSENT",
      apiActivation: { approvalState: "AWAITING_APPROVAL", runtimeState: "INACTIVE", revision: 1, failureCode: null },
      revision: 1,
    });
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toMatch(/base64|ciphertext|credential|repository|authorization|throw new Error/i);

    fixture.db.prepare(`INSERT INTO catalog_installations
      (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
      VALUES ('release-skill',?,'/private/artifact','INSTALLED','human-a',1,1,1)`).run(releaseDigest);
    fixture.db.prepare(`INSERT INTO catalog_api_activations
      (release_id,approval_state,runtime_state,failure_code,approved_digest,approved_by_human_id,approved_at,revision,created_at,updated_at)
      VALUES ('release-skill','APPROVED','ACTIVE',NULL,?,'human-a',1,3,1,1)`).run(releaseDigest);
    const projectedState = await fixture.authority.query({ kind: "release.detail", packageReleaseId: "release-skill" }, adminActor());
    expect(projectedState).toMatchObject({
      installationState: "INSTALLED",
      apiActivation: { approvalState: "APPROVED", runtimeState: "ACTIVE", revision: 3, failureCode: null },
    });
    expect(JSON.stringify(projectedState)).not.toContain("/private/artifact");
  });
});

describe("CatalogAuthority release review state machine", () => {
  it.each([
    ["PENDING", "APPROVE", "APPROVED"],
    ["PENDING", "REJECT", "REJECTED"],
    ["APPROVED", "WITHDRAW", "WITHDRAWN"],
    ["REJECTED", "REOPEN", "PENDING"],
    ["WITHDRAWN", "REOPEN", "PENDING"],
  ] as const)("allows %s -> %s -> %s", async (from, action, to) => {
    const fixture = trackedFixture({ state: from });
    const immutableBefore = fixture.db.prepare("SELECT * FROM catalog_package_releases WHERE package_release_id='release-skill'").get();
    const result = await fixture.authority.execute(reviewCommand(action), adminActor());
    expect(result).toMatchObject({
      kind: "review",
      release: {
        reviewState: to,
        reviewDigest: to === "PENDING" ? null : firstReviewDigest,
        reviewer: to === "PENDING" ? null : { humanId: "human-a", reviewedAt: expect.any(Number) },
        revision: 2,
        installationState: "ABSENT",
        apiActivation: { approvalState: "AWAITING_APPROVAL", runtimeState: "INACTIVE" },
      },
    });
    expect(fixture.db.prepare("SELECT * FROM catalog_package_releases WHERE package_release_id='release-skill'").get()).toEqual(immutableBefore);
    expect(fixture.db.prepare("SELECT count(*) AS n FROM catalog_installations").get()).toEqual({ n: 0 });
    expect(fixture.db.prepare("SELECT count(*) AS n FROM catalog_api_activations").get()).toEqual({ n: 0 });
    expect(fixture.published).toHaveLength(1);
  });

  it.each([
    ["PENDING", "WITHDRAW"], ["PENDING", "REOPEN"],
    ["APPROVED", "APPROVE"], ["APPROVED", "REJECT"], ["APPROVED", "REOPEN"],
    ["REJECTED", "APPROVE"], ["REJECTED", "REJECT"], ["REJECTED", "WITHDRAW"],
    ["WITHDRAWN", "APPROVE"], ["WITHDRAWN", "REJECT"], ["WITHDRAWN", "WITHDRAW"],
  ] as const)("rejects invalid %s -> %s", async (state, action) => {
    const fixture = trackedFixture({ state });
    await expect(fixture.authority.execute(reviewCommand(action), adminActor())).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expect(fixture.db.prepare("SELECT review_state,revision FROM catalog_release_controls WHERE package_release_id='release-skill'").get())
      .toEqual({ review_state: state, revision: 1 });
  });

  it("distinguishes stale revision, immutable release digest, review digest, state, and not-found conflicts", async () => {
    const pending = trackedFixture();
    await expect(pending.authority.execute(reviewCommand("APPROVE", 2), adminActor())).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(pending.authority.execute({ ...reviewCommand("APPROVE"), digest: secondReviewDigest }, adminActor())).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

    const approved = trackedFixture({ state: "APPROVED" });
    await expect(approved.authority.execute(reviewCommand("WITHDRAW", 1, secondReviewDigest), adminActor())).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(approved.authority.execute(reviewCommand("REOPEN"), adminActor())).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    await expect(approved.authority.execute({ ...reviewCommand("WITHDRAW"), releaseId: "release-missing" }, adminActor())).rejects.toMatchObject({ code: "NOT_FOUND" });

    for (const state of ["REJECTED", "WITHDRAWN"] as const) {
      const reopenable = trackedFixture({ state });
      await expect(reopenable.authority.execute(reviewCommand("REOPEN", 1, secondReviewDigest), adminActor()))
        .rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    }
  });

  it("requires fresh live-human administrator authority", async () => {
    const fixture = trackedFixture();
    fixture.db.prepare("UPDATE humans SET is_admin=0 WHERE id='human-a'").run();
    await expect(fixture.authority.execute(reviewCommand("APPROVE"), adminActor())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.db.prepare("SELECT review_state,revision FROM catalog_release_controls").get()).toEqual({ review_state: "PENDING", revision: 1 });
  });

  it("commits typed audit and review together, publishes after commit, and has no install, activation, or provenance side effects", async () => {
    const fixture = trackedFixture();
    const immutableBefore = fixture.db.prepare("SELECT * FROM catalog_package_releases WHERE package_release_id='release-skill'").get();
    const result = await fixture.authority.execute(reviewCommand("APPROVE"), adminActor());
    expect(result).toMatchObject({ kind: "review", release: { reviewState: "APPROVED", revision: 2 } });
    expect(fixture.db.prepare("SELECT * FROM catalog_package_releases WHERE package_release_id='release-skill'").get()).toEqual(immutableBefore);
    expect(fixture.db.prepare("SELECT count(*) AS n FROM catalog_installations").get()).toEqual({ n: 0 });
    expect(fixture.db.prepare("SELECT count(*) AS n FROM catalog_api_activations").get()).toEqual({ n: 0 });
    expect(fixture.db.prepare("SELECT count(*) AS n FROM catalog_snapshot_entries").get()).toEqual({ n: 0 });
    const audit = fixture.db.prepare("SELECT type,payload_json,source,channel_id,status FROM events WHERE type='audit.catalog.release.reviewed'").get() as Record<string, unknown>;
    expect(audit).toMatchObject({ type: "audit.catalog.release.reviewed", source: "system", channel_id: null, status: "DELIVERED" });
    expect(JSON.parse(audit.payload_json as string)).toEqual({
      actorKind: "HUMAN_ADMIN", actorId: "human-a", action: "APPROVE", outcome: "SUCCEEDED",
      revision: 2, releaseId: "release-skill", digest: releaseDigest,
    });
    expect(fixture.published).toHaveLength(1);
  });

  it("rolls back review mutation when typed audit insertion fails and never publishes", async () => {
    const fixture = trackedFixture({ writeAudit: () => { throw new Error("private sqlite detail"); } });
    await expect(fixture.authority.execute(reviewCommand("APPROVE"), adminActor())).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
    expect(fixture.db.prepare("SELECT review_state,review_digest,revision FROM catalog_release_controls").get())
      .toEqual({ review_state: "PENDING", review_digest: null, revision: 1 });
    expect(fixture.published).toEqual([]);
  });
});
