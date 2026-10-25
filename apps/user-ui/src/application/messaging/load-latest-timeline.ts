import type { MessageGateway } from "../../ports/message-gateway";
import type { EventRow } from "../../types";
import { mergeEventsChronologically } from "../../domain/messaging/event-ordering";

export function createLoadLatestTimeline(options: { messageGateway: MessageGateway }) {
  const { messageGateway } = options;
  return async function loadLatestTimeline(input: {
    channelId: string;
    limit: number;
    isStale: () => boolean;
  }): Promise<{ nextEvents: EventRow[]; hasOlderMessages: boolean } | null> {
    const { channelId, limit, isStale } = input;
    const { messageEvents, failureEvents, turnEvents, toolEvents, contextEvents, wrapperEvents, processEvents } =
      await messageGateway.listLatestChannelEvents({ channelId, limit });
    if (isStale()) return null;
    const nextEvents = mergeEventsChronologically(
      mergeEventsChronologically(
        mergeEventsChronologically(
          mergeEventsChronologically(mergeEventsChronologically(messageEvents, failureEvents), turnEvents),
          mergeEventsChronologically(toolEvents, contextEvents)
        ),
        wrapperEvents
      ),
      processEvents
    ).reverse();
    return { nextEvents, hasOlderMessages: messageEvents.length === limit };
  };
}
