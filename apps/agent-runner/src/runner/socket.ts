import WebSocket from "ws";

export type RunnerSocketWakeup = {
  agentName: string;
  channelId?: string;
  eventId: string;
  eventType: string;
  createdAt: number;
  deliverAt?: number;
};

type RunnerSocketClientDeps = {
  apiUrl: string;
  runnerToken: string;
  getRunnerId: () => string | null;
  onWakeup: (events: RunnerSocketWakeup[]) => void;
  reconnectBaseDelayMs?: number;
  pingIntervalMs?: number;
};

type RunnerSocketServerMessage =
  | { type: "hello"; runnerId: string }
  | { type: "pong"; now: number }
  | { type: "event.available"; runnerId: string; events: RunnerSocketWakeup[] }
  | { type: "error"; message: string };

function toWebSocketUrl(apiUrl: string, runnerId: string) {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/api/runners/${encodeURIComponent(runnerId)}/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function parseServerMessage(data: WebSocket.RawData): RunnerSocketServerMessage | null {
  try {
    const parsed = JSON.parse(data.toString());
    if (!parsed || typeof parsed !== "object") return null;
    const type = (parsed as { type?: unknown }).type;
    return typeof type === "string" ? (parsed as RunnerSocketServerMessage) : null;
  } catch {
    return null;
  }
}

function normalizeWakeups(message: RunnerSocketServerMessage): RunnerSocketWakeup[] {
  if (message.type !== "event.available" || !Array.isArray(message.events)) return [];
  return message.events.filter((event): event is RunnerSocketWakeup => {
    return (
      event &&
      typeof event === "object" &&
      typeof event.agentName === "string" &&
      typeof event.eventId === "string" &&
      typeof event.eventType === "string" &&
      typeof event.createdAt === "number"
    );
  });
}

export function createRunnerSocketClient(deps: RunnerSocketClientDeps) {
  const reconnectBaseDelayMs = deps.reconnectBaseDelayMs ?? 1000;
  const pingIntervalMs = deps.pingIntervalMs ?? 5000;
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectAttempt = 0;

  function clearTimers() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    reconnectTimer = null;
    pingTimer = null;
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(30_000, reconnectBaseDelayMs * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function handleWakeups(events: RunnerSocketWakeup[]) {
    const dueNow: RunnerSocketWakeup[] = [];
    const now = Date.now();
    for (const event of events) {
      if (event.deliverAt && event.deliverAt > now) {
        setTimeout(() => deps.onWakeup([event]), Math.max(0, event.deliverAt - now));
      } else {
        dueNow.push(event);
      }
    }
    if (dueNow.length > 0) deps.onWakeup(dueNow);
  }

  function connect() {
    if (stopped || socket) return;
    const runnerId = deps.getRunnerId();
    if (!runnerId) {
      scheduleReconnect();
      return;
    }

    const ws = new WebSocket(toWebSocketUrl(deps.apiUrl, runnerId), {
      headers: { "x-orgops-runner-token": deps.runnerToken },
    });
    socket = ws;

    ws.on("open", () => {
      reconnectAttempt = 0;
      ws.send(JSON.stringify({ type: "ping" }));
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, pingIntervalMs);
    });

    ws.on("message", (data) => {
      const message = parseServerMessage(data);
      if (!message) return;
      handleWakeups(normalizeWakeups(message));
    });

    ws.on("error", (error) => {
      console.warn("runner.socket.error", {
        message: error instanceof Error ? error.message : String(error),
      });
    });

    ws.on("close", () => {
      if (socket === ws) socket = null;
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      scheduleReconnect();
    });
  }

  function start() {
    stopped = false;
    connect();
  }

  function stop() {
    stopped = true;
    clearTimers();
    const current = socket;
    socket = null;
    current?.close();
  }

  return {
    start,
    stop,
    isConnected: () => socket?.readyState === WebSocket.OPEN,
  };
}
