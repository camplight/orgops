import { useMemo, useState } from "react";
import type { Agent } from "../../types";

type UseConversationAgentSelectionOptions = {
  visibleAgents: Agent[];
};

export function useConversationAgentSelection({ visibleAgents }: UseConversationAgentSelectionOptions) {
  const [selectedConversationAgents, setSelectedConversationAgents] = useState<string[]>([]);
  const [agentSearchQuery, setAgentSearchQuery] = useState("");

  const selectedConversationAgentRecords = useMemo(
    () =>
      selectedConversationAgents.map((agentName) => visibleAgents.find((agent) => agent.name === agentName) ?? { name: agentName }),
    [visibleAgents, selectedConversationAgents]
  );
  const agentSuggestions = useMemo(() => {
    const query = agentSearchQuery.trim().toLowerCase();
    return visibleAgents
      .filter((agent) => !selectedConversationAgents.includes(agent.name))
      .filter((agent) => !query || agent.name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [agentSearchQuery, visibleAgents, selectedConversationAgents]);

  function addConversationAgent(agentName: string) {
    setSelectedConversationAgents((current) =>
      current.includes(agentName) ? current : [...current, agentName]
    );
    setAgentSearchQuery("");
  }

  function removeConversationAgent(agentName: string) {
    setSelectedConversationAgents((current) => current.filter((name) => name !== agentName));
  }

  return {
    selectedConversationAgents,
    setSelectedConversationAgents,
    agentSearchQuery,
    setAgentSearchQuery,
    selectedConversationAgentRecords,
    agentSuggestions,
    addConversationAgent,
    removeConversationAgent
  };
}
