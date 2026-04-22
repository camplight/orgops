const RESERVED_AGENT_EVENT_PREFIXES = [
  "agent.",
  "audit.",
  "telemetry.",
  "tool.",
] as const;

export function isReservedAgentRuntimeEventType(type: string): boolean {
  return RESERVED_AGENT_EVENT_PREFIXES.some((prefix) => type.startsWith(prefix));
}

export function getReservedEventTypeError(type: string): string | null {
  if (!isReservedAgentRuntimeEventType(type)) return null;
  return [
    `Event type "${type}" is reserved for runtime bookkeeping/telemetry.`,
    'Agent-authored events cannot use "agent.*", "audit.*", "telemetry.*", or "tool.*" types.',
    "Use a domain/channel/custom event type instead.",
  ].join(" ");
}
