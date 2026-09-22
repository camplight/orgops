import { describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDrizzleDb, migrate, openDb, schema } from "./index";

const migrationId = "032_catalog_source_configuration.sql";
const url = "https://git.example.invalid/team/catalog.git";
const identity = JSON.stringify([url,null]);

function migrateLegacyCatalogFixture(db: ReturnType<typeof openDb>) {
  const dir = mkdtempSync(join(tmpdir(),"catalog-migrations-032-"));
  try {
    const migrations = fileURLToPath(new URL("../migrations/",import.meta.url));
    for (const file of readdirSync(migrations).filter(f => f.endsWith(".sql") && f < "033_")) {
      copyFileSync(join(migrations,file),join(dir,file));
    }
    migrate(db,dir);
  } finally { rmSync(dir,{recursive:true,force:true}); }
}

describe("historical catalog configuration persistence", () => {
  it("upgrades populated prior schema once without moving humans or secrets", () => {
    const db = openDb(":memory:");
    const dir = mkdtempSync(join(tmpdir(),"catalog-migrations-"));
    try {
      const migrations = fileURLToPath(new URL("../migrations/",import.meta.url));
      for (const file of readdirSync(migrations).filter(f => f.endsWith(".sql") && f < migrationId)) copyFileSync(join(migrations,file),join(dir,file));
      migrate(db,dir);
      db.prepare("INSERT INTO humans (id,username,password_hash,created_at,updated_at) VALUES ('human-owner','synthetic','synthetic-hash',1,1)").run();
      db.prepare("INSERT INTO secrets (id,name,scope_type,ciphertext_b64,created_at) VALUES ('existing','synthetic','GLOBAL','synthetic-ciphertext',1)").run();
      const humans = db.prepare("SELECT * FROM humans").all();
      const secrets = db.prepare("SELECT * FROM secrets").all();
      migrate(db); migrate(db);
      expect(db.prepare("SELECT count(*) AS count FROM migrations WHERE id=?").get(migrationId)).toEqual({count:1});
      expect(db.prepare("SELECT * FROM humans").all()).toEqual(humans);
      expect(db.prepare("SELECT * FROM secrets").all()).toEqual(secrets);
      const orm = createDrizzleDb(db);
      expect(orm.select().from(schema.catalogSources).all()).toEqual([]);
      expect(orm.select().from(schema.catalogs).all()).toEqual([]);
      expect(orm.select().from(schema.catalogReadCredentials).all()).toEqual([]);
    } finally { db.close(); rmSync(dir,{recursive:true,force:true}); }
  });
  it("reserves tombstoned identity and enforces source policy and revision constraints", () => {
    const db = openDb(":memory:");
    try {
      migrateLegacyCatalogFixture(db);
      const insert = db.prepare(`INSERT INTO catalog_sources (source_id,canonical_url,repository_identity,enabled,allow_packages,revision,created_at,updated_at) VALUES (?,?,?,1,0,1,1,1)`);
      insert.run("team-source",url,identity);
      expect(() => insert.run("alias-source",url,identity)).toThrow();
      for (const update of ["enabled=2", "allow_packages=2", "revision=0", "revision=2147483648", "removed_at=2"]) expect(() => db.prepare(`UPDATE catalog_sources SET ${update}`).run()).toThrow();
      db.prepare("UPDATE catalog_sources SET enabled=0, removed_at=2").run();
      expect(() => db.prepare("UPDATE catalog_sources SET allow_packages=1").run()).toThrow();
      expect(() => insert.run("alias-source",url,identity)).toThrow();
      expect(db.prepare("SELECT * FROM catalog_sources").all()).toEqual([{source_id:"team-source",canonical_url:url,ssh_user:null,repository_identity:identity,enabled:0,allow_packages:0,revision:1,removed_at:2,created_at:1,updated_at:1}]);
      expect(db.prepare("SELECT count(*) AS count FROM secrets").get()).toEqual({count:0});
    } finally { db.close(); }
  });
  it("enforces child foreign keys, catalog checks and private credential uniqueness", () => {
    const db = openDb(":memory:");
    try {
      migrateLegacyCatalogFixture(db);
      const catalog = db.prepare("INSERT INTO catalogs (catalog_id,source_id,display_name,ref,enabled,revision,created_at,updated_at) VALUES (?,?,'Team catalog','main',1,1,1,1)");
      const credential = db.prepare("INSERT INTO catalog_read_credentials (source_id,credential_ref,kind,ciphertext_b64,created_at,updated_at) VALUES (?,? ,?,'synthetic-ciphertext',1,1)");
      expect(() => catalog.run("team-catalog","absent")).toThrow();
      expect(() => credential.run("absent","ref","https-basic")).toThrow();
      const source = db.prepare("INSERT INTO catalog_sources (source_id,canonical_url,repository_identity,enabled,allow_packages,revision,created_at,updated_at) VALUES (?,?,?,1,0,1,1,1)");
      source.run("team-source",url,identity);
      source.run("other-source","https://forge.example.invalid/org/packages.git","other-identity");
      catalog.run("team-catalog","team-source");
      expect(() => catalog.run("team-catalog","other-source")).toThrow();
      for (const update of ["enabled=2", "revision=0", "revision=2147483648", "removed_at=2"]) expect(() => db.prepare(`UPDATE catalogs SET ${update}`).run()).toThrow();
      db.prepare("UPDATE catalogs SET enabled=0,removed_at=2,revision=2147483647").run();
      expect(() => credential.run("team-source","ref","ssh")).toThrow();
      credential.run("team-source","ref","https-basic");
      expect(() => credential.run("other-source","ref","https-basic")).toThrow();
      expect(() => credential.run("team-source","other-ref","https-basic")).toThrow();
      expect(() => db.prepare("DELETE FROM catalog_sources WHERE source_id='team-source'").run()).toThrow();
      expect(db.prepare("SELECT * FROM catalog_read_credentials").all()).toEqual([{source_id:"team-source",credential_ref:"ref",kind:"https-basic",ciphertext_b64:"synthetic-ciphertext",created_at:1,updated_at:1}]);
      expect(db.prepare("SELECT * FROM catalogs").all()).toEqual([{catalog_id:"team-catalog",source_id:"team-source",display_name:"Team catalog",ref:"main",enabled:0,revision:2147483647,removed_at:2,created_at:1,updated_at:1}]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_catalogs_source_id'").get()).toEqual({name:"idx_catalogs_source_id"});
    } finally { db.close(); }
  });
});
