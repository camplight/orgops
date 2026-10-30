import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@orgops/db";
import { createApp } from "./app";

async function liveKitIsUp() {
  try {
    const res = await fetch("http://127.0.0.1:7880/");
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

describe("local LiveKit room", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("issues tokens that actually join the local SFU", async () => {
    if (!(await liveKitIsUp())) {
      console.warn("skipping: livekit-server is not listening on 127.0.0.1:7880");
      return;
    }
    vi.stubEnv("ORGOPS_VOICE_BROKER", "livekit");
    vi.stubEnv("LIVEKIT_URL", "ws://127.0.0.1:7880");
    vi.stubEnv("LIVEKIT_API_KEY", "devkey");
    vi.stubEnv("LIVEKIT_API_SECRET", "secret");
    const dataDir = mkdtempSync(join(tmpdir(), "orgops-livekit-local-"));
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
      body: JSON.stringify({ name: "livekit-room" }),
    });
    const channel = (await channelRes.json()) as { id: string };
    await app.request("http://localhost/api/agents", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        name: "gemini-agent",
        modelId: "google:gemini-2.5-flash-native-audio-preview-09-2025",
        workspacePath: ".orgops-data/workspaces/gemini-agent",
      }),
    });
    await app.request(`http://localhost/api/channels/${channel.id}/subscribe`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ subscriberType: "AGENT", subscriberId: "gemini-agent" }),
    });
    const humanJoin = await app.request("http://localhost/api/voice/rooms/join", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ channelId: channel.id, sessionId: "local-session" }),
    });
    const agentJoin = await app.request("http://localhost/api/voice/rooms/agent-join", {
      method: "POST",
      headers: { "content-type": "application/json", "x-orgops-runner-token": "dev-runner-token" },
      body: JSON.stringify({
        channelId: channel.id,
        agentName: "gemini-agent",
        sessionId: "local-session",
      }),
    });
    expect(humanJoin.status).toBe(200);
    expect(agentJoin.status).toBe(200);
    const human = (await humanJoin.json()) as { url: string; token: string; identity: string };
    const agent = (await agentJoin.json()) as { url: string; token: string; identity: string };
    expect(human.identity).toContain("human:admin");
    expect(agent.identity).toBe("agent:gemini-agent");

    const rtc = await import("@livekit/rtc-node");
    const humanRoom = new rtc.Room();
    const agentRoom = new rtc.Room();
    const heard = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for agent audio")), 12_000);
      humanRoom.on(rtc.RoomEvent.TrackSubscribed, (track: any, _pub: unknown, participant: { identity?: string }) => {
        if (track.kind !== rtc.TrackKind.KIND_AUDIO) return;
        clearTimeout(timer);
        resolve(String(participant?.identity ?? ""));
      });
    });
    await humanRoom.connect(human.url, human.token, { autoSubscribe: true, dynacast: true });
    await agentRoom.connect(agent.url, agent.token, { autoSubscribe: true, dynacast: true });
    const source = new rtc.AudioSource(16_000, 1);
    const track = rtc.LocalAudioTrack.createAudioTrack("agent-audio", source);
    const options = new rtc.TrackPublishOptions();
    options.source = rtc.TrackSource.SOURCE_MICROPHONE;
    if (!agentRoom.localParticipant) throw new Error("agent LiveKit participant is missing");
    await agentRoom.localParticipant.publishTrack(track, options);
    const silence = new Int16Array(16_000 * 0.2);
    await source.captureFrame(new rtc.AudioFrame(silence, 16_000, 1, silence.length));
    const speaker = await heard;
    expect(speaker).toBe("agent:gemini-agent");
    await humanRoom.disconnect();
    await agentRoom.disconnect();
    rmSync(dataDir, { recursive: true, force: true });
  }, 20_000);
});
