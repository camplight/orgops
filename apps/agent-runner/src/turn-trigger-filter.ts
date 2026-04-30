import type { Event } from "./types";

export function agentChannelKey(agentName: string, channelId: string) {
  return `${agentName}::${channelId}`;
}

function getPayloadTargetAgentName(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const targetAgentName = (payload as { targetAgentName?: unknown }).targetAgentName;
  return typeof targetAgentName === "string" ? targetAgentName.trim() : "";
}

function isProcessLifecycleEvent(event: Event): boolean {
  return event.type === "process.started" || event.type === "process.output" || event.type === "process.exited";
}

export function shouldSuppressProcessLifecycleTrigger(input: {
  agentName: string;
  event: Event;
  recentWindow?: { startedAt: number; completedAt: number };
}) {
  const { agentName, event, recentWindow } = input;
  if (!isProcessLifecycleEvent(event)) return false;
  if (event.source !== "system:process-runner") return false;
  const payloadTargetAgentName = getPayloadTargetAgentName(event.payload);
  if (payloadTargetAgentName && payloadTargetAgentName !== agentName) return false;
  const createdAt = event.createdAt;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return false;
  if (!recentWindow) return false;
  return createdAt >= recentWindow.startedAt && createdAt <= recentWindow.completedAt;
}
