export const CHANNEL_KINDS = {
  GROUP: "GROUP",
  HUMAN_AGENT_DM: "HUMAN_AGENT_DM",
  AGENT_AGENT_DM: "AGENT_AGENT_DM",
  DIRECT_GROUP: "DIRECT_GROUP",
  INTEGRATION_BRIDGE: "INTEGRATION_BRIDGE"
} as const;

export type ChannelKind = (typeof CHANNEL_KINDS)[keyof typeof CHANNEL_KINDS];

const CHANNEL_KIND_VALUES_SET = new Set<string>(Object.values(CHANNEL_KINDS));

export function isChannelKind(value: unknown): value is ChannelKind {
  return typeof value === "string" && CHANNEL_KIND_VALUES_SET.has(value);
}
