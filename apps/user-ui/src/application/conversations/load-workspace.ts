import {
  agentVisibleToUserUi,
  channelVisibleToUserUi,
  normalizedSubscriberType
} from "../../domain/conversations/channel-rules";
import { keepOrFirstActiveChannelId } from "../../domain/conversations/active-channel";
import type { ConversationGateway } from "../../ports/conversation-gateway";
import type { DeepLink } from "../../ports/deep-link";
import type { Agent, Channel, Team } from "../../types";

export function createLoadWorkspace(options: {
  conversationGateway: ConversationGateway;
  deepLink: DeepLink;
}) {
  const { conversationGateway, deepLink } = options;
  return async function loadWorkspace(input: {
    claimedShareChannelId: string | null;
    activeChannelId: string | null;
    userId: string | null;
    username: string;
  }): Promise<{
    channels: Channel[];
    agents: Agent[];
    humans: Array<{ username: string }>;
    teams: Team[];
    visibleAgentNames: Set<string>;
    nextActiveChannelId: string | null;
    expandArchivedChannels: boolean;
  }> {
    const { claimedShareChannelId, activeChannelId, userId, username } = input;
    const [nextChannels, nextAgents, nextHumans, nextTeams] = await Promise.all([
      conversationGateway.listChannels(),
      conversationGateway.listAgents(),
      conversationGateway.listHumans().catch(() => []),
      conversationGateway.listMyTeams().catch(() => [])
    ]);
    const nextViewerTeamIds = new Set(nextTeams.map((team) => team.id));
    const visibleChannels = nextChannels.filter((channel) =>
      channelVisibleToUserUi(channel, userId, username, nextViewerTeamIds)
    );
    const nextVisibleChannelAgentNames = new Set<string>();
    for (const channel of visibleChannels) {
      for (const participant of channel.participants ?? []) {
        if (normalizedSubscriberType(participant) === "AGENT" && participant.subscriberId) {
          nextVisibleChannelAgentNames.add(participant.subscriberId);
        }
      }
    }
    const nextVisibleAgents = nextAgents.filter((agent) =>
      agentVisibleToUserUi(agent, nextVisibleChannelAgentNames, userId)
    );
    const linkedChannelId = deepLink.readLinkedChannelId();
    const preferredLinkedId = claimedShareChannelId ?? linkedChannelId;
    const linkedChannel = visibleChannels.find((channel) => channel.id === preferredLinkedId);
    const nextActiveChannelId =
      linkedChannel?.id ?? keepOrFirstActiveChannelId({ activeChannelId, visibleChannels });
    return {
      channels: nextChannels,
      agents: nextAgents,
      humans: nextHumans,
      teams: nextTeams,
      visibleAgentNames: new Set(nextVisibleAgents.map((agent) => agent.name)),
      nextActiveChannelId,
      expandArchivedChannels: Boolean(linkedChannel?.archivedAt)
    };
  };
}
