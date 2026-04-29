import type { Agent, Event } from "./types";

function getPayloadTargetAgentName(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const targetAgentName = (payload as { targetAgentName?: unknown }).targetAgentName;
  return typeof targetAgentName === "string" ? targetAgentName.trim() : "";
}

export function shouldHandleEventForAgent(agent: Agent, event: Event): boolean {
  if (event.type?.startsWith("agent.control.")) return false;
  // Turn lifecycle events are runner bookkeeping, not actionable input.
  if (event.type?.startsWith("agent.turn.")) return false;
  // Explicit no-op events are observable but should never trigger work.
  if (event.type === "noop") return false;
  const payloadTargetAgentName = getPayloadTargetAgentName(event.payload);
  if (payloadTargetAgentName && payloadTargetAgentName !== agent.name) {
    return false;
  }
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
