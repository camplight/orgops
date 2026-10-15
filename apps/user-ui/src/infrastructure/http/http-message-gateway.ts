import { apiJson, getApiHeaders } from "../../api";
import type { MessageGateway } from "../../ports/message-gateway";

export function createHttpMessageGateway(): MessageGateway {
  return {
    revealSensitive: ({ eventId, password }) =>
      apiJson<{ text?: string }>(`/api/events/${encodeURIComponent(eventId)}/reveal-sensitive`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ password })
      })
  };
}
