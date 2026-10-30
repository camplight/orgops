import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRealtimeVoiceManager, type RealtimeSocket } from "./realtime-voice";
import type { Agent, Event } from "./types";

class FakeSocket implements RealtimeSocket {
  sent: any[] = [];
  closed = false;
  private listeners = new Map<string, Array<(event: any) => void>>();
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.fire("close", {});
  }
  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  server(message: Record<string, unknown>) {
    this.fire("message", { data: JSON.stringify(message) });
  }
}

const agent: Agent = {
  name: "voice-agent",
  modelId: "openai:gpt-realtime",
  workspacePath: mkdtempSync(join(tmpdir(), "orgops-realtime-voice-")),
  soulContents: "You run the payments on-call desk.",
  desiredState: "RUNNING",
  runtimeState: "RUNNING",
};

function callStarted(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt-call",
    type: "voice.realtime.call.started",
    source: "human:alice",
    channelId: "chan-1",
    payload: {
      targetAgentName: "voice-agent",
      callId: "rtc_1",
      sessionId: "session-1",
      provider: "openai",
      model: "gpt-realtime",
      speakerId: "alice",
      startedAt: 1,
    },
    ...overrides,
  };
}

async function flush() {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup() {
  const sockets: FakeSocket[] = [];
  const emitted: any[] = [];
  const fetches: Array<{ url: string; init?: RequestInit }> = [];
  const toolCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const manager = createRealtimeVoiceManager({
    api: {
      apiFetch: async (path: string) =>
        path.startsWith("/api/files/")
          ? new Response(new Uint8Array([1, 2, 3]))
          : new Response(
          JSON.stringify([
            { id: "m1", type: "message.created", source: "human:bob", channelId: "chan-1", payload: { text: "Deploy is at 3pm." } },
          ]),
        ),
      emitEvent: async (event) => {
        emitted.push(event);
      },
      getPackageSecretsEnv: async () => ({ OPENAI_API_KEY: "sk-agent" }),
      getChannelRecord: async () => ({ id: "chan-1", name: "payments" }) as any,
    },
    skillRoots: [],
    connect: (url, headers) => {
      const socket = new FakeSocket(url, headers);
      sockets.push(socket);
      return socket;
    },
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      fetches.push({ url: String(url), init });
      return new Response(null, { status: 200 });
    }) as typeof fetch,
    executeTool: async (_ctx, tool, args) => {
      toolCalls.push({ tool, args });
      return { ok: true, files: ["a.txt"] };
    },
  });
  return { manager, sockets, emitted, fetches, toolCalls };
}

async function attachCall(
  ctx: ReturnType<typeof setup>,
  inputAgent: Agent = agent,
  event?: Event,
) {
  const startEvent =
    event ??
    callStarted({
      payload: { ...(callStarted().payload as Record<string, unknown>), targetAgentName: inputAgent.name },
    });
  expect(ctx.manager.consume(inputAgent, [startEvent])).toEqual([]);
  await flush();
  const socket = ctx.sockets[0]!;
  socket.fire("open", {});
  await ctx.manager.idle();
  await flush();
  return socket;
}

describe("realtime voice manager", () => {
  it("attaches to the call and syncs instructions, history, and runner tools", async () => {
    const ctx = setup();
    const socket = await attachCall(ctx);

    expect(socket.url).toBe("wss://api.openai.com/v1/realtime?call_id=rtc_1");
    expect(socket.headers.Authorization).toBe("Bearer sk-agent");
    const update = socket.sent.find((message) => message.type === "session.update");
    expect(update.session.type).toBe("realtime");
    expect(update.session.instructions).toContain("live channel voice room with alice");
    expect(update.session.instructions).toContain("payments on-call desk");
    expect(update.session.instructions).toContain("human:bob: Deploy is at 3pm.");
    const shellRun = update.session.tools.find((tool: any) => tool.name === "shell_run");
    expect(shellRun).toMatchObject({ type: "function", parameters: { type: "object" } });
    expect(shellRun.parameters.required).toContain("cmd");
    expect(update.session.tools.map((tool: any) => tool.name)).toContain("events_schedule_self");
    expect(update.session.tools.map((tool: any) => tool.name)).toContain("events_scheduled_create");
    expect(ctx.manager.hasActiveCall("voice-agent", "chan-1")).toBe(true);
  });

  it("hides delayed scheduling tools when model capabilities disable classic turns", async () => {
    const ctx = setup();
    const realtimeOnlyAgent = {
      ...agent,
      name: "realtime-only-agent",
      modelCapabilities: { realtimeAudioInput: true, realtimeAudioOutput: true, classicTurns: false },
    };
    const socket = await attachCall(
      ctx,
      realtimeOnlyAgent,
      callStarted({
        payload: {
          ...(callStarted().payload as Record<string, unknown>),
          targetAgentName: "realtime-only-agent",
        },
      }),
    );

    expect(socket.url).toContain("api.openai.com");
    const update = socket.sent.find((message) => message.type === "session.update");
    expect(update.session.tools.map((tool: any) => tool.name)).not.toContain("events_schedule_self");
    expect(update.session.tools.map((tool: any) => tool.name)).not.toContain("events_scheduled_create");
  });

  it("posts the human utterance before the agent reply even when transcription lands late", async () => {
    const ctx = setup();
    const socket = await attachCall(ctx);

    socket.server({ type: "input_audio_buffer.committed", item_id: "item_user" });
    socket.server({ type: "response.created", response: { id: "resp_1" } });
    socket.server({ type: "response.output_audio_transcript.done", response_id: "resp_1", transcript: "Two incidents are open." });
    socket.server({ type: "response.done", response: { id: "resp_1", status: "completed", output: [] } });
    await ctx.manager.idle();
    expect(ctx.emitted.filter((event) => event.type === "message.created")).toHaveLength(0);

    socket.server({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_user",
      transcript: "What incidents are open?",
    });
    await ctx.manager.idle();

    const messages = ctx.emitted.filter((event) => event.type === "message.created");
    expect(messages.map((event) => [event.source, event.payload.text])).toEqual([
      ["human:alice", "What incidents are open?"],
      ["agent:voice-agent", "Two incidents are open."],
    ]);
    expect(messages[0].payload.voice).toMatchObject({ mode: "realtime", callId: "rtc_1", speakerId: "alice" });
    expect(messages[1].payload.voice).toMatchObject({ mode: "realtime", agentName: "voice-agent" });
  });

  it("runs tool calls on the host and continues the response", async () => {
    const ctx = setup();
    const socket = await attachCall(ctx);

    socket.server({
      type: "response.done",
      response: {
        id: "resp_tool",
        status: "completed",
        output: [{ type: "function_call", call_id: "call_1", name: "fs_list", arguments: '{"path":"."}' }],
      },
    });
    await ctx.manager.idle();

    expect(ctx.toolCalls).toEqual([{ tool: "fs_list", args: { path: "." } }]);
    const output = socket.sent.find((message) => message.type === "conversation.item.create");
    expect(output.item).toMatchObject({ type: "function_call_output", call_id: "call_1" });
    expect(JSON.parse(output.item.output)).toEqual({ ok: true, files: ["a.txt"] });
    expect(socket.sent.at(-1)).toEqual({ type: "response.create" });
    expect(ctx.emitted.map((event) => event.type)).toEqual(
      expect.arrayContaining(["tool.started", "tool.executed"]),
    );
  });

  it("feeds channel text into the call instead of starting a text turn", async () => {
    const ctx = setup();
    const socket = await attachCall(ctx);
    const typed: Event = {
      id: "m2",
      type: "message.created",
      source: "human:bob",
      channelId: "chan-1",
      payload: { text: "Rollback finished." },
    };
    const otherChannel: Event = { ...typed, id: "m3", channelId: "chan-2" };

    expect(ctx.manager.consume(agent, [typed, otherChannel])).toEqual([otherChannel]);
    await ctx.manager.idle();

    const note = socket.sent.find((message) => message.type === "conversation.item.create");
    expect(note.item.content[0].text).toBe("[channel] human:bob: Rollback finished.");
  });

  it("shows images to the call and saves attachments into the agent workspace", async () => {
    const ctx = setup();
    const socket = await attachCall(ctx);
    const posted: Event = {
      id: "m4",
      type: "message.created",
      source: "human:bob",
      channelId: "chan-1",
      payload: {
        text: "Attached 2 files.",
        attachments: [
          { fileId: "img-1", name: "chart.png", mime: "image/png", size: 3 },
          { fileId: "pdf-1", name: "report.pdf", mime: "application/pdf", size: 3 },
        ],
      },
    };

    ctx.manager.consume(agent, [posted]);
    await ctx.manager.idle();

    const note = socket.sent.find((message) => message.type === "conversation.item.create");
    const imagePath = join(agent.workspacePath, ".orgops-attachments", "img-1", "chart.png");
    const pdfPath = join(agent.workspacePath, ".orgops-attachments", "pdf-1", "report.pdf");
    expect(note.item.content[0].text).toContain(`chart.png (image/png): ${imagePath}`);
    expect(note.item.content[0].text).toContain(`report.pdf (application/pdf): ${pdfPath}`);
    expect(note.item.content.slice(1)).toEqual([
      { type: "input_image", image_url: "data:image/png;base64,AQID" },
    ]);
    expect(readFileSync(pdfPath)).toEqual(Buffer.from([1, 2, 3]));
  });

  it("hangs up when the human ends the call and reports runner-side disconnects", async () => {
    const ctx = setup();
    const socket = await attachCall(ctx);

    ctx.manager.consume(agent, [
      {
        id: "evt-end",
        type: "voice.realtime.call.ended",
        source: "human:alice",
        channelId: "chan-1",
        payload: { targetAgentName: "voice-agent", callId: "rtc_1", endedAt: 2, reason: "left" },
      },
    ]);
    await ctx.manager.idle();

    expect(ctx.fetches[0]?.url).toBe("https://api.openai.com/v1/realtime/calls/rtc_1/hangup");
    expect(socket.closed).toBe(true);
    expect(ctx.manager.hasActiveCall("voice-agent", "chan-1")).toBe(false);
    expect(ctx.emitted.some((event) => event.type === "voice.realtime.call.ended")).toBe(false);

    const second = setup();
    const dropped = await attachCall(second);
    dropped.close();
    await second.manager.idle();
    expect(second.emitted.find((event) => event.type === "voice.realtime.call.ended")).toMatchObject({
      source: "agent:voice-agent",
      payload: { callId: "rtc_1", reason: "disconnected" },
    });
  });

  it("ignores calls meant for another agent", async () => {
    const ctx = setup();
    ctx.manager.consume(agent, [
      callStarted({ payload: { ...(callStarted().payload as object), targetAgentName: "someone-else" } }),
    ]);
    await flush();
    expect(ctx.sockets).toHaveLength(0);
  });

  it("posts LiveKit human transcripts before agent replies even when they land late", async () => {
    const sockets: FakeSocket[] = [];
    const emitted: any[] = [];
    const interrupted: string[] = [];
    let onAudio: ((frame: { pcm: Int16Array; sampleRate: number; identity: string }) => void) | undefined;
    const manager = createRealtimeVoiceManager({
      api: {
        apiFetch: async (path) => {
          if (path === "/api/voice/rooms/agent-join") {
            return new Response(
              JSON.stringify({
                broker: "livekit",
                url: "ws://127.0.0.1:7880",
                token: "lk-token",
                identity: "agent:voice-agent",
              }),
            );
          }
          return new Response(JSON.stringify([]));
        },
        emitEvent: async (event) => {
          emitted.push(event);
        },
        getPackageSecretsEnv: async () => ({ OPENAI_API_KEY: "sk-agent" }),
        getChannelRecord: async () => ({ id: "chan-1", name: "payments" }) as any,
      },
      skillRoots: [],
      connect: (url, headers) => {
        const socket = new FakeSocket(url, headers);
        sockets.push(socket);
        return socket;
      },
      createLiveKitRoom: (input) => {
        onAudio = input.onAudio;
        return {
          connect: async () => undefined,
          disconnect: async () => undefined,
          interrupt: () => interrupted.push("cleared"),
          flush: async () => undefined,
          publish: async () => undefined,
        };
      },
    });

    manager.consume(agent, [
      {
        id: "evt-room",
        type: "voice.room.started",
        source: "human:alice",
        channelId: "chan-1",
        payload: {
          roomId: "room-1",
          sessionId: "session-1",
          broker: "livekit",
          agentNames: ["voice-agent"],
          startedAt: 1,
        },
      },
    ]);
    await manager.idle();
    const socket = sockets[0]!;
    socket.fire("open", {});
    socket.server({ type: "session.created" });
    socket.server({ type: "session.updated" });
    onAudio?.({ pcm: new Int16Array([1, 2, 3, 4]), sampleRate: 48_000, identity: "human:alice" });
    socket.server({ type: "input_audio_buffer.speech_started" });
    expect(emitted.filter((event) => event.type === "message.created")).toHaveLength(0);
    socket.server({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_user",
      transcript: "Hello",
    });
    await manager.idle();
    expect(socket.sent.filter((message) => message.type === "response.create")).toEqual([
      { type: "response.create" },
    ]);
    socket.server({ type: "response.created", response: { id: "resp_1" } });
    socket.server({
      type: "response.output_audio_transcript.done",
      response_id: "resp_1",
      transcript: "Hi there, welcome to the room!",
    });
    socket.server({ type: "response.done", response: { id: "resp_1", status: "completed", output: [] } });
    await manager.idle();
    expect(interrupted.length).toBeGreaterThanOrEqual(0);
    expect(
      emitted.filter((event) => event.type === "message.created").map((event) => [event.source, event.payload.text]),
    ).toEqual([
      ["human:alice", "Hello"],
      ["agent:voice-agent", "Hi there, welcome to the room!"],
    ]);
    await manager.endAll("test");
  });

  it("forwards one agent's spoken line into the other agent's live session without a reply", async () => {
    const sockets: FakeSocket[] = [];
    const peer: Agent = { ...agent, name: "voice-agent-2" };
    const manager = createRealtimeVoiceManager({
      api: {
        apiFetch: async (path) => {
          if (path === "/api/voice/rooms/agent-join") {
            return new Response(
              JSON.stringify({
                broker: "livekit",
                url: "ws://127.0.0.1:7880",
                token: "lk-token",
                identity: "agent:peer",
              }),
            );
          }
          return new Response(JSON.stringify([]));
        },
        emitEvent: async () => undefined,
        getPackageSecretsEnv: async () => ({ OPENAI_API_KEY: "sk-agent" }),
        getChannelRecord: async () => ({ id: "chan-1", name: "payments" }) as any,
      },
      skillRoots: [],
      connect: (url, headers) => {
        const socket = new FakeSocket(url, headers);
        sockets.push(socket);
        return socket;
      },
      createLiveKitRoom: () => ({
        connect: async () => undefined,
        disconnect: async () => undefined,
        interrupt: () => undefined,
        flush: async () => undefined,
        publish: async () => undefined,
      }),
    });
    const started: Event = {
      id: "evt-room",
      type: "voice.room.started",
      source: "human:alice",
      channelId: "chan-1",
      payload: {
        roomId: "room-1",
        sessionId: "session-1",
        broker: "livekit",
        agentNames: ["voice-agent", "voice-agent-2"],
        startedAt: 1,
      },
    };
    manager.consume(agent, [started]);
    manager.consume(peer, [{ ...started, id: "evt-room-2" }]);
    await manager.idle();
    expect(sockets).toHaveLength(2);
    for (const socket of sockets) {
      socket.fire("open", {});
      socket.server({ type: "session.created" });
      socket.server({ type: "session.updated" });
    }
    sockets[0]!.server({ type: "response.created", response: { id: "resp_a" } });
    sockets[0]!.server({
      type: "response.output_audio_transcript.done",
      response_id: "resp_a",
      transcript: "I am agent one.",
    });
    sockets[0]!.server({ type: "response.done", response: { id: "resp_a", status: "completed", output: [] } });
    await manager.idle();
    const peerNotes = sockets[1]!.sent.filter((message) => message.type === "conversation.item.create");
    expect(peerNotes.map((message) => message.item.content[0].text)).toEqual([
      "[voice] agent:voice-agent: I am agent one.",
    ]);
    expect(sockets[1]!.sent.filter((message) => message.type === "response.create")).toEqual([]);
    await manager.endAll("test");
  });

  it("hangs up the LiveKit room when the last human leaves", async () => {
    const emitted: any[] = [];
    let humansLeft: (() => void) | undefined;
    const manager = createRealtimeVoiceManager({
      api: {
        apiFetch: async (path) => {
          if (path === "/api/voice/rooms/agent-join") {
            return new Response(
              JSON.stringify({
                broker: "livekit",
                url: "ws://127.0.0.1:7880",
                token: "lk-token",
                identity: "agent:voice-agent",
              }),
            );
          }
          return new Response(JSON.stringify([]));
        },
        emitEvent: async (event) => {
          emitted.push(event);
        },
        getPackageSecretsEnv: async () => ({ OPENAI_API_KEY: "sk-agent" }),
        getChannelRecord: async () => ({ id: "chan-1", name: "payments" }) as any,
      },
      skillRoots: [],
      connect: (url, headers) => new FakeSocket(url, headers),
      createLiveKitRoom: ({ onHumansLeft }) => {
        humansLeft = onHumansLeft;
        return {
          connect: async () => undefined,
          disconnect: async () => undefined,
          interrupt: () => undefined,
          flush: async () => undefined,
          publish: async () => undefined,
        };
      },
    });
    manager.consume(agent, [
      {
        id: "evt-room",
        type: "voice.room.started",
        source: "human:alice",
        channelId: "chan-1",
        payload: {
          roomId: "room-1",
          sessionId: "session-1",
          broker: "livekit",
          agentNames: ["voice-agent"],
          startedAt: 1,
        },
      },
    ]);
    await manager.idle();
    expect(manager.hasActiveCall("voice-agent", "chan-1")).toBe(true);
    humansLeft?.();
    await manager.idle();
    expect(manager.hasActiveCall("voice-agent", "chan-1")).toBe(false);
    expect(emitted.find((event) => event.type === "voice.room.ended")).toMatchObject({
      source: "agent:voice-agent",
      payload: { roomId: "room-1", reason: "humans_left" },
    });
  });

  it("uses other agents as local barge-in signals and posts the human transcript once", async () => {
    const sockets: FakeSocket[] = [];
    const emitted: any[] = [];
    const interrupted: string[] = [];
    const onAudios: Array<(frame: { pcm: Int16Array; sampleRate: number; identity: string }) => void> = [];
    const peer: Agent = { ...agent, name: "voice-agent-2" };
    const manager = createRealtimeVoiceManager({
      api: {
        apiFetch: async (path) => {
          if (path === "/api/voice/rooms/agent-join") {
            return new Response(
              JSON.stringify({
                broker: "livekit",
                url: "ws://127.0.0.1:7880",
                token: "lk-token",
                identity: "agent:peer",
              }),
            );
          }
          return new Response(JSON.stringify([]));
        },
        emitEvent: async (event) => {
          emitted.push(event);
        },
        getPackageSecretsEnv: async () => ({ OPENAI_API_KEY: "sk-agent" }),
        getChannelRecord: async () => ({ id: "chan-1", name: "payments" }) as any,
      },
      skillRoots: [],
      connect: (url, headers) => {
        const socket = new FakeSocket(url, headers);
        sockets.push(socket);
        return socket;
      },
      createLiveKitRoom: ({ onAudio }) => {
        onAudios.push(onAudio);
        return {
          connect: async () => undefined,
          disconnect: async () => undefined,
          interrupt: () => interrupted.push("cleared"),
          flush: async () => undefined,
          publish: async () => undefined,
        };
      },
    });
    const started: Event = {
      id: "evt-room",
      type: "voice.room.started",
      source: "human:alice",
      channelId: "chan-1",
      payload: {
        roomId: "room-1",
        sessionId: "session-1",
        broker: "livekit",
        agentNames: ["voice-agent", "voice-agent-2"],
        startedAt: 1,
      },
    };
    manager.consume(agent, [started]);
    manager.consume(peer, [{ ...started, id: "evt-room-2" }]);
    await manager.idle();
    for (const socket of sockets) {
      socket.fire("open", {});
      socket.server({ type: "session.created" });
      socket.server({ type: "session.updated" });
    }
    const pcm = new Int16Array([1, 2, 3, 4]);
    const before = sockets[0]!.sent.length;
    onAudios[0]!({ pcm, sampleRate: 48_000, identity: "agent:voice-agent" });
    expect(sockets[0]!.sent).toHaveLength(before);
    sockets[0]!.server({ type: "response.created", response: { id: "resp-active" } });
    onAudios[0]!({ pcm, sampleRate: 48_000, identity: "agent:voice-agent-2" });
    expect(sockets[0]!.sent.at(-2)?.type).toBe("response.cancel");
    expect(sockets[0]!.sent.at(-1)?.type).toBe("input_audio_buffer.append");
    expect(interrupted.length).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 650));
    for (const [index, socket] of sockets.entries()) {
      onAudios[index]!({ pcm, sampleRate: 48_000, identity: "human:alice" });
      socket.server({ type: "input_audio_buffer.speech_started" });
      socket.server({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "hello",
        transcript: "Hello there",
      });
    }
    await manager.idle();
    expect(
      emitted.filter((event) => event.type === "message.created" && event.source === "human:alice").map((event) => event.payload.text),
    ).toEqual(["Hello there"]);
    await manager.endAll("test");
  });

  it("attaches LiveKit room sessions for Gemini/Liquid agents without OpenAI WebRTC", async () => {
    const published: Array<{ pcm: Int16Array; sampleRate: number }> = [];
    const sockets: FakeSocket[] = [];
    const livekitJoins: string[] = [];
    const geminiAgent: Agent = {
      ...agent,
      name: "gemini-agent",
      modelId: "google:gemini-2.5-flash-native-audio-preview-09-2025",
      modelCapabilities: { realtimeAudioInput: true, realtimeAudioOutput: true },
    };
    const manager = createRealtimeVoiceManager({
      api: {
        apiFetch: async (path, init) => {
          if (path === "/api/voice/rooms/agent-join") {
            livekitJoins.push(String(init?.body ?? ""));
            return new Response(
              JSON.stringify({
                broker: "livekit",
                url: "ws://127.0.0.1:7880",
                token: "lk-token",
                identity: "agent:gemini-agent",
              }),
            );
          }
          return new Response(JSON.stringify([]));
        },
        emitEvent: async () => undefined,
        getPackageSecretsEnv: async () => ({ GOOGLE_API_KEY: "gemini-key" }),
        getChannelRecord: async () => ({ id: "chan-1", name: "payments" }) as any,
      },
      skillRoots: [],
      connect: (url, headers) => {
        const socket = new FakeSocket(url, headers);
        sockets.push(socket);
        return socket;
      },
      createLiveKitRoom: ({ onAudio }) => ({
        connect: async () => {
          onAudio({ pcm: new Int16Array([1, 2]), sampleRate: 48000, identity: "human:alice" });
        },
        disconnect: async () => undefined,
        interrupt: () => undefined,
        flush: async () => undefined,
        publish: async (pcm, sampleRate) => {
          published.push({ pcm, sampleRate });
        },
      }),
    });

    manager.consume(geminiAgent, [
      {
        id: "evt-room",
        type: "voice.room.started",
        source: "human:alice",
        channelId: "chan-1",
        payload: {
          roomId: "room-1",
          sessionId: "session-1",
          broker: "livekit",
          agentNames: ["gemini-agent"],
          startedAt: 1,
        },
      },
    ]);
    await manager.idle();
    expect(livekitJoins[0]).toContain("gemini-agent");
    expect(sockets[0]?.url).toContain("generativelanguage.googleapis.com");
    expect(manager.hasActiveCall("gemini-agent", "chan-1")).toBe(true);
    sockets[0]?.fire("open", {});
    sockets[0]?.fire("message", {
      data: JSON.stringify({
        serverContent: {
          modelTurn: { parts: [{ inlineData: { data: Buffer.from(new Int16Array([3]).buffer).toString("base64") } }] },
        },
      }),
    });
    await manager.idle();
    expect(published.length).toBeGreaterThan(0);
    await manager.endAll("test");
    expect(manager.hasActiveCall("gemini-agent", "chan-1")).toBe(false);
  });

  it("does not hang up a LiveKit room when a different room ends", async () => {
    const published: Array<{ pcm: Int16Array; sampleRate: number }> = [];
    const sockets: FakeSocket[] = [];
    const geminiAgent: Agent = {
      ...agent,
      name: "gemini-agent",
      modelId: "google:gemini-2.5-flash-native-audio-preview-09-2025",
      modelCapabilities: { realtimeAudioInput: true, realtimeAudioOutput: true },
    };
    const manager = createRealtimeVoiceManager({
      api: {
        apiFetch: async (path) => {
          if (path === "/api/voice/rooms/agent-join") {
            return new Response(
              JSON.stringify({
                broker: "livekit",
                url: "ws://127.0.0.1:7880",
                token: "lk-token",
                identity: "agent:gemini-agent",
              }),
            );
          }
          return new Response(JSON.stringify([]));
        },
        emitEvent: async () => undefined,
        getPackageSecretsEnv: async () => ({ GOOGLE_API_KEY: "gemini-key" }),
        getChannelRecord: async () => ({ id: "chan-1", name: "payments" }) as any,
      },
      skillRoots: [],
      connect: (url, headers) => {
        const socket = new FakeSocket(url, headers);
        sockets.push(socket);
        return socket;
      },
      createLiveKitRoom: () => ({
        connect: async () => undefined,
        disconnect: async () => undefined,
        interrupt: () => undefined,
        flush: async () => undefined,
        publish: async (pcm, sampleRate) => {
          published.push({ pcm, sampleRate });
        },
      }),
    });

    manager.consume(geminiAgent, [
      {
        id: "evt-room",
        type: "voice.room.started",
        source: "human:alice",
        channelId: "chan-1",
        payload: {
          roomId: "room-keep",
          sessionId: "session-1",
          broker: "livekit",
          agentNames: ["gemini-agent"],
          startedAt: 1,
        },
      },
    ]);
    await manager.idle();
    expect(manager.hasActiveCall("gemini-agent", "chan-1")).toBe(true);

    manager.consume(geminiAgent, [
      {
        id: "evt-other-end",
        type: "voice.room.ended",
        source: "human:alice",
        channelId: "chan-1",
        payload: { roomId: "room-other", reason: "rejoined" },
      },
    ]);
    await manager.idle();
    expect(manager.hasActiveCall("gemini-agent", "chan-1")).toBe(true);

    manager.consume(geminiAgent, [
      {
        id: "evt-end",
        type: "voice.room.ended",
        source: "human:alice",
        channelId: "chan-1",
        payload: { roomId: "room-keep", reason: "left" },
      },
    ]);
    await manager.idle();
    expect(manager.hasActiveCall("gemini-agent", "chan-1")).toBe(false);
  });

  it("requests a realtime response after VAD speech_stopped", async () => {
    const sockets: FakeSocket[] = [];
    let onAudio: ((frame: { pcm: Int16Array; sampleRate: number; identity: string }) => void) | undefined;
    const manager = createRealtimeVoiceManager({
      api: {
        apiFetch: async (path) => {
          if (path === "/api/voice/rooms/agent-join") {
            return new Response(
              JSON.stringify({
                broker: "livekit",
                url: "ws://127.0.0.1:7880",
                token: "lk-token",
                identity: "agent:voice-agent",
              }),
            );
          }
          return new Response(JSON.stringify([]));
        },
        emitEvent: async () => undefined,
        getPackageSecretsEnv: async () => ({ OPENAI_API_KEY: "sk-agent" }),
        getChannelRecord: async () => ({ id: "chan-1", name: "payments" }) as any,
      },
      skillRoots: [],
      connect: (url, headers) => {
        const socket = new FakeSocket(url, headers);
        sockets.push(socket);
        return socket;
      },
      createLiveKitRoom: (input) => {
        onAudio = input.onAudio;
        return {
          connect: async () => undefined,
          disconnect: async () => undefined,
          interrupt: () => undefined,
          flush: async () => undefined,
          publish: async () => undefined,
        };
      },
    });
    manager.consume(agent, [
      {
        id: "evt-room",
        type: "voice.room.started",
        source: "human:alice",
        channelId: "chan-1",
        payload: {
          roomId: "room-1",
          sessionId: "session-1",
          broker: "livekit",
          agentNames: ["voice-agent"],
          startedAt: 1,
        },
      },
    ]);
    await manager.idle();
    const socket = sockets[0]!;
    socket.fire("open", {});
    socket.server({ type: "session.created" });
    socket.server({ type: "session.updated" });
    onAudio?.({ pcm: new Int16Array([1, 2, 3, 4]), sampleRate: 48_000, identity: "human:alice" });
    socket.server({ type: "input_audio_buffer.speech_started" });
    socket.server({ type: "input_audio_buffer.speech_stopped" });
    socket.server({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "hello",
      transcript: "Hello",
    });
    await manager.idle();
    expect(socket.sent.filter((message) => message.type === "response.create")).toEqual([
      { type: "response.create" },
    ]);
    await manager.endAll("test");
  });

  it("defers a pending human response while another agent is talking", async () => {
    const previousStagger = process.env.ORGOPS_REALTIME_RESPONSE_STAGGER_MS;
    process.env.ORGOPS_REALTIME_RESPONSE_STAGGER_MS = "40";
    const sockets: FakeSocket[] = [];
    const onAudios: Array<(frame: { pcm: Int16Array; sampleRate: number; identity: string }) => void> = [];
    const peer: Agent = { ...agent, name: "voice-agent-2" };
    const manager = createRealtimeVoiceManager({
      api: {
        apiFetch: async (path) => {
          if (path === "/api/voice/rooms/agent-join") {
            return new Response(
              JSON.stringify({
                broker: "livekit",
                url: "ws://127.0.0.1:7880",
                token: "lk-token",
                identity: "agent:peer",
              }),
            );
          }
          return new Response(JSON.stringify([]));
        },
        emitEvent: async () => undefined,
        getPackageSecretsEnv: async () => ({ OPENAI_API_KEY: "sk-agent" }),
        getChannelRecord: async () => ({ id: "chan-1", name: "payments" }) as any,
      },
      skillRoots: [],
      connect: (url, headers) => {
        const socket = new FakeSocket(url, headers);
        sockets.push(socket);
        return socket;
      },
      createLiveKitRoom: ({ onAudio }) => {
        onAudios.push(onAudio);
        return {
          connect: async () => undefined,
          disconnect: async () => undefined,
          interrupt: () => undefined,
          flush: async () => undefined,
          publish: async () => undefined,
        };
      },
    });
    try {
      const started: Event = {
        id: "evt-room",
        type: "voice.room.started",
        source: "human:alice",
        channelId: "chan-1",
        payload: {
          roomId: "room-1",
          sessionId: "session-1",
          broker: "livekit",
          agentNames: ["voice-agent", "voice-agent-2"],
          startedAt: 1,
        },
      };
      manager.consume(agent, [started]);
      manager.consume(peer, [{ ...started, id: "evt-room-2" }]);
      await manager.idle();
      for (const socket of sockets) {
        socket.fire("open", {});
        socket.server({ type: "session.created" });
        socket.server({ type: "session.updated" });
      }
      onAudios[1]!({ pcm: new Int16Array([9, 10, 11, 12]), sampleRate: 48_000, identity: "human:alice" });
      sockets[1]!.server({ type: "input_audio_buffer.speech_started" });
      sockets[1]!.server({ type: "input_audio_buffer.speech_stopped" });
      sockets[1]!.server({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "hello-2",
        transcript: "voice agent 2 what do you think?",
      });
      onAudios[1]!({ pcm: new Int16Array([1, 2, 3, 4]), sampleRate: 48_000, identity: "agent:voice-agent" });
      onAudios[0]!({ pcm: new Int16Array([9, 10, 11, 12]), sampleRate: 48_000, identity: "human:alice" });
      sockets[0]!.server({ type: "input_audio_buffer.speech_started" });
      sockets[0]!.server({ type: "input_audio_buffer.speech_stopped" });
      sockets[0]!.server({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "hello-1",
        transcript: "voice agent 2 what do you think?",
      });
      await manager.idle();
      expect(sockets[1]!.sent.some((message) => message.type === "input_audio_buffer.append")).toBe(true);
      expect(sockets[1]!.sent.filter((message) => message.type === "response.create")).toEqual([
        { type: "response.create" },
      ]);
      expect(sockets[0]!.sent.filter((message) => message.type === "response.create")).toEqual([]);

      onAudios[1]!({ pcm: new Int16Array([5, 6, 7, 8]), sampleRate: 48_000, identity: "human:alice" });
      expect(sockets[1]!.sent.at(-1)?.type).toBe("input_audio_buffer.append");
      sockets[1]!.server({ type: "input_audio_buffer.speech_started" });
      sockets[1]!.server({ type: "input_audio_buffer.speech_stopped" });
      sockets[1]!.server({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "hello-3",
        transcript: "And now?",
      });
      await manager.idle();
      expect(sockets[1]!.sent.filter((message) => message.type === "response.create")).toEqual([
        { type: "response.create" },
        { type: "response.create" },
      ]);
    } finally {
      if (previousStagger === undefined) delete process.env.ORGOPS_REALTIME_RESPONSE_STAGGER_MS;
      else process.env.ORGOPS_REALTIME_RESPONSE_STAGGER_MS = previousStagger;
      await manager.endAll("test");
    }
  });
});
