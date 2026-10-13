import type { Agent, AuthMe, Channel, EventRow } from "../types";

export const getMockAuthMe = (overrides?: Partial<AuthMe>): AuthMe => ({
  id: "human-1",
  username: "alice",
  mustChangePassword: false,
  ...overrides,
});

export const getMockChannel = (overrides?: Partial<Channel>): Channel => ({
  id: "channel-1",
  name: "general",
  description: null,
  kind: "TEAM",
  visibility: "PUBLIC",
  ownerHumanId: null,
  archivedAt: null,
  participants: [],
  shares: [],
  canPost: true,
  canManage: false,
  ...overrides,
});

export const getMockAgent = (overrides?: Partial<Agent>): Agent => ({
  id: "agent-1",
  name: "helper",
  description: null,
  visibility: "PUBLIC",
  ownerHumanId: null,
  runtimeState: "RUNNING",
  desiredState: "RUNNING",
  ...overrides,
});

export const getMockEvent = (overrides?: Partial<EventRow>): EventRow => ({
  id: "event-1",
  type: "message.created",
  source: "human:alice",
  createdAt: 1_700_000_000_000,
  channelId: "channel-1",
  payload: { text: "Hello" },
  status: "DONE",
  ...overrides,
});
