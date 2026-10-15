import type { Agent, Channel, Team } from "../types";

export type ConversationGateway = {
  claimShareLink: (options: { token: string }) => Promise<{ ok?: boolean; channelId: string }>;
  listChannels: () => Promise<Channel[]>;
  listAgents: () => Promise<Agent[]>;
  listHumans: () => Promise<Array<{ username: string }>>;
  listMyTeams: () => Promise<Team[]>;
};
