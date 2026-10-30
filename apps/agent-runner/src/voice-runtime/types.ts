export type RealtimeSocket = {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (type: string, listener: (event: any) => void) => void;
};

export type VoiceRuntimeTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type VoiceRuntimeEvent =
  | { type: "audio"; pcm: Int16Array; sampleRate: number }
  | { type: "speech_started" }
  | { type: "speech_stopped" }
  | { type: "user_transcript"; itemId: string; text: string }
  | { type: "assistant_started"; responseId: string }
  | { type: "assistant_transcript"; responseId: string; text: string }
  | { type: "assistant_done"; responseId: string; interrupted?: boolean }
  | { type: "tool_call"; callId: string; name: string; arguments: string }
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "closed"; reason?: string };

export type VoiceRuntimeSession = {
  provider: string;
  model: string;
  inputSampleRate: number;
  outputSampleRate: number;
  sendAudio: (pcm: Int16Array, sampleRate: number) => void;
  sendText: (
    text: string,
    images?: Array<{ image_url: string }>,
    options?: { createResponse?: boolean },
  ) => void;
  sendToolResult: (callId: string, output: string) => void;
  requestResponse: () => void;
  cancelResponse: () => void;
  close: (reason?: string) => void;
};

export type VoiceRuntimeConnectInput = {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  instructions: string;
  tools: VoiceRuntimeTool[];
  onEvent: (event: VoiceRuntimeEvent) => void;
  connect?: (url: string, headers?: Record<string, string>) => RealtimeSocket;
};

export async function readRealtimeSocketText(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data as ArrayBufferView);
  }
  return String(data ?? "");
}

export function parseRealtimeJson(data: unknown): any | null {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function defaultVoiceSocket(url: string, headers: Record<string, string> = {}): RealtimeSocket {
  const WebSocketCtor = globalThis.WebSocket as unknown as new (
    url: string,
    init?: { headers: Record<string, string> },
  ) => RealtimeSocket;
  return Object.keys(headers).length > 0 ? new WebSocketCtor(url, { headers }) : new WebSocketCtor(url);
}

export function httpToWebSocketUrl(url: string) {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length)}`;
  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length)}`;
  return trimmed;
}

export function decodeBase64Pcm16(data: string): Int16Array {
  const bytes = Buffer.from(data, "base64");
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const pcm = new Int16Array(sampleCount);
  const src = new Uint8Array(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  new Uint8Array(pcm.buffer).set(src);
  return pcm;
}

export function encodeBase64Pcm16(pcm: Int16Array): string {
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString("base64");
}
