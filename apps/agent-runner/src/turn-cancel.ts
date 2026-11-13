type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export class TurnCancelledError extends Error {
  constructor() {
    super("The turn was cancelled by a channel participant.");
    this.name = "TurnCancelledError";
  }
}

export type TurnCancelWatch = {
  signal: AbortSignal;
  stop: () => void;
};

/**
 * Asks the API once per interval whether this agent's turn for `triggerEventId` was cancelled
 * while a CLASSIC turn runs, and aborts the returned signal when it was. Polling failures are ignored; the turn goes on.
 */
export function watchTurnCancel(input: {
  apiFetch: ApiFetch;
  agentName: string;
  channelId: string;
  triggerEventId: string;
  intervalMs?: number;
}): TurnCancelWatch {
  const controller = new AbortController();
  const path = `/api/agents/${encodeURIComponent(input.agentName)}/turns/cancel?${new URLSearchParams({
    channelId: input.channelId,
    triggerEventId: input.triggerEventId,
  }).toString()}`;
  let polling = false;
  const poll = async () => {
    if (polling || controller.signal.aborted) return;
    polling = true;
    try {
      const response = await input.apiFetch(path);
      if (!response.ok) return;
      const body = (await response.json()) as { cancelRequested?: unknown };
      if (body?.cancelRequested === true) controller.abort(new TurnCancelledError());
    } catch {
      // A missed poll only delays cancellation until the next one.
    } finally {
      polling = false;
    }
  };
  const timer = setInterval(() => void poll(), input.intervalMs ?? 1000);
  timer.unref?.();
  return {
    signal: controller.signal,
    stop: () => clearInterval(timer),
  };
}
