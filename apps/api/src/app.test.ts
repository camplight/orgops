import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDrizzleDb, migrate, openDb, schema } from "@orgops/db";
import { createApp } from "./app";

describe("api app", () => {
  it("does not inject admin when any human already exists", async () => {
    const db = openDb(":memory:");
    migrate(db);
    const orm = createDrizzleDb(db);
    const now = Date.now();
    orm
      .insert(schema.humans)
      .values({
        id: randomUUID(),
        username: "existing-user",
        password_hash: "seeded-password-hash",
        must_change_password: 0,
        created_at: now,
        updated_at: now,
        invited_by_human_id: null,
      })
      .run();

    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(401);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("registers runners and filters agents by assigned runner", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const registerRes = await app.request("http://localhost/api/runners/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orgops-runner-token": "test-token",
      },
      body: JSON.stringify({
        displayName: "runner-main",
      }),
    });
    expect(registerRes.status).toBe(201);
    const registerBody = (await registerRes.json()) as {
      runner?: { id?: string };
    };
    const runnerId = registerBody.runner?.id ?? "";
    expect(runnerId.length).toBeGreaterThan(0);

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createAssignedRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "assigned-agent",
        modelId: "openai:gpt-4o-mini",
        workspacePath: ".orgops-data/workspaces/assigned-agent",
        assignedRunnerId: runnerId,
      }),
    });
    expect(createAssignedRes.status).toBe(201);

    const createUnassignedRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "unassigned-agent",
        modelId: "openai:gpt-4o-mini",
        workspacePath: ".orgops-data/workspaces/unassigned-agent",
      }),
    });
    expect(createUnassignedRes.status).toBe(201);

    const listAssignedRes = await app.request(
      `http://localhost/api/agents?assignedRunnerId=${encodeURIComponent(runnerId)}`,
      {
        headers: { "x-orgops-runner-token": "test-token" },
      },
    );
    expect(listAssignedRes.status).toBe(200);
    const assignedList = (await listAssignedRes.json()) as Array<{ name: string }>;
    expect(assignedList.map((agent) => agent.name)).toEqual(["assigned-agent"]);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("persists wrapped agent configuration as editable JSON", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "wrapped-agent",
        mode: "WRAPPED",
        modelId: "wrapped:none",
        memoryContextMode: "PER_CHANNEL_CROSS_CHANNEL",
        allowOutsideWorkspace: true,
        workspacePath: ".orgops-data/workspaces/wrapped-agent",
        wrappedConfig: {
          kind: "openclaw",
          runtime: { command: "openclaw agent --local --json" },
        },
      }),
    });
    expect(createRes.status).toBe(201);

    const getRes = await app.request("http://localhost/api/agents/wrapped-agent", {
      headers: { cookie },
    });
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as {
      mode?: string;
      memoryContextMode?: string;
      allowOutsideWorkspace?: boolean;
      wrappedConfig?: { kind?: string; runtime?: { command?: string } };
    };
    expect(body.mode).toBe("WRAPPED");
    expect(body.memoryContextMode).toBe("OFF");
    expect(body.allowOutsideWorkspace).toBe(false);
    expect(body.wrappedConfig?.kind).toBe("openclaw");

    const patchRes = await app.request("http://localhost/api/agents/wrapped-agent", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        memoryContextMode: "FULL_CHANNEL_EVENTS",
        allowOutsideWorkspace: true,
        wrappedConfig: JSON.stringify({
          kind: "custom",
          runtime: { command: "node ./agent.js" },
        }),
      }),
    });
    expect(patchRes.status).toBe(200);

    const updatedRes = await app.request("http://localhost/api/agents/wrapped-agent", {
      headers: { cookie },
    });
    const updated = (await updatedRes.json()) as {
      memoryContextMode?: string;
      allowOutsideWorkspace?: boolean;
      wrappedConfig?: { kind?: string; runtime?: { command?: string } };
    };
    expect(updated.memoryContextMode).toBe("OFF");
    expect(updated.allowOutsideWorkspace).toBe(false);
    expect(updated.wrappedConfig?.kind).toBe("custom");
    expect(updated.wrappedConfig?.runtime?.command).toBe("node ./agent.js");

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("de-registers runner and clears assigned agents", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const registerRes = await app.request("http://localhost/api/runners/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orgops-runner-token": "test-token",
      },
      body: JSON.stringify({
        displayName: "runner-to-delete",
      }),
    });
    expect(registerRes.status).toBe(201);
    const registerBody = (await registerRes.json()) as {
      runner?: { id?: string };
    };
    const runnerId = registerBody.runner?.id ?? "";
    expect(runnerId.length).toBeGreaterThan(0);

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createAssignedRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "runner-bound-agent",
        modelId: "openai:gpt-4o-mini",
        workspacePath: ".orgops-data/workspaces/runner-bound-agent",
        assignedRunnerId: runnerId,
      }),
    });
    expect(createAssignedRes.status).toBe(201);

    const deregisterRes = await app.request(
      `http://localhost/api/runners/${encodeURIComponent(runnerId)}`,
      {
        method: "DELETE",
        headers: { cookie },
      },
    );
    expect(deregisterRes.status).toBe(200);
    const deregisterBody = (await deregisterRes.json()) as {
      ok?: boolean;
      unassignedAgents?: string[];
    };
    expect(deregisterBody.ok).toBe(true);
    expect(deregisterBody.unassignedAgents ?? []).toContain("runner-bound-agent");

    const runnersListRes = await app.request("http://localhost/api/runners", {
      headers: { cookie },
    });
    expect(runnersListRes.status).toBe(200);
    const runnersList = (await runnersListRes.json()) as Array<{ id: string }>;
    expect(runnersList.map((runner) => runner.id)).not.toContain(runnerId);

    const agentRes = await app.request("http://localhost/api/agents/runner-bound-agent", {
      headers: { cookie },
    });
    expect(agentRes.status).toBe(200);
    const agentBody = (await agentRes.json()) as { assignedRunnerId?: string | null };
    expect(agentBody.assignedRunnerId ?? null).toBeNull();

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns runner setup token only for authenticated humans", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const runnerAccessRes = await app.request("http://localhost/api/runners/setup-config", {
      headers: { "x-orgops-runner-token": "test-token" },
    });
    expect(runnerAccessRes.status).toBe(401);

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const humanAccessRes = await app.request("http://localhost/api/runners/setup-config", {
      headers: { cookie },
    });
    expect(humanAccessRes.status).toBe(200);
    const body = (await humanAccessRes.json()) as {
      runnerToken?: string;
      runnerApiUrl?: string;
    };
    expect(body.runnerToken).toBe("test-token");
    expect(body.runnerApiUrl).toBe("http://localhost:8787");

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("stores and updates agent soul contents in database", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "soul-agent",
        modelId: "openai:gpt-4o-mini",
        workspacePath: ".orgops-data/workspaces/soul-agent",
        allowOutsideWorkspace: true,
        soulContents: "initial soul",
      }),
    });
    expect(createAgentRes.status).toBe(201);

    const patchRes = await app.request(
      "http://localhost/api/agents/soul-agent",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          soulContents: "updated soul from db",
          allowOutsideWorkspace: false,
        }),
      },
    );
    expect(patchRes.status).toBe(200);

    const getRes = await app.request("http://localhost/api/agents/soul-agent", {
      headers: { cookie },
    });
    expect(getRes.status).toBe(200);
    const agent = (await getRes.json()) as {
      soulContents?: string;
      allowOutsideWorkspace?: boolean;
    };
    expect(agent.soulContents).toBe("updated soul from db");
    expect(agent.allowOutsideWorkspace).toBe(false);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("persists always-preloaded skills as a subset of enabled skills", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "skills-agent",
        modelId: "openai:gpt-4o-mini",
        workspacePath: ".orgops-data/workspaces/skills-agent",
        enabledSkills: ["slack"],
        alwaysPreloadedSkills: ["slack", "secrets"],
      }),
    });
    expect(createAgentRes.status).toBe(201);

    const getAgentRes = await app.request(
      "http://localhost/api/agents/skills-agent",
      {
        headers: { cookie },
      },
    );
    expect(getAgentRes.status).toBe(200);
    const createdAgent = (await getAgentRes.json()) as {
      enabledSkills?: string[];
      alwaysPreloadedSkills?: string[];
    };
    expect(createdAgent.enabledSkills).toEqual(["slack"]);
    expect(createdAgent.alwaysPreloadedSkills).toEqual(["slack"]);

    const patchRes = await app.request(
      "http://localhost/api/agents/skills-agent",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          enabledSkills: ["secrets"],
          alwaysPreloadedSkills: ["slack", "secrets"],
        }),
      },
    );
    expect(patchRes.status).toBe(200);

    const patchedRes = await app.request(
      "http://localhost/api/agents/skills-agent",
      {
        headers: { cookie },
      },
    );
    expect(patchedRes.status).toBe(200);
    const patchedAgent = (await patchedRes.json()) as {
      enabledSkills?: string[];
      alwaysPreloadedSkills?: string[];
    };
    expect(patchedAgent.enabledSkills).toEqual(["secrets"]);
    expect(patchedAgent.alwaysPreloadedSkills).toEqual(["secrets"]);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("deletes agents and directly related state", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const orm = createDrizzleDb(db);
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "delete-agent",
        modelId: "openai:gpt-4o-mini",
        workspacePath: ".orgops-data/workspaces/delete-agent",
      }),
    });
    expect(createAgentRes.status).toBe(201);

    const now = Date.now();
    const channelId = randomUUID();
    const eventId = randomUUID();
    const processId = randomUUID();
    const conversationId = randomUUID();
    orm
      .insert(schema.channels)
      .values({
        id: channelId,
        name: "delete-agent-channel",
        description: null,
        metadata_json: null,
        visibility: "PUBLIC",
        owner_human_id: null,
        kind: "GROUP",
        direct_participant_key: null,
        created_at: now,
      })
      .run();
    orm
      .insert(schema.channelSubscriptions)
      .values({
        channel_id: channelId,
        subscriber_type: "AGENT",
        subscriber_id: "delete-agent",
      })
      .run();
    orm
      .insert(schema.events)
      .values({
        id: eventId,
        type: "message.created",
        payload_json: "{}",
        source: "human:admin",
        channel_id: channelId,
        parent_event_id: null,
        deliver_at: null,
        status: "DELIVERED",
        idempotency_key: null,
        created_at: now,
        fail_count: 0,
        last_error: null,
      })
      .run();
    orm
      .insert(schema.eventReceipts)
      .values({
        event_id: eventId,
        agent_name: "delete-agent",
        status: "DELIVERED",
        delivered_at: now,
      })
      .run();
    orm
      .insert(schema.processes)
      .values({
        id: processId,
        agent_name: "delete-agent",
        channel_id: channelId,
        cmd: "echo ok",
        cwd: dataDir,
        pid: null,
        execution_mode: "SYNC",
        state: "EXITED",
        exit_code: 0,
        started_at: now,
        ended_at: now,
      })
      .run();
    orm
      .insert(schema.processOutput)
      .values({
        id: randomUUID(),
        process_id: processId,
        seq: 0,
        stream: "STDOUT",
        text: "ok",
        ts: now,
      })
      .run();
    orm
      .insert(schema.channelMemoryRecent)
      .values({
        agent_name: "delete-agent",
        channel_id: channelId,
        summary_text: "recent",
        window_start_at: now,
        last_processed_at: now,
        last_processed_event_id: eventId,
        version: 1,
        created_at: now,
        updated_at: now,
      })
      .run();
    orm
      .insert(schema.channelMemoryFull)
      .values({
        agent_name: "delete-agent",
        channel_id: channelId,
        summary_text: "full",
        last_processed_at: now,
        last_processed_event_id: eventId,
        version: 1,
        created_at: now,
        updated_at: now,
      })
      .run();
    orm
      .insert(schema.crossChannelMemoryRecent)
      .values({
        agent_name: "delete-agent",
        summary_text: "cross recent",
        window_start_at: now,
        last_processed_at: now,
        last_processed_event_id: eventId,
        version: 1,
        created_at: now,
        updated_at: now,
      })
      .run();
    orm
      .insert(schema.crossChannelMemoryFull)
      .values({
        agent_name: "delete-agent",
        summary_text: "cross full",
        last_processed_at: now,
        last_processed_event_id: eventId,
        version: 1,
        created_at: now,
        updated_at: now,
      })
      .run();
    orm
      .insert(schema.conversations)
      .values({
        id: conversationId,
        kind: "HUMAN_AGENT_DM",
        human_id: "admin",
        agent_name: "delete-agent",
        channel_id: channelId,
        title: null,
        created_at: now,
      })
      .run();
    orm
      .insert(schema.threads)
      .values({
        id: randomUUID(),
        conversation_id: conversationId,
        title: null,
        created_at: now,
      })
      .run();

    const deleteRes = await app.request("http://localhost/api/agents/delete-agent", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleteRes.status).toBe(200);
    const deleteBody = (await deleteRes.json()) as {
      ok?: boolean;
      removedProcessCount?: number;
    };
    expect(deleteBody.ok).toBe(true);
    expect(deleteBody.removedProcessCount).toBe(1);

    const getDeletedRes = await app.request("http://localhost/api/agents/delete-agent", {
      headers: { cookie },
    });
    expect(getDeletedRes.status).toBe(404);
    expect(orm.select().from(schema.events).where(eq(schema.events.id, eventId)).all()).toHaveLength(1);
    expect(
      orm.select().from(schema.eventReceipts).where(eq(schema.eventReceipts.agent_name, "delete-agent")).all(),
    ).toHaveLength(0);
    expect(
      orm
        .select()
        .from(schema.channelSubscriptions)
        .where(eq(schema.channelSubscriptions.subscriber_id, "delete-agent"))
        .all(),
    ).toHaveLength(0);
    expect(orm.select().from(schema.processes).where(eq(schema.processes.agent_name, "delete-agent")).all()).toHaveLength(0);
    expect(orm.select().from(schema.processOutput).where(eq(schema.processOutput.process_id, processId)).all()).toHaveLength(0);
    expect(
      orm.select().from(schema.channelMemoryRecent).where(eq(schema.channelMemoryRecent.agent_name, "delete-agent")).all(),
    ).toHaveLength(0);
    expect(
      orm.select().from(schema.channelMemoryFull).where(eq(schema.channelMemoryFull.agent_name, "delete-agent")).all(),
    ).toHaveLength(0);
    expect(
      orm
        .select()
        .from(schema.crossChannelMemoryRecent)
        .where(eq(schema.crossChannelMemoryRecent.agent_name, "delete-agent"))
        .all(),
    ).toHaveLength(0);
    expect(
      orm
        .select()
        .from(schema.crossChannelMemoryFull)
        .where(eq(schema.crossChannelMemoryFull.agent_name, "delete-agent"))
        .all(),
    ).toHaveLength(0);
    expect(
      orm.select().from(schema.conversations).where(eq(schema.conversations.agent_name, "delete-agent")).all(),
    ).toHaveLength(0);
    expect(
      orm.select().from(schema.threads).where(eq(schema.threads.conversation_id, conversationId)).all(),
    ).toHaveLength(0);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("supports per-agent LLM timeout and classic max model steps overrides", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "tuned-agent",
        modelId: "openai:gpt-4o-mini",
        workspacePath: ".orgops-data/workspaces/tuned-agent",
        llmCallTimeoutMs: 180000,
        classicMaxModelSteps: 250,
        memoryContextMode: "FULL_CHANNEL_EVENTS",
      }),
    });
    expect(createAgentRes.status).toBe(201);

    const getCreatedRes = await app.request(
      "http://localhost/api/agents/tuned-agent",
      {
        headers: { cookie },
      },
    );
    expect(getCreatedRes.status).toBe(200);
    const createdAgent = (await getCreatedRes.json()) as {
      llmCallTimeoutMs?: number | null;
      classicMaxModelSteps?: number | null;
      memoryContextMode?: string;
    };
    expect(createdAgent.llmCallTimeoutMs).toBe(180000);
    expect(createdAgent.classicMaxModelSteps).toBe(250);
    expect(createdAgent.memoryContextMode).toBe("FULL_CHANNEL_EVENTS");

    const patchRes = await app.request(
      "http://localhost/api/agents/tuned-agent",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          llmCallTimeoutMs: null,
          classicMaxModelSteps: null,
          memoryContextMode: "OFF",
        }),
      },
    );
    expect(patchRes.status).toBe(200);

    const getPatchedRes = await app.request(
      "http://localhost/api/agents/tuned-agent",
      {
        headers: { cookie },
      },
    );
    expect(getPatchedRes.status).toBe(200);
    const patchedAgent = (await getPatchedRes.json()) as {
      llmCallTimeoutMs?: number | null;
      classicMaxModelSteps?: number | null;
      memoryContextMode?: string;
    };
    expect(patchedAgent.llmCallTimeoutMs).toBeNull();
    expect(patchedAgent.classicMaxModelSteps).toBeNull();
    expect(patchedAgent.memoryContextMode).toBe("OFF");

    const invalidPatchRes = await app.request(
      "http://localhost/api/agents/tuned-agent",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          llmCallTimeoutMs: 0,
        }),
      },
    );
    expect(invalidPatchRes.status).toBe(400);

    const invalidModePatchRes = await app.request(
      "http://localhost/api/agents/tuned-agent",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          memoryContextMode: "SOMETHING_ELSE",
        }),
      },
    );
    expect(invalidModePatchRes.status).toBe(400);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("authenticates and creates events", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const meRes = await app.request("http://localhost/api/auth/me", {
      headers: { cookie },
    });
    expect(meRes.status).toBe(200);

    const eventRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orgops-runner-token": "test-token",
      },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "hello" },
        source: "test",
        channelId: "test-channel",
      }),
    });
    expect(eventRes.status).toBe(201);
    const firstEvent = (await eventRes.json()) as { id: string };

    const secondEventRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orgops-runner-token": "test-token",
      },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "hello again" },
        source: "test",
        channelId: "test-channel",
      }),
    });
    expect(secondEventRes.status).toBe(201);
    const secondEvent = (await secondEventRes.json()) as { id: string };

    const listRes = await app.request("http://localhost/api/events?limit=10", {
      headers: { "x-orgops-runner-token": "test-token" },
    });
    const list = await listRes.json();
    expect(Array.isArray(list)).toBe(true);

    const descListRes = await app.request(
      "http://localhost/api/events?limit=10&order=desc",
      {
        headers: { "x-orgops-runner-token": "test-token" },
      },
    );
    expect(descListRes.status).toBe(200);
    const descList = (await descListRes.json()) as Array<{ id: string }>;
    expect(descList[0]?.id).toBe(secondEvent.id);
    expect(descList[1]?.id).toBe(firstEvent.id);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("exports filtered events as a SQLite database", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const orm = createDrizzleDb(db);
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const now = Date.now();
    const channelId = randomUUID();
    orm
      .insert(schema.channels)
      .values({
        id: channelId,
        name: "event-export-channel",
        description: null,
        metadata_json: null,
        visibility: "PUBLIC",
        owner_human_id: null,
        kind: "GROUP",
        direct_participant_key: null,
        created_at: now,
      })
      .run();

    for (let index = 0; index < 1005; index += 1) {
      orm
        .insert(schema.events)
        .values({
          id: `export-event-${index}`,
          type: "message.created",
          payload_json: JSON.stringify({ index, text: `event ${index}` }),
          source: "human:admin",
          channel_id: channelId,
          parent_event_id: null,
          deliver_at: null,
          status: "DELIVERED",
          idempotency_key: null,
          created_at: now + index,
          fail_count: 0,
          last_error: null,
        })
        .run();
    }
    orm
      .insert(schema.events)
      .values({
        id: "excluded-audit-event",
        type: "audit.memory.updated",
        payload_json: JSON.stringify({ text: "exclude me" }),
        source: "system",
        channel_id: channelId,
        parent_event_id: null,
        deliver_at: null,
        status: "DELIVERED",
        idempotency_key: null,
        created_at: now + 2000,
        fail_count: 0,
        last_error: null,
      })
      .run();

    const exportRes = await app.request(
      `http://localhost/api/events/export.sqlite?channelId=${encodeURIComponent(channelId)}&excludeTypePrefix=audit.memory.&order=asc`,
      { headers: { cookie } },
    );
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get("content-type")).toContain("application/vnd.sqlite3");
    expect(exportRes.headers.get("content-disposition")).toContain(
      "attachment; filename=\"orgops-events-",
    );

    const exportDir = mkdtempSync(join(tmpdir(), "orgops-events-export-test-"));
    const exportPath = join(exportDir, "events.sqlite");
    writeFileSync(exportPath, Buffer.from(await exportRes.arrayBuffer()));
    const exportDb = openDb(exportPath);
    try {
      const count = exportDb
        .prepare("SELECT COUNT(*) AS count FROM events")
        .get() as { count: number };
      expect(count.count).toBe(1005);

      const excluded = exportDb
        .prepare("SELECT COUNT(*) AS count FROM events WHERE type LIKE 'audit.memory.%'")
        .get() as { count: number };
      expect(excluded.count).toBe(0);

      const channel = exportDb
        .prepare("SELECT name, kind FROM channels WHERE id = ?")
        .get(channelId) as { name: string; kind: string } | undefined;
      expect(channel).toEqual({ name: "event-export-channel", kind: "GROUP" });

      const metadataRows = exportDb
        .prepare("SELECT key, value FROM export_metadata")
        .all() as Array<{ key: string; value: string }>;
      const metadata = Object.fromEntries(
        metadataRows.map((row) => [row.key, row.value]),
      );
      expect(metadata.schema_version).toBe("orgops.event-export.sqlite.v1");
      expect(metadata.event_count).toBe("1005");
      expect(JSON.parse(metadata.filters_json)).toMatchObject({
        channelId,
        excludeTypePrefixes: ["audit.memory."],
        order: "asc",
      });

      const typeCount = exportDb
        .prepare("SELECT count FROM event_type_counts WHERE type = ?")
        .get("message.created") as { count: number } | undefined;
      expect(typeCount?.count).toBe(1005);

      const firstEvent = exportDb
        .prepare("SELECT id, payload_json FROM events ORDER BY created_at ASC LIMIT 1")
        .get() as { id: string; payload_json: string };
      expect(firstEvent.id).toBe("export-event-0");
      expect(JSON.parse(firstEvent.payload_json)).toEqual({
        index: 0,
        text: "event 0",
      });
    } finally {
      exportDb.close();
      rmSync(exportDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("returns schema validation errors for invalid event emit", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const invalidEventRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orgops-runner-token": "test-token",
      },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "" },
        source: "agent:tester",
        channelId: "chan-1",
      }),
    });
    expect(invalidEventRes.status).toBe(400);
    const invalidBody = (await invalidEventRes.json()) as {
      error?: string;
      validation?: { ok: boolean; issues?: Array<{ message?: string }> };
    };
    expect(invalidBody.error).toBe("Event payload validation failed");
    expect(invalidBody.validation?.ok).toBe(false);
    expect((invalidBody.validation?.issues ?? []).length).toBeGreaterThan(0);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("rejects scheduled triggers when target agent is not in channel participants", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createChannelRes = await app.request(
      "http://localhost/api/channels",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "scheduled-membership-guard-channel" }),
      },
    );
    expect(createChannelRes.status).toBe(201);
    const channel = (await createChannelRes.json()) as { id: string };

    const invalidEventRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        type: "agent.scheduled.trigger",
        payload: { text: "run later", targetAgentName: "worker-missing" },
        source: "system:scheduler",
        channelId: channel.id,
        deliverAt: Date.now() + 60_000,
      }),
    });
    expect(invalidEventRes.status).toBe(400);
    const invalidBody = (await invalidEventRes.json()) as { error?: string };
    expect(invalidBody.error).toContain("not an AGENT participant");

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("lists TypeScript event shape definitions from core and skills", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const eventTypesRes = await app.request(
      "http://localhost/api/event-types",
      {
        headers: { "x-orgops-runner-token": "test-token" },
      },
    );
    expect(eventTypesRes.status).toBe(200);
    const body = (await eventTypesRes.json()) as {
      eventTypes: Array<{ type: string; source: string }>;
    };
    expect(
      body.eventTypes.some((entry) => entry.type === "message.created"),
    ).toBe(true);
    expect(
      body.eventTypes.some(
        (entry) =>
          entry.type === "message.created" && entry.source === "skill:slack",
      ),
    ).toBe(true);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("invites humans with temporary passwords and enforces first-login reset", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const adminLoginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(adminLoginRes.status).toBe(200);
    const adminCookie = adminLoginRes.headers.get("set-cookie") ?? "";

    const inviteRes = await app.request("http://localhost/api/humans/invite", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ username: "alice" }),
    });
    expect(inviteRes.status).toBe(201);
    const inviteBody = (await inviteRes.json()) as {
      temporaryPassword: string;
    };
    expect(typeof inviteBody.temporaryPassword).toBe("string");
    expect(inviteBody.temporaryPassword.length).toBeGreaterThanOrEqual(8);

    const humanLoginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "alice",
        password: inviteBody.temporaryPassword,
      }),
    });
    expect(humanLoginRes.status).toBe(200);
    const humanLoginBody = (await humanLoginRes.json()) as {
      mustChangePassword?: boolean;
    };
    expect(humanLoginBody.mustChangePassword).toBe(true);
    const humanCookie = humanLoginRes.headers.get("set-cookie") ?? "";

    const blockedRes = await app.request("http://localhost/api/agents", {
      headers: { cookie: humanCookie },
    });
    expect(blockedRes.status).toBe(403);

    const profileRes = await app.request("http://localhost/api/auth/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: humanCookie },
      body: JSON.stringify({
        username: "alice",
        newPassword: "alice-password-123",
      }),
    });
    expect(profileRes.status).toBe(200);

    const allowedRes = await app.request("http://localhost/api/agents", {
      headers: { cookie: humanCookie },
    });
    expect(allowedRes.status).toBe(200);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("updates agent runtime state on start and stop actions", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "agent-one",
        modelId: "openai:gpt-4o-mini",
        workspacePath: ".orgops-data/workspaces/agent-one",
        soulContents: "",
      }),
    });
    expect(createAgentRes.status).toBe(201);

    const startRes = await app.request(
      "http://localhost/api/agents/agent-one/start",
      {
        method: "POST",
        headers: { cookie },
      },
    );
    expect(startRes.status).toBe(200);

    const afterStartRes = await app.request(
      "http://localhost/api/agents/agent-one",
      {
        headers: { cookie },
      },
    );
    expect(afterStartRes.status).toBe(200);
    const afterStart = await afterStartRes.json();
    expect(afterStart.desiredState).toBe("RUNNING");
    expect(afterStart.runtimeState).toBe("STARTING");

    const stopRes = await app.request(
      "http://localhost/api/agents/agent-one/stop",
      {
        method: "POST",
        headers: { cookie },
      },
    );
    expect(stopRes.status).toBe(200);

    const afterStopRes = await app.request(
      "http://localhost/api/agents/agent-one",
      {
        headers: { cookie },
      },
    );
    expect(afterStopRes.status).toBe(200);
    const afterStop = await afterStopRes.json();
    expect(afterStop.desiredState).toBe("STOPPED");
    expect(afterStop.runtimeState).toBe("STOPPED");

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("does not mark agent events delivered for non-runner requests", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "agent-two",
        modelId: "openai:gpt-4o-mini",
        workspacePath: ".orgops-data/workspaces/agent-two",
        soulContents: "",
      }),
    });
    expect(createAgentRes.status).toBe(201);

    const createChannelRes = await app.request(
      "http://localhost/api/channels",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "agent-two-inbox" }),
      },
    );
    expect(createChannelRes.status).toBe(201);
    const channel = (await createChannelRes.json()) as { id: string };
    const subscribeRes = await app.request(
      `http://localhost/api/channels/${channel.id}/subscribe`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          subscriberType: "AGENT",
          subscriberId: "agent-two",
        }),
      },
    );
    expect(subscribeRes.status).toBe(200);

    const eventRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "hello agent-two" },
        source: "human:admin",
        channelId: channel.id,
      }),
    });
    expect(eventRes.status).toBe(201);
    const event = (await eventRes.json()) as { id: string };

    const uiListRes = await app.request(
      "http://localhost/api/events?agentName=agent-two&status=PENDING&limit=10",
      { headers: { cookie } },
    );
    expect(uiListRes.status).toBe(200);
    const uiList = (await uiListRes.json()) as Array<{
      id: string;
      status: string;
    }>;
    expect(uiList.some((row) => row.id === event.id)).toBe(true);
    expect(uiList.find((row) => row.id === event.id)?.status).toBe("PENDING");

    const runnerListRes = await app.request(
      "http://localhost/api/events?agentName=agent-two&status=PENDING&limit=10",
      { headers: { "x-orgops-runner-token": "test-token" } },
    );
    expect(runnerListRes.status).toBe(200);

    const afterRunnerRes = await app.request(
      "http://localhost/api/events?agentName=agent-two&status=DELIVERED&limit=10",
      { headers: { "x-orgops-runner-token": "test-token" } },
    );
    expect(afterRunnerRes.status).toBe(200);
    const afterRunner = (await afterRunnerRes.json()) as Array<{
      id: string;
      status: string;
    }>;
    expect(afterRunner.some((row) => row.id === event.id)).toBe(true);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("delivers channel events per agent receipt and finalizes after all recipients", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    for (const name of ["agent-a", "agent-b"]) {
      const createAgentRes = await app.request("http://localhost/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name,
          modelId: "openai:gpt-4o-mini",
          workspacePath: `.orgops-data/workspaces/${name}`,
          soulContents: "",
        }),
      });
      expect(createAgentRes.status).toBe(201);
    }

    const createChannelRes = await app.request(
      "http://localhost/api/channels",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "fanout-channel" }),
      },
    );
    expect(createChannelRes.status).toBe(201);
    const channel = (await createChannelRes.json()) as { id: string };

    for (const subscriberId of ["agent-a", "agent-b"]) {
      const subscribeRes = await app.request(
        `http://localhost/api/channels/${channel.id}/subscribe`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ subscriberType: "AGENT", subscriberId }),
        },
      );
      expect(subscribeRes.status).toBe(200);
    }

    const eventRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "fanout test" },
        source: "human:admin",
        channelId: channel.id,
      }),
    });
    expect(eventRes.status).toBe(201);
    const event = (await eventRes.json()) as { id: string };

    const pollAgentARes = await app.request(
      "http://localhost/api/events?agentName=agent-a&status=PENDING&limit=10",
      { headers: { "x-orgops-runner-token": "test-token" } },
    );
    expect(pollAgentARes.status).toBe(200);
    const pollAgentA = (await pollAgentARes.json()) as Array<{ id: string }>;
    expect(pollAgentA.some((row) => row.id === event.id)).toBe(true);

    const afterAgentAStatusRes = await app.request(
      `http://localhost/api/events?channelId=${channel.id}&limit=10`,
      { headers: { cookie } },
    );
    expect(afterAgentAStatusRes.status).toBe(200);
    const afterAgentAStatus = (await afterAgentAStatusRes.json()) as Array<{
      id: string;
      status: string;
    }>;
    expect(afterAgentAStatus.find((row) => row.id === event.id)?.status).toBe(
      "PENDING",
    );

    const pollAgentBRes = await app.request(
      "http://localhost/api/events?agentName=agent-b&status=PENDING&limit=10",
      { headers: { "x-orgops-runner-token": "test-token" } },
    );
    expect(pollAgentBRes.status).toBe(200);
    const pollAgentB = (await pollAgentBRes.json()) as Array<{ id: string }>;
    expect(pollAgentB.some((row) => row.id === event.id)).toBe(true);

    const afterAgentBStatusRes = await app.request(
      `http://localhost/api/events?channelId=${channel.id}&status=DELIVERED&limit=10`,
      { headers: { cookie } },
    );
    expect(afterAgentBStatusRes.status).toBe(200);
    const afterAgentBStatus = (await afterAgentBStatusRes.json()) as Array<{
      id: string;
      status: string;
    }>;
    expect(afterAgentBStatus.some((row) => row.id === event.id)).toBe(true);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("deletes teams and removes related memberships", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createTeamRes = await app.request("http://localhost/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Team Alpha" }),
    });
    expect(createTeamRes.status).toBe(201);
    const createTeamBody = (await createTeamRes.json()) as { id: string };

    const addMemberRes = await app.request(
      `http://localhost/api/teams/${createTeamBody.id}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ memberType: "AGENT", memberId: "agent-one" }),
      },
    );
    expect(addMemberRes.status).toBe(200);

    const deleteRes = await app.request(
      `http://localhost/api/teams/${createTeamBody.id}`,
      {
        method: "DELETE",
        headers: { cookie },
      },
    );
    expect(deleteRes.status).toBe(200);

    const teamsRes = await app.request("http://localhost/api/teams", {
      headers: { cookie },
    });
    const teams = (await teamsRes.json()) as Array<{ id: string }>;
    expect(teams.some((team) => team.id === createTeamBody.id)).toBe(false);

    const membersRes = await app.request(
      `http://localhost/api/teams/${createTeamBody.id}/members`,
      {
        headers: { cookie },
      },
    );
    const members = await membersRes.json();
    expect(members).toEqual([]);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("rejects TEAM channel subscriptions", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createChannelRes = await app.request(
      "http://localhost/api/channels",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "team-targeted-channel" }),
      },
    );
    expect(createChannelRes.status).toBe(201);
    const createChannelBody = (await createChannelRes.json()) as { id: string };

    const subscribeRes = await app.request(
      `http://localhost/api/channels/${createChannelBody.id}/subscribe`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          subscriberType: "TEAM",
          subscriberId: "team-1",
        }),
      },
    );
    expect(subscribeRes.status).toBe(400);

    const participantsRes = await app.request(
      `http://localhost/api/channels/${createChannelBody.id}/participants`,
      {
        headers: { cookie },
      },
    );
    const participants = await participantsRes.json();
    expect(participants).toEqual([]);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("deletes teams through POST action endpoint", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createTeamRes = await app.request("http://localhost/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Team Beta" }),
    });
    expect(createTeamRes.status).toBe(201);
    const createTeamBody = (await createTeamRes.json()) as { id: string };

    const deleteRes = await app.request(
      `http://localhost/api/teams/${createTeamBody.id}/delete`,
      {
        method: "POST",
        headers: { cookie },
      },
    );
    expect(deleteRes.status).toBe(200);

    const teamsRes = await app.request("http://localhost/api/teams", {
      headers: { cookie },
    });
    const teams = (await teamsRes.json()) as Array<{ id: string }>;
    expect(teams.some((team) => team.id === createTeamBody.id)).toBe(false);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("deletes channels and removes related subscriptions", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createChannelRes = await app.request(
      "http://localhost/api/channels",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "deletable-channel" }),
      },
    );
    expect(createChannelRes.status).toBe(201);
    const createChannelBody = (await createChannelRes.json()) as { id: string };

    const createAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "agent-one",
        modelId: "test:model",
        systemInstructions: "",
        workspacePath: ".orgops-data/workspaces/agent-one",
      }),
    });
    expect(createAgentRes.status).toBe(201);

    const subscribeRes = await app.request(
      `http://localhost/api/channels/${createChannelBody.id}/subscribe`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          subscriberType: "AGENT",
          subscriberId: "agent-one",
        }),
      },
    );
    expect(subscribeRes.status).toBe(200);

    const deleteRes = await app.request(
      `http://localhost/api/channels/${createChannelBody.id}/delete`,
      {
        method: "POST",
        headers: { cookie },
      },
    );
    expect(deleteRes.status).toBe(200);

    const channelsRes = await app.request("http://localhost/api/channels", {
      headers: { cookie },
    });
    const channels = (await channelsRes.json()) as Array<{ id: string }>;
    expect(
      channels.some((channel) => channel.id === createChannelBody.id),
    ).toBe(false);

    const participantsRes = await app.request(
      `http://localhost/api/channels/${createChannelBody.id}/participants`,
      {
        headers: { cookie },
      },
    );
    const participants = await participantsRes.json();
    expect(participants).toEqual([]);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("deletes all channels and clears channel subscriptions", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "agent-bulk-delete",
        modelId: "test:model",
        systemInstructions: "",
        workspacePath: ".orgops-data/workspaces/agent-bulk-delete",
      }),
    });
    expect(createAgentRes.status).toBe(201);

    for (const channelName of ["bulk-delete-a", "bulk-delete-b"]) {
      const createChannelRes = await app.request(
        "http://localhost/api/channels",
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ name: channelName }),
        },
      );
      expect(createChannelRes.status).toBe(201);
      const channel = (await createChannelRes.json()) as { id: string };
      const subscribeRes = await app.request(
        `http://localhost/api/channels/${channel.id}/subscribe`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            subscriberType: "AGENT",
            subscriberId: "agent-bulk-delete",
          }),
        },
      );
      expect(subscribeRes.status).toBe(200);
    }

    const deleteRes = await app.request("http://localhost/api/channels", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleteRes.status).toBe(200);
    const deleteBody = (await deleteRes.json()) as {
      ok: boolean;
      deletedCount: number;
    };
    expect(deleteBody.ok).toBe(true);
    expect(deleteBody.deletedCount).toBe(2);

    const channelsRes = await app.request("http://localhost/api/channels", {
      headers: { cookie },
    });
    const channels = (await channelsRes.json()) as Array<{ id: string }>;
    expect(channels).toEqual([]);

    const participantsRes = await app.request(
      "http://localhost/api/channels/nonexistent/participants",
      {
        headers: { cookie },
      },
    );
    expect(participantsRes.status).toBe(200);
    const participants = await participantsRes.json();
    expect(participants).toEqual([]);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("deletes missing channels idempotently", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const deleteRes = await app.request(
      "http://localhost/api/channels/missing-id/delete",
      {
        method: "POST",
        headers: { cookie },
      },
    );
    expect(deleteRes.status).toBe(200);
    const body = (await deleteRes.json()) as { ok: boolean; deleted: boolean };
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(false);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("allows explicit integration bridge kind and rejects direct kinds via /api/channels", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createSlackBridgeRes = await app.request(
      "http://localhost/api/channels",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "slack:T1:C123",
          kind: "INTEGRATION_BRIDGE",
        }),
      },
    );
    expect(createSlackBridgeRes.status).toBe(201);
    const createdSlackBridge = (await createSlackBridgeRes.json()) as {
      id: string;
    };

    const channelsRes = await app.request("http://localhost/api/channels", {
      headers: { cookie },
    });
    expect(channelsRes.status).toBe(200);
    const channels = (await channelsRes.json()) as Array<{
      id: string;
      kind: string;
    }>;
    expect(
      channels.find((channel) => channel.id === createdSlackBridge.id)?.kind,
    ).toBe("INTEGRATION_BRIDGE");

    const invalidCreateRes = await app.request(
      "http://localhost/api/channels",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "bad-direct", kind: "HUMAN_AGENT_DM" }),
      },
    );
    expect(invalidCreateRes.status).toBe(400);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns 409 when creating a duplicate channel name", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const firstCreateRes = await app.request("http://localhost/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "dup-channel-name",
        kind: "INTEGRATION_BRIDGE",
      }),
    });
    expect(firstCreateRes.status).toBe(201);

    const secondCreateRes = await app.request("http://localhost/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "dup-channel-name",
        kind: "INTEGRATION_BRIDGE",
      }),
    });
    expect(secondCreateRes.status).toBe(409);
    const secondCreateBody = (await secondCreateRes.json()) as {
      error?: string;
    };
    expect(secondCreateBody.error).toBe("Channel name already exists");

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns 409 when renaming a channel to an existing name", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const firstCreateRes = await app.request("http://localhost/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "existing-channel",
        kind: "INTEGRATION_BRIDGE",
      }),
    });
    expect(firstCreateRes.status).toBe(201);

    const secondCreateRes = await app.request("http://localhost/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "channel-to-rename",
        kind: "INTEGRATION_BRIDGE",
      }),
    });
    expect(secondCreateRes.status).toBe(201);
    const secondCreateBody = (await secondCreateRes.json()) as { id: string };

    const patchRes = await app.request(
      `http://localhost/api/channels/${secondCreateBody.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "existing-channel" }),
      },
    );
    expect(patchRes.status).toBe(409);
    const patchBody = (await patchRes.json()) as { error?: string };
    expect(patchBody.error).toBe("Channel name already exists");

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("stores and returns channel metadata for integration bridge channels", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createRes = await app.request("http://localhost/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "slack-bridge-metadata",
        kind: "INTEGRATION_BRIDGE",
        metadata: {
          integrationBridge: {
            provider: "slack",
            connection: "worker1",
            teamId: "T123",
            channelId: "C456",
            threadTs: "1710000000.000100",
          },
        },
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    const listRes = await app.request("http://localhost/api/channels", {
      headers: { cookie },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{
      id: string;
      metadata?: {
        integrationBridge?: {
          provider?: string;
          channelId?: string;
          threadTs?: string;
        };
      } | null;
    }>;
    const row = list.find((channel) => channel.id === created.id);
    expect(row?.metadata?.integrationBridge?.provider).toBe("slack");
    expect(row?.metadata?.integrationBridge?.channelId).toBe("C456");
    expect(row?.metadata?.integrationBridge?.threadTs).toBe(
      "1710000000.000100",
    );

    const patchRes = await app.request(
      `http://localhost/api/channels/${created.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          metadata: {
            integrationBridge: {
              provider: "slack",
              connection: "worker1",
              teamId: "T123",
              dmUserId: "U999",
            },
          },
        }),
      },
    );
    expect(patchRes.status).toBe(200);

    const listAfterPatchRes = await app.request(
      "http://localhost/api/channels",
      {
        headers: { cookie },
      },
    );
    expect(listAfterPatchRes.status).toBe(200);
    const listAfterPatch = (await listAfterPatchRes.json()) as Array<{
      id: string;
      metadata?: {
        integrationBridge?: {
          dmUserId?: string;
        };
      } | null;
    }>;
    const patched = listAfterPatch.find((channel) => channel.id === created.id);
    expect(patched?.metadata?.integrationBridge?.dmUserId).toBe("U999");

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("ensures human-agent direct channel from authenticated user", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "coordinator",
        modelId: "test:model",
        systemInstructions: "",
        workspacePath: ".orgops-data/workspaces/coordinator",
      }),
    });
    expect(createAgentRes.status).toBe(201);

    const ensureRes = await app.request(
      "http://localhost/api/channels/direct/human-agent",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ agentName: "coordinator" }),
      },
    );
    expect(ensureRes.status).toBe(201);
    const channel = (await ensureRes.json()) as { id: string; kind: string };
    expect(channel.kind).toBe("HUMAN_AGENT_DM");

    const participantsRes = await app.request(
      `http://localhost/api/channels/${channel.id}/participants`,
      {
        headers: { cookie },
      },
    );
    expect(participantsRes.status).toBe(200);
    const participants = (await participantsRes.json()) as Array<{
      subscriberType: string;
      subscriberId: string;
    }>;
    expect(participants).toEqual([
      { subscriberType: "AGENT", subscriberId: "coordinator" },
      { subscriberType: "HUMAN", subscriberId: "admin" },
    ]);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("rejects human-agent direct channel for unknown agent", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const ensureRes = await app.request(
      "http://localhost/api/channels/direct/human-agent",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ agentName: "slack" }),
      },
    );
    expect(ensureRes.status).toBe(404);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("rejects agent-agent direct channel when participant agent is unknown", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const ensureRes = await app.request(
      "http://localhost/api/channels/direct/agent-agent",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-orgops-runner-token": "test-token",
        },
        body: JSON.stringify({
          leftAgentName: "coordinator",
          rightAgentName: "browser-use",
        }),
      },
    );
    expect(ensureRes.status).toBe(404);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("uses authenticated human source when creating events", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createChannelRes = await app.request(
      "http://localhost/api/channels",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "source-test-channel" }),
      },
    );
    expect(createChannelRes.status).toBe(201);
    const createChannelBody = (await createChannelRes.json()) as { id: string };

    const eventRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "hello" },
        source: "human:spoofed-user",
        channelId: createChannelBody.id,
      }),
    });
    expect(eventRes.status).toBe(201);
    const created = (await eventRes.json()) as { source: string };
    expect(created.source).toBe("human:admin");

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("clears all events", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const eventRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "to be deleted" },
        source: "human:admin",
        channelId: "cleanup-channel",
      }),
    });
    expect(eventRes.status).toBe(201);

    const clearRes = await app.request("http://localhost/api/events", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(clearRes.status).toBe(200);

    const listRes = await app.request("http://localhost/api/events?limit=10", {
      headers: { cookie },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{
      type: string;
      payload?: unknown;
    }>;
    expect(list.length).toBe(1);
    expect(list[0]?.type).toBe("audit.events.cleared");
    const payload = (list[0]?.payload ?? {}) as {
      scope?: string;
      deletedCount?: number;
    };
    expect(payload.scope).toBe("all");
    expect(payload.deletedCount).toBe(1);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("clears only matching events when delete filters are provided", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const eventInputs = [
      {
        type: "message.created",
        payload: { text: "delete me 1" },
        source: "human:admin",
        channelId: "channel-a",
      },
      {
        type: "message.created",
        payload: { text: "delete me 2" },
        source: "human:admin",
        channelId: "channel-a",
      },
      {
        type: "process.started",
        payload: {
          processId: "proc-keep-1",
          cmd: "echo keep",
        },
        source: "system",
        channelId: "channel-a",
      },
      {
        type: "message.created",
        payload: { text: "keep different channel" },
        source: "human:admin",
        channelId: "channel-b",
      },
    ];

    for (const input of eventInputs) {
      const createRes = await app.request("http://localhost/api/events", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(input),
      });
      expect(createRes.status).toBe(201);
    }

    const clearRes = await app.request(
      "http://localhost/api/events?channelId=channel-a&type=message.created",
      {
        method: "DELETE",
        headers: { cookie },
      },
    );
    expect(clearRes.status).toBe(200);

    const channelARes = await app.request(
      "http://localhost/api/events?channelId=channel-a&all=1&order=asc",
      {
        headers: { cookie },
      },
    );
    expect(channelARes.status).toBe(200);
    const channelAEvents = (await channelARes.json()) as Array<{
      type: string;
      payload?: unknown;
    }>;
    const channelATypes = channelAEvents.map((event) => event.type);
    expect(channelATypes.includes("process.started")).toBe(true);
    expect(channelATypes.includes("audit.events.cleared")).toBe(true);
    expect(channelAEvents.length).toBe(2);
    const auditEvent = channelAEvents.find(
      (event) => event.type === "audit.events.cleared",
    );
    const auditPayload = (auditEvent?.payload ?? {}) as {
      scope?: string;
      deletedCount?: number;
    };
    expect(auditPayload.scope).toBe("filtered");
    expect(auditPayload.deletedCount).toBe(2);

    const channelBRes = await app.request(
      "http://localhost/api/events?channelId=channel-b&all=1&order=asc",
      {
        headers: { cookie },
      },
    );
    expect(channelBRes.status).toBe(200);
    const channelBEvents = (await channelBRes.json()) as Array<{
      type: string;
    }>;
    expect(channelBEvents.length).toBe(1);
    expect(channelBEvents[0]?.type).toBe("message.created");

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("clears only channel messages via dedicated endpoint and leaves audit trace", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createEvents = [
      {
        type: "message.created",
        payload: { text: "delete me 1" },
        source: "human:admin",
        channelId: "chat-a",
      },
      {
        type: "message.created",
        payload: { text: "delete me 2" },
        source: "human:admin",
        channelId: "chat-a",
      },
      {
        type: "process.started",
        payload: {
          processId: "proc-keep-2",
          cmd: "echo keep",
        },
        source: "system",
        channelId: "chat-a",
      },
      {
        type: "message.created",
        payload: { text: "different channel" },
        source: "human:admin",
        channelId: "chat-b",
      },
    ];
    for (const input of createEvents) {
      const createRes = await app.request("http://localhost/api/events", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(input),
      });
      expect(createRes.status).toBe(201);
    }

    const clearRes = await app.request(
      "http://localhost/api/channels/chat-a/messages",
      {
        method: "DELETE",
        headers: { cookie },
      },
    );
    expect(clearRes.status).toBe(200);
    const clearBody = (await clearRes.json()) as { deletedCount?: number };
    expect(clearBody.deletedCount).toBe(2);

    const chatARes = await app.request(
      "http://localhost/api/events?channelId=chat-a&all=1&order=asc",
      {
        headers: { cookie },
      },
    );
    expect(chatARes.status).toBe(200);
    const chatAEvents = (await chatARes.json()) as Array<{
      type: string;
      payload?: unknown;
    }>;
    const chatATypes = chatAEvents.map((event) => event.type);
    expect(chatATypes.includes("process.started")).toBe(true);
    expect(chatATypes.includes("audit.events.cleared")).toBe(true);
    expect(chatATypes.includes("message.created")).toBe(false);

    const auditEvent = chatAEvents.find(
      (event) => event.type === "audit.events.cleared",
    );
    const payload = (auditEvent?.payload ?? {}) as {
      scope?: string;
      deletedCount?: number;
    };
    expect(payload.scope).toBe("channel_messages");
    expect(payload.deletedCount).toBe(2);

    const chatBRes = await app.request(
      "http://localhost/api/events?channelId=chat-b&all=1&order=asc",
      {
        headers: { cookie },
      },
    );
    expect(chatBRes.status).toBe(200);
    const chatBEvents = (await chatBRes.json()) as Array<{ type: string }>;
    expect(chatBEvents.length).toBe(1);
    expect(chatBEvents[0]?.type).toBe("message.created");

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns all events when all=1", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    for (let index = 0; index < 120; index += 1) {
      const eventRes = await app.request("http://localhost/api/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          type: "message.created",
          payload: { text: `event-${index}` },
          source: "human:admin",
          channelId: "bulk-channel",
        }),
      });
      expect(eventRes.status).toBe(201);
    }

    const defaultListRes = await app.request(
      "http://localhost/api/events?order=desc",
      {
        headers: { cookie },
      },
    );
    expect(defaultListRes.status).toBe(200);
    const defaultList = (await defaultListRes.json()) as unknown[];
    expect(defaultList.length).toBe(100);

    const allListRes = await app.request(
      "http://localhost/api/events?all=1&order=desc",
      {
        headers: { cookie },
      },
    );
    expect(allListRes.status).toBe(200);
    const allList = (await allListRes.json()) as unknown[];
    expect(allList.length).toBe(120);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("hides future scheduled events from non-runner event feeds", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "agent-future",
        modelId: "openai:gpt-4o-mini",
        workspacePath: ".orgops-data/workspaces/agent-future",
        soulContents: "",
      }),
    });
    expect(createAgentRes.status).toBe(201);

    const createChannelRes = await app.request(
      "http://localhost/api/channels",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "future-schedule-channel" }),
      },
    );
    expect(createChannelRes.status).toBe(201);
    const channel = (await createChannelRes.json()) as { id: string };

    const subscribeRes = await app.request(
      `http://localhost/api/channels/${channel.id}/subscribe`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          subscriberType: "AGENT",
          subscriberId: "agent-future",
        }),
      },
    );
    expect(subscribeRes.status).toBe(200);

    const immediateRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "immediate message" },
        source: "human:admin",
        channelId: channel.id,
      }),
    });
    expect(immediateRes.status).toBe(201);
    const immediateEvent = (await immediateRes.json()) as { id: string };

    const futureRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "future reminder" },
        source: "agent:agent-future",
        channelId: channel.id,
        deliverAt: Date.now() + 60_000,
      }),
    });
    expect(futureRes.status).toBe(201);
    const futureEvent = (await futureRes.json()) as { id: string };

    const uiFeedRes = await app.request(
      `http://localhost/api/events?channelId=${channel.id}&limit=50`,
      { headers: { cookie } },
    );
    expect(uiFeedRes.status).toBe(200);
    const uiFeed = (await uiFeedRes.json()) as Array<{ id: string }>;
    expect(uiFeed.some((row) => row.id === immediateEvent.id)).toBe(true);
    expect(uiFeed.some((row) => row.id === futureEvent.id)).toBe(false);

    const scheduledRes = await app.request(
      `http://localhost/api/events?channelId=${channel.id}&scheduled=1&limit=50`,
      { headers: { cookie } },
    );
    expect(scheduledRes.status).toBe(200);
    const scheduled = (await scheduledRes.json()) as Array<{ id: string }>;
    expect(scheduled.some((row) => row.id === futureEvent.id)).toBe(true);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("updates and deletes a future scheduled event by id", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "agent-future",
        modelId: "openai:gpt-4o-mini",
        workspacePath: ".orgops-data/workspaces/agent-future",
        soulContents: "",
      }),
    });
    expect(createAgentRes.status).toBe(201);

    const createChannelRes = await app.request(
      "http://localhost/api/channels",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "scheduled-manage-channel" }),
      },
    );
    expect(createChannelRes.status).toBe(201);
    const channel = (await createChannelRes.json()) as { id: string };

    const subscribeRes = await app.request(
      `http://localhost/api/channels/${channel.id}/subscribe`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          subscriberType: "AGENT",
          subscriberId: "agent-future",
        }),
      },
    );
    expect(subscribeRes.status).toBe(200);

    const deliverAt = Date.now() + 120_000;
    const createRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        type: "agent.scheduled.trigger",
        payload: { text: "original", targetAgentName: "agent-future" },
        source: "system:scheduler",
        channelId: channel.id,
        deliverAt,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    const updatedDeliverAt = Date.now() + 240_000;
    const patchRes = await app.request(
      `http://localhost/api/events/${created.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          deliverAt: updatedDeliverAt,
          payload: { text: "updated", targetAgentName: "agent-future" },
        }),
      },
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as {
      id: string;
      deliverAt?: number;
      payload?: { text?: string };
    };
    expect(patched.id).toBe(created.id);
    expect(patched.deliverAt).toBe(updatedDeliverAt);
    expect(patched.payload?.text).toBe("updated");

    const deleteRes = await app.request(
      `http://localhost/api/events/${created.id}`,
      {
        method: "DELETE",
        headers: { cookie },
      },
    );
    expect(deleteRes.status).toBe(200);
    const deleteBody = (await deleteRes.json()) as {
      ok: boolean;
      deleted: boolean;
    };
    expect(deleteBody.ok).toBe(true);
    expect(deleteBody.deleted).toBe(true);

    const getDeletedRes = await app.request(
      `http://localhost/api/events/${created.id}`,
      {
        headers: { cookie },
      },
    );
    expect(getDeletedRes.status).toBe(404);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("rejects update/delete when event is not future-scheduled", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "immediate" },
        source: "human:admin",
        channelId: "scheduled-guard-channel",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    const patchRes = await app.request(
      `http://localhost/api/events/${created.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ deliverAt: Date.now() + 60_000 }),
      },
    );
    expect(patchRes.status).toBe(409);

    const deleteRes = await app.request(
      `http://localhost/api/events/${created.id}`,
      {
        method: "DELETE",
        headers: { cookie },
      },
    );
    expect(deleteRes.status).toBe(409);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("cleans an agent workspace directory", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const workspacePath = join(dataDir, "workspaces", "agent-cleanup");
    const testFilePath = join(workspacePath, "stale.txt");
    mkdirSync(workspacePath, { recursive: true });
    writeFileSync(testFilePath, "stale-data", "utf-8");
    expect(readFileSync(testFilePath, "utf-8")).toBe("stale-data");

    const createAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "agent-cleanup",
        modelId: "openai:gpt-4o-mini",
        workspacePath,
        soulContents: "",
      }),
    });
    expect(createAgentRes.status).toBe(201);

    const cleanupRes = await app.request(
      "http://localhost/api/agents/agent-cleanup/cleanup-workspace",
      {
        method: "POST",
        headers: { cookie },
      },
    );
    expect(cleanupRes.status).toBe(200);

    expect(existsSync(workspacePath)).toBe(true);
    expect(existsSync(testFilePath)).toBe(false);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("rejects root-level workspace cleanup paths", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "agent-root-cleanup",
        modelId: "openai:gpt-4o-mini",
        workspacePath: "/agent-root-cleanup",
        soulContents: "",
      }),
    });
    expect(createAgentRes.status).toBe(201);

    const cleanupRes = await app.request(
      "http://localhost/api/agents/agent-root-cleanup/cleanup-workspace",
      {
        method: "POST",
        headers: { cookie },
      },
    );
    expect(cleanupRes.status).toBe(400);
    await expect(cleanupRes.json()).resolves.toEqual({
      error: "Refusing to clean unsafe workspace path",
    });

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("records workspace cleanup audit event in agent lifecycle channel", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const agentName = "agent-cleanup-lifecycle";
    const workspacePath = join(dataDir, "workspaces", agentName);
    mkdirSync(workspacePath, { recursive: true });
    const createAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: agentName,
        modelId: "openai:gpt-4o-mini",
        workspacePath,
        soulContents: "",
      }),
    });
    expect(createAgentRes.status).toBe(201);

    const createLifecycleRes = await app.request("http://localhost/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: `agent.lifecycle.${agentName}` }),
    });
    expect(createLifecycleRes.status).toBe(201);
    const lifecycleChannel = (await createLifecycleRes.json()) as { id: string };

    const subscribeRes = await app.request(
      `http://localhost/api/channels/${lifecycleChannel.id}/subscribe`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          subscriberType: "AGENT",
          subscriberId: agentName,
        }),
      },
    );
    expect(subscribeRes.status).toBe(200);

    const cleanupRes = await app.request(
      `http://localhost/api/agents/${agentName}/cleanup-workspace`,
      {
        method: "POST",
        headers: { cookie },
      },
    );
    expect(cleanupRes.status).toBe(200);

    const auditRes = await app.request(
      "http://localhost/api/events?type=audit.workspace.cleaned&order=desc&limit=1",
      { headers: { cookie } },
    );
    expect(auditRes.status).toBe(200);
    const events = (await auditRes.json()) as Array<{ channelId?: string; payload?: { agentName?: string } }>;
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.payload?.agentName).toBe(agentName);
    expect(events[0]?.channelId).toBe(lifecycleChannel.id);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("signals a single running process by id", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const child = spawn("/bin/bash", ["-lc", "sleep 30"]);
    const processId = randomUUID();
    try {
      const createProcessRes = await app.request(
        "http://localhost/api/processes",
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            id: processId,
            agentName: "test-agent",
            cmd: "sleep 30",
            cwd: dataDir,
            pid: child.pid ?? null,
            state: "RUNNING",
            startedAt: Date.now(),
          }),
        },
      );
      expect(createProcessRes.status).toBe(201);

      const exitRes = await app.request(
        `http://localhost/api/processes/${processId}`,
        {
          method: "DELETE",
          headers: { cookie },
        },
      );
      expect(exitRes.status).toBe(200);
      const body = (await exitRes.json()) as { ok: boolean; signaled: boolean };
      expect(body.ok).toBe(true);
      expect(body.signaled).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("reconciles missing running processes as exited on refresh", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const child = spawn("/bin/bash", ["-lc", "sleep 30"]);
    const processId = randomUUID();
    try {
      const createProcessRes = await app.request(
        "http://localhost/api/processes",
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            id: processId,
            agentName: "test-agent",
            cmd: "sleep 30",
            cwd: dataDir,
            pid: child.pid ?? null,
            state: "RUNNING",
            startedAt: Date.now(),
          }),
        },
      );
      expect(createProcessRes.status).toBe(201);

      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      await new Promise((resolve) => setTimeout(resolve, 25));

      const listRes = await app.request(
        "http://localhost/api/processes?reconcile=1",
        {
          headers: { cookie },
        },
      );
      expect(listRes.status).toBe(200);
      const list = (await listRes.json()) as Array<{
        id: string;
        state: string;
        ended_at?: number;
      }>;
      const row = list.find((item) => item.id === processId);
      expect(row).toBeDefined();
      expect(row?.state).toBe("EXITED");
      expect(typeof row?.ended_at).toBe("number");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("marks active process as exited when pid is missing on exit request", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const processId = randomUUID();
    const createProcessRes = await app.request(
      "http://localhost/api/processes",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          id: processId,
          agentName: "test-agent",
          cmd: "sleep 30",
          cwd: dataDir,
          pid: 999_999_999,
          state: "RUNNING",
          startedAt: Date.now(),
        }),
      },
    );
    expect(createProcessRes.status).toBe(201);

    const exitRes = await app.request(
      `http://localhost/api/processes/${processId}`,
      {
        method: "DELETE",
        headers: { cookie },
      },
    );
    expect(exitRes.status).toBe(200);
    const body = (await exitRes.json()) as {
      ok: boolean;
      signaled: boolean;
      markedExited: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.signaled).toBe(false);
    expect(body.markedExited).toBe(true);

    const listRes = await app.request("http://localhost/api/processes", {
      headers: { cookie },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{
      id: string;
      state: string;
      ended_at?: number;
    }>;
    const row = list.find((item) => item.id === processId);
    expect(row).toBeDefined();
    expect(row?.state).toBe("EXITED");
    expect(typeof row?.ended_at).toBe("number");

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("clears only exited processes when scope=exited", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const runningId = randomUUID();
    const exitedId = randomUUID();
    const completedId = randomUUID();
    const now = Date.now();

    const createRunningRes = await app.request(
      "http://localhost/api/processes",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          id: runningId,
          agentName: "test-agent",
          cmd: "sleep 30",
          cwd: dataDir,
          pid: null,
          state: "RUNNING",
          startedAt: now,
        }),
      },
    );
    expect(createRunningRes.status).toBe(201);

    const createExitedRes = await app.request(
      "http://localhost/api/processes",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          id: exitedId,
          agentName: "test-agent",
          cmd: "echo done",
          cwd: dataDir,
          pid: null,
          state: "EXITED",
          startedAt: now - 2000,
          endedAt: now - 1000,
        }),
      },
    );
    expect(createExitedRes.status).toBe(201);

    const createCompletedRes = await app.request(
      "http://localhost/api/processes",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          id: completedId,
          agentName: "test-agent",
          cmd: "echo complete",
          cwd: dataDir,
          pid: null,
          state: "COMPLETED",
          startedAt: now - 2000,
          endedAt: now - 1000,
        }),
      },
    );
    expect(createCompletedRes.status).toBe(201);

    const clearRes = await app.request(
      "http://localhost/api/processes?scope=exited",
      {
        method: "DELETE",
        headers: { cookie },
      },
    );
    expect(clearRes.status).toBe(200);
    const clearBody = (await clearRes.json()) as {
      ok: boolean;
      scope: string;
      clearedCount: number;
      terminatedCount: number;
    };
    expect(clearBody.ok).toBe(true);
    expect(clearBody.scope).toBe("exited");
    expect(clearBody.clearedCount).toBe(2);
    expect(clearBody.terminatedCount).toBe(0);

    const listRes = await app.request("http://localhost/api/processes", {
      headers: { cookie },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{ id: string; state: string }>;
    expect(list.map((row) => row.id)).toContain(runningId);
    expect(list.map((row) => row.id)).not.toContain(exitedId);
    expect(list.map((row) => row.id)).not.toContain(completedId);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("stores and retrieves separate recent/full channel memory records", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });
    const runnerHeaders = {
      "content-type": "application/json",
      "x-orgops-runner-token": "test-token",
    };

    const putRecentRes = await app.request("http://localhost/api/memory/channel/recent", {
      method: "PUT",
      headers: runnerHeaders,
      body: JSON.stringify({
        agentName: "memory-agent",
        channelId: "chan-1",
        summaryText: "recent summary",
        windowStartAt: 1000,
        lastProcessedAt: 2000,
        lastProcessedEventId: "evt-2",
      }),
    });
    expect(putRecentRes.status).toBe(200);
    const putRecentBody = (await putRecentRes.json()) as {
      record?: { summaryText?: string; windowStartAt?: number; version?: number };
    };
    expect(putRecentBody.record?.summaryText).toBe("recent summary");
    expect(putRecentBody.record?.windowStartAt).toBe(1000);
    expect(putRecentBody.record?.version).toBe(1);

    const putFullRes = await app.request("http://localhost/api/memory/channel/full", {
      method: "PUT",
      headers: runnerHeaders,
      body: JSON.stringify({
        agentName: "memory-agent",
        channelId: "chan-1",
        summaryText: "full summary",
        lastProcessedAt: 3000,
      }),
    });
    expect(putFullRes.status).toBe(200);
    const putFullBody = (await putFullRes.json()) as {
      record?: { summaryText?: string; windowStartAt?: number };
    };
    expect(putFullBody.record?.summaryText).toBe("full summary");
    expect(putFullBody.record?.windowStartAt).toBeUndefined();

    const getRecentRes = await app.request(
      "http://localhost/api/memory/channel/recent?agentName=memory-agent&channelId=chan-1",
      { headers: { "x-orgops-runner-token": "test-token" } },
    );
    expect(getRecentRes.status).toBe(200);
    const getRecentBody = (await getRecentRes.json()) as {
      record?: { summaryText?: string; lastProcessedEventId?: string };
    };
    expect(getRecentBody.record?.summaryText).toBe("recent summary");
    expect(getRecentBody.record?.lastProcessedEventId).toBe("evt-2");

    const listRecentRes = await app.request(
      "http://localhost/api/memory/channel/recent?agentName=memory-agent",
      { headers: { "x-orgops-runner-token": "test-token" } },
    );
    expect(listRecentRes.status).toBe(200);
    const listRecentBody = (await listRecentRes.json()) as {
      records?: Array<{ channelId: string }>;
    };
    expect(listRecentBody.records?.map((row) => row.channelId)).toEqual(["chan-1"]);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("stores cross-channel memory and enforces expectedVersion conflict", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });
    const runnerHeaders = {
      "content-type": "application/json",
      "x-orgops-runner-token": "test-token",
    };

    const putRes = await app.request("http://localhost/api/memory/cross/full", {
      method: "PUT",
      headers: runnerHeaders,
      body: JSON.stringify({
        agentName: "memory-agent",
        summaryText: "global summary",
        lastProcessedAt: 5000,
      }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { record?: { version?: number } };
    expect(putBody.record?.version).toBe(1);

    const conflictRes = await app.request("http://localhost/api/memory/cross/full", {
      method: "PUT",
      headers: runnerHeaders,
      body: JSON.stringify({
        agentName: "memory-agent",
        summaryText: "stale update",
        lastProcessedAt: 6000,
        expectedVersion: 0,
      }),
    });
    expect(conflictRes.status).toBe(409);

    const getRes = await app.request(
      "http://localhost/api/memory/cross/full?agentName=memory-agent",
      { headers: { "x-orgops-runner-token": "test-token" } },
    );
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      record?: { summaryText?: string; lastProcessedAt?: number; version?: number };
    };
    expect(getBody.record?.summaryText).toBe("global summary");
    expect(getBody.record?.lastProcessedAt).toBe(5000);
    expect(getBody.record?.version).toBe(1);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("shows private channels only to owner and invited humans", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const adminLoginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(adminLoginRes.status).toBe(200);
    const adminCookie = adminLoginRes.headers.get("set-cookie") ?? "";

    const inviteRes = await app.request("http://localhost/api/humans/invite", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ username: "bob" }),
    });
    expect(inviteRes.status).toBe(201);
    const inviteBody = (await inviteRes.json()) as { temporaryPassword: string };

    const bobLoginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "bob",
        password: inviteBody.temporaryPassword,
      }),
    });
    expect(bobLoginRes.status).toBe(200);
    const bobCookie = bobLoginRes.headers.get("set-cookie") ?? "";
    const bobProfileRes = await app.request("http://localhost/api/auth/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: bobCookie },
      body: JSON.stringify({
        username: "bob",
        newPassword: "bob-password-123",
      }),
    });
    expect(bobProfileRes.status).toBe(200);

    const createPrivateChannelRes = await app.request("http://localhost/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        name: "owner-private-channel",
        visibility: "PRIVATE",
      }),
    });
    expect(createPrivateChannelRes.status).toBe(201);
    const created = (await createPrivateChannelRes.json()) as { id: string };

    const bobBeforeInviteRes = await app.request("http://localhost/api/channels", {
      headers: { cookie: bobCookie },
    });
    expect(bobBeforeInviteRes.status).toBe(200);
    const bobBeforeInvite = (await bobBeforeInviteRes.json()) as Array<{ id: string }>;
    expect(bobBeforeInvite.some((channel) => channel.id === created.id)).toBe(false);

    const inviteBobToChannelRes = await app.request(
      `http://localhost/api/channels/${created.id}/subscribe`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({
          subscriberType: "HUMAN",
          subscriberId: "bob",
        }),
      },
    );
    expect(inviteBobToChannelRes.status).toBe(200);

    const bobAfterInviteRes = await app.request("http://localhost/api/channels", {
      headers: { cookie: bobCookie },
    });
    expect(bobAfterInviteRes.status).toBe(200);
    const bobAfterInvite = (await bobAfterInviteRes.json()) as Array<{ id: string }>;
    expect(bobAfterInvite.some((channel) => channel.id === created.id)).toBe(true);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates human-agent direct channels as private by default", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "dm-private-agent",
        modelId: "openai:gpt-4o-mini",
        workspacePath: ".orgops-data/workspaces/dm-private-agent",
      }),
    });
    expect(createAgentRes.status).toBe(201);

    const directRes = await app.request("http://localhost/api/channels/direct/human-agent", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ agentName: "dm-private-agent" }),
    });
    expect(directRes.status).toBe(201);
    const direct = (await directRes.json()) as { id: string };

    const channelsRes = await app.request("http://localhost/api/channels", {
      headers: { cookie },
    });
    expect(channelsRes.status).toBe(200);
    const channels = (await channelsRes.json()) as Array<{
      id: string;
      visibility?: string;
    }>;
    expect(channels.find((channel) => channel.id === direct.id)?.visibility).toBe("PRIVATE");

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("limits private agent discoverability to owner and humans sharing a channel", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token",
    });

    const adminLoginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(adminLoginRes.status).toBe(200);
    const adminCookie = adminLoginRes.headers.get("set-cookie") ?? "";

    const createPrivateAgentRes = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        name: "owner-private-agent",
        modelId: "openai:gpt-4o-mini",
        workspacePath: ".orgops-data/workspaces/owner-private-agent",
        visibility: "PRIVATE",
      }),
    });
    expect(createPrivateAgentRes.status).toBe(201);

    const inviteRes = await app.request("http://localhost/api/humans/invite", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ username: "charlie" }),
    });
    expect(inviteRes.status).toBe(201);
    const inviteBody = (await inviteRes.json()) as { temporaryPassword: string };

    const charlieLoginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "charlie",
        password: inviteBody.temporaryPassword,
      }),
    });
    expect(charlieLoginRes.status).toBe(200);
    const charlieCookie = charlieLoginRes.headers.get("set-cookie") ?? "";
    const charlieProfileRes = await app.request("http://localhost/api/auth/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: charlieCookie },
      body: JSON.stringify({
        username: "charlie",
        newPassword: "charlie-password-123",
      }),
    });
    expect(charlieProfileRes.status).toBe(200);

    const charlieBeforeShareRes = await app.request("http://localhost/api/agents", {
      headers: { cookie: charlieCookie },
    });
    expect(charlieBeforeShareRes.status).toBe(200);
    const charlieBeforeShare = (await charlieBeforeShareRes.json()) as Array<{ name: string }>;
    expect(charlieBeforeShare.some((agent) => agent.name === "owner-private-agent")).toBe(false);

    const createChannelRes = await app.request("http://localhost/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        name: "shared-visibility-channel",
        visibility: "PRIVATE",
      }),
    });
    expect(createChannelRes.status).toBe(201);
    const channel = (await createChannelRes.json()) as { id: string };

    const addPrivateAgentRes = await app.request(
      `http://localhost/api/channels/${channel.id}/subscribe`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({
          subscriberType: "AGENT",
          subscriberId: "owner-private-agent",
        }),
      },
    );
    expect(addPrivateAgentRes.status).toBe(200);
    const addCharlieRes = await app.request(
      `http://localhost/api/channels/${channel.id}/subscribe`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({
          subscriberType: "HUMAN",
          subscriberId: "charlie",
        }),
      },
    );
    expect(addCharlieRes.status).toBe(200);

    const charlieAfterShareRes = await app.request("http://localhost/api/agents", {
      headers: { cookie: charlieCookie },
    });
    expect(charlieAfterShareRes.status).toBe(200);
    const charlieAfterShare = (await charlieAfterShareRes.json()) as Array<{ name: string }>;
    expect(charlieAfterShare.some((agent) => agent.name === "owner-private-agent")).toBe(true);

    rmSync(dataDir, { recursive: true, force: true });
  });
});
