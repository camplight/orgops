import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@orgops/db";
import { createApp } from "./app";
import { parseRealtimeCallId } from "./voice-realtime";

type FetchCall = { url: string; headers: Headers; body: FormData };

async function setup(respond?: (call: FetchCall) => Response) {
  const dataDir = mkdtempSync(join(tmpdir(), "orgops-realtime-"));
  const calls: FetchCall[] = [];
  const realtimeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: init?.body as FormData,
    };
    calls.push(call);
    return (
      respond?.(call) ??
      new Response("v=0\r\nanswer", {
        status: 201,
        headers: { location: "/v1/realtime/calls/rtc_test123" },
      })
    );
  }) as typeof fetch;
  const { app } = createApp({
    db: openDb(":memory:"),
    dataDir,
    projectRoot: dataDir,
    adminUser: "admin",
    adminPass: "admin",
    realtimeFetch,
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

  async function addAgent(name: string, modelId: string, join = true) {
    const res = await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ name, modelId, workspacePath: `.orgops-data/workspaces/${name}` }),
    });
    expect(res.status).toBeLessThan(300);
    if (!join) return;
    await app.request(`http://localhost/api/channels/${channel.id}/subscribe`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ subscriberType: "AGENT", subscriberId: name }),
    });
  }

  async function startCall(agentName: string, roomId?: string) {
    const res = await app.request("http://localhost/api/voice/realtime/calls", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ channelId: channel.id, agentName, sessionId: "session-1", roomId, sdp: "v=0\r\noffer" }),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  async function events(type: string) {
    const res = await app.request(
      `http://localhost/api/events?channelId=${channel.id}&type=${type}&order=asc`,
      { headers: { cookie } },
    );
    return (await res.json()) as Array<{ source: string; payload: any }>;
  }

  return {
    channel,
    calls,
    addAgent,
    startCall,
    events,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("realtime voice calls", () => {
  it("parses the call id from the Location header", () => {
    expect(parseRealtimeCallId("/v1/realtime/calls/rtc_abc")).toBe("rtc_abc");
    expect(parseRealtimeCallId(null)).toBeNull();
  });

  it("brokers the WebRTC offer to OpenAI and records the call for the agent's runner", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("ORGOPS_LLM_STUB", "");
    const ctx = await setup();
    await ctx.addAgent("voice-agent", "openai:gpt-realtime");

    const result = await ctx.startCall("voice-agent", "room-1");

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      sdp: "v=0\r\nanswer",
      callId: "rtc_test123",
      model: "gpt-realtime",
      agentName: "voice-agent",
    });
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]!.url).toBe("https://api.openai.com/v1/realtime/calls");
    expect(ctx.calls[0]!.headers.get("authorization")).toBe("Bearer sk-test");
    expect(ctx.calls[0]!.body.get("sdp")).toBe("v=0\r\noffer");
    const session = JSON.parse(String(ctx.calls[0]!.body.get("session")));
    expect(session).toMatchObject({
      type: "realtime",
      model: "gpt-realtime",
      audio: { input: { transcription: { model: "gpt-4o-mini-transcribe" } } },
    });
    expect(session.instructions).toContain("You are voice-agent");

    const started = await ctx.events("voice.realtime.call.started");
    expect(started).toHaveLength(1);
    expect(started[0]!.source).toBe("human:admin");
    expect(started[0]!.payload).toMatchObject({
      targetAgentName: "voice-agent",
      callId: "rtc_test123",
      sessionId: "session-1",
      roomId: "room-1",
      provider: "openai",
      speakerId: "admin",
    });
    ctx.cleanup();
  });

  it("rejects agents that cannot take a realtime call", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("ORGOPS_LLM_STUB", "");
    const ctx = await setup();
    await ctx.addAgent("text-agent", "openai:gpt-4o-mini");
    await ctx.addAgent("outsider", "openai:gpt-realtime", false);

    expect(await ctx.startCall("text-agent")).toMatchObject({
      status: 400,
      body: { error: "openai:gpt-4o-mini is not a realtime voice model" },
    });
    expect(await ctx.startCall("outsider")).toMatchObject({
      status: 400,
      body: { error: "outsider is not in this channel" },
    });
    expect(ctx.calls).toHaveLength(0);
    ctx.cleanup();
  });

  it("surfaces provider failures without recording a call", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("ORGOPS_LLM_STUB", "");
    const ctx = await setup(() => new Response("bad sdp", { status: 400 }));
    await ctx.addAgent("voice-agent", "openai:gpt-realtime");

    const result = await ctx.startCall("voice-agent");

    expect(result.status).toBe(502);
    expect(result.body.error).toContain("bad sdp");
    expect(await ctx.events("voice.realtime.call.started")).toHaveLength(0);
    ctx.cleanup();
  });
});
