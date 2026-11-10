import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDrizzleDb, openDb, schema } from "@orgops/db";
import { eq } from "drizzle-orm";
import { createApp } from "../app";

describe("billing routes", () => {
  it("loads the checked-in catalog and prices deployed OpenAI model IDs", async () => {
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
      const pricesResponse = await engine.app.request("http://localhost/api/billing/prices", {
        headers,
      });
      const prices = await pricesResponse.json();
      expect(prices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ modelId: "openai:gpt-5.5" }),
          expect.objectContaining({ modelId: "openai:gpt-5.6" }),
          expect.objectContaining({ modelId: "openai:gpt-realtime" }),
        ]),
      );

      for (const usage of [
        {
          modelId: "openai:gpt-5.5",
          inputTokens: 300_000,
          outputTokens: 10_000,
          expectedCost: 3_450_000,
        },
        {
          modelId: "openai:gpt-5.6",
          inputTokens: 100_000,
          outputTokens: 500_000,
          expectedCost: 10_400_000,
        },
        {
          modelId: "openai:gpt-realtime",
          inputTokens: 1_000_000,
          outputTokens: 500_000,
          expectedCost: 12_000_000,
        },
      ]) {
        const response = await engine.app.request("http://localhost/api/billing/usage", {
          method: "POST",
          headers,
          body: JSON.stringify(usage),
        });
        expect(await response.json()).toMatchObject({
          priceFound: true,
          costUsdMicros: usage.expectedCost,
        });
      }

      const orm = createDrizzleDb(db);
      orm
        .update(schema.llmUsage)
        .set({ cost_usd_micros: 0, price_snapshot_json: "{}" })
        .where(eq(schema.llmUsage.model_id, "openai:gpt-5.5"))
        .run();
      orm
        .insert(schema.llmModelPrices)
        .values({
          id: "stale:price",
          provider: "stale",
          model_id: "stale:model",
          model_name: "model",
          currency: "USD",
          input_price_per_million: "1",
          output_price_per_million: "1",
          source: "manual",
          effective_at: Date.now(),
          metadata_json: "{}",
          created_at: Date.now(),
        })
        .run();
      createApp({
        db,
        dataDir,
        adminUser: "admin",
        adminPass: "admin",
        runnerToken,
        systemAgentModel: "",
      });
      expect(
        orm
          .select()
          .from(schema.llmModelPrices)
          .where(eq(schema.llmModelPrices.model_id, "stale:model"))
          .get(),
      ).toBeUndefined();
      expect(
        orm
          .select()
          .from(schema.llmUsage)
          .where(eq(schema.llmUsage.model_id, "openai:gpt-5.5"))
          .get()?.cost_usd_micros,
      ).toBe(3_450_000);

      for (const endpoint of [
        "/api/billing/prices",
        "/api/billing/prices/refresh",
        "/api/billing/prices/refresh/openrouter",
      ]) {
        const response = await engine.app.request(`http://localhost${endpoint}`, {
          method: "POST",
          headers,
          body: "{}",
        });
        expect(response.status).toBe(404);
      }
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
            modelId: "openai:gpt-4o-mini",
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

});
