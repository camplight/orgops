import { apiJson, getApiHeaders } from "../../api";
import type { EventRow } from "../../types";
import type { MessageGateway } from "../../ports/message-gateway";

export function createHttpMessageGateway(): MessageGateway {
  return {
    revealSensitive: ({ eventId, password }) =>
      apiJson<{ text?: string }>(`/api/events/${encodeURIComponent(eventId)}/reveal-sensitive`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ password })
      }),
    listLatestChannelEvents: async ({ channelId, limit }) => {
      const [messageEvents, failureEvents, turnEvents, toolEvents, contextEvents, wrapperEvents, processEvents] =
        await Promise.all([
          apiJson<EventRow[]>(
            `/api/events?channelId=${encodeURIComponent(channelId)}&type=message.created&limit=${limit}&order=desc`
          ),
          apiJson<EventRow[]>(
            `/api/events?channelId=${encodeURIComponent(channelId)}&type=agent.turn.failed&limit=${limit}&order=desc`
          ),
          apiJson<EventRow[]>(
            `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=agent.turn.&limit=${limit}&order=desc`
          ),
          apiJson<EventRow[]>(
            `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=tool.&limit=${limit}&order=desc`
          ),
          apiJson<EventRow[]>(
            `/api/events?channelId=${encodeURIComponent(channelId)}&type=telemetry.context.window.updated&limit=${limit}&order=desc`
          ),
          apiJson<EventRow[]>(
            `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=wrapper.turn.&limit=${limit}&order=desc`
          ),
          apiJson<EventRow[]>(
            `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=process.&limit=${limit}&order=desc`
          )
        ]);
      return { messageEvents, failureEvents, turnEvents, toolEvents, contextEvents, wrapperEvents, processEvents };
    },
    listOlderChannelEvents: async ({ channelId, limit, before }) => {
      const oldestEventAt = before;
      const [olderMessages, olderTurns, olderTools, olderWrappers, olderProcesses] = await Promise.all([
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&type=message.created&limit=${limit}&order=desc&before=${oldestEventAt}`
        ),
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=agent.turn.&limit=${limit}&order=desc&before=${oldestEventAt}`
        ),
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=tool.&limit=${limit}&order=desc&before=${oldestEventAt}`
        ),
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=wrapper.turn.&limit=${limit}&order=desc&before=${oldestEventAt}`
        ),
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=process.&limit=${limit}&order=desc&before=${oldestEventAt}`
        )
      ]);
      return { olderMessages, olderTurns, olderTools, olderWrappers, olderProcesses };
    },
    listRecentMessageEvents: () =>
      apiJson<EventRow[]>("/api/events?type=message.created&limit=100&order=desc")
  };
}
