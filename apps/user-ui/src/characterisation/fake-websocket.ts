type SocketHandler<E> = ((event: E) => void) | null;

export type FakeWebSocketInstance = {
  readonly url: string;
  readonly sent: string[];
  readyState: number;
  onopen: SocketHandler<Event>;
  onmessage: SocketHandler<{ data: string }>;
  onclose: SocketHandler<Event>;
  onerror: SocketHandler<Event>;
  send: (data: string) => void;
  close: () => void;
  open: () => void;
  receive: (message: unknown) => void;
  dropConnection: () => void;
};

export const createFakeWebSocket = () => {
  const sockets: FakeWebSocketInstance[] = [];

  class FakeWebSocket implements FakeWebSocketInstance {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly sent: string[] = [];
    readyState = FakeWebSocket.CONNECTING;
    onopen: SocketHandler<Event> = null;
    onmessage: SocketHandler<{ data: string }> = null;
    onclose: SocketHandler<Event> = null;
    onerror: SocketHandler<Event> = null;

    constructor(readonly url: string) {
      sockets.push(this);
    }

    send(data: string) {
      this.sent.push(data);
    }

    close() {
      this.dropConnection();
    }

    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.(new Event("open"));
    }

    receive(message: unknown) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }

    dropConnection() {
      if (this.readyState === FakeWebSocket.CLOSED) return;
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.(new Event("close"));
    }
  }

  return { WebSocketClass: FakeWebSocket, sockets };
};
