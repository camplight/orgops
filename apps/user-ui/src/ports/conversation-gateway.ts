import type { Agent, Channel, Team } from "../types";

export type ConversationGateway = {
  claimShareLink: (options: { token: string }) => Promise<{ ok?: boolean; channelId: string }>;
  listChannels: () => Promise<Channel[]>;
  listAgents: () => Promise<Agent[]>;
  listHumans: () => Promise<Array<{ username: string }>>;
  listMyTeams: () => Promise<Team[]>;
  openDirectChannel: (options: { agentName: string }) => Promise<{ id: string }>;
  createChannel: (options: {
    name: string;
    description: string | undefined;
    visibility: string;
  }) => Promise<{ id: string }>;
  subscribe: (options: {
    channelId: string;
    subscriberType: string;
    subscriberId: string;
  }) => Promise<void>;
  deleteChannel: (options: { channelId: string }) => Promise<void>;
  updateChannelVisibility: (options: { channelId: string; visibility: string }) => Promise<void>;
  setChannelArchived: (options: { channelId: string; archived: boolean }) => Promise<void>;
  unsubscribe: (options: {
    channelId: string;
    subscriberType: string;
    subscriberId: string;
  }) => Promise<void>;
  shareChannel: (options: { channelId: string; viewerType: string; viewerId: string }) => Promise<void>;
  unshareChannel: (options: { channelId: string; viewerType: string; viewerId: string }) => Promise<void>;
  createShareLink: (options: { channelId: string }) => Promise<{ token: string; channelId: string }>;
};
