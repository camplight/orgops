import { resamplePcm16 } from "./pcm";
import {
  defaultVoiceSocket,
  decodeBase64Pcm16,
  encodeBase64Pcm16,
  readRealtimeSocketText,
  type VoiceRuntimeConnectInput,
  type VoiceRuntimeSession,
} from "./types";

const INPUT_RATE = 16_000;
const OUTPUT_RATE = 24_000;
const GEMINI_LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export function geminiLiveUrl(apiKey: string) {
  return `${GEMINI_LIVE_URL}?key=${encodeURIComponent(apiKey)}`;
}

export function geminiModelName(model: string) {
  const trimmed = model.trim();
  return trimmed.startsWith("models/") ? trimmed : `models/${trimmed}`;
}

function sanitizeGeminiSchema(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { type: "object" };
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const type = input.type;
  if (typeof type === "string") output.type = type.toUpperCase();
  if (typeof input.description === "string") output.description = input.description;
  if (Array.isArray(input.enum)) output.enum = input.enum.filter((item) => typeof item === "string");
  if (Array.isArray(input.required)) output.required = input.required.filter((item) => typeof item === "string");
  if (input.items) output.items = sanitizeGeminiSchema(input.items);
  if (input.properties && typeof input.properties === "object" && !Array.isArray(input.properties)) {
    const properties: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(input.properties)) {
      properties[key] = sanitizeGeminiSchema(property);
    }
    output.properties = properties;
  }
  if (!output.type) output.type = output.properties ? "OBJECT" : "STRING";
  return output;
}

export function connectGeminiLiveRuntime(input: VoiceRuntimeConnectInput): VoiceRuntimeSession {
  const connect = input.connect ?? defaultVoiceSocket;
  const socket = connect(geminiLiveUrl(input.apiKey));
  let closed = false;
  let opened = false;
  let sessionReady = false;
  const pending: Record<string, unknown>[] = [];
  let responseSeq = 0;
  let currentResponseId = "";
  let inputTranscriptStarted = false;
  let inputTranscriptSeq = 0;
  const inputTranscriptParts: string[] = [];

  function flushPending() {
    const queued = pending.splice(0);
    for (const message of queued) send(message);
  }

  function send(message: Record<string, unknown>) {
    if (closed) return;
    if (!opened || (!sessionReady && !message.setup)) {
      pending.push(message);
      return;
    }
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      input.onEvent({ type: "error", message: String(error) });
    }
  }

  function beginResponse() {
    flushInputTranscript();
    responseSeq += 1;
    currentResponseId = `gemini-${responseSeq}`;
    input.onEvent({ type: "assistant_started", responseId: currentResponseId });
    return currentResponseId;
  }

  function appendInputTranscript(text: string) {
    if (!inputTranscriptStarted) {
      inputTranscriptStarted = true;
      input.onEvent({ type: "speech_started" });
    }
    inputTranscriptParts.push(text);
  }

  function flushInputTranscript() {
    const text = inputTranscriptParts.join(" ").replace(/\s+/g, " ").trim();
    inputTranscriptParts.length = 0;
    if (text) {
      inputTranscriptSeq += 1;
      input.onEvent({ type: "user_transcript", itemId: `gemini-user-${inputTranscriptSeq}`, text });
    }
    if (inputTranscriptStarted) {
      input.onEvent({ type: "speech_stopped" });
      inputTranscriptStarted = false;
    }
  }

  socket.addEventListener("open", () => {
    opened = true;
    send({
      setup: {
        model: geminiModelName(input.model),
        generationConfig: { responseModalities: ["AUDIO"] },
        systemInstruction: { parts: [{ text: input.instructions }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        ...(input.tools.length
          ? {
              tools: [
                {
                  functionDeclarations: input.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: sanitizeGeminiSchema(tool.parameters),
                  })),
                },
              ],
            }
          : {}),
      },
    });
  });

  function handleServerMessage(raw: string) {
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (parsed.setupComplete || parsed.setup_complete) {
      if (!sessionReady) {
        sessionReady = true;
        flushPending();
        input.onEvent({ type: "ready" });
      }
      return;
    }
    const inputText = String(parsed.serverContent?.inputTranscription?.text ?? "").trim();
    if (inputText) {
      appendInputTranscript(inputText);
    }
    const outputText = String(parsed.serverContent?.outputTranscription?.text ?? "").trim();
    if (outputText) {
      const responseId = currentResponseId || beginResponse();
      input.onEvent({ type: "assistant_transcript", responseId, text: outputText });
    }
    const parts = parsed.serverContent?.modelTurn?.parts;
    if (Array.isArray(parts)) {
      const responseId = currentResponseId || beginResponse();
      for (const part of parts) {
        const data = part?.inlineData?.data ?? part?.inline_data?.data;
        if (typeof data === "string" && data) {
          const pcm = decodeBase64Pcm16(data);
          if (pcm.length) input.onEvent({ type: "audio", pcm, sampleRate: OUTPUT_RATE });
        }
        if (typeof part?.text === "string" && part.text.trim()) {
          input.onEvent({ type: "assistant_transcript", responseId, text: part.text.trim() });
        }
      }
    }
    if (parsed.serverContent?.interrupted) {
      flushInputTranscript();
      input.onEvent({
        type: "assistant_done",
        responseId: currentResponseId || `gemini-${responseSeq}`,
        interrupted: true,
      });
      currentResponseId = "";
    } else if (parsed.serverContent?.turnComplete) {
      flushInputTranscript();
      input.onEvent({
        type: "assistant_done",
        responseId: currentResponseId || `gemini-${responseSeq}`,
      });
      currentResponseId = "";
    }
    const calls = parsed.toolCall?.functionCalls ?? parsed.toolCall?.function_calls;
    if (Array.isArray(calls)) {
      flushInputTranscript();
      for (const call of calls) {
        input.onEvent({
          type: "tool_call",
          callId: String(call.id ?? call.callId ?? ""),
          name: String(call.name ?? ""),
          arguments: typeof call.args === "string" ? call.args : JSON.stringify(call.args ?? {}),
        });
      }
    }
    if (parsed.error) {
      input.onEvent({ type: "error", message: String(parsed.error.message ?? parsed.error) });
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
  socket.addEventListener("close", (event: { code?: number; reason?: string } = {}) => {
    closed = true;
    input.onEvent({ type: "closed", reason: event.reason || (event.code ? `code ${event.code}` : undefined) });
  });

  return {
    provider: input.provider,
    model: input.model,
    inputSampleRate: INPUT_RATE,
    outputSampleRate: OUTPUT_RATE,
    sendAudio(pcm, sampleRate) {
      const resampled = resamplePcm16(pcm, sampleRate, INPUT_RATE);
      if (!resampled.length) return;
      send({
        realtimeInput: {
          audio: {
            data: encodeBase64Pcm16(resampled),
            mimeType: `audio/pcm;rate=${INPUT_RATE}`,
          },
        },
      });
    },
    sendText(text, _images = [], options = {}) {
      send({
        clientContent: {
          turns: [{ role: "user", parts: [{ text }] }],
          turnComplete: options.createResponse !== false,
        },
      });
    },
    sendToolResult(callId, output) {
      let parsed: unknown = output;
      try {
        parsed = JSON.parse(output);
      } catch {
        parsed = { result: output };
      }
      send({
        toolResponse: {
          functionResponses: [
            {
              id: callId,
              response: parsed && typeof parsed === "object" ? parsed : { result: output },
            },
          ],
        },
      });
    },
    requestResponse() {},
    cancelResponse() {},
    close() {
      closed = true;
      try {
        socket.close(1000, "ended");
      } catch {}
    },
  };
}
