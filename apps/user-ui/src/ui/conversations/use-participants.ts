import { useState, type FormEvent } from "react";
import type { ChannelParticipant } from "../../types";

export function useParticipants(options: {
  activeChannelId: string | null;
  addParticipant: (input: {
    channelId: string;
    subscriberType: "HUMAN" | "AGENT";
    subscriberId: string;
  }) => Promise<void>;
  removeParticipant: (input: {
    channelId: string;
    subscriberType: string;
    subscriberId: string;
  }) => Promise<void>;
  refreshChannels: (nextActiveChannelId?: string | null) => Promise<unknown>;
  setError: (message: string | null) => void;
}) {
  const { activeChannelId, addParticipant, removeParticipant, refreshChannels, setError } = options;
  const [participantKind, setParticipantKind] = useState<"HUMAN" | "AGENT">("AGENT");
  const [participantValue, setParticipantValue] = useState("");
  const [participantSubmitting, setParticipantSubmitting] = useState(false);
  const [participantRemovingKey, setParticipantRemovingKey] = useState<string | null>(null);

  async function handleAddParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeChannelId || !participantValue.trim()) return;
    setParticipantSubmitting(true);
    setError(null);
    try {
      await addParticipant({
        channelId: activeChannelId,
        subscriberType: participantKind,
        subscriberId: participantValue
      });
      await refreshChannels(activeChannelId);
      setParticipantValue("");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Unable to add participant");
    } finally {
      setParticipantSubmitting(false);
    }
  }

  async function handleRemoveParticipant(participant: ChannelParticipant) {
    if (!activeChannelId) return;
    const participantKey = `${participant.subscriberType}:${participant.subscriberId}`;
    setParticipantRemovingKey(participantKey);
    setError(null);
    try {
      await removeParticipant({
        channelId: activeChannelId,
        subscriberType: participant.subscriberType,
        subscriberId: participant.subscriberId
      });
      await refreshChannels(activeChannelId);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove participant");
    } finally {
      setParticipantRemovingKey(null);
    }
  }

  return {
    participantKind,
    participantValue,
    participantSubmitting,
    participantRemovingKey,
    setParticipantKind,
    setParticipantValue,
    handleAddParticipant,
    handleRemoveParticipant
  };
}
