import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDrizzleDb, openDb, schema } from "@orgops/db";
import { eq } from "drizzle-orm";
import { createApp } from "../app";

describe("billing routes", () => {
  it("allows runner-authenticated price upsert and uses it for billing", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-billing-"));
    const db = openDb(":memory:");
    const runnerToken = "runner-billing-token";
    const engine = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken,
      systemAgentModel: "",
    });

    try {
      const upsert = await engine.app.request("http://localhost/api/billing/prices", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-orgops-runner-token": runnerToken,
        },
        body: JSON.stringify({
          modelId: "openrouter:acme/new-model",
          inputPricePerMillion: 2,
          outputPricePerMillion: 6,
          source: "test",
        }),
      });
      expect(upsert.status).toBe(201);
      expect(await upsert.json()).toMatchObject({ upserted: 1 });

      const usage = await engine.app.request("http://localhost/api/billing/usage", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-orgops-runner-token": runnerToken,
        },
        body: JSON.stringify({
          modelId: "openrouter:acme/new-model",
          inputTokens: 1_000_000,
          outputTokens: 500_000,
        }),
      });
      expect(usage.status).toBe(201);
      expect(await usage.json()).toMatchObject({
        priceFound: true,
        costUsdMicros: 5_000_000,
      });
    } finally {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects provider values that do not match modelId prefix", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-billing-"));
    const db = openDb(":memory:");
    const runnerToken = "runner-billing-token";
    const engine = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken,
      systemAgentModel: "",
    });

    try {
      const response = await engine.app.request("http://localhost/api/billing/prices", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-orgops-runner-token": runnerToken,
        },
        body: JSON.stringify({
          provider: "openai",
          modelId: "anthropic:claude-sonnet-5-5",
          inputPricePerMillion: 1,
          outputPricePerMillion: 2,
          source: "test",
        }),
      });
      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toBe("Invalid pricing payload");
    } finally {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("prices usage that was recorded before its model had a price", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-billing-"));
    const db = openDb(":memory:");
    const runnerToken = "runner-billing-token";
    const engine = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken,
      systemAgentModel: "",
    });
    const headers = {
      "content-type": "application/json",
      "x-orgops-runner-token": runnerToken,
    };

    try {
      const usage = await engine.app.request("http://localhost/api/billing/usage", {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelId: "openrouter:acme/late-priced",
          agentName: "late",
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        }),
      });
      expect(await usage.json()).toMatchObject({ priceFound: false, costUsdMicros: 0 });

      const upsert = await engine.app.request("http://localhost/api/billing/prices", {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelId: "openrouter:acme/late-priced",
          inputPricePerMillion: 1,
          outputPricePerMillion: 3,
          source: "test",
        }),
      });
      expect(await upsert.json()).toMatchObject({ upserted: 1, repriced: 1 });

      const aggregate = await engine.app.request(
        "http://localhost/api/billing/usage?groupBy=agent",
        { headers },
      );
      const payload = await aggregate.json();
      expect(payload.totals.costUsdMicros).toBe(4_000_000);
    } finally {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("filters aggregate usage by channel before grouping by agent", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-billing-"));
    const db = openDb(":memory:");
    const runnerToken = "runner-billing-token";
    const engine = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken,
      systemAgentModel: "",
    });

    try {
      const price = await engine.app.request("http://localhost/api/billing/prices", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-orgops-runner-token": runnerToken,
        },
        body: JSON.stringify({
          modelId: "openrouter:acme/channel-model",
          inputPricePerMillion: 1,
          outputPricePerMillion: 1,
          source: "test",
        }),
      });
      expect(price.status).toBe(201);

      for (const usage of [
        { channelId: "channel-a", agentName: "alice", inputTokens: 100, outputTokens: 50 },
        { channelId: "channel-a", agentName: "bob", inputTokens: 200, outputTokens: 25 },
        { channelId: "channel-b", agentName: "alice", inputTokens: 10_000, outputTokens: 10_000 },
      ]) {
        const response = await engine.app.request("http://localhost/api/billing/usage", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-orgops-runner-token": runnerToken,
          },
          body: JSON.stringify({
            modelId: "openrouter:acme/channel-model",
            ...usage,
          }),
        });
        expect(response.status).toBe(201);
      }

      const aggregate = await engine.app.request(
        "http://localhost/api/billing/usage?groupBy=agent&channelId=channel-a",
        {
          headers: { "x-orgops-runner-token": runnerToken },
        },
      );
      expect(aggregate.status).toBe(200);
      const payload = await aggregate.json();
      expect(payload.totals).toMatchObject({
        calls: 2,
        inputTokens: 300,
        outputTokens: 75,
        totalTokens: 375,
      });
      expect(payload.groups).toEqual([
        expect.objectContaining({ key: "bob", calls: 1, totalTokens: 225 }),
        expect.objectContaining({ key: "alice", calls: 1, totalTokens: 150 }),
      ]);
    } finally {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("accepts an isolated price proposal from any selected agent and reprices usage", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-billing-"));
    const db = openDb(":memory:");
    const runnerToken = "runner-billing-token";
    const engine = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken,
      systemAgentModel: "",
    });
    const orm = createDrizzleDb(db);
    const now = Date.now();
    const headers = {
      "content-type": "application/json",
      "x-orgops-runner-token": runnerToken,
    };

    try {
      orm.insert(schema.agents).values({
        id: "pricing-agent-id",
        name: "pricing-agent",
        agent_role: "STANDARD",
        model_id: "openai:gpt-4o-mini",
        soul_contents: "",
        workspace_path: dataDir,
        desired_state: "RUNNING",
        runtime_state: "RUNNING",
        assigned_runner_id: "runner-1",
        created_at: now,
        updated_at: now,
      }).run();
      const usage = await engine.app.request("http://localhost/api/billing/usage", {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelId: "openai:gpt-agent-refresh-test",
          inputTokens: 1_000_000,
          outputTokens: 500_000,
        }),
      });
      expect(await usage.json()).toMatchObject({ priceFound: false });

      const start = await engine.app.request("http://localhost/api/billing/prices/refresh", {
        method: "POST",
        headers,
        body: JSON.stringify({ updaterAgentName: "pricing-agent" }),
      });
      expect(start.status).toBe(202);
      const started = await start.json();
      expect(started.modelsByProvider.openai).toContain("openai:gpt-agent-refresh-test");
      const requestEvent = orm
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, started.eventId))
        .get();
      expect(requestEvent?.channel_id).toBeTruthy();
      const refreshChannelId = requestEvent!.channel_id!;

      const proposal = await engine.app.request("http://localhost/api/events", {
        method: "POST",
        headers: { ...headers, "x-orgops-agent-name": "pricing-agent" },
        body: JSON.stringify({
          type: "message.created",
          source: "agent:pricing-agent",
          channelId: refreshChannelId,
          parentEventId: started.eventId,
          payload: {
            text: JSON.stringify({
              prices: [{
                modelId: "openai:gpt-agent-refresh-test",
                inputPricePerMillion: 2,
                outputPricePerMillion: 4,
                source: "openai-docs",
                sourceUrl: "https://developers.openai.com/api/docs/pricing",
              }],
              unresolved: [],
            }),
          },
        }),
      });
      const proposalBody = await proposal.json();
      expect(proposal.status, JSON.stringify(proposalBody)).toBe(201);

      const status = await engine.app.request(
        `http://localhost/api/billing/prices/refresh/${started.refreshId}`,
        { headers },
      );
      expect(await status.json()).toMatchObject({ status: "COMPLETED" });
      const refreshChannel = orm
        .select()
        .from(schema.channels)
        .where(eq(schema.channels.id, refreshChannelId))
        .get();
      expect(refreshChannel?.metadata_json).toContain('"purpose":"billing-price-refresh"');
      expect(refreshChannel?.archived_at).toBeTypeOf("number");

      const aggregate = await engine.app.request(
        "http://localhost/api/billing/usage?groupBy=model",
        { headers },
      );
      expect((await aggregate.json()).totals.costUsdMicros).toBe(4_000_000);
    } finally {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
