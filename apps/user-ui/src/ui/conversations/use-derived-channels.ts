import { useMemo } from "react";
import type { Agent, Channel } from "../../types";
import {
  CHANNEL_GROUPS,
  agentVisibleToUserUi,
  channelGroupId,
  channelHasHumanParticipant,
  channelMatchesQuery,
  channelVisibleToUserUi,
  isHumanAgentDirectChannel,
  isSharedChannelForUser,
  normalizedSubscriberType,
  participantAgentStatus
} from "../../domain/conversations/channel-rules";

type UseDerivedChannelsOptions = {
  channels: Channel[];
  agents: Agent[];
  activeChannel: Channel | null;
  userId: string | null;
  username: string;
  viewerTeamIds: Set<string>;
  channelQuery: string;
};

export function useDerivedChannels({
  channels,
  agents,
  activeChannel,
  userId,
  username,
  viewerTeamIds,
  channelQuery
}: UseDerivedChannelsOptions) {
  const offlineAgentNames = useMemo(
    () =>
      (activeChannel?.participants ?? [])
        .filter((participant) => participantAgentStatus(participant, agents) === "off")
        .map((participant) => participant.subscriberId),
    [activeChannel, agents]
  );

  const visibleChannels = useMemo(
    () =>
      channels.filter((channel) =>
        channelVisibleToUserUi(channel, userId, username, viewerTeamIds)
      ),
    [channels, userId, username, viewerTeamIds]
  );
  const activeChannels = useMemo(
    () => visibleChannels.filter((channel) => !channel.archivedAt),
    [visibleChannels]
  );
  const archivedChannels = useMemo(
    () => visibleChannels.filter((channel) => Boolean(channel.archivedAt)),
    [visibleChannels]
  );
  const visibleChannelAgentNames = useMemo(() => {
    const names = new Set<string>();
    for (const channel of visibleChannels) {
      for (const participant of channel.participants ?? []) {
        if (normalizedSubscriberType(participant) === "AGENT" && participant.subscriberId) {
          names.add(participant.subscriberId);
        }
      }
    }
    return names;
  }, [visibleChannels]);
  const visibleAgents = useMemo(
    () => agents.filter((agent) => agentVisibleToUserUi(agent, visibleChannelAgentNames, userId)),
    [agents, visibleChannelAgentNames, userId]
  );

  const filteredChannels = useMemo(() => {
    const query = channelQuery.trim().toLowerCase();
    if (!query) return activeChannels;
    return activeChannels.filter((channel) => channelMatchesQuery(channel, query, username));
  }, [activeChannels, channelQuery, username]);

  const filteredArchivedChannels = useMemo(() => {
    const query = channelQuery.trim().toLowerCase();
    if (!query) return archivedChannels;
    return archivedChannels.filter((channel) => channelMatchesQuery(channel, query, username));
  }, [archivedChannels, channelQuery, username]);

  const groupedChannels = useMemo(
    () =>
      CHANNEL_GROUPS.map((group) => ({
        ...group,
        channels: filteredChannels.filter((channel) => {
          const shared = isSharedChannelForUser(channel, username);
          if (group.id === "shared") return shared;
          if (group.id === "direct") {
            if (shared || !username) return false;
            return (
              channelGroupId(channel) === "direct" &&
              isHumanAgentDirectChannel(channel) &&
              channelHasHumanParticipant(channel, username)
            );
          }
          if (shared) return false;
          return channelGroupId(channel) === "channels";
        })
      })).filter((group) => group.channels.length > 0),
    [filteredChannels, username]
  );

  return {
    offlineAgentNames,
    visibleChannels,
    visibleAgents,
    filteredChannels,
    filteredArchivedChannels,
    groupedChannels
  };
}
