import { useReducer } from "react";
import {
  conversationsReducer,
  initialConversationsState
} from "../../domain/conversations/conversations-state";
import type { Agent, Channel, Team } from "../../types";

export function useConversationsState() {
  const [state, dispatch] = useReducer(conversationsReducer, initialConversationsState);

  function setWorkspace(workspace: {
    channels: Channel[];
    agents: Agent[];
    humans: Array<{ username: string }>;
    teams: Team[];
  }) {
    dispatch({ type: "set-workspace", ...workspace });
  }

  function setChannels(channels: Channel[]) {
    dispatch({ type: "set-channels", channels });
  }

  function setActiveChannelId(channelId: string | null) {
    dispatch({ type: "select-channel", channelId });
  }

  function resetForSignOut() {
    dispatch({ type: "sign-out" });
  }

  return { ...state, setWorkspace, setChannels, setActiveChannelId, resetForSignOut };
}
