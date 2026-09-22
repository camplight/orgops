import { describe, expect, it, vi } from "vitest";
import { openDb, migrate } from "@orgops/db";
import { OpaqueSecretReferenceSchema, ProvisionAgentSchema, type AgentCreation } from "@orgops/schemas";
import { createAgentProvisioning, createSecretReferenceResolver } from "./provisioning";

const adminActor = { kind: "HUMAN_ADMIN" as const, id: "human-a" };
const blank = () => ({ kind: "BLANK" as const, idempotencyKey: "00000000-0000-4000-8000-000000000001", name: "agent-a", visibility: "PRIVATE" as const, mode: "CLASSIC" as const, modelId: "model-a", workspacePath: "workspace/agent-a", runnerId: "runner-a", desiredState: "STOPPED" as const, localSkills: [], catalogSkills: [] });

describe("atomic agent provisioning", () => {
  it("exposes strict flat HTTP input and a domain translation seam", () => {
    expect(ProvisionAgentSchema.safeParse({ ...blank(), idempotencyKey: "00000000-0000-4000-8000-000000000001" }).success).toBe(true);
    const withoutKey = { ...blank() }; delete (withoutKey as { idempotencyKey?: string }).idempotencyKey;
    expect(ProvisionAgentSchema.safeParse(withoutKey).success).toBe(false);
    expect(OpaqueSecretReferenceSchema.safeParse("a".repeat(2048)).success).toBe(true);
    expect(OpaqueSecretReferenceSchema.safeParse("a".repeat(2049)).success).toBe(false);
    const provisioning = createAgentProvisioning({ db: openDb(":memory:"), requireLiveHuman: () => undefined });
    const handle = "opaque-handle";
    const command = provisioning.toAgentCreation({ kind: "TEMPLATE", idempotencyKey: "00000000-0000-4000-8000-000000000002", name: "agent-a", visibility: "PRIVATE", modelId: "model-a", workspacePath: "workspace/agent-a", runnerId: "runner-a", packageReleaseId: "release-a", secretBindings: [{ requirementName: "API_KEY", secretReferenceId: handle }], localSkills: [], catalogSkills: [] }, adminActor);
    expect(command.kind).toBe("TEMPLATE");
    if (command.kind === "TEMPLATE") expect(command.secretBindings).toEqual([{ requirementName: "API_KEY", secretReferenceId: handle }]);
  });

  it("issues actor-bound handles that expire without exposing the secret id", () => {
    let now = 1_000;
    const resolver = createSecretReferenceResolver({ key: Buffer.alloc(32, 7), now: () => now });
    const handle = resolver.issue(adminActor, "secret-1");
    expect(Buffer.byteLength(handle)).toBeLessThanOrEqual(2048);
    expect(resolver.validate(adminActor, handle)).toBe("VALID");
    expect(resolver.validate({ kind: "AUTHENTICATED_HUMAN", id: "human-b" }, handle)).toBe("INVALID");
    expect(handle).not.toContain("secret-1");
    now += 10 * 60 * 1000;
    expect(resolver.validate(adminActor, handle)).toBe("INVALID");
  });

  it("preserves reviewed mandatory template preloads over submitted false", async () => {
    const db = openDb(":memory:"); migrate(db);
    const scoped = { recheck: vi.fn(), applyAll: vi.fn(() => ({ agentRevision: 2, catalogSetChanged: true, deploymentId: "deployment-a", results: [] })) };
    const management = { inTransaction: vi.fn(() => scoped) } as any;
    db.exec("INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('human-a','admin','x',0,1,1,1)");
    const provisioning = createAgentProvisioning({ db, management, requireLiveHuman: () => undefined, resolvePortableConfig: () => ({ mode: "RLM_REPL", skillPreloads: ["dep-skill"] }), resolveSkillRefs: () => [{ kind: "CATALOG", packageReleaseId: "release-dep", name: "dep-skill", version: "1.0.0", digest: `sha256:${"0".repeat(64)}` }] });
    const command = provisioning.toAgentCreation({ kind: "TEMPLATE", name: "preloaded", visibility: "PRIVATE", runnerId: "runner-a", workspacePath: "workspace/preloaded", modelId: "model-a", packageReleaseId: "release-root", localSkills: [], catalogSkills: [{ packageReleaseId: "release-dep", preload: false }], secretBindings: [] }, adminActor);
    await provisioning.create(command, adminActor);
    expect(management.inTransaction.mock.calls[0]?.[2]).toEqual([expect.objectContaining({ packageReleaseId: "release-dep", preload: true })]);
    db.close();
  });

  it("returns the stored receipt for an idempotent retry", async () => {
    const db = openDb(":memory:"); migrate(db);
    db.exec("INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('human-a','admin','x',0,1,1,1)");
    const provisioning = createAgentProvisioning({ db, requireLiveHuman: () => undefined });
    const command = provisioning.toAgentCreation(blank(), adminActor);
    const first = await provisioning.create(command, adminActor);
    const second = await provisioning.create(command, adminActor);
    expect(second).toEqual(first);
    expect(db.prepare("SELECT count(*) AS count FROM agents").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT count(*) AS count FROM agent_provision_operations").get()).toEqual({ count: 1 });
    db.close();
  });

  it("serializes concurrent retries to one receipt", async () => {
    const db = openDb(":memory:"); migrate(db);
    db.exec("INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('human-a','admin','x',0,1,1,1)");
    const provisioning = createAgentProvisioning({ db, requireLiveHuman: () => undefined });
    const command = provisioning.toAgentCreation(blank(), adminActor);
    const results = await Promise.all([provisioning.create(command, adminActor), provisioning.create(command, adminActor)]);
    expect(results[0]).toEqual(results[1]);
    expect(db.prepare("SELECT count(*) AS count FROM agents").get()).toEqual({ count: 1 });
    db.close();
  });

  it("rejects reuse of an idempotency key with a different request", async () => {
    const db = openDb(":memory:"); migrate(db);
    db.exec("INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('human-a','admin','x',0,1,1,1)");
    const provisioning = createAgentProvisioning({ db, requireLiveHuman: () => undefined });
    await provisioning.create(provisioning.toAgentCreation(blank(), adminActor), adminActor);
    await expect(provisioning.create(provisioning.toAgentCreation({ ...blank(), name: "different" }, adminActor), adminActor)).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    db.close();
  });

  it("preflights selected skills before the transaction and uses management once", async () => {
    const db = openDb(":memory:"); migrate(db);
    db.exec("INSERT INTO humans (id,username,password_hash,must_change_password,is_admin,created_at,updated_at) VALUES ('human-a','admin','x',0,1,1,1)");
    const scoped = { recheck: vi.fn(), applyAll: vi.fn(() => ({ agentRevision: 2, catalogSetChanged: true, deploymentId: "deployment-a", results: [] })) };
    const management = { inTransaction: vi.fn(() => scoped) } as any;
    const provisioning = createAgentProvisioning({ db, management, requireLiveHuman: () => undefined, recheckCreationPolicy: () => undefined });
    const command = { ...provisioning.toAgentCreation(blank(), adminActor), catalogSkills: [{ packageReleaseId: "release-a", preload: false }] } as AgentCreation;
    await provisioning.create(command, adminActor);
    expect(management.inTransaction).toHaveBeenCalledTimes(1);
    expect(scoped.recheck).toHaveBeenCalledTimes(1);
    expect(scoped.applyAll).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT desired_state,runtime_state FROM agents").get()).toEqual({ desired_state: "STOPPED", runtime_state: "STOPPED" });
    db.close();
  });
});
