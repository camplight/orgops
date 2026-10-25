import type { MessageGateway } from "../../ports/message-gateway";
import type { EventRow } from "../../types";
import { mergeEventsChronologically } from "../../domain/messaging/event-ordering";

export function createLoadOlderTimeline(options: { messageGateway: MessageGateway }) {
  const { messageGateway } = options;
  return async function loadOlderTimeline(input: {
    channelId: string;
    limit: number;
    before: number;
  }): Promise<{ olderEvents: EventRow[]; hasOlderMessages: boolean }> {
    const { channelId, limit, before } = input;
    const { olderMessages, olderTurns, olderTools, olderWrappers, olderProcesses } =
      await messageGateway.listOlderChannelEvents({ channelId, limit, before });
    const olderEvents = mergeEventsChronologically(
      mergeEventsChronologically(
        mergeEventsChronologically(olderMessages, olderTurns),
        mergeEventsChronologically(olderTools, olderWrappers)
      ),
      olderProcesses
    );
    const hasOlderMessages =
      olderMessages.length === limit ||
      olderTurns.length === limit ||
      olderTools.length === limit ||
      olderWrappers.length === limit ||
      olderProcesses.length === limit;
    return { olderEvents, hasOlderMessages };
  };
}
