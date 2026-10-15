import { apiJson, getApiHeaders } from "../../api";
import type { ConversationGateway } from "../../ports/conversation-gateway";
import type { Agent, Channel, Team } from "../../types";

export function createHttpConversationGateway(): ConversationGateway {
  return {
    claimShareLink: ({ token }) =>
      apiJson<{ ok?: boolean; channelId: string }>(
        `/api/channel-share-links/${encodeURIComponent(token)}/claim`,
        {
          method: "POST",
          headers: getApiHeaders()
        }
      ),
    listChannels: () => apiJson<Channel[]>("/api/channels?includeArchived=1"),
    listAgents: () => apiJson<Agent[]>("/api/agents"),
    listHumans: () => apiJson<Array<{ username: string }>>("/api/humans"),
    listMyTeams: () => apiJson<Team[]>("/api/teams/me")
  };
}
