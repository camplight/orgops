import { apiFetch, apiJson, getApiHeaders } from "./api";
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
    listMyTeams: () => apiJson<Team[]>("/api/teams/me"),
    openDirectChannel: ({ agentName }) =>
      apiJson<{ id: string }>("/api/channels/direct/human-agent", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ agentName })
      }),
    createChannel: ({ name, description, visibility }) =>
      apiJson<{ id: string }>("/api/channels", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          name,
          description,
          visibility
        })
      }),
    subscribe: async ({ channelId, subscriberType, subscriberId }) => {
      await apiFetch(`/api/channels/${encodeURIComponent(channelId)}/subscribe`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ subscriberType, subscriberId })
      });
    },
    deleteChannel: async ({ channelId }) => {
      await apiFetch(`/api/channels/${encodeURIComponent(channelId)}`, { method: "DELETE" });
    },
    updateChannelVisibility: async ({ channelId, visibility }) => {
      await apiFetch(`/api/channels/${encodeURIComponent(channelId)}`, {
        method: "PATCH",
        headers: getApiHeaders(),
        body: JSON.stringify({ visibility })
      });
    },
    setChannelArchived: async ({ channelId, archived }) => {
      await apiFetch(
        `/api/channels/${encodeURIComponent(channelId)}/${archived ? "archive" : "unarchive"}`,
        { method: "POST" }
      );
    },
    unsubscribe: async ({ channelId, subscriberType, subscriberId }) => {
      await apiFetch(`/api/channels/${encodeURIComponent(channelId)}/unsubscribe`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          subscriberType,
          subscriberId
        })
      });
    },
    shareChannel: async ({ channelId, viewerType, viewerId }) => {
      await apiFetch(`/api/channels/${encodeURIComponent(channelId)}/share`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          viewerType,
          viewerId
        })
      });
    },
    unshareChannel: async ({ channelId, viewerType, viewerId }) => {
      await apiFetch(`/api/channels/${encodeURIComponent(channelId)}/unshare`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          viewerType,
          viewerId
        })
      });
    },
    createShareLink: ({ channelId }) =>
      apiJson<{ token: string; channelId: string }>(
        `/api/channels/${encodeURIComponent(channelId)}/share-link`,
        {
          method: "POST",
          headers: getApiHeaders()
        }
      )
  };
}
