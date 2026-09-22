import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { CatalogAuthority, CatalogAuditEvent, CatalogConsumption, CatalogPolicy } from "@orgops/schemas";
import { registerCatalogSourceRoutes } from "../routes/catalog-library";
import { CatalogConsumptionError, createCatalogConsumption, projectEffectiveAgentSkills, type BoundDeploymentCommand } from "./consumption";
import { AgentSkillManagementError, createAgentSkillManagement } from "../unified-skills/management";
import { adminActor, approvedRelease, humanActor, openCatalogFixture } from "./test-fixtures";
import { catalogGrantId } from "./grant-identity";

const body = { expectedAgentRevision: 1, expectedAssignmentRevision: 0, preload: true };
const result = {
  assignmentId: "assignment-a", desiredState: "ENABLED" as const, effectiveState: "DISABLED" as const,
  deploymentState: "REQUESTED" as const, activeGeneration: null, desiredGeneration: "generation-a", revision: 1,
};

function routeFixture() {
  const app = new Hono();
  const assignSkill = vi.fn<CatalogConsumption["assignSkill"]>().mockImplementation(async command => ({
    ...result, desiredState: command.kind === "assignment.enable" ? "ENABLED" : "DISABLED",
  }));
  const executeLegacyCatalog = vi.fn().mockImplementation(async (command: any) => ({
    ref: { kind: "CATALOG", packageReleaseId: command.packageReleaseId, assignmentId: result.assignmentId, desiredGeneration: result.desiredGeneration, activeGeneration: result.activeGeneration },
    desired: command.operation === "ENABLE" ? "ENABLED" : "DISABLED", effective: result.effectiveState, preload: command.preload, deployment: result.deploymentState, revision: result.revision, agentRevision: 1,
  }));
  const authority: CatalogAuthority = { execute: vi.fn(), query: vi.fn() };
  registerCatalogSourceRoutes(app, {
    authority,
    consumption: { assignSkill },
    management: { executeLegacyCatalog } as any,
    requireAuth: async (c: any, next: any) => { c.set("user", { id: "human-a", username: "owner" }); await next(); },
    requireAdmin: async (_c: any, next: any) => next(),
    resolveLibraryActor: () => ({ kind: "HUMAN_ADMIN", id: "human-a" }),
    resolveAgentId: (name: string) => name === "agent-a" ? "agent-id-a" : undefined,
  } as any);
  return { app, assignSkill, executeLegacyCatalog };
}

describe("catalog skill assignment routes", () => {
  it.each([
    ["PUT", "assignment.enable"],
    ["DELETE", "assignment.disable"],
  ] as const)("routes %s through AgentSkillManagement legacy adapter", async (method, kind) => {
    const fixture = routeFixture();
    const response = await fixture.app.request("/api/agents/agent-a/catalog-skills/release-skill", {
      method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...result, desiredState: kind === "assignment.enable" ? "ENABLED" : "DISABLED" });
    expect(fixture.executeLegacyCatalog).toHaveBeenCalledWith({
      kind: "CATALOG", operation: kind === "assignment.enable" ? "ENABLE" : "DISABLE", agentId: "agent-id-a", packageReleaseId: "release-skill", ...body,
    }, { kind: "HUMAN_ADMIN", id: "human-a" });
    expect(fixture.assignSkill).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

const digest = `sha256:${"a".repeat(64)}`;
const normalizedRow = (overrides: Record<string, unknown> = {}) => ({
  assignment_id: "assignment-a", agent_id: "agent-a", release_id: "release-skill", local_skill_name: "demo-skill",
  desired_state: "ENABLED", effective_state: "DISABLED", deployment_state: "REQUESTED", preload: 0, effective_preload: 0,
  active_generation: null, desired_generation: "next-generation", revision: 1, actor_kind: "ADMIN", actor_human_id: "human-a",
  grant_id: null, ...overrides,
});
const projectionDb = (rows: Array<Record<string, unknown>>) => ({ prepare: () => ({ all: () => rows }) }) as any;

function serviceFixture(options: { legacy?: string[]; failAudit?: boolean; failEnqueue?: boolean; policy?: CatalogPolicy } = {}) {
  const opened = openCatalogFixture();
  const downstreamReads = { release: 0, grant: 0 };
  const db = new Proxy(opened.db, {
    get(target, property) {
      if (property === "prepare") return (sql: string) => {
        const statement = target.prepare(sql);
        const read = sql.includes("FROM catalog_package_releases") ? "release"
          : sql.includes("FROM catalog_grants") ? "grant" : undefined;
        if (!read) return statement;
        return new Proxy(statement, {
          get(statementTarget, statementProperty) {
            const value = Reflect.get(statementTarget, statementProperty, statementTarget);
            if ((statementProperty === "get" || statementProperty === "all") && typeof value === "function") {
              return (...args: unknown[]) => {
                downstreamReads[read] += 1;
                return value.apply(statementTarget, args);
              };
            }
            return typeof value === "function" ? value.bind(statementTarget) : value;
          },
        });
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const manifest = approvedRelease("skill").manifest;
  opened.db.prepare("UPDATE agents SET enabled_skills_json=?,always_preloaded_skills_json='[]' WHERE id='agent-a'").run(JSON.stringify(options.legacy ?? []));
  opened.db.exec(`INSERT INTO catalog_sources
    (source_id,display_name,canonical_url,repository_identity,ref,enabled,allow_packages,revision,created_at,updated_at)
    VALUES ('source-team','Team','https://github.com/example/team','["github","example","team"]','main',1,0,1,1,1)`);
  opened.db.prepare(`INSERT INTO catalog_package_releases
    (package_release_id,authority_source_id,content_source_id,kind,name,version,digest,catalog_commit,package_commit,package_path,
     manifest_json,execution_preview_json,warnings_json,created_at) VALUES ('release-skill','source-team','source-team','skill','demo-skill','1.0.0',?,
     'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','skills/demo-skill',?,?,'[]',1)`)
    .run(digest, JSON.stringify(manifest), JSON.stringify({ apiEventShapes: [], runnerScripts: [], wrappedCommands: [], externalSources: [] }));
  opened.db.prepare(`INSERT INTO catalog_release_controls
    (package_release_id,review_state,review_digest,reviewed_by_human_id,reviewed_at,revision,created_at,updated_at)
    VALUES ('release-skill','APPROVED',?,'human-a',1,1,1,1)`).run(digest);
  opened.db.prepare(`INSERT INTO catalog_installations
    (release_id,artifact_digest,artifact_path,state,installed_by_human_id,installed_at,last_verified_at,revision)
    VALUES ('release-skill',?,'/private/release-skill','INSTALLED','human-a',1,1,1)`).run(digest);
  let sequence = 0;
  const audits: CatalogAuditEvent[] = [];
  const boundDeployments: BoundDeploymentCommand[] = [];
  const policy = options.policy ?? {
    decide: input => input.release ? { allow: true } : { allow: false, reasonCode: "NOT_FOUND" },
  } satisfies CatalogPolicy;
  const management = createAgentSkillManagement({
    db: db as typeof opened.db,
    now: () => 1234,
    newId: () => `generated-${++sequence}`,
    requireLiveHuman: () => undefined,
    requireManageableAgent(tx, agentId) {
      return tx.prepare<[string], any>("SELECT id,name,revision,assigned_runner_id,enabled_skills_json,always_preloaded_skills_json FROM agents WHERE id=?").get(agentId)!;
    },
    localSkillExists: () => false,
    validateCatalog(tx, command, actor) {
      if (options.policy) {
        let early: any;
        try { early = options.policy.decide({ action: "SKILL_ASSIGN", actor, agent: { id: command.agentId, name: "agent-a", ownerHumanId: "human-a", assignedRunnerId: "runner-a", revision: 1 } } as any); }
        catch { throw new AgentSkillManagementError("FORBIDDEN"); }
        if (!early || early.allow !== true) throw new AgentSkillManagementError("FORBIDDEN");
      }
      const release = tx.prepare<[string], { digest: string; installation_digest: string | null; installation_state: string }>("SELECT r.digest,i.artifact_digest AS installation_digest,i.state AS installation_state FROM catalog_package_releases r LEFT JOIN catalog_installations i ON i.release_id=r.package_release_id WHERE r.package_release_id=?").get(command.packageReleaseId);
      if (!release || release.installation_state !== "INSTALLED" || release.installation_digest !== release.digest) throw new AgentSkillManagementError("INSTALLATION_REQUIRED");
      const decision = policy.decide({ action: "SKILL_ASSIGN", actor, release: { packageReleaseId: command.packageReleaseId, name: "demo-skill", version: "1.0.0", digest: release.digest, kind: "skill" } as any, agent: { id: command.agentId, name: "agent-a", ownerHumanId: "human-a", assignedRunnerId: "runner-a", revision: 1 } });
      if (!decision || decision.allow !== true) throw new AgentSkillManagementError((decision as any)?.reasonCode ?? "FORBIDDEN");
      const currentAgent = tx.prepare<[string], { assigned_runner_id: string | null; enabled_skills_json: string }>("SELECT assigned_runner_id,enabled_skills_json FROM agents WHERE id=?").get(command.agentId);
      if (JSON.parse(currentAgent?.enabled_skills_json ?? "[]").includes("demo-skill")) throw new AgentSkillManagementError("STATE_CONFLICT");
      if (!currentAgent?.assigned_runner_id) throw new AgentSkillManagementError("STATE_CONFLICT");
      const grant = actor.kind === "AUTHENTICATED_HUMAN" ? tx.prepare<[string, string], { grant_id: string }>("SELECT grant_id FROM catalog_grants WHERE release_id=? AND human_id=? AND revoked_at IS NULL LIMIT 1").get(command.packageReleaseId, actor.id) : undefined;
      return { localSkillName: "demo-skill", runnerId: currentAgent.assigned_runner_id, actorKind: actor.kind === "HUMAN_ADMIN" ? "ADMIN" : "GRANT", grantId: grant?.grant_id ?? null };
    },
    enqueueCompleteGeneration(tx, agentId, generation, assignments) {
      if (options.failEnqueue) throw new Error("private adapter failure");
      if (!assignments.length) return generation;
      const deploymentId = `deployment-${generation}`;
      tx.prepare(`INSERT INTO runner_package_deployments (deployment_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,revision,created_at,updated_at) VALUES (?,?,?,?,?,'QUEUED',1,?,?)`).run(deploymentId, agentId, assignments[0]!.packageReleaseId, "runner-a", generation, 1234, 1234);
      return deploymentId;
    },
    enqueueLegacyGeneration(tx, agentId, generation, assignments) {
      if (options.failEnqueue) throw new Error("private adapter failure");
      if (!assignments.length) return generation;
      const deploymentId = `deployment-${generation}`;
      tx.prepare(`INSERT INTO runner_package_deployments (deployment_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,revision,created_at,updated_at) VALUES (?,?,?,?,?,'QUEUED',1,?,?)`).run(deploymentId, agentId, assignments[0]!.packageReleaseId, "runner-a", generation, 1234, 1234);
      return deploymentId;
    },
    writeAudit(tx, event) {
      if (options.failAudit) throw new Error("private audit failure");
      audits.push(event as CatalogAuditEvent);
      tx.prepare(`INSERT INTO events (id,type,payload_json,source,channel_id,parent_event_id,deliver_at,status,fail_count,last_error,idempotency_key,created_at) VALUES (?,?,?,?,NULL,NULL,NULL,'DELIVERED',0,NULL,NULL,?)`).run(`audit-${sequence}`, (event as any).type, JSON.stringify((event as any).payload), "system", 1234);
    },
  });
  const service = createCatalogConsumption({
    db: db as typeof opened.db,
    policy,
    enqueueBoundDeployment: (_tx, command) => { boundDeployments.push(command); },
    writeAudit: (_tx, event) => { audits.push(event); },
    management,
  });
  const command = (expectedAssignmentRevision = 0, preload = false) => ({
    kind: "assignment.enable" as const, agentId: "agent-a", releaseId: "release-skill",
    expectedAgentRevision: 1, expectedAssignmentRevision, preload,
  });
  return { ...opened, service, command, audits, downstreamReads };
}

describe("createCatalogConsumption", () => {
  it.each([
    ["throws", (): never => { throw new Error("policy adapter failure"); }],
    ["returns null", (): null => null],
    ["returns undefined", (): undefined => undefined],
    ["returns a malformed object", (): object => ({ allow: false, reasonCode: "NOT_FOUND", unexpected: true })],
  ] as const)("fails fixed FORBIDDEN before downstream reads or writes when policy preflight %s", async (_name, decide) => {
    const fixture = serviceFixture({ policy: { decide } as unknown as CatalogPolicy });
    try {
      await expect(fixture.service.assignSkill(fixture.command(), adminActor()))
        .rejects.toEqual(new CatalogConsumptionError("FORBIDDEN"));
      expect(fixture.downstreamReads).toEqual({ release: 0, grant: 0 });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agent_skill_assignments").get()).toEqual({ count: 0 });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM runner_package_deployments").get()).toEqual({ count: 0 });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM events").get()).toEqual({ count: 0 });
      expect(fixture.audits).toEqual([]);
    } finally { fixture.close(); }
  });

  it("pins exact installed identity and admin provenance with one transactional audit", async () => {
    const fixture = serviceFixture();
    try {
      const result = await fixture.service.assignSkill(fixture.command(0, true), adminActor());
      expect(result).toEqual({ assignmentId: "generated-1", desiredState: "ENABLED", effectiveState: "DISABLED",
        deploymentState: "REQUESTED", activeGeneration: null, desiredGeneration: "generated-2", revision: 1 });
      expect(fixture.db.prepare(`SELECT a.release_id,a.local_skill_name,a.preload,a.effective_preload,a.actor_kind,a.actor_human_id,a.grant_id,
        d.bound_runner_id,d.desired_generation FROM agent_skill_assignments a JOIN runner_package_deployments d
        ON d.target_agent_id=a.agent_id AND d.desired_generation=a.desired_generation`).get()).toEqual({
        release_id: "release-skill", local_skill_name: "demo-skill", preload: 1, effective_preload: 0,
        actor_kind: "ADMIN", actor_human_id: "human-a", grant_id: null, bound_runner_id: "runner-a", desired_generation: "generated-2",
      });
      expect(fixture.audits).toHaveLength(1);
      expect(fixture.db.prepare("SELECT count(*) AS count FROM event_receipts").get()).toEqual({ count: 0 });
    } finally { fixture.close(); }
  });

  it("retains effective state, generation and preload while disable is requested", async () => {
    const fixture = serviceFixture();
    try {
      fixture.db.prepare(`INSERT INTO agent_skill_assignments
        (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,
         active_generation,desired_generation,revision,actor_kind,actor_human_id,grant_id,created_at,updated_at)
        VALUES ('assignment-a','agent-a','release-skill','demo-skill','ENABLED','ENABLED','STABLE',1,1,'active-1','active-1',1,'ADMIN','human-a',NULL,1,1)`).run();
      const result = await fixture.service.assignSkill({ ...fixture.command(1, false), kind: "assignment.disable" }, adminActor());
      expect(result).toMatchObject({ desiredState: "DISABLED", effectiveState: "ENABLED", activeGeneration: "active-1", revision: 2 });
      expect(fixture.db.prepare("SELECT desired_state,effective_state,preload,effective_preload,active_generation,deployment_state FROM agent_skill_assignments").get())
        .toEqual({ desired_state: "DISABLED", effective_state: "ENABLED", preload: 0, effective_preload: 1,
          active_generation: "active-1", deployment_state: "REQUESTED" });
      expect(projectEffectiveAgentSkills(fixture.db, { id: "agent-a", enabled_skills_json: "[]", always_preloaded_skills_json: "[]" }))
        .toEqual({ enabledSkills: ["demo-skill"], alwaysPreloadedSkills: ["demo-skill"] });
    } finally { fixture.close(); }
  });

  it("records exact human grant provenance and preserves it after revocation", async () => {
    const fixture = serviceFixture();
    try {
      fixture.db.exec(`INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at)
        VALUES ('human-b','human-b','fixture',0,0,1,1)`);
      const humanGrant = catalogGrantId("release-skill", "HUMAN", "human-b");
      const organizationGrant = catalogGrantId("release-skill", "ORGANIZATION");
      fixture.db.prepare(`INSERT INTO catalog_grants
        (grant_id,release_id,subject_type,human_id,revision,created_by_human_id,created_at,updated_at) VALUES
        (?, 'release-skill','HUMAN','human-b',1,'human-a',1,1),
        (?, 'release-skill','ORGANIZATION',NULL,1,'human-a',1,1)`).run(humanGrant, organizationGrant);
      await fixture.service.assignSkill(fixture.command(), humanActor("human-b"));
      expect(fixture.db.prepare("SELECT actor_kind,actor_human_id,grant_id FROM agent_skill_assignments").get())
        .toEqual({ actor_kind: "GRANT", actor_human_id: "human-b", grant_id: humanGrant });
      fixture.db.prepare("UPDATE catalog_grants SET revoked_at=2 WHERE grant_id=?").run(humanGrant);
      expect(fixture.db.prepare("SELECT actor_kind,grant_id FROM agent_skill_assignments").get())
        .toEqual({ actor_kind: "GRANT", grant_id: humanGrant });
    } finally { fixture.close(); }
  });

  it("rejects stale revisions, missing runners, overflow and legacy collisions", async () => {
    const stale = serviceFixture();
    try { await expect(stale.service.assignSkill({ ...stale.command(), expectedAgentRevision: 2 }, adminActor())).rejects.toMatchObject({ code: "REVISION_CONFLICT" }); }
    finally { stale.close(); }
    const missingRunner = serviceFixture();
    try {
      missingRunner.db.prepare("UPDATE agents SET assigned_runner_id=NULL WHERE id='agent-a'").run();
      await expect(missingRunner.service.assignSkill(missingRunner.command(), adminActor())).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    } finally { missingRunner.close(); }
    const collision = serviceFixture({ legacy: ["demo-skill"] });
    try { await expect(collision.service.assignSkill(collision.command(), adminActor())).rejects.toMatchObject({ code: "STATE_CONFLICT" }); }
    finally { collision.close(); }
    const overflow = serviceFixture();
    try {
      overflow.db.prepare(`INSERT INTO agent_skill_assignments
        (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,
         active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
        VALUES ('a','agent-a','release-skill','demo-skill','DISABLED','DISABLED','FAILED',0,0,NULL,'old',2147483647,'ADMIN','human-a',1,1)`).run();
      await expect(overflow.service.assignSkill(overflow.command(2147483647), adminActor())).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    } finally { overflow.close(); }
  });

  it.each(["enqueue", "audit"] as const)("rolls back all durable effects when %s fails", async seam => {
    const fixture = serviceFixture({ failEnqueue: seam === "enqueue", failAudit: seam === "audit" });
    try {
      await expect(fixture.service.assignSkill(fixture.command(), adminActor())).rejects.toEqual(new CatalogConsumptionError("STORAGE_FAILURE"));
      expect(fixture.db.prepare("SELECT count(*) AS count FROM agent_skill_assignments").get()).toEqual({ count: 0 });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM runner_package_deployments").get()).toEqual({ count: 0 });
      expect(fixture.db.prepare("SELECT count(*) AS count FROM events").get()).toEqual({ count: 0 });
    } finally { fixture.close(); }
  });

  it("rejects malformed current rows before assignment mutation", async () => {
    const fixture = serviceFixture();
    try {
      fixture.db.prepare(`INSERT INTO agent_skill_assignments
        (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,
         active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
        VALUES ('a','agent-a','release-skill','demo-skill','ENABLED','ENABLED','REQUESTED',0,0,NULL,'next',1,'ADMIN','human-a',1,1)`).run();
      await expect(fixture.service.assignSkill(fixture.command(1), adminActor())).rejects.toEqual(new CatalogConsumptionError("STATE_CONFLICT"));
      expect(fixture.db.prepare("SELECT revision,desired_generation FROM agent_skill_assignments").get())
        .toEqual({ revision: 1, desired_generation: "next" });
    } finally { fixture.close(); }
  });

  it.each([
    ["malformed disabled local name", [normalizedRow({ local_skill_name: "", desired_state: "DISABLED" })]],
    ["duplicate disabled local names", [normalizedRow({ assignment_id: "a", local_skill_name: "duplicate", desired_state: "DISABLED" }),
      normalizedRow({ assignment_id: "b", release_id: "release-other", local_skill_name: "duplicate", desired_state: "DISABLED" })]],
    ["enabled state without an active generation", [normalizedRow({ effective_state: "ENABLED", active_generation: null })]],
    ["invalid provenance", [normalizedRow({ actor_kind: "ADMIN", grant_id: "grant-a" })]],
    ["invalid generation", [normalizedRow({ desired_generation: "" })]],
  ] as const)("rejects %s before deciding effective inclusion", (_name, rows) => {
    expect(() => projectEffectiveAgentSkills(projectionDb([...rows]), {
      id: "agent-a", enabled_skills_json: "[]", always_preloaded_skills_json: "[]",
    })).toThrowError(new CatalogConsumptionError("STATE_CONFLICT"));
  });

  it.each(["REQUESTED", "FAILED"] as const)("preserves valid %s disable projections with the old effective generation", deploymentState => {
    const row = normalizedRow({ desired_state: "DISABLED", effective_state: "ENABLED", deployment_state: deploymentState,
      preload: 0, effective_preload: 1, active_generation: "active-old", desired_generation: "desired-new" });
    expect(projectEffectiveAgentSkills(projectionDb([row]), {
      id: "agent-a", enabled_skills_json: "[]", always_preloaded_skills_json: "[]",
    })).toEqual({ enabledSkills: ["demo-skill"], alwaysPreloadedSkills: ["demo-skill"] });
  });

  it("rejects STABLE rows whose effective state, generation or preload differ from desired", () => {
    for (const row of [
      normalizedRow({ deployment_state: "STABLE", desired_state: "ENABLED", effective_state: "DISABLED", active_generation: "next-generation" }),
      normalizedRow({ deployment_state: "STABLE", effective_state: "ENABLED", active_generation: "old-generation" }),
      normalizedRow({ deployment_state: "STABLE", desired_state: "ENABLED", effective_state: "ENABLED", active_generation: "next-generation", preload: 1, effective_preload: 0 }),
    ]) {
      expect(() => projectEffectiveAgentSkills(projectionDb([row]), {
        id: "agent-a", enabled_skills_json: "[]", always_preloaded_skills_json: "[]",
      })).toThrowError(new CatalogConsumptionError("STATE_CONFLICT"));
    }
  });

  it("projects only effective names and preload and rejects ambiguity", () => {
    const fixture = serviceFixture();
    try {
      fixture.db.prepare(`INSERT INTO agent_skill_assignments
        (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,
         active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
        VALUES ('a','agent-a','release-skill','demo-skill','ENABLED','DISABLED','REQUESTED',1,0,NULL,'requested',1,'ADMIN','human-a',1,1)`).run();
      expect(projectEffectiveAgentSkills(fixture.db, { id: "agent-a", enabled_skills_json: '["legacy"]', always_preloaded_skills_json: '["legacy"]' }))
        .toEqual({ enabledSkills: ["legacy"], alwaysPreloadedSkills: ["legacy"] });
      fixture.db.prepare("UPDATE agent_skill_assignments SET effective_state='ENABLED',effective_preload=1,active_generation='active'").run();
      expect(projectEffectiveAgentSkills(fixture.db, { id: "agent-a", enabled_skills_json: '["legacy"]', always_preloaded_skills_json: '["legacy"]' }))
        .toEqual({ enabledSkills: ["demo-skill", "legacy"], alwaysPreloadedSkills: ["demo-skill", "legacy"] });
      expect(() => projectEffectiveAgentSkills(fixture.db, { id: "agent-a", enabled_skills_json: '["demo-skill"]', always_preloaded_skills_json: "[]" }))
        .toThrowError(CatalogConsumptionError);
    } finally { fixture.close(); }
  });
});
