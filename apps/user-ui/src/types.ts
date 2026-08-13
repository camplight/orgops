export type ChannelParticipant = {
  subscriberType: string;
  subscriberId: string;
};

export type Channel = {
  id: string;
  name: string;
  description?: string | null;
  kind?: string;
  participants?: ChannelParticipant[];
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
