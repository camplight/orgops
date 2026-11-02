import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@orgops/db";
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
});
