import type { Channel } from "../../types";

export function keepOrFirstActiveChannelId(input: {
  activeChannelId: string | null;
  visibleChannels: Channel[];
}): string | null {
  const { activeChannelId, visibleChannels } = input;
  return activeChannelId &&
    visibleChannels.some((channel) => channel.id === activeChannelId && !channel.archivedAt)
    ? activeChannelId
    : visibleChannels.find((channel) => !channel.archivedAt)?.id ?? null;
}
