import { describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { createDrizzleDb, openDb, schema } from "@orgops/db";
import { createApp } from "./app";

function nextJsonMessage(socket: WebSocket) {
  return new Promise<any>((resolve) => {
    socket.once("message", (data) => resolve(JSON.parse(String(data))));
  });
}

async function nextMessageOfType(socket: WebSocket, type: string) {
  for (;;) {
    const message = await nextJsonMessage(socket);
    if (message?.type === type) return message;
  }
}

describe("runner socket", () => {
  it("pushes compact event wakeups to the assigned runner", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-runner-socket-"));
    const db = openDb(":memory:");
    const orm = createDrizzleDb(db);
    const runnerToken = "runner-socket-token";
    const engine = createApp({
      db,
      dataDir,
      adminUser: "admin",
      adminPass: "admin",
      runnerToken,
      systemAgentModel: "",
    });
    const now = Date.now();
    orm.insert(schema.runnerNodes)
      .values({
        id: "runner-1",
        display_name: "runner-1",
        hostname: null,
        platform: null,
        arch: null,
        version: null,
        metadata_json: "{}",
        created_at: now,
        updated_at: now,
        last_seen_at: now,
      })
      .run();
    orm.insert(schema.agents)
      .values({
        id: "agent-1",
        name: "agent-1",
        model_id: "openai:gpt-4o-mini",
        workspace_path: ".orgops-data/workspaces/agent-1",
        assigned_runner_id: "runner-1",
        created_at: now,
        updated_at: now,
      })
      .run();
    orm.insert(schema.channels)
      .values({ id: "channel-1", name: "general", created_at: now })
      .run();
    orm.insert(schema.channelSubscriptions)
      .values({
        channel_id: "channel-1",
        subscriber_type: "AGENT",
        subscriber_id: "agent-1",
      })
      .run();

    const server = serve({ fetch: engine.app.fetch, port: 0 });
    engine.injectWebSocket(server);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/runners/runner-1/ws`, {
      headers: { "x-orgops-runner-token": runnerToken },
    });
    await once(socket, "open");
    socket.send(JSON.stringify({ type: "ping" }));

    try {
      await expect(nextMessageOfType(socket, "pong")).resolves.toMatchObject({
        type: "pong",
      });

      const created = await engine.app.request("http://localhost/api/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-orgops-runner-token": runnerToken,
        },
        body: JSON.stringify({
          type: "message.created",
          source: "human:alice",
          channelId: "channel-1",
          payload: { text: "wake up" },
        }),
      });
      expect(created.status).toBe(201);

      await expect(nextMessageOfType(socket, "event.available")).resolves.toMatchObject({
        type: "event.available",
        runnerId: "runner-1",
        events: [
          {
            agentName: "agent-1",
            channelId: "channel-1",
            eventType: "message.created",
          },
        ],
      });
    } finally {
      socket.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
