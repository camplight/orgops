import type { Event } from "../types";
import type { createFakeProvider } from "./provider";

type Responder = Parameters<typeof createFakeProvider>[0][number];

export const createPendingEvents = (initial: Event[] = []) => {
  const arrived: Event[] = [...initial];
  return {
    list: () => [...arrived],
    arrive: (...events: Event[]) => {
      arrived.push(...events);
    },
  };
};

export const arrivingDuring =
  (pending: ReturnType<typeof createPendingEvents>, events: Event[], responder: Responder): Responder =>
  (request, callIndex) => {
    pending.arrive(...events);
    return responder(request, callIndex);
  };

export const neverAnswers = (): Promise<Response> => new Promise<Response>(() => {});

export const answersAfter =
  (delayMs: number, responder: Responder): Responder =>
  async (request, callIndex) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return responder(request, callIndex);
  };

export const modelEvents = <T extends { type: string }>(emitted: T[]) =>
  emitted.filter(
    (event) =>
      !event.type.startsWith("agent.turn.") &&
      !event.type.startsWith("telemetry.") &&
      !event.type.startsWith("tool."),
  );

export const pendingListings = (requestLog: string[]) =>
  requestLog.filter((entry) => entry.startsWith("GET /api/events?agentName="));

export const lateEventsNotice = (attempt: number) =>
  [
    `New channel events arrived while you were responding on attempt ${attempt}/3.`,
    "Re-evaluate using these events and return exactly one final JSON event object.",
  ].join("\n");

export const eventRecord = (event: {
  id: string;
  type?: string;
  source?: string;
  channelId?: string;
  parentEventId?: string;
  payload?: unknown;
}) => ({
  eventId: event.id,
  channelId: event.channelId ?? "chan-1",
  ...(event.parentEventId ? { parentEventId: event.parentEventId } : {}),
  type: event.type ?? "message.created",
  source: event.source ?? "human:admin",
  payload: event.payload ?? { text: "hello" },
});

type RecordedProvider = ReturnType<typeof createFakeProvider>;

export const injectedUserMessages = (provider: RecordedProvider, requestIndex: number) =>
  (provider.requests[requestIndex]?.messages ?? [])
    .slice(1)
    .filter((message) => message.role === "user")
    .map((message) => String(message.content));
