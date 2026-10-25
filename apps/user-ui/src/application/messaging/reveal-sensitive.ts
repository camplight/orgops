import type { MessageGateway } from "../../ports/message-gateway";

export function createRevealSensitive(options: { messageGateway: MessageGateway }) {
  const { messageGateway } = options;
  return async function revealSensitive(input: { eventId: string; password: string }): Promise<string> {
    const response = await messageGateway.revealSensitive({ eventId: input.eventId, password: input.password });
    return typeof response.text === "string" ? response.text : "";
  };
}
