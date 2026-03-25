import type { Agent, Event } from "./types";

export function shouldHandleEventForAgent(agent: Agent, event: Event): boolean {
  if (event.type?.startsWith("agent.control.")) return false;
  // Turn lifecycle events are runner bookkeeping, not actionable input.
  if (event.type?.startsWith("agent.turn.")) return false;
  // Skip bookkeeping events that should never trigger model replies.
  if (event.type?.startsWith("audit.")) return false;
  if (event.source === `agent:${agent.name}`) return false;
  if (!event.channelId) return false;
  return true;
}
