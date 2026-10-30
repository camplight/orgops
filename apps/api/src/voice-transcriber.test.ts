import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@orgops/db";
import { createApp } from "./app";

type Transcribe = NonNullable<Parameters<typeof createApp>[0]>["voiceTranscribe"];

async function setup(transcribe: Transcribe, env: Record<string, string | undefined> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "orgops-voice-"));
  const { app, voiceTranscriber } = createApp({
    db: openDb(":memory:"),
    dataDir,
    projectRoot: dataDir,
    adminUser: "admin",
    adminPass: "admin",
    voiceTranscribe: transcribe,
    voiceTranscriberEnv: () => ({ ORGOPS_TRANSCRIPTION_MODEL: "mistral:voxtral-mini-latest", ...env }),
  });
  const loginRes = await app.request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }),
  });
  const cookie = loginRes.headers.get("set-cookie") ?? "";
  const channelRes = await app.request("http://localhost/api/channels", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: "voice-room" }),
  });
  const channel = (await channelRes.json()) as { id: string };

  async function upload(bytes: number[], name = "voice.webm") {
    const body = new FormData();
    body.append("file", new File([new Uint8Array(bytes)], name, { type: "audio/webm" }));
    const res = await app.request("http://localhost/api/files", {
      method: "POST",
      headers: { cookie },
      body,
    });
    return ((await res.json()) as { id: string }).id;
  }

  async function postEvent(type: string, payload: Record<string, unknown>) {
    const res = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ type, payload, source: "human:admin", channelId: channel.id }),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  async function messages() {
    const res = await app.request(
      `http://localhost/api/events?channelId=${channel.id}&type=message.created&order=asc`,
      { headers: { cookie } },
    );
    return (await res.json()) as Array<{ source: string; parentEventId?: string; payload: any }>;
  }

  return {
    app,
    cookie,
    upload,
    postEvent,
    messages,
    voiceTranscriber,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

describe("voice transcriber", () => {
  it("reports transcription config", async () => {
    const ctx = await setup(async () => ({ text: "" }));
    const res = await ctx.app.request("http://localhost/api/voice/config", {
      headers: { cookie: ctx.cookie },
    });
    expect(await res.json()).toMatchObject({
      transcription: { enabled: true, modelId: "mistral:voxtral-mini-latest" },
      realtime: { provider: "openai" },
    });
    ctx.cleanup();
  });

  it("turns a hold-to-talk chunk into a transcribed message from the speaker", async () => {
    const seen: number[] = [];
    const ctx = await setup(async (modelId, audio) => {
      expect(modelId).toBe("mistral:voxtral-mini-latest");
      seen.push(audio.data.byteLength);
      return { text: "  deploy the staging build  ", language: "en" };
    });
    const fileId = await ctx.upload([1, 2, 3, 4]);
    const chunk = await ctx.postEvent("voice.input.chunk", {
      mode: "message",
      speakerId: "admin",
      startedAt: 1000,
      endedAt: 3500,
      durationMs: 2500,
      attachment: { fileId, name: "voice.webm", mime: "audio/webm", size: 4 },
    });
    expect(chunk.status).toBe(201);
    await ctx.voiceTranscriber.idle();

    expect(seen).toEqual([4]);
    const [message] = await ctx.messages();
    expect(message.source).toBe("human:admin");
    expect(message.parentEventId).toBe(chunk.body.id);
    expect(message.payload.text).toBe("deploy the staging build");
    expect(message.payload.attachments).toEqual([
      expect.objectContaining({ fileId, kind: "voice", durationMs: 2500 }),
    ]);
    expect(message.payload.voice).toMatchObject({
      mode: "message",
      status: "transcribed",
      chunkEventId: chunk.body.id,
      transcribedBy: "mistral:voxtral-mini-latest",
      language: "en",
    });
    ctx.cleanup();
  });

  it("keeps live utterances in speaking order and drops silent ones", async () => {
    const replies = [
      { text: "first point", delayMs: 40 },
      { text: "", delayMs: 0 },
      { text: "second point", delayMs: 0 },
    ];
    const ctx = await setup(async () => {
      const next = replies.shift()!;
      await new Promise((resolve) => setTimeout(resolve, next.delayMs));
      return { text: next.text };
    });
    for (let index = 0; index < 3; index += 1) {
      const fileId = await ctx.upload([index + 1]);
      const res = await ctx.postEvent("voice.input.chunk", {
        mode: "live",
        speakerId: "admin",
        sessionId: "session-1",
        streamId: "stream-1",
        chunkIndex: index,
        startedAt: index * 1000,
        endedAt: index * 1000 + 800,
        attachment: { fileId },
      });
      expect(res.status).toBe(201);
    }
    await ctx.voiceTranscriber.idle();

    const texts = (await ctx.messages()).map((message) => message.payload.text);
    expect(texts).toEqual(["first point", "second point"]);
    ctx.cleanup();
  });

  it("still delivers the audio when transcription fails", async () => {
    const ctx = await setup(async () => {
      throw new Error("provider unavailable");
    });
    const fileId = await ctx.upload([9, 9]);
    await ctx.postEvent("voice.input.chunk", {
      mode: "message",
      speakerId: "admin",
      startedAt: 0,
      endedAt: 1200,
      attachment: { fileId },
    });
    await ctx.voiceTranscriber.idle();

    const [message] = await ctx.messages();
    expect(message.payload.text).toBe("Voice message (transcription failed)");
    expect(message.payload.voice).toMatchObject({ status: "failed", error: "provider unavailable" });
    expect(message.payload.attachments[0].fileId).toBe(fileId);
    ctx.cleanup();
  });

  it("rejects voice chunks without a mode or attachment", async () => {
    const ctx = await setup(async () => ({ text: "x" }));
    const res = await ctx.postEvent("voice.input.chunk", {
      speakerId: "admin",
      startedAt: 0,
      endedAt: 10,
    });
    expect(res.status).toBe(400);
    ctx.cleanup();
  });
});
