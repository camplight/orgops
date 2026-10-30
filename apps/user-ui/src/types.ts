export type ChannelParticipant = {
  subscriberType: string;
  subscriberId: string;
};

export type ChannelShare = {
  viewerType: string;
  viewerId: string;
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
  shares?: ChannelShare[];
  canPost?: boolean;
  canManage?: boolean;
};

export type Agent = {
  id?: string;
  name: string;
  description?: string | null;
  visibility?: "PUBLIC" | "PRIVATE";
  ownerHumanId?: string | null;
  runtimeState?: string;
  desiredState?: string;
  modelId?: string;
  modelCapabilities?: ModelCapabilities;
};

export type ModelCapabilities = {
  textInput?: boolean;
  textOutput?: boolean;
  imageInput?: boolean;
  audioInput?: boolean;
  audioOutput?: boolean;
  realtimeAudioInput?: boolean;
  realtimeAudioOutput?: boolean;
  multiSpeakerRealtimeAudioInput?: boolean;
  activeSpeakerRealtimeAudioInput?: boolean;
  toolCalling?: boolean;
  [key: string]: boolean | undefined;
};

export type EventRow = {
  id: string;
  type: string;
  source: string;
  createdAt?: number;
  deliverAt?: number;
  channelId?: string;
  payload?: unknown;
  status?: string;
  lastError?: string;
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
