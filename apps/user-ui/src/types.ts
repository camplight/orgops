export type Agent = {
  id?: string;
  name: string;
  description?: string | null;
  runtimeState?: string | null;
  desiredState?: string | null;
};

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
