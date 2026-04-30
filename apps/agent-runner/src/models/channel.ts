export type ChannelParticipant = {
  subscriberType?: string;
  subscriberId?: string;
};

export type ChannelRecord = {
  id: string;
  name?: string;
  kind?: string;
  description?: string;
  metadata?: Record<string, unknown> | null;
  participants?: ChannelParticipant[];
};

export function isAgentSubscribed(channel: ChannelRecord, agentName: string): boolean {
  return (channel.participants ?? []).some(
    (participant) =>
      String(participant.subscriberType ?? "").toUpperCase() === "AGENT" &&
      participant.subscriberId === agentName,
  );
}
