import { agentChannelKey } from "./turn-trigger-filter";
import type { Event } from "./types";

/** Recorded by POST /api/agents/:name/turns/cancel; reaches the runner like any channel event. */
export const TURN_CANCEL_EVENT_TYPE = "agent.turn.cancel_requested";
/** How long a cancelled turn waits for its processes to stop before it reports the result. */
export const TURN_CANCEL_SETTLE_MS = 5000;

export class TurnCancelledError extends Error {
  constructor() {
    super("The turn was cancelled by a channel participant.");
    this.name = "TurnCancelledError";
  }
}

export type ActiveTurnCancel = {
  signal: AbortSignal;
  /** Runs `stop` when the turn is cancelled, or right away when it already was. */
  onCancel(stop: () => Promise<unknown>): void;
  /** Waits for the stops already running, at most `timeoutMs`. */
  settle(timeoutMs?: number): Promise<void>;
  /** Forgets the turn unless a newer turn took its place. */
  end(): void;
};

export type TurnCancellations = {
  begin(input: { agentName: string; channelId: string; triggerEventId: string }): ActiveTurnCancel;
  /** Cancels the running turn a Stop event names; true when it did. */
  request(event: Event): boolean;
};

type Entry = { triggerEventId: string; controller: AbortController; turn: ActiveTurnCancel };

function stopTarget(event: Event) {
  if (event.type !== TURN_CANCEL_EVENT_TYPE || !event.channelId) return null;
  const payload = event.payload as { targetAgentName?: unknown; triggerEventId?: unknown } | null;
  const agentName = typeof payload?.targetAgentName === "string" ? payload.targetAgentName : "";
  const triggerEventId = typeof payload?.triggerEventId === "string" ? payload.triggerEventId : "";
  return agentName && triggerEventId ? { agentName, channelId: event.channelId, triggerEventId } : null;
}

/**
 * The running CLASSIC turns on this runner, one per agent and channel (the channel loop runs
 * them one at a time). A Stop event aborts the turn whose trigger it names and stops the
 * processes the turn registered; a Stop for an earlier turn is ignored.
 */
export function createTurnCancellations(): TurnCancellations {
  const running = new Map<string, Entry>();

  function begin(input: { agentName: string; channelId: string; triggerEventId: string }) {
    const key = agentChannelKey(input.agentName, input.channelId);
    const controller = new AbortController();
    const stopping: Promise<unknown>[] = [];
    const pending: Array<() => Promise<unknown>> = [];
    const runStop = (stop: () => Promise<unknown>) => {
      let started: Promise<unknown>;
      try {
        started = stop();
      } catch (error) {
        started = Promise.reject(error);
      }
      // A process that is already gone is not an error worth reporting.
      stopping.push(Promise.resolve(started).catch(() => undefined));
    };
    controller.signal.addEventListener(
      "abort",
      () => {
        for (const stop of pending.splice(0)) runStop(stop);
      },
      { once: true },
    );
    const turn: ActiveTurnCancel = {
      signal: controller.signal,
      onCancel(stop) {
        if (controller.signal.aborted) runStop(stop);
        else pending.push(stop);
      },
      async settle(timeoutMs = TURN_CANCEL_SETTLE_MS) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        });
        await Promise.race([Promise.all(stopping).then(() => undefined), timeout]);
        clearTimeout(timer);
      },
      end() {
        if (running.get(key) === entry) running.delete(key);
      },
    };
    const entry: Entry = { triggerEventId: input.triggerEventId, controller, turn };
    running.set(key, entry);
    return turn;
  }

  function request(event: Event) {
    const target = stopTarget(event);
    if (!target) return false;
    const entry = running.get(agentChannelKey(target.agentName, target.channelId));
    if (!entry || entry.triggerEventId !== target.triggerEventId) return false;
    if (!entry.controller.signal.aborted) entry.controller.abort(new TurnCancelledError());
    return true;
  }

  return { begin, request };
}

type ListPendingEvents = (
  agentName: string,
  channelId: string,
  options: { typePrefix?: string },
) => Promise<Event[]>;

/**
 * What the runner fetches for a channel whose turn is still running: voice call setup, which
 * must not wait for the turn, and Stop requests, which end it. Other events wait for the turn.
 */
export async function listBusyChannelEvents(
  list: ListPendingEvents,
  agentName: string,
  channelId: string,
): Promise<Event[]> {
  const buckets = await Promise.all(
    ["voice.", TURN_CANCEL_EVENT_TYPE].map((typePrefix) => list(agentName, channelId, { typePrefix })),
  );
  return buckets.flat().sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
}
