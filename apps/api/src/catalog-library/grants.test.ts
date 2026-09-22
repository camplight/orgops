import { afterEach, describe, expect, it } from "vitest";
import type { CatalogAuditEvent, PackageReleaseView } from "@orgops/schemas";
import { adminActor, approvedRelease, humanActor, openCatalogFixture } from "./test-fixtures";
import { CatalogAuthorityError, createCatalogAuthority } from "./authority";
import { catalogGrantId } from "./grant-identity";
import { createCatalogPolicy } from "./policy";

function seedRelease(db: ReturnType<typeof openCatalogFixture>["db"], options: {
  state?: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  installed?: boolean;
  artifactDigest?: string;
} = {}) {
  const release = approvedRelease();
  const state = options.state ?? "APPROVED";
  db.prepare(`INSERT INTO catalog_sources
    (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
    VALUES ('source-team','Team','https://github.com/example/team',?,'main',1,0,1,1,1)`)
    .run(JSON.stringify(["github", "example", "team"]));
  db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,
     manifest_json,execution_preview_json,warnings_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
    .run(release.packageReleaseId, release.authoritySourceId, release.contentSourceId, release.kind, release.name, release.version,
      release.digest, release.catalogCommit, release.packageCommit, release.packagePath, JSON.stringify(release.manifest),
      JSON.stringify(release.executionPreview), JSON.stringify(release.warnings));
  db.prepare(`INSERT INTO catalog_release_controls
    (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,1,1,1)`)
    .run(release.packageReleaseId, state, state === "PENDING" ? null : release.digest,
      state === "PENDING" ? null : "human-a", state === "PENDING" ? null : 1);
  if (options.installed !== false) db.prepare(`INSERT INTO catalog_installations
    (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
    VALUES (?,?,?,'INSTALLED','human-a',1,1,1)`)
    .run(release.packageReleaseId, options.artifactDigest ?? release.digest, "/private/catalog-artifacts/demo-skill");
  return release;
}

type ReleaseOptions = Parameters<typeof seedRelease>[1];

function fixture(options: { auditFailure?: boolean; release?: ReleaseOptions } = {}) {
  const opened = openCatalogFixture();
  const { db } = opened;
  db.exec(`
    INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
      VALUES ('human-selected','selected','fixture',0,0,1,1),
             ('human-future','future','fixture',0,0,1,1),
             ('human-other','other','fixture',0,0,1,1);
  `);
  const release = seedRelease(db, options.release);
  db.prepare(`INSERT INTO agent_template_origins
    (agent_id,release_id,mode,consumed_by_kind,consumed_by_human_id,authority_source_id,content_source_id,package_kind,
     package_name,package_version,catalog_commit,package_commit,package_path,package_digest,created_at)
    VALUES ('agent-a','release-skill','RLM_REPL','ADMIN','human-a','source-team','source-team','native-agent','demo-skill','1.0.0',?,?,?,?,1)`)
    .run(release.catalogCommit, release.packageCommit, release.packagePath, release.digest);
  const published: CatalogAuditEvent[] = [];
  let auditFailure = options.auditFailure ?? false;
  const authority = createCatalogAuthority({
    db,
    fetchSource: async () => { throw new Error("unused"); },
    inspectIndex: async () => { throw new Error("unused"); },
    inspectRelease: async () => { throw new Error("unused"); },
    writeAudit(tx, event) {
      if (auditFailure) throw new Error("private audit storage failure");
      expect(tx.inTransaction).toBe(true);
      tx.prepare(`INSERT INTO events
        (id,type,payload_json,source,channel_id,parent_event_id,deliver_at,status,fail_count,last_error,idempotency_key,created_at)
        VALUES (?,?,?,?,NULL,NULL,NULL,'DELIVERED',0,NULL,NULL,?)`)
        .run(`event-${crypto.randomUUID()}`, event.type, JSON.stringify(event.payload), event.source, Date.now());
    },
    publishAudit(event) {
      expect(db.inTransaction).toBe(false);
      published.push(event);
    },
  });
  const policy = createCatalogPolicy({
    canManageAgent(actor, agent) {
      return (actor.kind === "HUMAN_ADMIN" || actor.kind === "AUTHENTICATED_HUMAN") && agent.ownerHumanId === actor.id;
    },
    readRelease(releaseId) {
      const row = db.prepare<[string], { review_state: PackageReleaseView["reviewState"]; installation_state: PackageReleaseView["installationState"] | null; enabled: number; external_allowed: number }>(`SELECT c.review_state,i.state AS installation_state,
        auth.enabled, CASE WHEN r.authority_source_id=r.content_source_id THEN 1 ELSE content.enabled*content.allow_packages END AS external_allowed
        FROM catalog_package_releases r JOIN catalog_release_controls c ON c.package_release_id=r.package_release_id
        JOIN catalog_sources auth ON auth.source_id=r.authority_source_id
        JOIN catalog_sources content ON content.source_id=r.content_source_id
        LEFT JOIN catalog_installations i ON i.release_id=r.package_release_id AND i.artifact_digest=r.digest
        WHERE r.package_release_id=?`).get(releaseId);
      if (!row) return undefined;
      return {
        release: {
          packageReleaseId: release.packageReleaseId,
          reviewState: row.review_state,
          installationState: row.installation_state ?? "ABSENT",
          executionPreview: release.executionPreview,
          apiActivation: release.apiActivation,
        },
        sourceEnabled: row.enabled === 1,
        externalSourceAllowed: row.external_allowed === 1,
      };
    },
    readGrant(actor, releaseId) {
      if (actor.kind !== "AUTHENTICATED_HUMAN") return undefined;
      const row = db.prepare<[string, string], { grant_id: string; release_id: string; subject_type: "ORGANIZATION" | "HUMAN"; human_id: string | null; revision: number; revoked_at: number | null }>(`SELECT grant_id,release_id,subject_type,human_id,revision,revoked_at FROM catalog_grants
        WHERE release_id=? AND revoked_at IS NULL AND (subject_type='ORGANIZATION' OR (subject_type='HUMAN' AND human_id=?))
        ORDER BY CASE subject_type WHEN 'HUMAN' THEN 0 ELSE 1 END LIMIT 1`).get(releaseId, actor.id);
      return row ? {
        grantId: row.grant_id,
        releaseId: row.release_id,
        subject: row.subject_type === "ORGANIZATION" ? { kind: "ORGANIZATION" } : { kind: "HUMAN", humanId: row.human_id! },
        revision: row.revision,
        revokedAt: row.revoked_at,
      } : undefined;
    },
  });
  return { ...opened, authority, policy, db, release, published, setAuditFailure(value: boolean) { auditFailure = value; } };
}

const opened: Array<ReturnType<typeof fixture>> = [];
afterEach(() => {
  while (opened.length) opened.pop()!.close();
});
function grantFixture(options?: { auditFailure?: boolean; release?: ReleaseOptions }) {
  const value = fixture(options);
  opened.push(value);
  return value;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: "CatalogAuthorityError", code });
}

describe("CatalogAuthority grants", () => {
  it("uses one organization row for current and future humans and preserves existing local agents after revocation", async () => {
    const { authority, policy, db } = grantFixture();
    const created = await authority.execute({ kind: "grant.organization", releaseId: "release-skill", expectedRevision: 0 }, adminActor());
    expect(created).toMatchObject({ kind: "grant", grant: { releaseId: "release-skill", subject: { kind: "ORGANIZATION" }, revision: 1, revokedAt: null } });
    expect(db.prepare("SELECT count(*) AS count FROM catalog_grants").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT human_id FROM catalog_grants").get()).toEqual({ human_id: null });
    for (const id of ["human-selected", "human-future"]) {
      expect(policy.decide({ action: "LIBRARY_VIEW", actor: humanActor(id), release: approvedRelease() }), id).toEqual({ allow: true });
    }

    const grantId = created.kind === "grant" ? created.grant.grantId : "";
    const revoked = await authority.execute({ kind: "grant.revoke", grantId, expectedRevision: 1 }, adminActor());
    expect(revoked).toMatchObject({ kind: "grant", grant: { grantId, revision: 2, revokedAt: expect.any(Number) } });
    expect(policy.decide({ action: "TEMPLATE_INSTANTIATE", actor: humanActor("human-selected"), release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "GRANT_REQUIRED" });
    expect(db.prepare("SELECT count(*) AS count FROM agents WHERE id='agent-a'").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT count(*) AS count FROM agent_template_origins WHERE agent_id='agent-a'").get()).toEqual({ count: 1 });
  });

  it("grants only the selected existing human and rejects absent subjects", async () => {
    const { authority, policy } = grantFixture();
    await authority.execute({ kind: "grant.human", releaseId: "release-skill", humanId: "human-selected", expectedRevision: 0 }, adminActor());
    expect(policy.decide({ action: "LIBRARY_VIEW", actor: humanActor("human-selected"), release: approvedRelease() })).toEqual({ allow: true });
    expect(policy.decide({ action: "LIBRARY_VIEW", actor: humanActor("human-other"), release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "GRANT_REQUIRED" });
    await expectCode(authority.execute({ kind: "grant.human", releaseId: "release-skill", humanId: "human-missing", expectedRevision: 0 }, adminActor()), "NOT_FOUND");
  });

  it("replaces only its immutable tombstoned identity and enforces every revision", async () => {
    const { authority, db } = grantFixture();
    const first = await authority.execute({ kind: "grant.human", releaseId: "release-skill", humanId: "human-selected", expectedRevision: 0 }, adminActor());
    const grantId = first.kind === "grant" ? first.grant.grantId : "";
    await expectCode(authority.execute({ kind: "grant.human", releaseId: "release-skill", humanId: "human-selected", expectedRevision: 0 }, adminActor()), "REVISION_CONFLICT");
    await authority.execute({ kind: "grant.revoke", grantId, expectedRevision: 1 }, adminActor());
    await expectCode(authority.execute({ kind: "grant.revoke", grantId, expectedRevision: 1 }, adminActor()), "REVISION_CONFLICT");
    const replacement = await authority.execute({ kind: "grant.human", releaseId: "release-skill", humanId: "human-selected", expectedRevision: 2 }, adminActor());
    expect(replacement).toMatchObject({ kind: "grant", grant: { grantId, revision: 3, revokedAt: null } });
    expect(db.prepare("SELECT count(*) AS count FROM catalog_grants WHERE release_id='release-skill'").get()).toEqual({ count: 1 });
    await expectCode(authority.execute({ kind: "grant.human", releaseId: "release-skill", humanId: "human-selected", expectedRevision: 2 }, adminActor()), "REVISION_CONFLICT");
  });

  it.each([
    ["review withdrawal", (db: ReturnType<typeof openCatalogFixture>["db"]) => db.prepare("UPDATE catalog_release_controls SET review_state='WITHDRAWN' WHERE package_release_id='release-skill'").run()],
    ["review rejection", (db: ReturnType<typeof openCatalogFixture>["db"]) => db.prepare("UPDATE catalog_release_controls SET review_state='REJECTED' WHERE package_release_id='release-skill'").run()],
    ["Source disable", (db: ReturnType<typeof openCatalogFixture>["db"]) => db.prepare("UPDATE catalog_sources SET enabled=0 WHERE source_id='source-team'").run()],
    ["Source removal", (db: ReturnType<typeof openCatalogFixture>["db"]) => db.prepare("UPDATE catalog_sources SET enabled=0,removed_at=2 WHERE source_id='source-team'").run()],
    ["installation removal", (db: ReturnType<typeof openCatalogFixture>["db"]) => db.prepare("DELETE FROM catalog_installations WHERE release_id='release-skill'").run()],
    ["installation quarantine", (db: ReturnType<typeof openCatalogFixture>["db"]) => db.prepare("UPDATE catalog_installations SET state='QUARANTINED' WHERE release_id='release-skill'").run()],
    ["installation digest drift", (db: ReturnType<typeof openCatalogFixture>["db"]) => db.prepare("UPDATE catalog_installations SET artifact_digest=? WHERE release_id='release-skill'").run(`sha256:${"b".repeat(64)}`)],
  ] as const)("revokes an existing canonical grant after %s without touching local state", async (_name, degrade) => {
    const { authority, db, published } = grantFixture();
    const created = await authority.execute({ kind: "grant.organization", releaseId: "release-skill", expectedRevision: 0 }, adminActor());
    const grantId = created.kind === "grant" ? created.grant.grantId : "";
    degrade(db);

    const revoked = await authority.execute({ kind: "grant.revoke", grantId, expectedRevision: 1 }, adminActor());

    expect(revoked).toMatchObject({ kind: "grant", grant: { grantId, releaseId: "release-skill", subject: { kind: "ORGANIZATION" }, revision: 2, revokedAt: expect.any(Number) } });
    expect(published).toHaveLength(2);
    expect(published[1]).toMatchObject({ type: "audit.catalog.grant.changed", channelId: null, payload: { action: "grant.revoke", revision: 2, releaseId: "release-skill", operationId: grantId } });
    expect(db.prepare("SELECT count(*) AS count FROM agents WHERE id='agent-a'").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT count(*) AS count FROM agent_template_origins WHERE agent_id='agent-a'").get()).toEqual({ count: 1 });
  });

  it("rolls back degraded-release revocation when its audit write fails", async () => {
    const value = grantFixture();
    const created = await value.authority.execute({ kind: "grant.organization", releaseId: "release-skill", expectedRevision: 0 }, adminActor());
    const grantId = created.kind === "grant" ? created.grant.grantId : "";
    value.db.prepare("UPDATE catalog_release_controls SET review_state='WITHDRAWN' WHERE package_release_id='release-skill'").run();
    value.setAuditFailure(true);

    await expectCode(value.authority.execute({ kind: "grant.revoke", grantId, expectedRevision: 1 }, adminActor()), "STORAGE_FAILURE");

    expect(value.db.prepare("SELECT revision,revoked_at FROM catalog_grants WHERE grant_id=?").get(grantId)).toEqual({ revision: 1, revoked_at: null });
    expect(value.published).toHaveLength(1);
    expect(value.db.prepare("SELECT count(*) AS count FROM agents WHERE id='agent-a'").get()).toEqual({ count: 1 });
    expect(value.db.prepare("SELECT count(*) AS count FROM agent_template_origins WHERE agent_id='agent-a'").get()).toEqual({ count: 1 });
  });

  it("freshly rechecks administrator authority when revoking a degraded grant", async () => {
    const { authority, db } = grantFixture();
    const created = await authority.execute({ kind: "grant.organization", releaseId: "release-skill", expectedRevision: 0 }, adminActor());
    const grantId = created.kind === "grant" ? created.grant.grantId : "";
    db.prepare("UPDATE catalog_release_controls SET review_state='WITHDRAWN' WHERE package_release_id='release-skill'").run();
    db.prepare("UPDATE humans SET is_admin=0 WHERE id='human-a'").run();
    await expectCode(authority.execute({ kind: "grant.revoke", grantId, expectedRevision: 1 }, adminActor()), "FORBIDDEN");
    expect(db.prepare("SELECT revision,revoked_at FROM catalog_grants WHERE grant_id=?").get(grantId)).toEqual({ revision: 1, revoked_at: null });
  });

  it("fails closed when a reserved grant ID is bound to another subject", async () => {
    const { authority, db } = grantFixture();
    const reservedId = catalogGrantId("release-skill", "ORGANIZATION");
    db.prepare(`INSERT INTO catalog_grants
      (grant_id,release_id,subject_type,human_id,revision,revoked_at,created_by_human_id,created_at,updated_at)
      VALUES (?,'release-skill','HUMAN','human-selected',1,1,'human-a',1,1)`).run(reservedId);
    await expectCode(authority.execute({ kind: "grant.revoke", grantId: reservedId, expectedRevision: 1 }, adminActor()), "IDENTITY_CONFLICT");
    await expectCode(authority.execute({ kind: "grant.organization", releaseId: "release-skill", expectedRevision: 1 }, adminActor()), "IDENTITY_CONFLICT");
  });

  it.each([false, true])("rejects an exact live subject tuple stored under a noncanonical grant ID (revoked=%s)", async revoked => {
    const { authority, policy, db } = grantFixture();
    db.prepare(`INSERT INTO catalog_grants
      (grant_id,release_id,subject_type,human_id,revision,revoked_at,created_by_human_id,created_at,updated_at)
      VALUES ('grant-noncanonical','release-skill','ORGANIZATION',NULL,1,?,'human-a',1,1)`).run(revoked ? 1 : null);

    await expectCode(authority.execute({ kind: "grant.organization", releaseId: "release-skill", expectedRevision: revoked ? 1 : 0 }, adminActor()), "IDENTITY_CONFLICT");
    await expectCode(authority.query({ kind: "release.grants", packageReleaseId: "release-skill" }, adminActor()), "IDENTITY_CONFLICT");
    expect(() => policy.decide({ action: "LIBRARY_VIEW", actor: humanActor("human-future"), release: approvedRelease() })).not.toThrow();
    expect(policy.decide({ action: "LIBRARY_VIEW", actor: humanActor("human-future"), release: approvedRelease() }))
      .toEqual({ allow: false, reasonCode: "GRANT_REQUIRED" });
    expect(db.prepare("SELECT count(*) AS count FROM catalog_grants").get()).toEqual({ count: 1 });
  });

  it.each([
    ["PENDING", true, undefined, "RELEASE_NOT_APPROVED"],
    ["REJECTED", true, undefined, "RELEASE_NOT_APPROVED"],
    ["WITHDRAWN", true, undefined, "RELEASE_NOT_APPROVED"],
    ["APPROVED", false, undefined, "INSTALLATION_REQUIRED"],
    ["APPROVED", true, `sha256:${"b".repeat(64)}`, "INSTALLATION_REQUIRED"],
  ] as const)("rejects grant creation for %s installed=%s without exact installed release identity", async (state, installed, artifactDigest, code) => {
    const { authority } = grantFixture({ release: { state, installed, artifactDigest } });
    await expectCode(authority.execute({ kind: "grant.organization", releaseId: "release-skill", expectedRevision: 0 }, adminActor()), code);
  });

  it("requires a fresh live administrator and canonical exact identifiers", async () => {
    const { authority, db } = grantFixture();
    db.prepare("UPDATE humans SET is_admin=0 WHERE id='human-a'").run();
    await expectCode(authority.execute({ kind: "grant.organization", releaseId: "release-skill", expectedRevision: 0 }, adminActor()), "FORBIDDEN");
    db.prepare("UPDATE humans SET is_admin=1 WHERE id='human-a'").run();
    for (const command of [
      { kind: "grant.organization", releaseId: "INVALID!", expectedRevision: 0 },
      { kind: "grant.organization", releaseId: "release-skill", expectedRevision: -1 },
      { kind: "grant.human", releaseId: "release-skill", humanId: "", expectedRevision: 0 },
      { kind: "grant.revoke", grantId: "", expectedRevision: 1 },
    ] as const) await expectCode(authority.execute(command, adminActor()), "INVALID_REQUEST");
  });

  it("commits grant mutation and redacted channel-less audit atomically then publishes after commit", async () => {
    const success = grantFixture();
    const result = await success.authority.execute({ kind: "grant.organization", releaseId: "release-skill", expectedRevision: 0 }, adminActor());
    const grantId = result.kind === "grant" ? result.grant.grantId : "";
    expect(success.published).toHaveLength(1);
    expect(success.published[0]).toEqual({
      type: "audit.catalog.grant.changed", source: "system", status: "DELIVERED", channelId: null,
      payload: {
        actorKind: "HUMAN_ADMIN", actorId: "human-a", action: "grant.organization", outcome: "SUCCEEDED",
        revision: 1, releaseId: "release-skill", operationId: grantId, digest: approvedRelease().digest,
      },
    });
    const serialized = JSON.stringify(success.published[0]);
    expect(serialized).not.toMatch(/artifact|path|credential|secret|repository|human-selected/i);

    const failed = grantFixture({ auditFailure: true });
    await expectCode(failed.authority.execute({ kind: "grant.organization", releaseId: "release-skill", expectedRevision: 0 }, adminActor()), "STORAGE_FAILURE");
    expect(failed.db.prepare("SELECT count(*) AS count FROM catalog_grants").get()).toEqual({ count: 0 });
    expect(failed.published).toEqual([]);
  });

  it("lists only bounded grant metadata and keeps identity tombstones queryable", async () => {
    const { authority } = grantFixture();
    const result = await authority.execute({ kind: "grant.human", releaseId: "release-skill", humanId: "human-selected", expectedRevision: 0 }, adminActor());
    const grantId = result.kind === "grant" ? result.grant.grantId : "";
    await authority.execute({ kind: "grant.revoke", grantId, expectedRevision: 1 }, adminActor());
    const listed = await authority.query({ kind: "release.grants", packageReleaseId: "release-skill" }, adminActor());
    expect(listed).toEqual([{ grantId, releaseId: "release-skill", subject: { kind: "HUMAN", humanId: "human-selected" }, revision: 2, revokedAt: expect.any(Number) }]);
    expect(JSON.stringify(listed)).not.toMatch(/artifact|path|credential|secret|digest|createdBy/i);
    await expect(authority.query({ kind: "release.grants", packageReleaseId: "release-skill" }, humanActor("human-selected")))
      .rejects.toBeInstanceOf(CatalogAuthorityError);
  });
});
