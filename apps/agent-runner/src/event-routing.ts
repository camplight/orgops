import type { Agent, Event } from "./types";

export function shouldHandleEventForAgent(agent: Agent, event: Event): boolean {
  if (event.type?.startsWith("agent.control.")) return false;
  // Skip bookkeeping events that should never trigger model replies.
  if (event.type?.startsWith("audit.")) return false;
  if (event.source === `agent:${agent.name}`) return false;
  if (!event.channelId) return false;
  if (typeof event.source === "string" && event.source.startsWith("agent:")) {
    return false;
  }
  return true;
}
