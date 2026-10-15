import { useState, type FormEvent } from "react";

export function useStartConversation(options: {
  username: string;
  selectedConversationAgents: string[];
  startConversation: (input: {
    name: string;
    description: string;
    visibility: "PUBLIC" | "PRIVATE";
    selectedAgents: string[];
    username: string;
    onChannelReady: (group: "direct" | "channels") => void;
  }) => Promise<{ channelId: string }>;
  refreshChannels: (nextActiveChannelId?: string | null) => Promise<unknown>;
  expandChannelGroup: (group: "direct" | "channels") => void;
  setError: (message: string | null) => void;
  setLoading: (loading: boolean) => void;
  setSelectedConversationAgents: (agents: string[]) => void;
  setAgentSearchQuery: (query: string) => void;
  setChannelQuery: (query: string) => void;
  setShowConversationDialog: (show: boolean) => void;
}) {
  const {
    username,
    selectedConversationAgents,
    startConversation,
    refreshChannels,
    expandChannelGroup,
    setError,
    setLoading,
    setSelectedConversationAgents,
    setAgentSearchQuery,
    setChannelQuery,
    setShowConversationDialog
  } = options;
  const [conversationName, setConversationName] = useState("");
  const [conversationDescription, setConversationDescription] = useState("");
  const [conversationVisibility, setConversationVisibility] = useState<"PUBLIC" | "PRIVATE">("PRIVATE");

  async function handleStartConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = conversationName.trim();
    const description = conversationDescription.trim();
    const selectedAgents = selectedConversationAgents.filter(Boolean);
    setError(null);

    if (!name && selectedAgents.length !== 1) {
      setError("Choose one agent for a direct message, or add a channel name.");
      return;
    }

    setLoading(true);
    try {
      const { channelId } = await startConversation({
        name,
        description,
        visibility: conversationVisibility,
        selectedAgents,
        username,
        onChannelReady: expandChannelGroup
      });
      await refreshChannels(channelId);
      setConversationName("");
      setConversationDescription("");
      setSelectedConversationAgents([]);
      setConversationVisibility("PRIVATE");
      setAgentSearchQuery("");
      setChannelQuery("");
      setShowConversationDialog(false);
    } catch (conversationError) {
      setError(
        conversationError instanceof Error
          ? conversationError.message
          : "Unable to start conversation"
      );
    } finally {
      setLoading(false);
    }
  }

  return {
    conversationName,
    conversationDescription,
    conversationVisibility,
    setConversationName,
    setConversationDescription,
    setConversationVisibility,
    handleStartConversation
  };
}
