import type { Agent, Channel, Team } from "../../types";

export type ConversationsState = {
  channels: Channel[];
  agents: Agent[];
  teams: Team[];
  humans: Array<{ username: string }>;
  activeChannelId: string | null;
};

export type ConversationsAction =
  | {
      type: "set-workspace";
      channels: Channel[];
      agents: Agent[];
      humans: Array<{ username: string }>;
      teams: Team[];
    }
  | { type: "set-channels"; channels: Channel[] }
  | { type: "select-channel"; channelId: string | null }
  | { type: "sign-out" };

export const initialConversationsState: ConversationsState = {
  channels: [],
  agents: [],
  teams: [],
  humans: [],
  activeChannelId: null
};

export function conversationsReducer(
  state: ConversationsState,
  action: ConversationsAction
): ConversationsState {
  switch (action.type) {
    case "set-workspace":
      return {
        ...state,
        channels: action.channels,
        agents: action.agents,
        humans: action.humans,
        teams: action.teams
      };
    case "set-channels":
      return { ...state, channels: action.channels };
    case "select-channel":
      if (state.activeChannelId === action.channelId) return state;
      return { ...state, activeChannelId: action.channelId };
    case "sign-out":
      return { ...state, channels: [], agents: [], teams: [], activeChannelId: null };
  }
}
