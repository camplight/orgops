import type { Agent, Event } from "./types";

function getPayloadTargetAgentName(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const targetAgentName = (payload as { targetAgentName?: unknown }).targetAgentName;
  return typeof targetAgentName === "string" ? targetAgentName.trim() : "";
}

function payloadTargetsAgent(payload: unknown, agentName: string): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return true;
  if (!("targetAgentNames" in payload)) return true;
  const names = (payload as { targetAgentNames?: unknown }).targetAgentNames;
  return (
    Array.isArray(names) &&
    names.length > 0 &&
    names.every((name) => typeof name === "string" && name.trim()) &&
    names.some((name) => name.trim() === agentName)
  );
}

function isRealtimeVoiceTranscript(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const voice = (payload as { voice?: unknown }).voice;
  return Boolean(voice && typeof voice === "object" && (voice as { mode?: unknown }).mode === "realtime");
}

export function shouldHandleEventForAgent(agent: Agent, event: Event): boolean {
  if (event.payloadTruncated) return false;
  if (event.type?.startsWith("agent.control.")) return false;
  // Turn lifecycle events are runner bookkeeping, not actionable input.
  if (event.type?.startsWith("agent.turn.")) return false;
  // Wrapped runtime lifecycle events are observable bookkeeping.
  if (event.type?.startsWith("wrapper.")) return false;
  // Voice presence and raw audio are bookkeeping; speech reaches agents as transcribed messages.
  if (event.type?.startsWith("voice.")) return false;
  // Realtime call transcripts record a conversation the call's agent already answered.
  if (isRealtimeVoiceTranscript(event.payload)) return false;
  // Explicit no-op events are observable but should never trigger work.
  if (event.type === "noop") return false;
  const payloadTargetAgentName = getPayloadTargetAgentName(event.payload);
  if (payloadTargetAgentName && payloadTargetAgentName !== agent.name) {
    return false;
  }
  // Target lists restrict delivery to every explicitly selected agent.
  if (!payloadTargetsAgent(event.payload, agent.name)) return false;
  if (event.type === "agent.scheduled.trigger") {
    // Scheduled trigger events should only wake their intended target.
    if (!payloadTargetAgentName || payloadTargetAgentName !== agent.name) return false;
  }
  // Skip bookkeeping events that should never trigger model replies.
  if (event.type?.startsWith("audit.")) return false;
  if (event.type?.startsWith("telemetry.")) return false;
  if (event.type?.startsWith("tool.")) return false;
  if (event.source === `agent:${agent.name}`) return false;
  if (!event.channelId) return false;
  return true;
}
