import { ws } from "msw";

const realtimeLink = ws.link("*");

export type TopicFrame = {
  type: "subscribe" | "unsubscribe";
  topic: string;
};

const isTopicFrame = (value: unknown): value is TopicFrame =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  (value.type === "subscribe" || value.type === "unsubscribe") &&
  "topic" in value &&
  typeof value.topic === "string";

const parseTopicFrame = (data: unknown): TopicFrame => {
  const frame: unknown = JSON.parse(String(data));
  if (!isTopicFrame(frame)) throw new Error(`Unexpected frame from the app: ${String(data)}`);
  return frame;
};

export type RealtimeConnection = {
  readonly url: string;
  readonly receivedFrames: readonly TopicFrame[];
  readonly closed: boolean;
  push: (message: unknown) => void;
  pushRaw: (data: string) => void;
  failWithNetworkError: () => void;
  drop: () => void;
};

export const createFakeRealtime = (options: { available: boolean }) => {
  let available = options.available;
  const connectionAttempts: string[] = [];
  const connections: RealtimeConnection[] = [];

  const handler = realtimeLink.addEventListener("connection", ({ client }) => {
    connectionAttempts.push(client.url.href);
    if (!available) {
      client.close();
      return;
    }

    const receivedFrames: TopicFrame[] = [];
    let closed = false;
    client.addEventListener("message", (event) => {
      receivedFrames.push(parseTopicFrame(event.data));
    });
    client.addEventListener("close", () => {
      closed = true;
    });

    connections.push({
      url: client.url.href,
      receivedFrames,
      get closed() {
        return closed;
      },
      push: (message) => client.send(JSON.stringify(message)),
      pushRaw: (data) => client.send(data),
      failWithNetworkError: () => {
        if (!("socket" in client) || !(client.socket instanceof EventTarget)) {
          throw new Error("The websocket client cannot be failed with a network error");
        }
        client.socket.dispatchEvent(new Event("error"));
      },
      drop: () => client.close(),
    });
  });

  return {
    handler,
    connectionAttempts,
    connections,
    makeAvailable: () => {
      available = true;
    },
    makeUnavailable: () => {
      available = false;
    },
  };
};
