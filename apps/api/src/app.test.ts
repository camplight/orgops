import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { openDb } from "@orgops/db";
import { createApp } from "./app";

describe("api app", () => {
  it("stores and updates agent soul contents in database", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
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
        soulContents: "initial soul"
      })
    });
    expect(createAgentRes.status).toBe(201);

    const patchRes = await app.request("http://localhost/api/agents/soul-agent", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        soulContents: "updated soul from db",
        allowOutsideWorkspace: false
      })
    });
    expect(patchRes.status).toBe(200);

    const getRes = await app.request("http://localhost/api/agents/soul-agent", {
      headers: { cookie }
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

  it("authenticates and creates events", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const meRes = await app.request("http://localhost/api/auth/me", {
      headers: { cookie }
    });
    expect(meRes.status).toBe(200);

    const eventRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orgops-runner-token": "test-token"
      },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "hello" },
        source: "test",
        channelId: "test-channel"
      })
    });
    expect(eventRes.status).toBe(201);
    const firstEvent = (await eventRes.json()) as { id: string };

    const secondEventRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orgops-runner-token": "test-token"
      },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "hello again" },
        source: "test",
        channelId: "test-channel"
      })
    });
    expect(secondEventRes.status).toBe(201);
    const secondEvent = (await secondEventRes.json()) as { id: string };

    const listRes = await app.request("http://localhost/api/events?limit=10", {
      headers: { "x-orgops-runner-token": "test-token" }
    });
    const list = await listRes.json();
    expect(Array.isArray(list)).toBe(true);

    const descListRes = await app.request("http://localhost/api/events?limit=10&order=desc", {
      headers: { "x-orgops-runner-token": "test-token" }
    });
    expect(descListRes.status).toBe(200);
    const descList = (await descListRes.json()) as Array<{ id: string }>;
    expect(descList[0]?.id).toBe(secondEvent.id);
    expect(descList[1]?.id).toBe(firstEvent.id);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("verifies generic webhook signature", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    process.env.ORGOPS_WEBHOOK_SECRET = "test-secret";
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token"
    });

    const payload = JSON.stringify({ id: "evt-1", message: "ok" });
    const signature = createHmac("sha256", "test-secret").update(payload).digest("hex");

    const res = await app.request("http://localhost/api/webhooks/generic/test", {
      method: "POST",
      headers: {
        "x-orgops-signature": signature
      },
      body: payload
    });
    expect(res.status).toBe(200);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("dynamic webhook: CRUD definitions and verify by name", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createRes = await app.request("http://localhost/api/webhook-definitions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "my-webhook",
        verificationKind: "generic_hmac",
        secret: "my-secret"
      })
    });
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    expect(createBody.name).toBe("my-webhook");

    const listRes = await app.request("http://localhost/api/webhook-definitions", { headers: { cookie } });
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("my-webhook");
    expect(list[0].verificationKind).toBe("generic_hmac");
    expect(list[0].secret).toBeUndefined();

    const payload = JSON.stringify({ id: "evt-2", message: "hello" });
    const signature = createHmac("sha256", "my-secret").update(payload).digest("hex");
    const webhookRes = await app.request("http://localhost/api/webhooks/my-webhook", {
      method: "POST",
      headers: { "x-orgops-signature": signature },
      body: payload
    });
    expect(webhookRes.status).toBe(200);

    const notFoundRes = await app.request("http://localhost/api/webhooks/nonexistent", {
      method: "POST",
      body: payload
    });
    expect(notFoundRes.status).toBe(404);

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
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
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
        soulContents: ""
      })
    });
    expect(createAgentRes.status).toBe(201);

    const startRes = await app.request("http://localhost/api/agents/agent-one/start", {
      method: "POST",
      headers: { cookie }
    });
    expect(startRes.status).toBe(200);

    const afterStartRes = await app.request("http://localhost/api/agents/agent-one", {
      headers: { cookie }
    });
    expect(afterStartRes.status).toBe(200);
    const afterStart = await afterStartRes.json();
    expect(afterStart.desiredState).toBe("RUNNING");
    expect(afterStart.runtimeState).toBe("STARTING");

    const stopRes = await app.request("http://localhost/api/agents/agent-one/stop", {
      method: "POST",
      headers: { cookie }
    });
    expect(stopRes.status).toBe(200);

    const afterStopRes = await app.request("http://localhost/api/agents/agent-one", {
      headers: { cookie }
    });
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
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
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
        soulContents: ""
      })
    });
    expect(createAgentRes.status).toBe(201);

    const createChannelRes = await app.request("http://localhost/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "agent-two-inbox" })
    });
    expect(createChannelRes.status).toBe(201);
    const channel = (await createChannelRes.json()) as { id: string };
    const subscribeRes = await app.request(`http://localhost/api/channels/${channel.id}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ subscriberType: "AGENT", subscriberId: "agent-two" })
    });
    expect(subscribeRes.status).toBe(200);

    const eventRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie
      },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "hello agent-two" },
        source: "human:admin",
        channelId: channel.id
      })
    });
    expect(eventRes.status).toBe(201);
    const event = (await eventRes.json()) as { id: string };

    const uiListRes = await app.request(
      "http://localhost/api/events?agentName=agent-two&status=PENDING&limit=10",
      { headers: { cookie } }
    );
    expect(uiListRes.status).toBe(200);
    const uiList = (await uiListRes.json()) as Array<{ id: string; status: string }>;
    expect(uiList.some((row) => row.id === event.id)).toBe(true);
    expect(uiList.find((row) => row.id === event.id)?.status).toBe("PENDING");

    const runnerListRes = await app.request(
      "http://localhost/api/events?agentName=agent-two&status=PENDING&limit=10",
      { headers: { "x-orgops-runner-token": "test-token" } }
    );
    expect(runnerListRes.status).toBe(200);

    const afterRunnerRes = await app.request(
      "http://localhost/api/events?agentName=agent-two&status=DELIVERED&limit=10",
      { headers: { "x-orgops-runner-token": "test-token" } }
    );
    expect(afterRunnerRes.status).toBe(200);
    const afterRunner = (await afterRunnerRes.json()) as Array<{ id: string; status: string }>;
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
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
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
          soulContents: ""
        })
      });
      expect(createAgentRes.status).toBe(201);
    }

    const createChannelRes = await app.request("http://localhost/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "fanout-channel" })
    });
    expect(createChannelRes.status).toBe(201);
    const channel = (await createChannelRes.json()) as { id: string };

    for (const subscriberId of ["agent-a", "agent-b"]) {
      const subscribeRes = await app.request(
        `http://localhost/api/channels/${channel.id}/subscribe`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ subscriberType: "AGENT", subscriberId })
        }
      );
      expect(subscribeRes.status).toBe(200);
    }

    const eventRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie
      },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "fanout test" },
        source: "human:admin",
        channelId: channel.id
      })
    });
    expect(eventRes.status).toBe(201);
    const event = (await eventRes.json()) as { id: string };

    const pollAgentARes = await app.request(
      "http://localhost/api/events?agentName=agent-a&status=PENDING&limit=10",
      { headers: { "x-orgops-runner-token": "test-token" } }
    );
    expect(pollAgentARes.status).toBe(200);
    const pollAgentA = (await pollAgentARes.json()) as Array<{ id: string }>;
    expect(pollAgentA.some((row) => row.id === event.id)).toBe(true);

    const afterAgentAStatusRes = await app.request(
      `http://localhost/api/events?channelId=${channel.id}&limit=10`,
      { headers: { cookie } }
    );
    expect(afterAgentAStatusRes.status).toBe(200);
    const afterAgentAStatus = (await afterAgentAStatusRes.json()) as Array<{
      id: string;
      status: string;
    }>;
    expect(afterAgentAStatus.find((row) => row.id === event.id)?.status).toBe("PENDING");

    const pollAgentBRes = await app.request(
      "http://localhost/api/events?agentName=agent-b&status=PENDING&limit=10",
      { headers: { "x-orgops-runner-token": "test-token" } }
    );
    expect(pollAgentBRes.status).toBe(200);
    const pollAgentB = (await pollAgentBRes.json()) as Array<{ id: string }>;
    expect(pollAgentB.some((row) => row.id === event.id)).toBe(true);

    const afterAgentBStatusRes = await app.request(
      `http://localhost/api/events?channelId=${channel.id}&status=DELIVERED&limit=10`,
      { headers: { cookie } }
    );
    expect(afterAgentBStatusRes.status).toBe(200);
    const afterAgentBStatus = (await afterAgentBStatusRes.json()) as Array<{
      id: string;
      status: string;
    }>;
    expect(afterAgentBStatus.some((row) => row.id === event.id)).toBe(true);

    rmSync(dataDir, { recursive: true, force: true });
  });

  it("deletes teams and removes related memberships/subscriptions", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-api-"));
    const db = openDb(":memory:");
    const { app } = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createTeamRes = await app.request("http://localhost/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Team Alpha" })
    });
    expect(createTeamRes.status).toBe(201);
    const createTeamBody = (await createTeamRes.json()) as { id: string };

    const addMemberRes = await app.request(
      `http://localhost/api/teams/${createTeamBody.id}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ memberType: "AGENT", memberId: "agent-one" })
      }
    );
    expect(addMemberRes.status).toBe(200);

    const createChannelRes = await app.request("http://localhost/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "team-channel" })
    });
    expect(createChannelRes.status).toBe(201);
    const createChannelBody = (await createChannelRes.json()) as { id: string };

    const subscribeRes = await app.request(
      `http://localhost/api/channels/${createChannelBody.id}/subscribe`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ subscriberType: "TEAM", subscriberId: createTeamBody.id })
      }
    );
    expect(subscribeRes.status).toBe(200);

    const deleteRes = await app.request(`http://localhost/api/teams/${createTeamBody.id}`, {
      method: "DELETE",
      headers: { cookie }
    });
    expect(deleteRes.status).toBe(200);

    const teamsRes = await app.request("http://localhost/api/teams", {
      headers: { cookie }
    });
    const teams = (await teamsRes.json()) as Array<{ id: string }>;
    expect(teams.some((team) => team.id === createTeamBody.id)).toBe(false);

    const membersRes = await app.request(
      `http://localhost/api/teams/${createTeamBody.id}/members`,
      {
        headers: { cookie }
      }
    );
    const members = await membersRes.json();
    expect(members).toEqual([]);

    const participantsRes = await app.request(
      `http://localhost/api/channels/${createChannelBody.id}/participants`,
      {
        headers: { cookie }
      }
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
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createTeamRes = await app.request("http://localhost/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Team Beta" })
    });
    expect(createTeamRes.status).toBe(201);
    const createTeamBody = (await createTeamRes.json()) as { id: string };

    const deleteRes = await app.request(
      `http://localhost/api/teams/${createTeamBody.id}/delete`,
      {
        method: "POST",
        headers: { cookie }
      }
    );
    expect(deleteRes.status).toBe(200);

    const teamsRes = await app.request("http://localhost/api/teams", {
      headers: { cookie }
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
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createChannelRes = await app.request("http://localhost/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "deletable-channel" })
    });
    expect(createChannelRes.status).toBe(201);
    const createChannelBody = (await createChannelRes.json()) as { id: string };

    const subscribeRes = await app.request(
      `http://localhost/api/channels/${createChannelBody.id}/subscribe`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ subscriberType: "AGENT", subscriberId: "agent-one" })
      }
    );
    expect(subscribeRes.status).toBe(200);

    const deleteRes = await app.request(
      `http://localhost/api/channels/${createChannelBody.id}/delete`,
      {
        method: "POST",
        headers: { cookie }
      }
    );
    expect(deleteRes.status).toBe(200);

    const channelsRes = await app.request("http://localhost/api/channels", {
      headers: { cookie }
    });
    const channels = (await channelsRes.json()) as Array<{ id: string }>;
    expect(channels.some((channel) => channel.id === createChannelBody.id)).toBe(false);

    const participantsRes = await app.request(
      `http://localhost/api/channels/${createChannelBody.id}/participants`,
      {
        headers: { cookie }
      }
    );
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
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const deleteRes = await app.request("http://localhost/api/channels/missing-id/delete", {
      method: "POST",
      headers: { cookie }
    });
    expect(deleteRes.status).toBe(200);
    const body = (await deleteRes.json()) as { ok: boolean; deleted: boolean };
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(false);

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
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const ensureRes = await app.request("http://localhost/api/channels/direct/human-agent", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ agentName: "coordinator" })
    });
    expect(ensureRes.status).toBe(201);
    const channel = (await ensureRes.json()) as { id: string; kind: string };
    expect(channel.kind).toBe("HUMAN_AGENT_DM");

    const participantsRes = await app.request(
      `http://localhost/api/channels/${channel.id}/participants`,
      {
        headers: { cookie }
      }
    );
    expect(participantsRes.status).toBe(200);
    const participants = (await participantsRes.json()) as Array<{
      subscriberType: string;
      subscriberId: string;
    }>;
    expect(participants).toEqual([
      { subscriberType: "AGENT", subscriberId: "coordinator" },
      { subscriberType: "HUMAN", subscriberId: "admin" }
    ]);

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
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createChannelRes = await app.request("http://localhost/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "source-test-channel" })
    });
    expect(createChannelRes.status).toBe(201);
    const createChannelBody = (await createChannelRes.json()) as { id: string };

    const eventRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "hello" },
        source: "human:spoofed-user",
        channelId: createChannelBody.id
      })
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
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const eventRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie
      },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "to be deleted" },
        source: "human:admin",
        channelId: "cleanup-channel"
      })
    });
    expect(eventRes.status).toBe(201);

    const clearRes = await app.request("http://localhost/api/events", {
      method: "DELETE",
      headers: { cookie }
    });
    expect(clearRes.status).toBe(200);

    const listRes = await app.request("http://localhost/api/events?limit=10", {
      headers: { cookie }
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{ type: string; payload?: unknown }>;
    expect(list.length).toBe(1);
    expect(list[0]?.type).toBe("audit.events.cleared");
    const payload = (list[0]?.payload ?? {}) as { scope?: string; deletedCount?: number };
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
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const eventInputs = [
      {
        type: "message.created",
        payload: { text: "delete me 1" },
        source: "human:admin",
        channelId: "channel-a"
      },
      {
        type: "message.created",
        payload: { text: "delete me 2" },
        source: "human:admin",
        channelId: "channel-a"
      },
      {
        type: "agent.scheduled.trigger",
        payload: { reason: "keep different type" },
        source: "system",
        channelId: "channel-a"
      },
      {
        type: "message.created",
        payload: { text: "keep different channel" },
        source: "human:admin",
        channelId: "channel-b"
      }
    ];

    for (const input of eventInputs) {
      const createRes = await app.request("http://localhost/api/events", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(input)
      });
      expect(createRes.status).toBe(201);
    }

    const clearRes = await app.request(
      "http://localhost/api/events?channelId=channel-a&type=message.created",
      {
        method: "DELETE",
        headers: { cookie }
      }
    );
    expect(clearRes.status).toBe(200);

    const channelARes = await app.request(
      "http://localhost/api/events?channelId=channel-a&all=1&order=asc",
      {
        headers: { cookie }
      }
    );
    expect(channelARes.status).toBe(200);
    const channelAEvents = (await channelARes.json()) as Array<{ type: string; payload?: unknown }>;
    const channelATypes = channelAEvents.map((event) => event.type);
    expect(channelATypes.includes("agent.scheduled.trigger")).toBe(true);
    expect(channelATypes.includes("audit.events.cleared")).toBe(true);
    expect(channelAEvents.length).toBe(2);
    const auditEvent = channelAEvents.find((event) => event.type === "audit.events.cleared");
    const auditPayload = (auditEvent?.payload ?? {}) as { scope?: string; deletedCount?: number };
    expect(auditPayload.scope).toBe("filtered");
    expect(auditPayload.deletedCount).toBe(2);

    const channelBRes = await app.request(
      "http://localhost/api/events?channelId=channel-b&all=1&order=asc",
      {
        headers: { cookie }
      }
    );
    expect(channelBRes.status).toBe(200);
    const channelBEvents = (await channelBRes.json()) as Array<{ type: string }>;
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
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const createEvents = [
      {
        type: "message.created",
        payload: { text: "delete me 1" },
        source: "human:admin",
        channelId: "chat-a"
      },
      {
        type: "message.created",
        payload: { text: "delete me 2" },
        source: "human:admin",
        channelId: "chat-a"
      },
      {
        type: "agent.scheduled.trigger",
        payload: { reason: "keep non-message event" },
        source: "system",
        channelId: "chat-a"
      },
      {
        type: "message.created",
        payload: { text: "different channel" },
        source: "human:admin",
        channelId: "chat-b"
      }
    ];
    for (const input of createEvents) {
      const createRes = await app.request("http://localhost/api/events", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(input)
      });
      expect(createRes.status).toBe(201);
    }

    const clearRes = await app.request("http://localhost/api/channels/chat-a/messages", {
      method: "DELETE",
      headers: { cookie }
    });
    expect(clearRes.status).toBe(200);
    const clearBody = (await clearRes.json()) as { deletedCount?: number };
    expect(clearBody.deletedCount).toBe(2);

    const chatARes = await app.request("http://localhost/api/events?channelId=chat-a&all=1&order=asc", {
      headers: { cookie }
    });
    expect(chatARes.status).toBe(200);
    const chatAEvents = (await chatARes.json()) as Array<{ type: string; payload?: unknown }>;
    const chatATypes = chatAEvents.map((event) => event.type);
    expect(chatATypes.includes("agent.scheduled.trigger")).toBe(true);
    expect(chatATypes.includes("audit.events.cleared")).toBe(true);
    expect(chatATypes.includes("message.created")).toBe(false);

    const auditEvent = chatAEvents.find((event) => event.type === "audit.events.cleared");
    const payload = (auditEvent?.payload ?? {}) as { scope?: string; deletedCount?: number };
    expect(payload.scope).toBe("channel_messages");
    expect(payload.deletedCount).toBe(2);

    const chatBRes = await app.request("http://localhost/api/events?channelId=chat-b&all=1&order=asc", {
      headers: { cookie }
    });
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
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    for (let index = 0; index < 120; index += 1) {
      const eventRes = await app.request("http://localhost/api/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie
        },
        body: JSON.stringify({
          type: "message.created",
          payload: { text: `event-${index}` },
          source: "human:admin",
          channelId: "bulk-channel"
        })
      });
      expect(eventRes.status).toBe(201);
    }

    const defaultListRes = await app.request("http://localhost/api/events?order=desc", {
      headers: { cookie }
    });
    expect(defaultListRes.status).toBe(200);
    const defaultList = (await defaultListRes.json()) as unknown[];
    expect(defaultList.length).toBe(100);

    const allListRes = await app.request("http://localhost/api/events?all=1&order=desc", {
      headers: { cookie }
    });
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
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
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
        soulContents: ""
      })
    });
    expect(createAgentRes.status).toBe(201);

    const createChannelRes = await app.request("http://localhost/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "future-schedule-channel" })
    });
    expect(createChannelRes.status).toBe(201);
    const channel = (await createChannelRes.json()) as { id: string };

    const subscribeRes = await app.request(`http://localhost/api/channels/${channel.id}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ subscriberType: "AGENT", subscriberId: "agent-future" })
    });
    expect(subscribeRes.status).toBe(200);

    const immediateRes = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        type: "message.created",
        payload: { text: "immediate message" },
        source: "human:admin",
        channelId: channel.id
      })
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
        deliverAt: Date.now() + 60_000
      })
    });
    expect(futureRes.status).toBe(201);
    const futureEvent = (await futureRes.json()) as { id: string };

    const uiFeedRes = await app.request(
      `http://localhost/api/events?channelId=${channel.id}&limit=50`,
      { headers: { cookie } }
    );
    expect(uiFeedRes.status).toBe(200);
    const uiFeed = (await uiFeedRes.json()) as Array<{ id: string }>;
    expect(uiFeed.some((row) => row.id === immediateEvent.id)).toBe(true);
    expect(uiFeed.some((row) => row.id === futureEvent.id)).toBe(false);

    const scheduledRes = await app.request(
      `http://localhost/api/events?channelId=${channel.id}&scheduled=1&limit=50`,
      { headers: { cookie } }
    );
    expect(scheduledRes.status).toBe(200);
    const scheduled = (await scheduledRes.json()) as Array<{ id: string }>;
    expect(scheduled.some((row) => row.id === futureEvent.id)).toBe(true);

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
      runnerToken: "test-token"
    });

    const loginRes = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" })
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
        soulContents: ""
      })
    });
    expect(createAgentRes.status).toBe(201);

    const cleanupRes = await app.request(
      "http://localhost/api/agents/agent-cleanup/cleanup-workspace",
      {
        method: "POST",
        headers: { cookie }
      }
    );
    expect(cleanupRes.status).toBe(200);

    expect(existsSync(workspacePath)).toBe(true);
    expect(existsSync(testFilePath)).toBe(false);

    rmSync(dataDir, { recursive: true, force: true });
  });

});
