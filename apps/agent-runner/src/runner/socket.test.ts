import { afterEach, describe, expect, it } from "vitest";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import {
  createRunnerSocketClient,
  type RunnerSocketWakeup,
} from "./socket";

describe("runner socket client", () => {
  let server: WebSocketServer | null = null;

  afterEach(async () => {
    const current = server;
    server = null;
    if (current) {
      await new Promise<void>((resolve) => current.close(() => resolve()));
    }
  });

  it("connects with runner auth and forwards event wakeups", async () => {
    server = new WebSocketServer({ port: 0 });
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const wakeups: RunnerSocketWakeup[][] = [];
    const received = new Promise<void>((resolve) => {
      server?.once("connection", (socket, request) => {
        expect(request.url).toBe("/api/runners/runner-1/ws");
        expect(request.headers["x-orgops-runner-token"]).toBe("secret-token");
        socket.send(
          JSON.stringify({
            type: "event.available",
            runnerId: "runner-1",
            events: [
              {
                eventId: "event-1",
                eventType: "message.created",
                agentName: "agent-1",
                channelId: "channel-1",
                createdAt: 123,
              },
            ],
          }),
        );
        resolve();
      });
    });

    const client = createRunnerSocketClient({
      apiUrl: `http://127.0.0.1:${port}`,
      runnerToken: "secret-token",
      getRunnerId: () => "runner-1",
      reconnectBaseDelayMs: 10,
      onWakeup: (events) => wakeups.push(events),
    });
    client.start();

    await received;
    await expect
      .poll(() => wakeups.flat().map((event) => event.eventId))
      .toEqual(["event-1"]);
    client.stop();
  });
});
