export const CHANNEL_VISIBILITY = {
  PUBLIC: "PUBLIC",
  PRIVATE: "PRIVATE",
} as const;

export type ChannelVisibility =
  (typeof CHANNEL_VISIBILITY)[keyof typeof CHANNEL_VISIBILITY];

export function isChannelVisibility(value: string): value is ChannelVisibility {
  return value === CHANNEL_VISIBILITY.PUBLIC || value === CHANNEL_VISIBILITY.PRIVATE;
}

export const AGENT_VISIBILITY = {
  PUBLIC: "PUBLIC",
  PRIVATE: "PRIVATE",
} as const;

export type AgentVisibility =
  (typeof AGENT_VISIBILITY)[keyof typeof AGENT_VISIBILITY];

export function isAgentVisibility(value: string): value is AgentVisibility {
  return value === AGENT_VISIBILITY.PUBLIC || value === AGENT_VISIBILITY.PRIVATE;
}
