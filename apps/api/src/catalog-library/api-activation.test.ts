import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { validateEventAgainstShapes, type CatalogAuditEvent, type EventShapeDefinition } from "@orgops/schemas";
import { adminActor, openCatalogFixture } from "./test-fixtures";
import {
  ApiExecutionError,
  createApiExecutionCoordinator,
  createAtomicEventShapeRegistry,
  loadCapturedEventShapeModule,
  validateEventShapeRegistry,
  verifyInstalledApiRelease,
  type ApiActivationRelease,
} from "./activation";

const digest = `sha256:${"a".repeat(64)}`;
const moduleShape: EventShapeDefinition = {
  type: "catalog-authored-event",
  description: "Catalog-authored fixture event.",
  payloadSchema: z.object({ value: z.string() }).strict(),
};
const coreShape: EventShapeDefinition = {
  type: "core-event",
  description: "Core fixture event.",
  source: "core",
  payloadSchema: z.object({}).passthrough(),
};

function seedRelease(db: ReturnType<typeof openCatalogFixture>["db"], apiEventShapes = ["event-shapes.ts"]) {
  const manifest = {
    formatVersion: 1, kind: "skill", name: "demo-skill", version: "1.0.0", description: "fixture", author: "OrgOps", license: "MIT",
    compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [], dependencies: [],
    files: apiEventShapes.map(path => ({ path, size: 1, digest: `sha256:${"b".repeat(64)}`, executable: false })),
    executables: apiEventShapes.map(path => ({ path, execution: "api-event-shapes" })), digest, skill: { entrypoint: "SKILL.md" },
  };
  db.prepare(`INSERT INTO catalog_sources
    (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
    VALUES ('source-team','Team','https://example.invalid/team','team','main',1,0,1,1,1)`).run();
  db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,
     manifest_json,execution_preview_json,warnings_json,created_at)
    VALUES ('release-skill','source-team','source-team','skill','demo-skill','1.0.0',?,'aaaaaaaa','aaaaaaaa','skills/demo-skill',?,?, '[]',1)`)
    .run(digest, JSON.stringify(manifest), JSON.stringify({ apiEventShapes, runnerScripts: [], wrappedCommands: [], externalSources: [] }));
  db.prepare(`INSERT INTO catalog_release_controls
    (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
    VALUES ('release-skill','APPROVED',?,'human-a',1,1,1,1)`).run(digest);
  db.prepare(`INSERT INTO catalog_installations
    (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
    VALUES ('release-skill',?,'/catalog/demo-skill/digest','INSTALLED','human-a',1,1,1)`).run(digest);
}

function seedSecondActiveRelease(db: ReturnType<typeof openCatalogFixture>["db"]) {
  const secondDigest = `sha256:${"c".repeat(64)}`;
  const original = db.prepare("SELECT manifest_json,execution_preview_json FROM catalog_package_releases WHERE package_release_id='release-skill'").get() as { manifest_json: string; execution_preview_json: string };
  const manifest = JSON.parse(original.manifest_json);
  manifest.name = "healthy-skill"; manifest.digest = secondDigest;
  db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,manifest_json,execution_preview_json,warnings_json,created_at)
    VALUES ('release-healthy','source-team','source-team','skill','healthy-skill','1.0.0',?,'bbbbbbbb','bbbbbbbb','skills/healthy-skill',?,?,'[]',1)`)
    .run(secondDigest, JSON.stringify(manifest), original.execution_preview_json);
  db.prepare(`INSERT INTO catalog_release_controls
    (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
    VALUES ('release-healthy','APPROVED',?,'human-a',1,1,1,1)`).run(secondDigest);
  db.prepare(`INSERT INTO catalog_installations
    (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
    VALUES ('release-healthy',?,'/catalog/healthy-skill/digest','INSTALLED','human-a',1,1,1)`).run(secondDigest);
  db.prepare(`INSERT INTO catalog_api_activations
    (release_id,approval_state,runtime_state,failure_code,approved_digest,approved_by_human_id,approved_at,revision,created_at,updated_at)
    VALUES ('release-healthy','APPROVED','ACTIVE',NULL,?,'human-a',1,4,1,1)`).run(secondDigest);
}

type FailureAt = "import" | "validation" | "registry-swap" | "active-commit";
function apiActivationFixture(options: { failureAt?: FailureAt; apiEventShapes?: string[]; moduleResult?: unknown; baseShapes?: EventShapeDefinition[] } = {}) {
  const opened = openCatalogFixture();
  seedRelease(opened.db, options.apiEventShapes);
  const registry = createAtomicEventShapeRegistry([coreShape]);
  const imports: string[] = [];
  const audits: CatalogAuditEvent[] = [];
  let finalCommitFailure = options.failureAt === "active-commit";
  let baseFailure = false;
  let deactivationFinalFailure = false;
  let deactivationAuditFailure = false;
  let allDeactivationAuditsFail = false;
  let approvalAuditFailure = false;
  const coordinator = createApiExecutionCoordinator({
    db: opened.db,
    registry,
    loadBaseShapes: async () => {
      if (baseFailure) { baseFailure = false; throw new Error("base failure"); }
      return { shapes: options.baseShapes ?? [coreShape], loadErrors: [] };
    },
    verifyInstalledRelease: async (release: ApiActivationRelease) => release.apiEventShapePaths.map(path => Object.freeze({
      releaseId: release.releaseId, releaseDigest: release.digest, declaredRelativePath: path,
      digest: `sha256:${"b".repeat(64)}`, bytes: Buffer.from("fixture").toString("base64"),
    })),
    loadEventShapeModule: async module => {
      imports.push(module.declaredRelativePath);
      if (options.failureAt === "import") throw new Error("private path and authored exception must be redacted");
      return options.moduleResult ?? { eventShapes: options.failureAt === "validation" ? [{ type: "bad", description: "bad", payloadSchema: {} }] : [moduleShape] };
    },
    writeAudit(tx, event) {
      if (!tx.inTransaction) throw new Error("audit outside transaction");
      if (allDeactivationAuditsFail && event.payload.action === "deactivate") throw new Error("audit storage unavailable");
      if (deactivationAuditFailure && event.payload.action === "deactivate" && event.payload.outcome === "SUCCEEDED") {
        deactivationAuditFailure = false; throw new Error("audit failure");
      }
      if (approvalAuditFailure && event.payload.action === "approve") {
        approvalAuditFailure = false; throw new Error("audit failure");
      }
      audits.push(event);
    },
    beforeFinalTransition(action) {
      if (action === "activate" && finalCommitFailure) {
        finalCommitFailure = false;
        throw new Error("simulated final commit failure");
      }
      if (action === "deactivate" && deactivationFinalFailure) {
        deactivationFinalFailure = false;
        throw new Error("simulated deactivation final failure");
      }
    },
  });
  const row = () => opened.db.prepare("SELECT approval_state AS approvalState,runtime_state AS runtimeState,failure_code AS failureCode,approved_digest AS approvedDigest,revision FROM catalog_api_activations WHERE release_id='release-skill'").get() as any;
  return {
    ...opened, coordinator, registry, audits,
    importedModules: () => [...imports],
    activeTypes: () => registry.snapshot().shapes.map(shape => shape.type),
    previousTypes: () => ["core-event"],
    activationRow: row,
    approveRelease: async () => undefined,
    install: async () => undefined,
    approveApiExecution: () => coordinator.approveApiExecution({ releaseId: "release-skill", expectedRevision: 1, digest }, adminActor()),
    activate: () => coordinator.activateApiExecution({ releaseId: "release-skill", expectedRevision: 2 }, adminActor()),
    failNextBaseLoad() { baseFailure = true; },
    failNextDeactivationFinal() { deactivationFinalFailure = true; },
    failNextDeactivationAudit() { deactivationAuditFailure = true; },
    failAllDeactivationAudits() { allDeactivationAuditsFail = true; },
    failNextApprovalAudit() { approvalAuditFailure = true; },
  };
}

describe("explicit API event-shape activation", () => {
  it("does not import event-shape code after release approval or inert installation", async () => {
    const fixture = apiActivationFixture();
    try {
      await fixture.approveRelease();
      await fixture.install();
      expect(fixture.importedModules()).toEqual([]);
      expect(fixture.activeTypes()).not.toContain("catalog-authored-event");
    } finally { fixture.close(); }
  });

  it.each(["import", "validation", "registry-swap", "active-commit"] as const)("keeps the old registry and a non-ACTIVE row after %s failure", async failureAt => {
    const fixture = apiActivationFixture({ failureAt });
    try {
      if (failureAt === "registry-swap") fixture.registry.failNextSwapForTest();
      await fixture.approveApiExecution();
      await expect(fixture.activate()).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
      expect(fixture.activeTypes()).toEqual(fixture.previousTypes());
      expect(["FAILED", "ACTIVATING"]).toContain(fixture.activationRow().runtimeState);
      expect(fixture.activationRow().runtimeState).not.toBe("ACTIVE");
    } finally { fixture.close(); }
  });

  it("rolls approval back when its audit cannot be stored and does not duplicate audit on replay", async () => {
    const fixture = apiActivationFixture();
    try {
      fixture.failNextApprovalAudit();
      await expect(fixture.approveApiExecution()).rejects.toBeInstanceOf(Error);
      expect(fixture.activationRow()).toMatchObject({ approvalState: "AWAITING_APPROVAL", runtimeState: "INACTIVE", revision: 1, approvedDigest: null });
      expect(fixture.audits).toEqual([]);
      await fixture.approveApiExecution();
      await expect(fixture.approveApiExecution()).rejects.toBeInstanceOf(ApiExecutionError);
      expect(fixture.audits.filter(event => event.payload.action === "approve")).toHaveLength(1);
    } finally { fixture.close(); }
  });

  it("rejects an arbitrary FAILED failure code before activation can import or expose shapes", async () => {
    const fixture = apiActivationFixture();
    try {
      await fixture.approveApiExecution();
      fixture.db.pragma("ignore_check_constraints = ON");
      fixture.db.prepare(`UPDATE catalog_api_activations
        SET runtime_state='FAILED',failure_code='ARBITRARY_UNSAFE_CODE',revision=3
        WHERE release_id='release-skill'`).run();
      fixture.db.pragma("ignore_check_constraints = OFF");

      await expect(fixture.coordinator.activateApiExecution({ releaseId: "release-skill", expectedRevision: 3 }, adminActor()))
        .rejects.toMatchObject({ code: "STORAGE_FAILURE" });
      expect(fixture.importedModules()).toEqual([]);
      expect(fixture.activeTypes()).toEqual(fixture.previousTypes());
      expect(fixture.activationRow()).toMatchObject({ runtimeState: "FAILED", failureCode: "ARBITRARY_UNSAFE_CODE", revision: 3 });
    } finally { fixture.close(); }
  });

  it("rejects an arbitrary ACTIVE failure code during startup before importing or exposing shapes", async () => {
    const fixture = apiActivationFixture();
    try {
      await fixture.approveApiExecution();
      fixture.db.pragma("ignore_check_constraints = ON");
      fixture.db.prepare(`UPDATE catalog_api_activations
        SET runtime_state='ACTIVE',failure_code='ARBITRARY_UNSAFE_CODE',revision=3
        WHERE release_id='release-skill'`).run();
      fixture.db.pragma("ignore_check_constraints = OFF");
      const restarted = createAtomicEventShapeRegistry([coreShape]);
      const imports: string[] = [];
      const coordinator = createApiExecutionCoordinator({
        db: fixture.db, registry: restarted,
        loadBaseShapes: async () => ({ shapes: [coreShape], loadErrors: [] }),
        verifyInstalledRelease: async release => release.apiEventShapePaths.map(path => Object.freeze({
          releaseId: release.releaseId, releaseDigest: release.digest, declaredRelativePath: path,
          digest: `sha256:${"b".repeat(64)}`, bytes: Buffer.from("fixture").toString("base64"),
        })),
        loadEventShapeModule: async module => { imports.push(module.declaredRelativePath); return { eventShapes: [moduleShape] }; },
        writeAudit() {},
      });

      await expect(coordinator.reconcileStartup()).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
      expect(imports).toEqual([]);
      expect(restarted.snapshot().shapes.map(shape => shape.type)).toEqual(["core-event"]);
    } finally { fixture.close(); }
  });

  it("rejects an arbitrary ACTIVE failure code before deactivation can import or expose shapes", async () => {
    const fixture = apiActivationFixture();
    try {
      await fixture.approveApiExecution();
      fixture.db.pragma("ignore_check_constraints = ON");
      fixture.db.prepare(`UPDATE catalog_api_activations
        SET runtime_state='ACTIVE',failure_code='ARBITRARY_UNSAFE_CODE',revision=3
        WHERE release_id='release-skill'`).run();
      fixture.db.pragma("ignore_check_constraints = OFF");

      await expect(fixture.coordinator.deactivateApiExecution({ releaseId: "release-skill", expectedRevision: 3 }, adminActor()))
        .rejects.toMatchObject({ code: "STORAGE_FAILURE" });
      expect(fixture.importedModules()).toEqual([]);
      expect(fixture.activeTypes()).toEqual(fixture.previousTypes());
    } finally { fixture.close(); }
  });

  it("approves without import, activates immediately, and deactivates without unloading module side effects", async () => {
    const fixture = apiActivationFixture();
    try {
      expect(await fixture.approveApiExecution()).toMatchObject({ approvalState: "APPROVED", runtimeState: "INACTIVE", revision: 2 });
      expect(fixture.activationRow().approvedDigest).toBe(digest);
      expect(fixture.importedModules()).toEqual([]);
      expect(await fixture.activate()).toMatchObject({ runtimeState: "ACTIVE", revision: 4 });
      expect(fixture.activeTypes()).toEqual(["core-event", "catalog-authored-event"]);
      expect(await fixture.coordinator.deactivateApiExecution({ releaseId: "release-skill", expectedRevision: 4 }, adminActor()))
        .toMatchObject({ runtimeState: "INACTIVE", revision: 6 });
      expect(fixture.activeTypes()).toEqual(["core-event"]);
      expect(fixture.importedModules()).toHaveLength(1);
      expect(fixture.audits.map(event => event.payload.action)).toEqual(["approve", "activate", "deactivate"]);
    } finally { fixture.close(); }
  });

  it("uses compare-and-swap rollback that cannot clobber a later successful swap", () => {
    const registry = createAtomicEventShapeRegistry([coreShape]);
    const first = registry.swap([coreShape, { ...moduleShape, source: "skill:first" }]);
    registry.swap([coreShape, { ...moduleShape, type: "later-event", source: "skill:later" }]);
    first.rollback();
    expect(registry.snapshot().shapes.map(shape => shape.type)).toEqual(["core-event", "later-event"]);
  });

  it("rejects a newly introduced local skill collision with a core event type", async () => {
    const fixture = apiActivationFixture({ baseShapes: [coreShape, { ...coreShape, source: "skill:new-local" }] });
    try {
      await fixture.approveApiExecution();
      await expect(fixture.activate()).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
      expect(fixture.activeTypes()).toEqual(["core-event"]);
    } finally { fixture.close(); }
  });

  it("rejects duplicate, malformed, spoofed, and over-limit candidate definitions", () => {
    expect(() => validateEventShapeRegistry([coreShape, { ...coreShape }])).toThrow();
    expect(() => validateEventShapeRegistry([{ ...moduleShape, payloadSchema: {} as never }])).toThrow();
    expect(() => validateEventShapeRegistry([{ ...moduleShape, source: "forged" as never }])).toThrow();
    expect(() => validateEventShapeRegistry(Array.from({ length: 1025 }, (_, index) => ({ ...moduleShape, type: `event-${index}` })))).toThrow();
  });

  it("rejects an empty authored module export without changing the old registry", async () => {
    const fixture = apiActivationFixture({ moduleResult: { eventShapes: [] } });
    try {
      await fixture.approveApiExecution();
      await expect(fixture.activate()).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
      expect(fixture.activeTypes()).toEqual(fixture.previousTypes());
      expect(fixture.activationRow().runtimeState).toBe("FAILED");
    } finally { fixture.close(); }
  });

  it("keeps no-executable releases NOT_REQUIRED and refuses approval before import", async () => {
    const fixture = apiActivationFixture({ apiEventShapes: [] });
    try {
      await expect(fixture.approveApiExecution()).rejects.toMatchObject({ code: "STATE_CONFLICT" });
      expect(fixture.importedModules()).toEqual([]);
      expect(fixture.activationRow()).toMatchObject({ approvalState: "NOT_REQUIRED", runtimeState: "INACTIVE", revision: 1 });
    } finally { fixture.close(); }
  });

  it("attributes a startup package failure only to the bad release and keeps a healthy ACTIVE release", async () => {
    const fixture = apiActivationFixture();
    try {
      await fixture.approveApiExecution();
      await fixture.activate();
      seedSecondActiveRelease(fixture.db);
      const registry = createAtomicEventShapeRegistry([coreShape]);
      const audits: CatalogAuditEvent[] = [];
      const coordinator = createApiExecutionCoordinator({
        db: fixture.db, registry,
        loadBaseShapes: async () => ({ shapes: [coreShape], loadErrors: [] }),
        verifyInstalledRelease: async release => release.apiEventShapePaths.map(path => Object.freeze({
          releaseId: release.releaseId, releaseDigest: release.digest, declaredRelativePath: path,
          digest: `sha256:${"b".repeat(64)}`, bytes: Buffer.from("fixture").toString("base64"),
        })),
        loadEventShapeModule: async module => {
          if (module.releaseId === "release-skill") throw new Error("bad package");
          return { eventShapes: [{ ...moduleShape, type: "healthy-event" }] };
        },
        writeAudit(_tx, event) { audits.push(event); },
      });
      await expect(coordinator.reconcileStartup()).resolves.toBeUndefined();
      expect(registry.snapshot().shapes.map(shape => shape.type)).toEqual(["core-event", "healthy-event"]);
      expect(fixture.db.prepare("SELECT release_id,runtime_state FROM catalog_api_activations ORDER BY release_id").all()).toEqual([
        { release_id: "release-healthy", runtime_state: "ACTIVE" },
        { release_id: "release-skill", runtime_state: "FAILED" },
      ]);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ payload: { action: "activate", outcome: "FAILED", releaseId: "release-skill" } });
    } finally { fixture.close(); }
  });

  it("does not blame ACTIVE packages when startup base loading or final swap fails", async () => {
    for (const failure of ["base", "swap"] as const) {
      const fixture = apiActivationFixture();
      try {
        await fixture.approveApiExecution(); await fixture.activate();
        const registry = createAtomicEventShapeRegistry([coreShape]);
        if (failure === "swap") registry.failNextSwapForTest();
        const audits: CatalogAuditEvent[] = [];
        const coordinator = createApiExecutionCoordinator({
          db: fixture.db, registry,
          loadBaseShapes: async () => failure === "base" ? Promise.reject(new Error("base")) : ({ shapes: [coreShape], loadErrors: [] }),
          verifyInstalledRelease: async release => release.apiEventShapePaths.map(path => Object.freeze({
            releaseId: release.releaseId, releaseDigest: release.digest, declaredRelativePath: path,
            digest: `sha256:${"b".repeat(64)}`, bytes: Buffer.from("fixture").toString("base64"),
          })),
          loadEventShapeModule: async () => ({ eventShapes: [moduleShape] }),
          writeAudit(_tx, event) { audits.push(event); },
        });
        await expect(coordinator.reconcileStartup()).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
        expect(fixture.activationRow()).toMatchObject({ runtimeState: "ACTIVE", revision: 4 });
        expect(audits).toEqual([]);
        expect(registry.snapshot().shapes.map(shape => shape.type)).toEqual(["core-event"]);
      } finally { fixture.close(); }
    }
  });

  it("reloads persisted ACTIVE bytes after Source disablement or review withdrawal", async () => {
    const fixture = apiActivationFixture();
    try {
      await fixture.approveApiExecution(); await fixture.activate();
      fixture.db.prepare("UPDATE catalog_sources SET enabled=0,removed_at=1 WHERE source_id='source-team'").run();
      fixture.db.prepare("UPDATE catalog_release_controls SET review_state='WITHDRAWN' WHERE package_release_id='release-skill'").run();
      const registry = createAtomicEventShapeRegistry([coreShape]);
      const coordinator = createApiExecutionCoordinator({
        db: fixture.db, registry,
        loadBaseShapes: async () => ({ shapes: [coreShape], loadErrors: [] }),
        verifyInstalledRelease: async release => release.apiEventShapePaths.map(path => Object.freeze({
          releaseId: release.releaseId, releaseDigest: release.digest, declaredRelativePath: path,
          digest: `sha256:${"b".repeat(64)}`, bytes: Buffer.from("fixture").toString("base64"),
        })),
        loadEventShapeModule: async () => ({ eventShapes: [moduleShape] }), writeAudit() {},
      });
      await expect(coordinator.reconcileStartup()).resolves.toBeUndefined();
      expect(registry.snapshot().shapes.map(shape => shape.type)).toContain("catalog-authored-event");
      expect(fixture.activationRow()).toMatchObject({ runtimeState: "ACTIVE", revision: 4 });
    } finally { fixture.close(); }
  });

  it("does not overwrite a concurrent admin state change during startup reconciliation", async () => {
    const fixture = apiActivationFixture();
    try {
      await fixture.approveApiExecution(); await fixture.activate();
      const registry = createAtomicEventShapeRegistry([coreShape]);
      const coordinator = createApiExecutionCoordinator({
        db: fixture.db, registry,
        loadBaseShapes: async () => ({ shapes: [coreShape], loadErrors: [] }),
        verifyInstalledRelease: async release => release.apiEventShapePaths.map(path => Object.freeze({
          releaseId: release.releaseId, releaseDigest: release.digest, declaredRelativePath: path,
          digest: `sha256:${"b".repeat(64)}`, bytes: Buffer.from("fixture").toString("base64"),
        })),
        loadEventShapeModule: async () => {
          fixture.db.prepare("UPDATE catalog_api_activations SET runtime_state='INACTIVE',revision=5 WHERE release_id='release-skill'").run();
          throw new Error("stale startup read");
        },
        writeAudit() { throw new Error("must not audit stale transition"); },
      });
      await expect(coordinator.reconcileStartup()).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
      expect(fixture.activationRow()).toMatchObject({ runtimeState: "INACTIVE", revision: 5, failureCode: null });
      expect(registry.snapshot().shapes.map(shape => shape.type)).toEqual(["core-event"]);
    } finally { fixture.close(); }
  });

  it("reconciles only persisted APPROVED+ACTIVE rows into a new registry", async () => {
    const fixture = apiActivationFixture();
    try {
      await fixture.approveApiExecution();
      await fixture.activate();
      const restarted = createAtomicEventShapeRegistry([coreShape]);
      const loader = vi.fn(async () => ({ eventShapes: [moduleShape] }));
      const coordinator = createApiExecutionCoordinator({
        db: fixture.db, registry: restarted,
        loadBaseShapes: async () => ({ shapes: [coreShape], loadErrors: [] }),
        verifyInstalledRelease: async release => release.apiEventShapePaths.map(path => Object.freeze({
          releaseId: release.releaseId, releaseDigest: release.digest, declaredRelativePath: path,
          digest: `sha256:${"b".repeat(64)}`, bytes: Buffer.from("fixture").toString("base64"),
        })),
        loadEventShapeModule: loader,
        writeAudit() {},
      });
      await coordinator.reconcileStartup();
      expect(restarted.snapshot().shapes.map(shape => shape.type)).toEqual(["core-event", "catalog-authored-event"]);
      expect(loader).toHaveBeenCalledTimes(1);
    } finally { fixture.close(); }
  });

  it("loads standalone TypeScript from captured bytes with only the trusted exact zod import", async () => {
    const source = `import { z } from "zod";\nexport const eventShapes = [{ type: "captured", description: "captured", payloadSchema: z.object({ value: z.string() }) }];`;
    const bytes = Buffer.from(source);
    const loaded = await loadCapturedEventShapeModule(Object.freeze({
      releaseId: "release-skill", releaseDigest: digest, declaredRelativePath: "event-shapes.ts",
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, bytes: bytes.toString("base64"),
    })) as { eventShapes: EventShapeDefinition[] };
    expect(validateEventAgainstShapes(
      { type: "captured", source: "agent:test", payload: { value: "ok" } }, loaded.eventShapes,
    )).toMatchObject({ ok: true });
  });

  it.each([
    `import "./undeclared.ts"; globalThis.__catalogExecuted = true; export const eventShapes = [];`,
    `import fs from "node:fs"; globalThis.__catalogExecuted = true; export const eventShapes = [];`,
    `const load = import("zod"); globalThis.__catalogExecuted = true; export const eventShapes = [];`,
    `const fs = require("node:fs"); globalThis.__catalogExecuted = true; export const eventShapes = [];`,
    `const hidden = require; globalThis.__catalogExecuted = true; export const eventShapes = [];`,
    `globalThis.__catalogExecuted = true; export const eventShapes = [];`,
    `global.__catalogExecuted = true; export const eventShapes = [];`,
    `process.mainModule; globalThis.__catalogExecuted = true; export const eventShapes = [];`,
    `module.createRequire; globalThis.__catalogExecuted = true; export const eventShapes = [];`,
    `Function("return process")(); globalThis.__catalogExecuted = true; export const eventShapes = [];`,
    `eval("process"); globalThis.__catalogExecuted = true; export const eventShapes = [];`,
    `(() => {}).constructor("return process")(); globalThis.__catalogExecuted = true; export const eventShapes = [];`,
    `(() => {})["constructor"]("return process")(); globalThis.__catalogExecuted = true; export const eventShapes = [];`,
    `import { z } from "zod"; z.string.constructor("return process")(); globalThis.__catalogExecuted = true; export const eventShapes = [];`,
  ])("rejects host and undeclared graph access before top-level execution", async source => {
    delete (globalThis as { __catalogExecuted?: boolean }).__catalogExecuted;
    const bytes = Buffer.from(source);
    await expect(loadCapturedEventShapeModule(Object.freeze({
      releaseId: "release-skill", releaseDigest: digest, declaredRelativePath: "event-shapes.ts",
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, bytes: bytes.toString("base64"),
    }))).rejects.toThrow();
    expect((globalThis as { __catalogExecuted?: boolean }).__catalogExecuted).toBeUndefined();
  });

  it("blocks process.getBuiltinModule before an fs marker side effect", async () => {
    const root = await mkdtemp(join(tmpdir(), "catalog-vm-marker-"));
    const marker = join(root, "escaped");
    const source = `process.getBuiltinModule("fs").writeFileSync(${JSON.stringify(marker)}, "escaped"); export const eventShapes = [];`;
    const bytes = Buffer.from(source);
    try {
      await expect(loadCapturedEventShapeModule(Object.freeze({
        releaseId: "release-skill", releaseDigest: digest, declaredRelativePath: "host-access.ts",
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, bytes: bytes.toString("base64"),
      }))).rejects.toThrow();
      await expect(readFile(marker)).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("captures exact module bytes and rejects hard links before execution", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "api-activation-capture-"));
    const root = join(artifactRoot, "demo-skill", "a".repeat(64));
    const bytes = Buffer.from("export const eventShapes = [];\n");
    const fileDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "event-shapes.ts"), bytes, { mode: 0o644 });
    const release = {
      releaseId: "release-skill", packageName: "demo-skill", digest, installationPath: root,
      apiEventShapePaths: ["event-shapes.ts"],
      manifest: {
        formatVersion: 1, kind: "skill", name: "demo-skill", version: "1.0.0", description: "fixture", author: "OrgOps", license: "MIT",
        compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [], dependencies: [],
        files: [{ path: "event-shapes.ts", size: bytes.length, digest: fileDigest, executable: false }],
        executables: [{ path: "event-shapes.ts", execution: "api-event-shapes" }], digest, skill: { entrypoint: "SKILL.md" },
      },
    } as ApiActivationRelease;
    try {
      const captured = await verifyInstalledApiRelease(release, artifactRoot);
      await writeFile(join(root, "event-shapes.ts"), "throw new Error('replacement executed');\n", { mode: 0o644 });
      expect(captured).toEqual([expect.objectContaining({
        declaredRelativePath: "event-shapes.ts",
        digest: fileDigest,
        bytes: bytes.toString("base64"),
      })]);
      await expect(loadCapturedEventShapeModule(captured[0]!)).resolves.toMatchObject({ eventShapes: [] });

      await writeFile(join(root, "event-shapes.ts"), bytes, { mode: 0o644 });
      await link(join(root, "event-shapes.ts"), join(root, "hardlink.ts"));
      release.manifest.files.push({ path: "hardlink.ts", size: bytes.length, digest: fileDigest, executable: false });
      await expect(verifyInstalledApiRelease(release, artifactRoot)).rejects.toMatchObject({ code: "INSPECTION_FAILED" });
      await unlink(join(root, "hardlink.ts")); release.manifest.files.pop();
      await writeFile(join(root, "EVENT-SHAPES.ts"), bytes, { mode: 0o644 });
      release.manifest.files.push({ path: "EVENT-SHAPES.ts", size: bytes.length, digest: fileDigest, executable: false });
      await expect(verifyInstalledApiRelease(release, artifactRoot)).rejects.toMatchObject({ code: "INSPECTION_FAILED" });
    } finally { await rm(artifactRoot, { recursive: true, force: true }); }
  });

  it("rejects authored safeParse closures and freezes example snapshots and definitions", () => {
    const mutableSchema = { safeParse: (_input: unknown) => ({ success: true, data: {} }) };
    const mutableExample = { nested: { value: "before" } };
    const registry = createAtomicEventShapeRegistry([coreShape]);
    expect(() => registry.swap([{ type: "mutable", description: "mutable", payloadSchema: mutableSchema as never }]))
      .toThrow("invalid event-shape schema");
    registry.swap([{ type: "example", description: "example", payloadExample: mutableExample }]);
    mutableExample.nested.value = "after";
    const shape = registry.snapshot().shapes[0]!;
    expect(shape.payloadExample).toEqual({ nested: { value: "before" } });
    expect(Object.isFrozen(shape)).toBe(true);
    expect(Object.isFrozen(shape.payloadExample)).toBe(true);

    const getter = Object.defineProperty({ type: "getter", description: "getter" }, "payloadSchema", { enumerable: true, get() { throw new Error("getter"); } });
    expect(() => registry.swap([getter as EventShapeDefinition])).toThrow("invalid event-shape definition");
    const proxy = new Proxy({}, { ownKeys() { throw new Error("proxy"); } });
    expect(() => registry.swap([proxy as EventShapeDefinition])).toThrow("invalid event-shape definition");
    expect(() => registry.swap([{
      type: "oversized-example", description: "oversized", payloadExample: Array.from({ length: 10_001 }, () => ({})),
    }])).toThrow("invalid event-shape example");
  });

  it("compiles catalog zod schemas once and rejects authored effects", async () => {
    const mutable = z.object({ value: z.string() }).strict();
    const exported = { eventShapes: [{ type: "immutable", description: "immutable", payloadSchema: mutable }] };
    const fixture = apiActivationFixture({ moduleResult: exported });
    try {
      await fixture.approveApiExecution();
      await fixture.activate();
      const active = fixture.registry.snapshot().shapes.find(shape => shape.type === "immutable")!;
      expect(validateEventAgainstShapes({ type: "immutable", source: "agent:test", payload: { value: "ok" } }, [active])).toMatchObject({ ok: true });
      (mutable as unknown as { _def: { shape: () => unknown } })._def.shape = () => ({ value: z.number() });
      exported.eventShapes[0]!.payloadSchema = z.never() as never;
      expect(validateEventAgainstShapes({ type: "immutable", source: "agent:test", payload: { value: "still-ok" } }, [active])).toMatchObject({ ok: true });
      expect(validateEventAgainstShapes({ type: "immutable", source: "agent:test", payload: { value: 1 } }, [active])).toMatchObject({ ok: false });
    } finally { fixture.close(); }

    let toggle = false;
    for (const payloadSchema of [
      z.string().refine(() => (toggle = !toggle)),
      z.string().transform(value => value.length),
      z.object({ value: z.string() }),
    ]) {
      const rejected = apiActivationFixture({ moduleResult: { eventShapes: [{ type: "effect", description: "effect", payloadSchema }] } });
      try {
        await rejected.approveApiExecution();
        await expect(rejected.activate()).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
        expect(rejected.activeTypes()).toEqual(["core-event"]);
      } finally { rejected.close(); }
    }
  });

  it("turns throwing or malformed schema results into deterministic validation failures", () => {
    for (const payloadSchema of [
      { safeParse() { throw new Error("authored secret"); } },
      { safeParse() { return null; } },
      { safeParse() { return { success: false, error: {} }; } },
    ]) {
      expect(() => validateEventAgainstShapes(
        { type: "hostile", source: "agent:test", payload: {} },
        [{ type: "hostile", description: "hostile", payloadSchema: payloadSchema as never }],
      )).not.toThrow();
      expect(validateEventAgainstShapes(
        { type: "hostile", source: "agent:test", payload: {} },
        [{ type: "hostile", description: "hostile", payloadSchema: payloadSchema as never }],
      )).toMatchObject({ ok: false, issues: [{ source: "core", message: "Schema validation failed" }] });
    }
  });

  it.each(["compose", "validation", "registry-swap", "final-transition", "audit"] as const)(
    "restores ACTIVE truth and writes one failed audit after deactivation %s failure", async failure => {
      const baseShapes = [coreShape];
      const fixture = apiActivationFixture({ baseShapes });
      try {
        await fixture.approveApiExecution(); await fixture.activate();
        if (failure === "compose") fixture.failNextBaseLoad();
        if (failure === "validation") baseShapes.push({ ...coreShape });
        if (failure === "registry-swap") fixture.registry.failNextSwapForTest();
        if (failure === "final-transition") fixture.failNextDeactivationFinal();
        if (failure === "audit") fixture.failNextDeactivationAudit();
        await expect(fixture.coordinator.deactivateApiExecution({ releaseId: "release-skill", expectedRevision: 4 }, adminActor()))
          .rejects.toMatchObject({ code: "STORAGE_FAILURE" });
        expect(fixture.activationRow()).toMatchObject({ runtimeState: "ACTIVE", failureCode: null, revision: 6, approvedDigest: digest });
        expect(fixture.activeTypes()).toContain("catalog-authored-event");
        expect(fixture.audits.filter(event => event.payload.action === "deactivate")).toEqual([
          expect.objectContaining({ payload: expect.objectContaining({ action: "deactivate", outcome: "FAILED", failureCode: "STORAGE_FAILURE", revision: 6 }) }),
        ]);
      } finally { fixture.close(); }
    },
  );

  it("restores ACTIVE truth after failed deactivation and permits retry", async () => {
    const fixture = apiActivationFixture();
    try {
      await fixture.approveApiExecution();
      await fixture.activate();
      fixture.registry.failNextSwapForTest();
      await expect(fixture.coordinator.deactivateApiExecution({ releaseId: "release-skill", expectedRevision: 4 }, adminActor()))
        .rejects.toMatchObject({ code: "STORAGE_FAILURE" });
      expect(fixture.activationRow()).toMatchObject({ runtimeState: "ACTIVE", failureCode: null, revision: 6 });
      expect(fixture.activeTypes()).toContain("catalog-authored-event");
      await expect(fixture.coordinator.deactivateApiExecution({ releaseId: "release-skill", expectedRevision: 6 }, adminActor()))
        .resolves.toMatchObject({ runtimeState: "INACTIVE", revision: 8 });
    } finally { fixture.close(); }
  });

  it("leaves DEACTIVATING when restoration audit storage fails and excludes it on restart", async () => {
    const fixture = apiActivationFixture();
    try {
      await fixture.approveApiExecution(); await fixture.activate();
      fixture.failAllDeactivationAudits();
      await expect(fixture.coordinator.deactivateApiExecution({ releaseId: "release-skill", expectedRevision: 4 }, adminActor()))
        .rejects.toMatchObject({ code: "STORAGE_FAILURE" });
      expect(fixture.activationRow()).toMatchObject({ runtimeState: "DEACTIVATING", revision: 5, failureCode: null });
      expect(fixture.activeTypes()).toContain("catalog-authored-event");

      const restarted = createAtomicEventShapeRegistry([coreShape]);
      const coordinator = createApiExecutionCoordinator({
        db: fixture.db, registry: restarted,
        loadBaseShapes: async () => ({ shapes: [coreShape], loadErrors: [] }),
        verifyInstalledRelease: async () => { throw new Error("DEACTIVATING must not verify"); },
        loadEventShapeModule: async () => { throw new Error("DEACTIVATING must not import"); },
        writeAudit() { throw new Error("DEACTIVATING must not audit"); },
      });
      await coordinator.reconcileStartup();
      expect(restarted.snapshot().shapes.map(shape => shape.type)).toEqual(["core-event"]);
      expect(fixture.activationRow()).toMatchObject({ runtimeState: "DEACTIVATING", revision: 5 });
    } finally { fixture.close(); }
  });

  it("still verifies every remaining ACTIVE package while removing a degraded target", async () => {
    const fixture = apiActivationFixture();
    try {
      await fixture.approveApiExecution(); await fixture.activate(); seedSecondActiveRelease(fixture.db);
      const registry = createAtomicEventShapeRegistry([coreShape]);
      let failHealthyVerification = false;
      const coordinator = createApiExecutionCoordinator({
        db: fixture.db, registry,
        loadBaseShapes: async () => ({ shapes: [coreShape], loadErrors: [] }),
        verifyInstalledRelease: async release => {
          if (failHealthyVerification && release.releaseId === "release-healthy") throw new ApiExecutionError("INSPECTION_FAILED");
          return release.apiEventShapePaths.map(path => Object.freeze({
            releaseId: release.releaseId, releaseDigest: release.digest, declaredRelativePath: path,
            digest: `sha256:${"b".repeat(64)}`, bytes: Buffer.from("fixture").toString("base64"),
          }));
        },
        loadEventShapeModule: async module => ({ eventShapes: [{ ...moduleShape, type: module.releaseId === "release-healthy" ? "healthy-event" : moduleShape.type }] }),
        writeAudit() {},
      });
      await coordinator.reconcileStartup();
      failHealthyVerification = true;
      await expect(coordinator.deactivateApiExecution({ releaseId: "release-skill", expectedRevision: 4 }, adminActor()))
        .rejects.toMatchObject({ code: "INSPECTION_FAILED" });
      expect(fixture.activationRow()).toMatchObject({ runtimeState: "ACTIVE", revision: 6 });
      expect(registry.snapshot().shapes.map(shape => shape.type)).toContain("catalog-authored-event");
    } finally { fixture.close(); }
  });

  it("allows an ACTIVE package to be removed after source and installation degradation", async () => {
    const fixture = apiActivationFixture();
    try {
      await fixture.approveApiExecution();
      await fixture.activate();
      fixture.db.prepare("UPDATE catalog_sources SET enabled=0 WHERE source_id='source-team'").run();
      fixture.db.prepare("UPDATE catalog_release_controls SET review_state='WITHDRAWN' WHERE package_release_id='release-skill'").run();
      fixture.db.prepare("DELETE FROM catalog_installations WHERE release_id='release-skill'").run();
      await expect(fixture.coordinator.deactivateApiExecution({ releaseId: "release-skill", expectedRevision: 4 }, adminActor()))
        .resolves.toMatchObject({ runtimeState: "INACTIVE", revision: 6 });
      expect(fixture.activeTypes()).toEqual(["core-event"]);
    } finally { fixture.close(); }
  });

  it("remeasures exact installed module inventory and rejects symlinks, mode drift, extras, and path escape", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "api-activation-integrity-"));
    const root = join(artifactRoot, "demo-skill", "a".repeat(64));
    const bytes = Buffer.from("export const eventShapes = [];\n");
    const fileDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "event-shapes.ts"), bytes, { mode: 0o644 });
    const release = {
      releaseId: "release-skill", packageName: "demo-skill", digest, installationPath: root,
      apiEventShapePaths: ["event-shapes.ts"],
      manifest: {
        formatVersion: 1, kind: "skill", name: "demo-skill", version: "1.0.0", description: "fixture", author: "OrgOps", license: "MIT",
        compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [], dependencies: [],
        files: [{ path: "event-shapes.ts", size: bytes.length, digest: fileDigest, executable: false }],
        executables: [{ path: "event-shapes.ts", execution: "api-event-shapes" }], digest, skill: { entrypoint: "SKILL.md" },
      },
    } as ApiActivationRelease;
    try {
      await expect(verifyInstalledApiRelease(release, artifactRoot)).resolves.toEqual([expect.objectContaining({
        declaredRelativePath: "event-shapes.ts", digest: fileDigest, bytes: bytes.toString("base64"),
      })]);
      await chmod(join(root, "event-shapes.ts"), 0o755);
      await expect(verifyInstalledApiRelease(release, artifactRoot)).rejects.toMatchObject({ code: "INSPECTION_FAILED" });
      await chmod(join(root, "event-shapes.ts"), 0o644);
      await writeFile(join(root, "extra"), "extra");
      await expect(verifyInstalledApiRelease(release, artifactRoot)).rejects.toMatchObject({ code: "INSPECTION_FAILED" });
      await unlink(join(root, "extra"));
      await unlink(join(root, "event-shapes.ts"));
      await symlink("outside", join(root, "event-shapes.ts"));
      await expect(verifyInstalledApiRelease(release, artifactRoot)).rejects.toMatchObject({ code: "INSPECTION_FAILED" });
      await expect(verifyInstalledApiRelease({ ...release, installationPath: join(artifactRoot, "..", "escape") }, artifactRoot))
        .rejects.toMatchObject({ code: "INSPECTION_FAILED" });
    } finally { await rm(artifactRoot, { recursive: true, force: true }); }
  });

  it("requires a valid bound review digest without confusing it with the release digest", async () => {
    const fixture = apiActivationFixture();
    try {
      fixture.db.prepare("UPDATE catalog_release_controls SET review_digest=? WHERE package_release_id='release-skill'")
        .run(`sha256:${"c".repeat(64)}`);
      await expect(fixture.approveApiExecution()).resolves.toMatchObject({ approvalState: "APPROVED" });
    } finally { fixture.close(); }
    for (const corruption of ["review_digest='malformed'", "reviewed_by_human_id=NULL", "reviewed_at=NULL"]) {
      const malformed = apiActivationFixture();
      try {
        malformed.db.prepare(`UPDATE catalog_release_controls SET ${corruption} WHERE package_release_id='release-skill'`).run();
        await expect(malformed.approveApiExecution()).rejects.toMatchObject({ code: "RELEASE_NOT_APPROVED" });
        expect(malformed.importedModules()).toEqual([]);
      } finally { malformed.close(); }
    }
  });

  it("rejects malformed ACTIVE approval timestamps before startup import or deactivation membership", async () => {
    const fixture = apiActivationFixture();
    try {
      await fixture.approveApiExecution(); await fixture.activate();
      fixture.db.pragma("ignore_check_constraints=ON");
      fixture.db.prepare("UPDATE catalog_api_activations SET approved_at='bad' WHERE release_id='release-skill'").run();
      fixture.db.pragma("ignore_check_constraints=OFF");
      const loader = vi.fn(async () => ({ eventShapes: [moduleShape] }));
      const restarted = createApiExecutionCoordinator({
        db: fixture.db, registry: createAtomicEventShapeRegistry([coreShape]),
        loadBaseShapes: async () => ({ shapes: [coreShape], loadErrors: [] }),
        verifyInstalledRelease: async release => release.apiEventShapePaths.map(path => Object.freeze({
          releaseId: release.releaseId, releaseDigest: release.digest, declaredRelativePath: path,
          digest: `sha256:${"b".repeat(64)}`, bytes: Buffer.from("fixture").toString("base64"),
        })),
        loadEventShapeModule: loader,
        writeAudit() {},
      });
      await expect(restarted.reconcileStartup()).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
      expect(loader).not.toHaveBeenCalled();
      const importsBeforeDeactivation = fixture.importedModules();
      await expect(fixture.coordinator.deactivateApiExecution({ releaseId: "release-skill", expectedRevision: 4 }, adminActor()))
        .rejects.toMatchObject({ code: "STORAGE_FAILURE" });
      expect(fixture.importedModules()).toEqual(importsBeforeDeactivation);
    } finally { fixture.close(); }
  });

  it("rejects stale or malformed persisted approval bindings before module loading", async () => {
    for (const corruption of [
      `approved_digest='sha256:${"f".repeat(64)}'`,
      "approved_by_human_id=NULL",
      `approved_by_human_id='${"x".repeat(201)}'`,
      "approved_at=NULL",
      "approved_at='bad'",
      "approved_at=1.5",
      "approved_at=-1",
      "approved_at=9007199254740992",
    ]) {
      const fixture = apiActivationFixture();
      try {
        await fixture.approveApiExecution();
        fixture.db.pragma("foreign_keys=OFF");
        fixture.db.pragma("ignore_check_constraints=ON");
        fixture.db.prepare(`UPDATE catalog_api_activations SET ${corruption} WHERE release_id='release-skill'`).run();
        fixture.db.pragma("ignore_check_constraints=OFF");
        fixture.db.pragma("foreign_keys=ON");
        await expect(fixture.activate()).rejects.toBeInstanceOf(ApiExecutionError);
        expect(fixture.importedModules()).toEqual([]);
        expect(fixture.activeTypes()).toEqual(["core-event"]);
      } finally { fixture.close(); }
    }
  });

  it("fails stale revisions, duplicate commands, overflow, malformed state, and concurrent operations deterministically", async () => {
    const fixture = apiActivationFixture();
    try {
      await expect(fixture.coordinator.approveApiExecution({ releaseId: "release-skill", expectedRevision: 2, digest }, adminActor()))
        .rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      await expect(fixture.coordinator.approveApiExecution({ releaseId: "release-skill", expectedRevision: 1, digest: `sha256:${"f".repeat(64)}` }, adminActor()))
        .rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      await fixture.approveApiExecution();
      await expect(fixture.approveApiExecution()).rejects.toBeInstanceOf(ApiExecutionError);
      fixture.db.prepare("UPDATE catalog_api_activations SET revision=2147483647 WHERE release_id='release-skill'").run();
      await expect(fixture.coordinator.activateApiExecution({ releaseId: "release-skill", expectedRevision: 2147483647 }, adminActor()))
        .rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    } finally { fixture.close(); }
  });
});
