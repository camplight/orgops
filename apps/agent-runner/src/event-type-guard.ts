const RESERVED_AGENT_EVENT_PREFIXES = ["agent.", "audit."] as const;

export function isReservedAgentRuntimeEventType(type: string): boolean {
  return RESERVED_AGENT_EVENT_PREFIXES.some((prefix) => type.startsWith(prefix));
}

export function getReservedEventTypeError(type: string): string | null {
  if (!isReservedAgentRuntimeEventType(type)) return null;
  return [
    `Event type "${type}" is reserved for runtime bookkeeping/audit.`,
    'Agent-authored events cannot use "agent.*" or "audit.*" types.',
    "Use a domain/channel/custom event type instead.",
  ].join(" ");
}
