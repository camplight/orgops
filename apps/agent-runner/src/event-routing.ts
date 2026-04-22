import type { Agent, Event } from "./types";

export function shouldHandleEventForAgent(agent: Agent, event: Event): boolean {
  if (event.type?.startsWith("agent.control.")) return false;
  // Turn lifecycle events are runner bookkeeping, not actionable input.
  if (event.type?.startsWith("agent.turn.")) return false;
  // Explicit no-op events are observable but should never trigger work.
  if (event.type === "noop") return false;
  if (event.type === "agent.scheduled.trigger") {
    const payload =
      event.payload && typeof event.payload === "object"
        ? (event.payload as { targetAgentName?: unknown })
        : undefined;
    const targetAgentName =
      typeof payload?.targetAgentName === "string"
        ? payload.targetAgentName.trim()
        : "";
    // Scheduled trigger events should only wake their intended target.
    if (!targetAgentName || targetAgentName !== agent.name) return false;
  }
  // Skip bookkeeping events that should never trigger model replies.
  if (event.type?.startsWith("audit.")) return false;
  if (event.type?.startsWith("telemetry.")) return false;
  if (event.type?.startsWith("tool.")) return false;
  if (event.source === `agent:${agent.name}`) return false;
  if (!event.channelId) return false;
  return true;
}
