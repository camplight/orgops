import { describe, expect, it } from "vitest";
import { migrate, openDb } from "@orgops/db";
import { catalogDesiredSetChanged, createAgentSkillManagement } from "./management";
import { SkillCommandSchema } from "@orgops/schemas";

function dbFixture() {
  const db = openDb(":memory:"); migrate(db);
  db.exec(`INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('human-1','admin','x',0,1,1,1);
    INSERT INTO agents (id,name,model_id,soul_path,workspace_path,enabled_skills_json,always_preloaded_skills_json,revision,created_at,updated_at) VALUES ('agent-1','agent-1','model','soul','/workspace','[]','[]',4,1,1);`);
  return db;
}
const actor = { kind: "HUMAN_ADMIN" as const, id: "human-1" };

describe("agent skill management", () => {
  it("compares exact order-independent catalog desired sets", () => {
    const before = [
      { packageReleaseId: "release-b", desired: "DISABLED" as const, preload: true },
      { packageReleaseId: "release-a", desired: "ENABLED" as const, preload: false },
    ];
    expect(catalogDesiredSetChanged(before, [...before].reverse())).toBe(false);
    expect(catalogDesiredSetChanged(before, [{ ...before[0]!, packageReleaseId: "release-c" }, before[1]!])).toBe(true);
    expect(catalogDesiredSetChanged(before, [{ ...before[0]!, desired: "ENABLED" }, before[1]!])).toBe(true);
    expect(catalogDesiredSetChanged(before, [{ ...before[0]!, preload: false }, before[1]!])).toBe(true);
  });

  it("rejects unknown mutation fields", () => {
    expect(SkillCommandSchema.safeParse({
      kind: "LOCAL", operation: "ADD", agentId: "agent-1", name: "local-tool", preload: true,
      expectedAgentRevision: 4, unexpected: true,
    }).success).toBe(false);
  });

  it("updates local JSON and advances one agent revision", async () => {
    const db = dbFixture();
    const management = createAgentSkillManagement({ db, localSkillExists: (_tx, name) => name === "local-tool" });
    const result = await management.execute({ kind: "LOCAL", operation: "ADD", agentId: "agent-1", name: "local-tool", preload: true, expectedAgentRevision: 4 }, actor);
    expect(result).toMatchObject({ ref: { kind: "LOCAL", name: "local-tool" }, desired: "ENABLED", effective: "ENABLED", preload: true, deployment: "STABLE" });
    expect(db.prepare("SELECT enabled_skills_json,always_preloaded_skills_json,revision FROM agents WHERE id='agent-1'").get()).toEqual({ enabled_skills_json: '["local-tool"]', always_preloaded_skills_json: '["local-tool"]', revision: 5 });
    db.close();
  });

  it("returns true and persists local SET_PRELOAD(true)", async () => {
    const db = dbFixture();
    db.prepare("UPDATE agents SET enabled_skills_json='[\"local-tool\"]' WHERE id='agent-1'").run();
    const management = createAgentSkillManagement({ db, localSkillExists: (_tx, name) => name === "local-tool" });
    const result = await management.execute({ kind: "LOCAL", operation: "SET_PRELOAD", agentId: "agent-1", name: "local-tool", preload: true, expectedAgentRevision: 4 }, actor);
    expect(result.preload).toBe(true);
    expect(db.prepare("SELECT always_preloaded_skills_json FROM agents WHERE id='agent-1'").get()).toEqual({ always_preloaded_skills_json: '["local-tool"]' });
    db.close();
  });

  it("exposes a legacy catalog adapter without advancing the legacy agent revision", () => {
    const db = dbFixture();
    const management = createAgentSkillManagement({ db });
    expect(management.executeLegacyCatalog).toBeTypeOf("function");
    db.close();
  });

  it("writes exact per-ref operations for local batch diffs", async () => {
    const db = dbFixture();
    db.prepare("UPDATE agents SET enabled_skills_json='[\"removed\",\"retained\"]',always_preloaded_skills_json='[]' WHERE id='agent-1'").run();
    const audits: any[] = [];
    const management = createAgentSkillManagement({ db, localSkillExists: () => true, writeAudit: (_tx, event) => audits.push(event) });
    await management.updateLocalBatch({ agentId: "agent-1", enabled: ["retained", "added"], preloaded: ["retained"], expectedAgentRevision: 4 }, actor);
    expect(audits.map(event => [event.payload.ref.name, event.payload.operation])).toEqual([
      ["removed", "REMOVE"],
      ["retained", "SET_PRELOAD"],
      ["added", "ADD"],
    ]);
    db.close();
  });

  it("resurrects a removed catalog tombstone with expected assignment revision zero", async () => {
    const db = dbFixture();
    db.prepare("INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-1','Runner','{}',1,1,1)").run();
    db.prepare("UPDATE agents SET assigned_runner_id='runner-1' WHERE id='agent-1'").run();
    db.exec("PRAGMA foreign_keys=OFF");
    db.prepare(`INSERT INTO agent_skill_assignments (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
      VALUES ('assignment-1','agent-1','release-1','catalog-tool','ENABLED','ENABLED','STABLE',0,0,'generation-1','generation-1',3,'ADMIN','human-1',1,1)`).run();
    db.exec("PRAGMA foreign_keys=ON");
    const management = createAgentSkillManagement({ db, newId: (() => { let id = 0; return () => `generation-${++id + 1}`; })(), validateCatalog: () => ({ localSkillName: "catalog-tool", runnerId: "runner-1" }) });
    await management.execute({ kind: "CATALOG", operation: "REMOVE", agentId: "agent-1", packageReleaseId: "release-1", expectedAgentRevision: 4, expectedAssignmentRevision: 3 }, actor);
    const resurrected = await management.execute({ kind: "CATALOG", operation: "ASSIGN", agentId: "agent-1", packageReleaseId: "release-1", preload: false, expectedAgentRevision: 5, expectedAssignmentRevision: 0 }, actor);
    expect(resurrected).toMatchObject({ desired: "ENABLED", deployment: "REQUESTED", revision: 5 });
    expect(db.prepare("SELECT removal_requested,revision FROM agent_skill_assignments WHERE assignment_id='assignment-1'").get()).toEqual({ removal_requested: 0, revision: 5 });
    db.close();
  });

  it("reads bounded typed history from payload_json", () => {
    const db = dbFixture();
    db.prepare("INSERT INTO events (id,type,payload_json,source,channel_id,status,created_at) VALUES (?,?,?,?,?,?,?)").run(
      "event-1", "audit.skill.changed", JSON.stringify({ actorKind: "HUMAN_ADMIN", actorId: "human-1", agentId: "agent-1", ref: { kind: "LOCAL", name: "local-tool", localOrigin: "BUILT_IN" }, operation: "ADD", revision: 5, outcome: "SUCCEEDED" }), "system", null, "DELIVERED", 5,
    );
    const management = createAgentSkillManagement({ db });
    expect(management.history("agent-1", { kind: "LOCAL", name: "local-tool", localOrigin: "BUILT_IN" }, actor)).toEqual([expect.objectContaining({ eventId: "event-1", operation: "ADD" })]);
    db.close();
  });

  it("keeps catalog history generations bound to each immutable command snapshot", () => {
    const db = dbFixture();
    db.exec(`PRAGMA foreign_keys=OFF;
      INSERT INTO runner_nodes (id,display_name,metadata_json,created_at,updated_at,last_seen_at) VALUES ('runner-1','Runner','{}',1,1,1);
      UPDATE agents SET assigned_runner_id='runner-1' WHERE id='agent-1';
      INSERT INTO agent_skill_assignments (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,created_at,updated_at)
      VALUES ('assignment-1','agent-1','release-1','catalog-tool','ENABLED','ENABLED','STABLE',0,0,'generation-2','generation-2',3,'ADMIN','human-1',1,1);
      INSERT INTO runner_package_deployments (deployment_id,target_agent_id,release_id,bound_runner_id,desired_generation,state,attempt_token,lease_expires_at,revision,failure_code,created_at,updated_at,completed_at)
      VALUES ('deployment-1','agent-1','release-1','runner-1','generation-1','FAILED','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',100,3,'STORAGE_FAILURE',1,2,2),
             ('deployment-2','agent-1','release-1','runner-1','generation-2','ACTIVE','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',100,3,NULL,3,4,4);
      PRAGMA foreign_keys=ON;`);
    const payload = (values: Record<string, unknown>) => ({ actorKind: "HUMAN_ADMIN", actorId: "human-1", agentId: "agent-1", releaseId: "release-1", operation: "ENABLE", outcome: "SUCCEEDED", revision: 2, state: "REQUESTED", failureCode: null, ...values });
    db.prepare("INSERT INTO events (id,type,payload_json,source,channel_id,status,created_at) VALUES (?,?,?,?,?,?,?)").run(
      "event-1", "audit.catalog.assignment.changed", JSON.stringify(payload({ deploymentId: "deployment-1", desiredGeneration: "generation-1", effectiveGeneration: "generation-0" })), "system", null, "DELIVERED", 1,
    );
    db.prepare("INSERT INTO events (id,type,payload_json,source,channel_id,status,created_at) VALUES (?,?,?,?,?,?,?)").run(
      "event-2", "audit.catalog.assignment.changed", JSON.stringify(payload({ deploymentId: "deployment-2", desiredGeneration: "generation-2", effectiveGeneration: "generation-0", revision: 3 })), "system", null, "DELIVERED", 3,
    );
    const management = createAgentSkillManagement({ db });
    expect(management.history("agent-1", { kind: "CATALOG", packageReleaseId: "release-1" }, actor)).toEqual([
      { eventId: "event-2", operation: "ENABLE", state: "STABLE", desiredGeneration: "generation-2", effectiveGeneration: "generation-2", failureCode: null, revision: 3, createdAt: 3 },
      { eventId: "event-1", operation: "ENABLE", state: "FAILED", desiredGeneration: "generation-1", effectiveGeneration: "generation-0", failureCode: "STORAGE_FAILURE", revision: 2, createdAt: 1 },
    ]);
    db.close();
  });
});
