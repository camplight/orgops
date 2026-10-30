import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@orgops/db";
import { createApp } from "./app";

async function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "orgops-voice-broker-"));
  const { app } = createApp({
    db: openDb(":memory:"),
    dataDir,
    projectRoot: dataDir,
    adminUser: "admin",
    adminPass: "admin",
  });
  const loginRes = await app.request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }),
  });
  const cookie = loginRes.headers.get("set-cookie") ?? "";
  const json = { "content-type": "application/json", cookie };
  const channelRes = await app.request("http://localhost/api/channels", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ name: "voice-room" }),
  });
  const channel = (await channelRes.json()) as { id: string };
  return {
    app,
    channel,
    json,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

function decodeJwtPayload(token: string) {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("missing JWT payload");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, any>;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("voice broker", () => {
  it("reports the direct browser multiplexer by default", async () => {
    const ctx = await setup();
    const configRes = await ctx.app.request("http://localhost/api/voice/config", { headers: ctx.json });
    expect(await configRes.json()).toMatchObject({
      realtime: {
        rooms: {
          enabled: true,
          broker: "direct-openai-calls",
          url: null,
        },
      },
    });

    const joinRes = await ctx.app.request("http://localhost/api/voice/rooms/join", {
      method: "POST",
      headers: ctx.json,
      body: JSON.stringify({ channelId: ctx.channel.id, sessionId: "session-1" }),
    });
    expect(joinRes.status).toBe(200);
    expect(await joinRes.json()).toMatchObject({
      broker: "direct-openai-calls",
      mode: "client-multiplex",
      sessionId: "session-1",
      roomName: `orgops-channel-${ctx.channel.id}`,
    });
    ctx.cleanup();
  });

  it("issues LiveKit room tokens when configured", async () => {
    vi.stubEnv("ORGOPS_VOICE_BROKER", "livekit");
    vi.stubEnv("LIVEKIT_URL", "wss://livekit.example");
    vi.stubEnv("LIVEKIT_API_KEY", "lk-key");
    vi.stubEnv("LIVEKIT_API_SECRET", "lk-secret");
    const ctx = await setup();

    const joinRes = await ctx.app.request("http://localhost/api/voice/rooms/join", {
      method: "POST",
      headers: ctx.json,
      body: JSON.stringify({ channelId: ctx.channel.id, sessionId: "session-2" }),
    });
    expect(joinRes.status).toBe(200);
    const body = (await joinRes.json()) as any;
    expect(body).toMatchObject({
      broker: "livekit",
      mode: "sfu",
      url: "wss://livekit.example",
      roomName: `orgops-channel-${ctx.channel.id}`,
      identity: "human:admin:session-2",
      sessionId: "session-2",
    });
    const payload = decodeJwtPayload(body.token);
    expect(payload).toMatchObject({
      iss: "lk-key",
      sub: "human:admin:session-2",
      video: {
        room: `orgops-channel-${ctx.channel.id}`,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
      },
    });
    ctx.cleanup();
  });

  it("issues LiveKit tokens for runner-authenticated agents", async () => {
    vi.stubEnv("ORGOPS_VOICE_BROKER", "livekit");
    vi.stubEnv("LIVEKIT_URL", "ws://127.0.0.1:7880");
    vi.stubEnv("LIVEKIT_API_KEY", "devkey");
    vi.stubEnv("LIVEKIT_API_SECRET", "secret");
    const ctx = await setup();
    const agentRes = await ctx.app.request("http://localhost/api/agents", {
      method: "POST",
      headers: ctx.json,
      body: JSON.stringify({ name: "voice-agent", modelId: "google:gemini-2.5-flash-native-audio-preview-09-2025", workspacePath: ".orgops-data/workspaces/voice-agent" }),
    });
    expect(agentRes.status).toBeLessThan(300);
    await ctx.app.request(`http://localhost/api/channels/${ctx.channel.id}/subscribe`, {
      method: "POST",
      headers: ctx.json,
      body: JSON.stringify({ subscriberType: "AGENT", subscriberId: "voice-agent" }),
    });
    const joinRes = await ctx.app.request("http://localhost/api/voice/rooms/agent-join", {
      method: "POST",
      headers: { "content-type": "application/json", "x-orgops-runner-token": "dev-runner-token" },
      body: JSON.stringify({ channelId: ctx.channel.id, agentName: "voice-agent", sessionId: "session-3" }),
    });
    expect(joinRes.status).toBe(200);
    const body = (await joinRes.json()) as any;
    expect(body).toMatchObject({
      broker: "livekit",
      identity: "agent:voice-agent",
      url: "ws://127.0.0.1:7880",
    });
    expect(decodeJwtPayload(body.token).sub).toBe("agent:voice-agent");
    ctx.cleanup();
  });
});
