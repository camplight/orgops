import type { EventRow } from "../../types";

export function messageText(event: EventRow) {
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  if (event.type === "agent.turn.failed") {
    const error = (payload as { error?: unknown }).error;
    return typeof error === "string" ? `Agent error: ${error}` : "Agent failed to respond.";
  }
  const text = (payload as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

export type SensitiveMessagePayload = {
  ciphertextB64: string;
  hint?: string;
  requiresPassword: boolean;
};

export function sensitiveMessagePayload(event: EventRow): SensitiveMessagePayload | null {
  if (event.type !== "message.created") return null;
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const sensitiveRaw = (payload as { sensitive?: unknown }).sensitive;
  if (!sensitiveRaw || typeof sensitiveRaw !== "object" || Array.isArray(sensitiveRaw)) return null;
  const ciphertextB64 = (sensitiveRaw as { ciphertextB64?: unknown }).ciphertextB64;
  if (typeof ciphertextB64 !== "string" || !ciphertextB64.trim()) return null;
  const hint = (sensitiveRaw as { hint?: unknown }).hint;
  const requiresPasswordRaw = (sensitiveRaw as { requiresPassword?: unknown }).requiresPassword;
  return {
    ciphertextB64: ciphertextB64.trim(),
    hint: typeof hint === "string" && hint.trim() ? hint.trim() : undefined,
    requiresPassword: requiresPasswordRaw !== false
  };
}

export function isHiddenUiActionMessage(event: EventRow) {
  if (event.type !== "message.created") return false;
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const payloadRecord = payload as { eventType?: unknown; text?: unknown };
  if (payloadRecord.eventType === "ui.json-render.action") return true;
  const text = typeof payloadRecord.text === "string" ? payloadRecord.text.trim() : "";
  return text.toLowerCase().startsWith("json-render action:");
}

export function sourceLabel(source: string) {
  if (source.startsWith("human:")) return source.slice("human:".length) || "Human";
  if (source.startsWith("agent:")) return source.slice("agent:".length) || "Agent";
  return source || "System";
}

export function messageRole(source: string) {
  if (source.startsWith("human:")) return "human";
  if (source.startsWith("agent:")) return "agent";
  return "system";
}

export function messageDisplayTime(event: EventRow) {
  return event.deliverAt ?? event.createdAt;
}
