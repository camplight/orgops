export type ChannelParticipant = {
  subscriberType: string;
  subscriberId: string;
};

export type Channel = {
  id: string;
  name: string;
  description?: string | null;
  kind?: string;
  visibility?: "PUBLIC" | "PRIVATE";
  ownerHumanId?: string | null;
  archivedAt?: number | null;
  participants?: ChannelParticipant[];
};

export type Agent = {
  id?: string;
  name: string;
  description?: string | null;
  visibility?: "PUBLIC" | "PRIVATE";
  ownerHumanId?: string | null;
  runtimeState?: string;
  desiredState?: string;
};

export type EventRow = {
  id: string;
  type: string;
  source: string;
  createdAt?: number;
  channelId?: string;
  payload?: unknown;
  status?: string;
};

export type AuthMe = {
  id?: string | null;
  username?: string | null;
  mustChangePassword?: boolean;
};

export type Team = {
  id: string;
  name: string;
};
