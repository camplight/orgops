import { afterEach, describe, expect, it } from "vitest";
import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb, migrate, type OrgOpsDb } from "@orgops/db";
import { canonicalManifestBytes, type LocalSkillEvidence, type LocalSkillEvidenceResult } from "@orgops/skills";
import { skillEntries, skillManifest } from "@orgops/skills/src/catalogs/fixtures";
import { createLegacyOriginReconciliation } from "./reconciliation";

const admin = { kind: "HUMAN_ADMIN" as const, id: "admin" };
let db: OrgOpsDb | undefined;
const tempRoots: string[] = [];

type Fixture = {
  reconcile: ReturnType<typeof createLegacyOriginReconciliation>["reconcileLegacyOrigin"];
  evidence: LocalSkillEvidence;
  auditEvents: unknown[];
};

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "catalog-reconcile-fixture-")); tempRoots.push(root);
  const localPath = join(root, "echo-skill", skillManifest.digest.slice("sha256:".length));
  mkdirSync(localPath, { recursive: true, mode: 0o700 });
  const installedManifest = canonicalManifestBytes(skillManifest);
  writeFileSync(join(localPath, "orgops-package.json"), installedManifest, { mode: 0o644 });
  for (const entry of skillEntries) if (entry.type === "file") writeFileSync(join(localPath, entry.path), Buffer.from(entry.base64, "base64"), { mode: entry.executable ? 0o755 : 0o644 });
  db = openDb(":memory:");
  migrate(db);
  db.exec(`
    INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
      VALUES ('admin','admin','fixture',0,1,1,1);
    INSERT INTO catalog_sources
      (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
      VALUES ('legacy-origin','Team','https://github.com/example/team','team','main',0,0,1,1,1);
    INSERT INTO catalog_sources_legacy_032
      (source_id,canonical_url,repository_identity,enabled,allow_packages,revision,created_at,updated_at)
      VALUES ('old-source','https://github.com/example/team','team',0,0,1,1,1);
    INSERT INTO catalogs_legacy_032
      (catalog_id,source_id,display_name,ref,enabled,revision,created_at,updated_at)
      VALUES ('old-catalog','old-source','Team','main',0,1,1,1);
  `);
  db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
      "release-echo", "legacy-origin", "legacy-origin", "skill", "echo-skill", "1.0.0", skillManifest.digest,
      "a".repeat(40), "b".repeat(40), "skills/echo-skill", JSON.stringify(skillManifest), "[]", "[]",
    );
  db.prepare(`INSERT INTO catalog_release_controls
    (package_release_id,review_state,review_digest,revision,created_at,updated_at)
    VALUES ('release-echo','PENDING',NULL,1,1,1)`).run();
  db.prepare(`INSERT INTO catalog_installations
    (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
    VALUES (?,?,?,'INSTALLED','admin',12,12,1)`).run("release-echo", skillManifest.digest, localPath);
  db.prepare(`INSERT INTO catalog_installed_origins
    (name,catalog_id,source_id,catalog_commit,package_commit,path,kind,version,digest,local_path,installed_by_human_id,installed_at)
    VALUES (?,?,?,?,?,?,'skill','1.0.0',?,?, 'admin',12)`).run(
      "echo-skill", "old-catalog", "old-source", "a".repeat(40), "b".repeat(40), "skills/echo-skill", skillManifest.digest, localPath,
    );
  const entries = [
    { type: "file" as const, path: "orgops-package.json", base64: installedManifest.toString("base64"), executable: false },
    ...skillEntries.map(entry => entry.type === "file"
      ? { type: "file" as const, path: entry.path, base64: entry.base64, executable: entry.executable }
      : { type: "blocked" as const, path: entry.path }),
  ];
  const evidence: LocalSkillEvidence = {
    nominatedNames: [skillManifest.digest.slice("sha256:".length)],
    namespace: { complete: true, entries: [{ name: skillManifest.digest.slice("sha256:".length), type: "directory" }] },
    subtrees: [{ name: skillManifest.digest.slice("sha256:".length), complete: true, entries }],
  };
  const auditEvents: unknown[] = [];
  const service = createLegacyOriginReconciliation({
    db,
    readLocalSkillEvidence: async (): Promise<LocalSkillEvidenceResult<LocalSkillEvidence>> => ({ ok: true, value: evidence }),
    writeAudit: (_tx, event) => { auditEvents.push(event); },
  });
  return { reconcile: service.reconcileLegacyOrigin, evidence, auditEvents };
}

afterEach(async () => {
  db?.close();
  while (tempRoots.length) await rm(tempRoots.pop()!, { recursive: true, force: true });
});

describe("exact migration-033 origin reconciliation", () => {
  it("reconciles an unchanged origin, is idempotent, and rejects changed bytes", async () => {
    const f = fixture();
    expect(await f.reconcile("echo-skill", admin)).toEqual({ status: "RECONCILED" });
    expect(f.auditEvents).toHaveLength(1);
    expect(await f.reconcile("echo-skill", admin)).toEqual({ status: "RECONCILED" });
    expect(f.auditEvents).toHaveLength(1);
    (f.evidence.subtrees[0]!.entries[1] as { base64: string }).base64 = Buffer.from("changed").toString("base64");
    expect(await f.reconcile("echo-skill", admin)).toEqual({ status: "REJECTED", code: "IDENTITY_CONFLICT" });
  });

  it("rejects malformed actors and an administrator demotion during evidence", async () => {
    const f = fixture();
    expect(await f.reconcile("echo-skill", { kind: "RUNNER", runnerId: "runner" } as never)).toEqual({ status: "REJECTED", code: "IDENTITY_CONFLICT" });
    const raced = createLegacyOriginReconciliation({
      db: db!,
      readLocalSkillEvidence: async () => ({ ok: true, value: f.evidence }),
      writeAudit: () => { throw new Error("audit marker"); },
      beforeFinalTransaction: async () => { db!.prepare("UPDATE humans SET is_admin=0 WHERE id='admin'").run(); },
    });
    expect(await raced.reconcileLegacyOrigin("echo-skill", admin)).toEqual({ status: "REJECTED", code: "IDENTITY_CONFLICT" });
  });

  it.each([
    ["actor", "UPDATE catalog_installed_origins SET installed_by_human_id='other' WHERE name='echo-skill'"],
    ["time", "UPDATE catalog_installations SET installed_at=13 WHERE release_id='release-echo'"],
  ])("rejects canonical installation %s mismatch without writing provenance", async (_field, mutation) => {
    const f = fixture();
    if (_field === "actor") db!.prepare("INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('other','other','fixture',0,1,1,1)").run();
    db!.prepare(mutation).run();
    expect(await f.reconcile("echo-skill", admin)).toEqual({ status: "REJECTED", code: "IDENTITY_CONFLICT" });
    expect(f.auditEvents).toHaveLength(0);
  });

  it("rejects null-origin actor when the canonical installation actor is non-null", async () => {
    const f = fixture();
    db!.prepare("UPDATE catalog_installed_origins SET installed_by_human_id=NULL WHERE name='echo-skill'").run();
    expect(await f.reconcile("echo-skill", admin)).toEqual({ status: "REJECTED", code: "IDENTITY_CONFLICT" });
    expect(f.auditEvents).toHaveLength(0);
  });

  it.each([
    ["malformed", async () => ({ ok: true, value: { bad: true } })],
    ["throw", async () => { throw new Error("adapter failure"); }],
  ])("rejects evidence adapter %s", async (_label, adapter) => {
    const f = fixture();
    const service = createLegacyOriginReconciliation({ db: db!, readLocalSkillEvidence: adapter as never, writeAudit: () => f.auditEvents.push("unexpected") });
    expect(await service.reconcileLegacyOrigin("echo-skill", admin)).toEqual({ status: "REJECTED", code: "IDENTITY_CONFLICT" });
    expect(f.auditEvents).toHaveLength(0);
  });

  it("rejects actor and time mutation after evidence before the final transaction", async () => {
    const f = fixture();
    const raced = createLegacyOriginReconciliation({
      db: db!,
      readLocalSkillEvidence: async () => ({ ok: true, value: f.evidence }),
      writeAudit: () => { f.auditEvents.push("unexpected"); },
      beforeFinalTransaction: async () => {
        db!.prepare("UPDATE catalog_installations SET installed_by_human_id='other', installed_at=13 WHERE release_id='release-echo'").run();
      },
    });
    expect(await raced.reconcileLegacyOrigin("echo-skill", admin)).toEqual({ status: "REJECTED", code: "IDENTITY_CONFLICT" });
    expect(f.auditEvents).toHaveLength(0);
  });

  it("reconciles an external content source only when its exact identity matches", async () => {
    const f = fixture();
    db!.prepare(`INSERT INTO catalog_sources
      (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
      VALUES ('external-source','External','https://github.com/example/external','external','main',0,0,1,1,1)`).run();
    db!.prepare("UPDATE catalog_installed_origins SET source_id='external-source' WHERE name='echo-skill'").run();
    db!.prepare("UPDATE catalog_package_releases SET content_source_id='external-source' WHERE package_release_id='release-echo'").run();
    const service = createLegacyOriginReconciliation({ db: db!, writeAudit: () => undefined });
    expect(await service.reconcileLegacyOrigin("echo-skill", admin)).toEqual({ status: "RECONCILED" });
    db!.prepare("UPDATE catalog_package_releases SET content_source_id='legacy-origin' WHERE package_release_id='release-echo'").run();
    expect(await service.reconcileLegacyOrigin("echo-skill", admin)).toEqual({ status: "REJECTED", code: "IDENTITY_CONFLICT" });
  });

  function productionManifestBytes(): Buffer {
    return canonicalManifestBytes(skillManifest);
  }

  async function writeManifestEvidence(f: Fixture, bytes: Buffer): Promise<void> {
    const manifest = f.evidence.subtrees[0]!.entries.find(entry => entry.type === "file" && entry.path === "orgops-package.json");
    expect(manifest?.type).toBe("file");
    if (!manifest || manifest.type !== "file") throw new Error("Evidence omitted package manifest");
    manifest.base64 = bytes.toString("base64");
    const localPath = (db!.prepare<[string], { local_path: string}>("SELECT local_path FROM catalog_installed_origins WHERE name=?").get("echo-skill"))!.local_path;
    await writeFile(join(localPath, "orgops-package.json"), bytes);
  }

  it("accepts canonical manifest bytes emitted by the production installer formatter", async () => {
    const f = fixture();
    await writeManifestEvidence(f, productionManifestBytes());
    const service = createLegacyOriginReconciliation({ db: db!, writeAudit: () => undefined });
    expect(await service.reconcileLegacyOrigin("echo-skill", admin)).toEqual({ status: "RECONCILED" });
  });

  it.each(["compact", "alternate-pretty"] as const)("rejects non-canonical installed manifest bytes: %s", async variant => {
    const f = fixture();
    const canonicalBytes = productionManifestBytes();
    const bytes = variant === "compact"
      ? Buffer.from(JSON.stringify(skillManifest), "utf8")
      : Buffer.from(JSON.stringify(JSON.parse(canonicalBytes.toString("utf8")), null, 4) + "\r\n", "utf8");
    await writeManifestEvidence(f, bytes);
    const service = createLegacyOriginReconciliation({ db: db!, writeAudit: () => undefined });
    expect(await service.reconcileLegacyOrigin("echo-skill", admin)).toEqual({ status: "REJECTED", code: "IDENTITY_CONFLICT" });
  });

  it("accepts the actual installed artifact layout measured by the canonical collector", async () => {
    const f = fixture();
    const root = await mkdtemp(join(tmpdir(), "catalog-reconcile-")); tempRoots.push(root);
    const digestDirectory = skillManifest.digest.slice("sha256:".length);
    const artifact = join(root, "echo-skill", digestDirectory);
    await mkdir(artifact, { recursive: true, mode: 0o700 });
    await writeFile(join(artifact, "orgops-package.json"), productionManifestBytes(), { mode: 0o644 });
    for (const entry of skillEntries) {
      if (entry.type === "file") await writeFile(join(artifact, entry.path), Buffer.from(entry.base64, "base64"), { mode: entry.executable ? 0o755 : 0o644 });
    }
    const canonical = productionManifestBytes();
    const manifest = f.evidence.subtrees[0]!.entries.find(entry => entry.type === "file" && entry.path === "orgops-package.json");
    if (!manifest || manifest.type !== "file") throw new Error("Evidence omitted package manifest");
    manifest.base64 = canonical.toString("base64");
    db!.prepare("UPDATE catalog_installations SET artifact_path=? WHERE release_id='release-echo'").run(artifact);
    db!.prepare("UPDATE catalog_installed_origins SET local_path=? WHERE name='echo-skill'").run(artifact);
    const service = createLegacyOriginReconciliation({ db: db!, writeAudit: () => undefined });
    expect(await service.reconcileLegacyOrigin("echo-skill", admin)).toEqual({ status: "RECONCILED" });
  });

  it.each(["changed-bytes", "symlink", "hardlink", "extra", "missing", "file-mode", "directory-mode", "manifest-mode"])("rejects canonical filesystem drift: %s", async drift => {
    const f = fixture();
    const root = await mkdtemp(join(tmpdir(), "catalog-reconcile-")); tempRoots.push(root);
    const digestDirectory = skillManifest.digest.slice("sha256:".length);
    const artifact = join(root, "echo-skill", digestDirectory);
    await mkdir(artifact, { recursive: true, mode: 0o700 });
    await writeFile(join(artifact, "orgops-package.json"), productionManifestBytes(), { mode: 0o644 });
    for (const entry of skillEntries) {
      if (entry.type === "file") await writeFile(join(artifact, entry.path), Buffer.from(entry.base64, "base64"), { mode: entry.executable ? 0o755 : 0o644 });
    }
    if (drift === "changed-bytes") await writeFile(join(artifact, "SKILL.md"), "changed");
    if (drift === "symlink") { await rm(join(artifact, "SKILL.md")); await symlink("event-shapes.ts", join(artifact, "SKILL.md")); }
    if (drift === "hardlink") { await rm(join(artifact, "SKILL.md")); await link(join(artifact, "event-shapes.ts"), join(artifact, "SKILL.md")); }
    if (drift === "extra") await writeFile(join(artifact, "extra.txt"), "extra");
    if (drift === "missing") await rm(join(artifact, "SKILL.md"));
    if (drift === "file-mode") await chmod(join(artifact, "SKILL.md"), 0o755);
    if (drift === "directory-mode") await chmod(artifact, 0o755);
    if (drift === "manifest-mode") await chmod(join(artifact, "orgops-package.json"), 0o755);
    db!.prepare("UPDATE catalog_installations SET artifact_path=? WHERE release_id='release-echo'").run(artifact);
    db!.prepare("UPDATE catalog_installed_origins SET local_path=? WHERE name='echo-skill'").run(artifact);
    const service = createLegacyOriginReconciliation({ db: db!, writeAudit: () => undefined });
    expect(await service.reconcileLegacyOrigin("echo-skill", admin)).toEqual({ status: "REJECTED", code: "IDENTITY_CONFLICT" });
  });

  it.each(["relative", "traversal", "drift"])("rejects origin local_path %s", async kind => {
    const f = fixture();
    const value = kind === "relative" ? "relative/path" : kind === "traversal" ? "/tmp/orgops-reconcile/../escape" : "/tmp/orgops-reconcile/other/digest";
    db!.prepare("UPDATE catalog_installed_origins SET local_path=? WHERE name='echo-skill'").run(value);
    const service = createLegacyOriginReconciliation({ db: db!, writeAudit: () => undefined });
    expect(await service.reconcileLegacyOrigin("echo-skill", admin)).toEqual({ status: "REJECTED", code: "IDENTITY_CONFLICT" });
  });

  it("rolls back canonical identity and audit together", async () => {
    const f = fixture();
    const before = db!.prepare("SELECT catalog_id,source_id,path FROM catalog_installed_origins WHERE name='echo-skill'").get();
    const failingAudit = createLegacyOriginReconciliation({
      db: db!,
      readLocalSkillEvidence: async () => ({ ok: true, value: f.evidence }),
      writeAudit: () => { throw new Error("storage marker"); },
    });
    expect(await failingAudit.reconcileLegacyOrigin("echo-skill", admin)).toEqual({ status: "REJECTED", code: "IDENTITY_CONFLICT" });
    expect(db!.prepare("SELECT catalog_id,source_id,path FROM catalog_installed_origins WHERE name='echo-skill'").get()).toEqual(before);
  });
});
