import { describe, expect, it } from "vitest";
import { connectVoiceRuntime, geminiLiveUrl, openaiCompatibleRealtimeUrl, resamplePcm16 } from "./index";
import { takePcmFrames } from "./pcm";
import type { RealtimeSocket, VoiceRuntimeEvent } from "./types";

class FakeSocket implements RealtimeSocket {
  sent: any[] = [];
  private listeners = new Map<string, Array<(event: any) => void>>();
  constructor(
    readonly url: string,
    readonly headers: Record<string, string> = {},
  ) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("voice runtime adapters", () => {
  it("resamples PCM without changing amplitude at the same rate", () => {
    const pcm = new Int16Array([0, 1000, -1000]);
    expect(resamplePcm16(pcm, 16000, 16000)).toEqual(pcm);
    expect(resamplePcm16(pcm, 16000, 24000).length).toBeGreaterThan(pcm.length);
  });

  it("splits PCM into fixed frames without dropping leftover samples", () => {
    const pcm = new Int16Array([1, 2, 3, 4, 5]);
    expect(takePcmFrames(pcm, 2)).toEqual({
      frames: [new Int16Array([1, 2]), new Int16Array([3, 4])],
      rest: new Int16Array([5]),
    });
  });

  it("connects OpenAI-compatible realtime sessions and forwards audio plus tools", () => {
    const sockets: FakeSocket[] = [];
    const events: VoiceRuntimeEvent[] = [];
    const session = connectVoiceRuntime({
      provider: "liquid",
      model: "lfm3-audio-2b",
      apiKey: "liquid-key",
      baseUrl: "http://127.0.0.1:8080/v1",
      instructions: "You are a voice agent.",
      tools: [{ name: "shell_run", description: "Run a command", parameters: { type: "object" } }],
      onEvent: (event) => events.push(event),
      connect: (url, headers) => {
        const socket = new FakeSocket(url, headers);
        sockets.push(socket);
        return socket;
      },
    });
    const socket = sockets[0]!;
    expect(socket.url).toBe(openaiCompatibleRealtimeUrl("http://127.0.0.1:8080/v1", "lfm3-audio-2b"));
    expect(socket.headers.Authorization).toBe("Bearer liquid-key");
    expect(socket.headers["OpenAI-Beta"]).toBeUndefined();
    session.sendAudio(new Int16Array([7, 8]), 24000);
    expect(socket.sent).toEqual([]);
    socket.fire("open", {});
    expect(socket.sent).toEqual([]);
    socket.fire("message", { data: JSON.stringify({ type: "session.created" }) });
    expect(socket.sent[0]?.type).toBe("session.update");
    expect(socket.sent[0]?.session.type).toBe("realtime");
    expect(socket.sent[0]?.session.output_modalities).toEqual(["audio"]);
    expect(socket.sent[0]?.session.audio?.input?.format).toEqual({ type: "audio/pcm", rate: 24000 });
    expect(socket.sent[0]?.session.audio?.input?.turn_detection).toEqual({
      type: "server_vad",
      threshold: 0.55,
      prefix_padding_ms: 300,
      silence_duration_ms: 1100,
      create_response: false,
      interrupt_response: true,
    });
    expect(socket.sent[0]?.session.audio?.output?.voice).toBe("marin");
    expect(socket.sent[0]?.session.tools[0]?.name).toBe("shell_run");
    expect(socket.sent).toHaveLength(1);
    socket.fire("message", { data: JSON.stringify({ type: "session.updated" }) });
    expect(socket.sent[1]?.type).toBe("input_audio_buffer.append");
    session.sendAudio(new Int16Array([1, 2, 3, 4]), 24000);
    expect(socket.sent.at(-1)?.type).toBe("input_audio_buffer.append");
    socket.fire("message", {
      data: JSON.stringify({
        type: "response.audio.delta",
        delta: Buffer.from(new Int16Array([9, 8]).buffer).toString("base64"),
      }),
    });
    expect(events.some((event) => event.type === "audio")).toBe(true);
    session.requestResponse();
    expect(socket.sent.at(-1)).toEqual({ type: "response.create" });
  });

  it("reads OpenAI-compatible VAD knobs from env", () => {
    const previous = {
      threshold: process.env.ORGOPS_REALTIME_VAD_THRESHOLD,
      prefix: process.env.ORGOPS_REALTIME_VAD_PREFIX_MS,
      silence: process.env.ORGOPS_REALTIME_VAD_SILENCE_MS,
    };
    process.env.ORGOPS_REALTIME_VAD_THRESHOLD = "0.8";
    process.env.ORGOPS_REALTIME_VAD_PREFIX_MS = "120";
    process.env.ORGOPS_REALTIME_VAD_SILENCE_MS = "1600";
    const sockets: FakeSocket[] = [];
    try {
      connectVoiceRuntime({
        provider: "openai",
        model: "gpt-realtime",
        apiKey: "sk-test",
        instructions: "Speak briefly.",
        tools: [],
        onEvent: () => undefined,
        connect: (url, headers) => {
          const socket = new FakeSocket(url, headers ?? {});
          sockets.push(socket);
          return socket;
        },
      });
      sockets[0]!.fire("open", {});
      sockets[0]!.fire("message", { data: JSON.stringify({ type: "session.created" }) });
      expect(sockets[0]!.sent[0]?.session.audio?.input?.turn_detection).toEqual({
        type: "server_vad",
        threshold: 0.8,
        prefix_padding_ms: 120,
        silence_duration_ms: 1600,
        create_response: false,
        interrupt_response: true,
      });
    } finally {
      if (previous.threshold === undefined) delete process.env.ORGOPS_REALTIME_VAD_THRESHOLD;
      else process.env.ORGOPS_REALTIME_VAD_THRESHOLD = previous.threshold;
      if (previous.prefix === undefined) delete process.env.ORGOPS_REALTIME_VAD_PREFIX_MS;
      else process.env.ORGOPS_REALTIME_VAD_PREFIX_MS = previous.prefix;
      if (previous.silence === undefined) delete process.env.ORGOPS_REALTIME_VAD_SILENCE_MS;
      else process.env.ORGOPS_REALTIME_VAD_SILENCE_MS = previous.silence;
    }
  });

  it("connects Gemini Live and maps audio, transcripts, and tool calls", () => {
    const sockets: FakeSocket[] = [];
    const events: VoiceRuntimeEvent[] = [];
    connectVoiceRuntime({
      provider: "google",
      model: "gemini-2.5-flash-native-audio-preview-09-2025",
      apiKey: "gemini-key",
      instructions: "Speak briefly.",
      tools: [{ name: "fs_read", description: "Read a file", parameters: { type: "object" } }],
      onEvent: (event) => events.push(event),
      connect: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    const socket = sockets[0]!;
    expect(socket.url).toBe(geminiLiveUrl("gemini-key"));
    socket.fire("open", {});
    expect(socket.sent[0]?.setup.model).toBe("models/gemini-2.5-flash-native-audio-preview-09-2025");
    socket.fire("message", {
      data: JSON.stringify({
        serverContent: {
          inputTranscription: { text: "hello" },
          outputTranscription: { text: "hi" },
          modelTurn: {
            parts: [{ inlineData: { data: Buffer.from(new Int16Array([1]).buffer).toString("base64") } }],
          },
          turnComplete: true,
        },
      }),
    });
    socket.fire("message", {
      data: JSON.stringify({ toolCall: { functionCalls: [{ id: "c1", name: "fs_read", args: { path: "a.txt" } }] } }),
    });
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["user_transcript", "assistant_transcript", "audio", "assistant_done", "tool_call"]),
    );
  });

  it("decodes Gemini Live websocket blobs before parsing messages", async () => {
    const sockets: FakeSocket[] = [];
    const events: VoiceRuntimeEvent[] = [];
    connectVoiceRuntime({
      provider: "google",
      model: "gemini-2.5-flash-native-audio-preview-09-2025",
      apiKey: "gemini-key",
      instructions: "Speak briefly.",
      tools: [],
      onEvent: (event) => events.push(event),
      connect: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    const socket = sockets[0]!;
    socket.fire("open", {});
    socket.fire("message", {
      data: new Blob([JSON.stringify({ setupComplete: {} })], { type: "application/json" }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toContainEqual({ type: "ready" });
  });

  it("buffers Gemini input transcription fragments until the model responds", () => {
    const sockets: FakeSocket[] = [];
    const events: VoiceRuntimeEvent[] = [];
    connectVoiceRuntime({
      provider: "google",
      model: "gemini-2.5-flash-native-audio-preview-09-2025",
      apiKey: "gemini-key",
      instructions: "Speak briefly.",
      tools: [],
      onEvent: (event) => events.push(event),
      connect: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    const socket = sockets[0]!;
    socket.fire("open", {});
    socket.fire("message", { data: JSON.stringify({ setupComplete: {} }) });
    socket.fire("message", { data: JSON.stringify({ serverContent: { inputTranscription: { text: "I" } } }) });
    socket.fire("message", { data: JSON.stringify({ serverContent: { inputTranscription: { text: "would" } } }) });
    expect(events.filter((event) => event.type === "user_transcript")).toEqual([]);
    socket.fire("message", {
      data: JSON.stringify({ serverContent: { outputTranscription: { text: "Sure." }, turnComplete: true } }),
    });
    expect(events).toContainEqual({ type: "user_transcript", itemId: "gemini-user-1", text: "I would" });
  });
});
