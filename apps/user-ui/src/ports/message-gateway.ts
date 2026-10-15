import type { EventRow } from "../types";

export type MessageGateway = {
  revealSensitive: (options: { eventId: string; password: string }) => Promise<{ text?: string }>;
  listLatestChannelEvents: (options: { channelId: string; limit: number }) => Promise<{
    messageEvents: EventRow[];
    failureEvents: EventRow[];
    turnEvents: EventRow[];
    toolEvents: EventRow[];
    contextEvents: EventRow[];
    wrapperEvents: EventRow[];
    processEvents: EventRow[];
  }>;
  listOlderChannelEvents: (options: { channelId: string; limit: number; before: number }) => Promise<{
    olderMessages: EventRow[];
    olderTurns: EventRow[];
    olderTools: EventRow[];
    olderWrappers: EventRow[];
    olderProcesses: EventRow[];
  }>;
  listRecentMessageEvents: () => Promise<EventRow[]>;
};
