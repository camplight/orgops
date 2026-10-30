import { resamplePcm16 } from "./pcm";
import {
  defaultVoiceSocket,
  encodeBase64Pcm16,
  decodeBase64Pcm16,
  httpToWebSocketUrl,
  parseRealtimeJson,
  readRealtimeSocketText,
  type VoiceRuntimeConnectInput,
  type VoiceRuntimeSession,
} from "./types";

const DEFAULT_RATE = 24_000;

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function openaiRealtimeVadConfig() {
  return {
    type: "server_vad" as const,
    threshold: clamp(Number(process.env.ORGOPS_REALTIME_VAD_THRESHOLD ?? 0.55), 0.1, 1),
    prefix_padding_ms: Math.round(clamp(Number(process.env.ORGOPS_REALTIME_VAD_PREFIX_MS ?? 300), 0, 2_000)),
    silence_duration_ms: Math.round(clamp(Number(process.env.ORGOPS_REALTIME_VAD_SILENCE_MS ?? 1_100), 200, 4_000)),
    create_response: false,
    interrupt_response: true,
  };
}

export function openaiCompatibleRealtimeUrl(baseUrl: string, model: string) {
  const http = baseUrl.trim().replace(/\/+$/, "");
  const withV1 = /\/v1$/i.test(http) ? http : `${http}/v1`;
  return `${httpToWebSocketUrl(withV1)}/realtime?model=${encodeURIComponent(model)}`;
}

export function connectOpenAiCompatibleRuntime(input: VoiceRuntimeConnectInput): VoiceRuntimeSession {
  const connect = input.connect ?? defaultVoiceSocket;
  const url = openaiCompatibleRealtimeUrl(input.baseUrl || "https://api.openai.com/v1", input.model);
  const socket = connect(url, {
    Authorization: `Bearer ${input.apiKey}`,
  });
  let closed = false;
  let opened = false;
  let sessionReady = false;
  let updateSent = false;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  const pending: Record<string, unknown>[] = [];

  function emitAudio(data: string, sampleRate = DEFAULT_RATE) {
    const pcm = decodeBase64Pcm16(data);
    if (pcm.length) input.onEvent({ type: "audio", pcm, sampleRate });
  }

  function flushPending() {
    const queued = pending.splice(0);
    for (const message of queued) send(message);
  }

  function markReady() {
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = undefined;
    }
    if (sessionReady) return;
    sessionReady = true;
    flushPending();
    input.onEvent({ type: "ready" });
  }

  function scheduleReady(ms: number) {
    if (sessionReady || readyTimer) return;
    readyTimer = setTimeout(markReady, ms);
  }

  function send(message: Record<string, unknown>) {
    if (closed) return;
    if (!opened || (!sessionReady && message.type !== "session.update")) {
      pending.push(message);
      return;
    }
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      input.onEvent({ type: "error", message: String(error) });
    }
  }

  function sendSessionUpdate() {
    if (updateSent || closed || !opened) return;
    updateSent = true;
    send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: input.instructions,
        output_modalities: ["audio"],
        tools: input.tools.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
        tool_choice: "auto",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: DEFAULT_RATE },
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: openaiRealtimeVadConfig(),
          },
          output: {
            format: { type: "audio/pcm", rate: DEFAULT_RATE },
            voice: process.env.ORGOPS_REALTIME_VOICE?.trim() || "marin",
          },
        },
      },
    });
  }

  socket.addEventListener("open", () => {
    opened = true;
    scheduleReady(1_200);
  });

  function handleServerMessage(raw: string) {
    const parsed = parseRealtimeJson(raw);
    if (!parsed) return;
    switch (parsed?.type) {
      case "session.created":
        sendSessionUpdate();
        scheduleReady(800);
        return;
      case "session.updated":
        markReady();
        return;
      case "input_audio_buffer.speech_started":
        input.onEvent({ type: "speech_started" });
        return;
      case "input_audio_buffer.speech_stopped":
        input.onEvent({ type: "speech_stopped" });
        return;
      case "conversation.item.input_audio_transcription.completed":
        input.onEvent({
          type: "user_transcript",
          itemId: String(parsed.item_id ?? ""),
          text: String(parsed.transcript ?? "").trim(),
        });
        return;
      case "response.created":
        if (parsed.response?.id) {
          input.onEvent({ type: "assistant_started", responseId: String(parsed.response.id) });
        }
        return;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
      case "response.output_text.done":
        input.onEvent({
          type: "assistant_transcript",
          responseId: String(parsed.response_id ?? ""),
          text: String(parsed.transcript ?? parsed.text ?? "").trim(),
        });
        return;
      case "response.output_audio.delta":
      case "response.audio.delta":
        if (typeof parsed.delta === "string") emitAudio(parsed.delta);
        return;
      case "response.done": {
        const output = Array.isArray(parsed.response?.output) ? parsed.response.output : [];
        for (const item of output) {
          if (item?.type === "function_call") {
            input.onEvent({
              type: "tool_call",
              callId: String(item.call_id ?? ""),
              name: String(item.name ?? ""),
              arguments: String(item.arguments ?? "{}"),
            });
          }
        }
        input.onEvent({
          type: "assistant_done",
          responseId: String(parsed.response?.id ?? ""),
          interrupted: parsed.response?.status === "cancelled",
        });
        return;
      }
      case "error":
        markReady();
        input.onEvent({
          type: "error",
          message: String(parsed.error?.message ?? parsed.error ?? "realtime error"),
        });
        return;
      default:
        return;
    }
  }

  socket.addEventListener("message", (message: { data?: unknown }) => {
    if (typeof message.data === "string") {
      handleServerMessage(message.data);
      return;
    }
    void readRealtimeSocketText(message.data)
      .then(handleServerMessage)
      .catch(() => undefined);
  });
  socket.addEventListener("close", () => {
    closed = true;
    input.onEvent({ type: "closed" });
  });

  return {
    provider: input.provider,
    model: input.model,
    inputSampleRate: DEFAULT_RATE,
    outputSampleRate: DEFAULT_RATE,
    sendAudio(pcm, sampleRate) {
      const resampled = resamplePcm16(pcm, sampleRate, DEFAULT_RATE);
      if (!resampled.length) return;
      send({
        type: "input_audio_buffer.append",
        audio: encodeBase64Pcm16(resampled),
      });
    },
    sendText(text, images = [], options = {}) {
      send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text },
            ...images.map((image) => ({ type: "input_image", image_url: image.image_url })),
          ],
        },
      });
      if (options.createResponse !== false) send({ type: "response.create" });
    },
    sendToolResult(callId, output) {
      send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output },
      });
      send({ type: "response.create" });
    },
    requestResponse() {
      send({ type: "response.create" });
    },
    cancelResponse() {
      send({ type: "response.cancel" });
    },
    close() {
      closed = true;
      if (readyTimer) clearTimeout(readyTimer);
      try {
        socket.close(1000, "ended");
      } catch {}
    },
  };
}
