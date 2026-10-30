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
});
