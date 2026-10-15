import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Channel, EventRow } from "../types";
import { getMockAuthMe, getMockChannel, getMockEvent } from "./factories";
import type { FakeRequest, FakeRoute } from "./fake-api";
import type { FakeWebSocketInstance } from "./fake-websocket";
import { renderApp, settle } from "./render-app";

const BASE_TIME = 1_700_000_000_000;
const at = (step: number) => BASE_TIME + step * 1000;

const general = getMockChannel({ id: "channel-1", name: "general" });
const ops = getMockChannel({ id: "ops-id", name: "ops" });
const someoneElsesPrivate = getMockChannel({
  id: "secret-id",
  name: "secret",
  visibility: "PRIVATE",
  ownerHumanId: "human-2",
});

const BATCH = 30;
const LOAD_MESSAGES_PATH = `/api/events?channelId=channel-1&type=message.created&limit=${BATCH}&order=desc`;
const NOTIFICATIONS_PATH = "/api/events?type=message.created&limit=100&order=desc";

const matchesQuery = (event: EventRow, params: URLSearchParams) => {
  if (params.get("channelId") !== event.channelId) return false;
  const type = params.get("type");
  const prefix = params.get("typePrefix");
  if (type) return event.type === type;
  if (prefix) return event.type.startsWith(prefix);
  return true;
};

const feedRoute = (options: { events: readonly EventRow[]; older: readonly EventRow[] }): FakeRoute => ({
  path: /^\/api\/events\?channelId=/,
  respond: ({ path }) => {
    const params = new URL(path, "http://localhost").searchParams;
    const source = params.has("before") ? options.older : options.events;
    return { json: source.filter((event) => matchesQuery(event, params)) };
  },
});

type WorkspaceOptions = {
  events?: readonly EventRow[];
  older?: readonly EventRow[];
  channels?: readonly Channel[];
  routes?: readonly FakeRoute[];
};

const openWorkspace = (options: WorkspaceOptions = {}) =>
  renderApp({
    routes: [
      ...(options.routes ?? []),
      { path: "/api/auth/me", respond: { json: getMockAuthMe({ id: "human-1", username: "alice" }) } },
      { path: "/api/channels?includeArchived=1", respond: { json: options.channels ?? [general] } },
      { path: "/api/agents", respond: { json: [] } },
      feedRoute({ events: options.events ?? [], older: options.older ?? [] }),
    ],
  });

const message = (text: string, overrides?: Partial<EventRow>) =>
  getMockEvent({ id: `message-${text}`, createdAt: at(1), payload: { text }, ...overrides });

const numberedMessages = (count: number): EventRow[] =>
  Array.from({ length: count }, (_, index) =>
    message(`m${count - index}`, { createdAt: at(count - index) }),
  );

const trace = (id: string, overrides?: Partial<EventRow>) =>
  getMockEvent({ id, type: "tool.started", createdAt: at(1), payload: { tool: "shell" }, ...overrides });

const toolEvents = (count: number): EventRow[] =>
  Array.from({ length: count }, (_, index) => trace(`tool-${index}`, { createdAt: at(index + 1) }));

const pathsOf = (requests: readonly FakeRequest[]) => requests.map((request) => request.path);

const countOf = (requests: readonly FakeRequest[], path: string) =>
  pathsOf(requests).filter((candidate) => candidate === path).length;

const isShown = (text: string) => screen.queryByText(text) !== null;

const press = async (name: string) => {
  fireEvent.click(screen.getByRole("button", { name }));
  await settle();
};

const receive = async (socket: FakeWebSocketInstance, event: Partial<EventRow>) => {
  await act(async () => {
    socket.receive({ type: "event", topic: `channel:${event.channelId}`, data: event });
  });
};

const openSocket = async (socket: FakeWebSocketInstance) => {
  await act(async () => {
    socket.open();
  });
  await settle();
};

const dropSocket = async (socket: FakeWebSocketInstance) => {
  await act(async () => {
    socket.dropConnection();
  });
};

const shownInOrder = (texts: readonly string[]) =>
  [...texts.map((text) => screen.getByText(text))]
    .sort((left, right) => (left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map((element) => element.textContent);

const panelAround = (text: string) => {
  const panel = screen.getByText(text).closest("section");
  if (!panel) throw new Error(`No panel around "${text}"`);
  return panel;
};

type Layout = { scrollHeight: number; clientHeight: number; scrollTop: number };

const stubLayout = (panel: HTMLElement, layout: Layout) => {
  const scrollTo = vi.fn();
  Object.defineProperty(panel, "scrollHeight", { configurable: true, value: layout.scrollHeight });
  Object.defineProperty(panel, "clientHeight", { configurable: true, value: layout.clientHeight });
  Object.defineProperty(panel, "scrollTop", { configurable: true, writable: true, value: layout.scrollTop });
  Object.defineProperty(panel, "scrollTo", { configurable: true, value: scrollTo });
  return scrollTo;
};

const scrolledUp = (panel: HTMLElement, distanceFromBottom = 800) =>
  stubLayout(panel, { scrollHeight: 1000, clientHeight: 200, scrollTop: 1000 - 200 - distanceFromBottom });

const showsNewMessagesButton = () => screen.queryByRole("button", { name: "New messages below" }) !== null;

const feedWithNewerMessageOnPoll = (first: EventRow, second: EventRow): FakeRoute => ({
  path: LOAD_MESSAGES_PATH,
  respondInOrder: [{ json: [first] }, { json: [second, first] }],
});

const socketUrlPattern = /^ws:\/\/.+\/ws$/;

describe("Initial load of a channel", () => {
  it("requests the message, failure, turn, tool, context, wrapper and process feeds of the active channel", async () => {
    const { requests } = await openWorkspace();
    const base = `/api/events?channelId=channel-1`;

    expect(pathsOf(requests)).toEqual(
      expect.arrayContaining([
        `${base}&type=message.created&limit=30&order=desc`,
        `${base}&type=agent.turn.failed&limit=30&order=desc`,
        `${base}&typePrefix=agent.turn.&limit=30&order=desc`,
        `${base}&typePrefix=tool.&limit=30&order=desc`,
        `${base}&type=telemetry.context.window.updated&limit=30&order=desc`,
        `${base}&typePrefix=wrapper.turn.&limit=30&order=desc`,
        `${base}&typePrefix=process.&limit=30&order=desc`,
      ]),
    );
  });

  it("shows a loading state while the feeds are pending", async () => {
    await openWorkspace({
      routes: [{ path: /^\/api\/events\?channelId=/, respond: () => new Promise(() => undefined) }],
    });

    expect(isShown("Loading messages...")).toBe(true);
    expect(isShown("No messages yet")).toBe(false);
  });

  it("lists messages oldest first although the server returns newest first", async () => {
    await openWorkspace({
      events: [
        message("third", { createdAt: at(3) }),
        message("second", { createdAt: at(2) }),
        message("first", { createdAt: at(1) }),
      ],
    });

    expect(shownInOrder(["first", "second", "third"])).toEqual(["first", "second", "third"]);
  });

  it("says there are no messages yet for an empty channel", async () => {
    await openWorkspace();

    expect(isShown("No messages yet")).toBe(true);
    expect(isShown("Loading messages...")).toBe(false);
  });

  it("shows the server's error text when the messages cannot be loaded", async () => {
    await openWorkspace({
      routes: [{ path: LOAD_MESSAGES_PATH, respond: { status: 500, text: "Events unavailable" } }],
    });

    expect(isShown("Events unavailable")).toBe(true);
  });

  it("loads the feeds of another channel when it is selected and drops the previous timeline", async () => {
    const { requests } = await openWorkspace({
      channels: [general, ops],
      events: [message("in general"), message("in ops", { id: "ops-message", channelId: "ops-id" })],
    });
    await press("# ops");

    expect(pathsOf(requests)).toContain(
      `/api/events?channelId=ops-id&type=message.created&limit=${BATCH}&order=desc`,
    );
    expect(isShown("in ops")).toBe(true);
    expect(isShown("in general")).toBe(false);
  });

  it("does not show the button for older messages while loading", async () => {
    await openWorkspace({
      routes: [{ path: /^\/api\/events\?channelId=/, respond: () => new Promise(() => undefined) }],
    });

    expect(screen.queryByRole("button", { name: "Load previous messages" })).toBeNull();
  });
});

describe("Offering older messages", () => {
  const offersOlder = () => screen.queryByRole("button", { name: "Load previous messages" }) !== null;

  it("offers previous messages when the first page is full (30 messages)", async () => {
    await openWorkspace({ events: numberedMessages(30) });

    expect(offersOlder()).toBe(true);
  });

  it("does not offer previous messages when the first page is not full (29 messages)", async () => {
    await openWorkspace({ events: numberedMessages(29) });

    expect(offersOlder()).toBe(false);
  });

  it("[quirk] ignores a full page of tool events when deciding whether older messages exist", async () => {
    await openWorkspace({ events: [message("only one"), ...toolEvents(30)] });

    expect(offersOlder()).toBe(false);
  });
});

describe("Load previous messages", () => {
  const olderOf = (...texts: string[]) =>
    texts.map((text, index) => message(text, { createdAt: at(-1 - index) }));

  it("asks for messages, turns, tools, wrappers and processes before the oldest loaded event", async () => {
    const { requests } = await openWorkspace({ events: numberedMessages(30) });
    await press("Load previous messages");
    const before = `limit=30&order=desc&before=${at(1)}`;
    const base = `/api/events?channelId=channel-1`;

    expect(pathsOf(requests).filter((path) => path.includes("before="))).toEqual([
      `${base}&type=message.created&${before}`,
      `${base}&typePrefix=agent.turn.&${before}`,
      `${base}&typePrefix=tool.&${before}`,
      `${base}&typePrefix=wrapper.turn.&${before}`,
      `${base}&typePrefix=process.&${before}`,
    ]);
  });

  it("uses the oldest loaded event of any kind as the cursor", async () => {
    const { requests } = await openWorkspace({
      events: [...numberedMessages(30), trace("old-tool", { createdAt: at(-7) })],
    });
    await press("Load previous messages");

    expect(pathsOf(requests)).toContain(
      `/api/events?channelId=channel-1&type=message.created&limit=30&order=desc&before=${at(-7)}`,
    );
  });

  it("puts the older messages above the ones already shown", async () => {
    await openWorkspace({
      events: [...numberedMessages(29), message("newest", { createdAt: at(100) })],
      older: olderOf("one-before"),
    });
    await press("Load previous messages");

    expect(shownInOrder(["one-before", "m1", "newest"])).toEqual(["one-before", "m1", "newest"]);
  });

  it("[quirk] lists an older batch newest first, so a batch reads backwards", async () => {
    await openWorkspace({
      events: numberedMessages(30),
      older: olderOf("one-before", "two-before"),
    });
    await press("Load previous messages");

    expect(shownInOrder(["one-before", "two-before"])).toEqual(["one-before", "two-before"]);
  });

  it("does not repeat an older message that is already shown", async () => {
    await openWorkspace({
      events: numberedMessages(30),
      older: [message("m1", { createdAt: at(1) }), ...olderOf("fresh")],
    });
    await press("Load previous messages");

    expect(screen.getAllByText("m1")).toHaveLength(1);
    expect(isShown("fresh")).toBe(true);
  });

  it("stops offering older messages once a page comes back short", async () => {
    await openWorkspace({ events: numberedMessages(30), older: olderOf("only-one") });
    await press("Load previous messages");

    expect(screen.queryByRole("button", { name: "Load previous messages" })).toBeNull();
  });

  it("keeps offering older messages when the older page is full", async () => {
    await openWorkspace({
      events: numberedMessages(30),
      older: Array.from({ length: 30 }, (_, index) => message(`old${index}`, { createdAt: at(-1 - index) })),
    });
    await press("Load previous messages");

    expect(screen.queryByRole("button", { name: "Load previous messages" })).not.toBeNull();
  });

  it("[quirk] keeps offering older messages when only the older tool page is full", async () => {
    await openWorkspace({
      events: numberedMessages(30),
      older: toolEvents(30).map((event) => ({ ...event, createdAt: (event.createdAt ?? 0) - at(100) })),
    });
    await press("Load previous messages");

    expect(screen.queryByRole("button", { name: "Load previous messages" })).not.toBeNull();
  });

  it("shows a disabled 'Loading previous messages...' button while the request is pending", async () => {
    await openWorkspace({
      events: numberedMessages(30),
      routes: [{ path: /before=/, respond: () => new Promise(() => undefined) }],
    });
    await press("Load previous messages");
    const button = screen.getByRole("button", { name: "Loading previous messages..." }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
  });

  it("shows the server's error and keeps the loaded messages when loading older ones fails", async () => {
    await openWorkspace({
      events: numberedMessages(30),
      routes: [{ path: /before=/, respond: { status: 500, text: "Older unavailable" } }],
    });
    await press("Load previous messages");

    expect(isShown("Older unavailable")).toBe(true);
    expect(isShown("m30")).toBe(true);
    expect(screen.queryByRole("button", { name: "Load previous messages" })).not.toBeNull();
  });

  it("keeps the reading position by scrolling down by the height that was added", async () => {
    await openWorkspace({ events: numberedMessages(30), older: olderOf("fresh") });
    const panel = panelAround("m1");
    stubLayout(panel, { scrollHeight: 1000, clientHeight: 200, scrollTop: 100 });
    fireEvent.click(screen.getByRole("button", { name: "Load previous messages" }));
    Object.defineProperty(panel, "scrollHeight", { configurable: true, value: 1500 });
    await settle(50);

    expect(panel.scrollTop).toBe(600);
  });
});

describe("Realtime events in the active channel", () => {
  it("adds a message that arrives over the websocket", async () => {
    const { sockets } = await openWorkspace({ events: [message("loaded")] });
    await receive(sockets[0], message("live", { createdAt: at(5) }));

    expect(isShown("live")).toBe(true);
  });

  it("shows a message delivered twice only once", async () => {
    const { sockets } = await openWorkspace();
    await receive(sockets[0], message("live"));
    await receive(sockets[0], message("live"));

    expect(screen.getAllByText("live")).toHaveLength(1);
  });

  it("replaces a loaded event that shares the id of the incoming one", async () => {
    const { sockets } = await openWorkspace({ events: [message("draft", { id: "shared-id" })] });
    await receive(sockets[0], message("final", { id: "shared-id" }));

    expect(isShown("final")).toBe(true);
    expect(isShown("draft")).toBe(false);
  });

  it("places an incoming message by its creation time among loaded ones", async () => {
    const { sockets } = await openWorkspace({
      events: [message("third", { createdAt: at(3) }), message("first", { createdAt: at(1) })],
    });
    await receive(sockets[0], message("second", { createdAt: at(2) }));

    expect(shownInOrder(["first", "second", "third"])).toEqual(["first", "second", "third"]);
  });

  it("orders a scheduled message by its delivery time rather than its creation time", async () => {
    const { sockets } = await openWorkspace({ events: [message("loaded", { createdAt: at(3) })] });
    await receive(sockets[0], message("scheduled", { createdAt: at(1), deliverAt: at(9) }));

    expect(shownInOrder(["loaded", "scheduled"])).toEqual(["loaded", "scheduled"]);
  });

  it("orders messages created at the same time by id", async () => {
    const { sockets } = await openWorkspace({ events: [message("bravo", { id: "b-id", createdAt: at(2) })] });
    await receive(sockets[0], message("alpha", { id: "a-id", createdAt: at(2) }));

    expect(shownInOrder(["alpha", "bravo"])).toEqual(["alpha", "bravo"]);
  });

  it("ignores an event without an id", async () => {
    const { sockets } = await openWorkspace();
    await receive(sockets[0], message("nameless", { id: "" }));

    expect(isShown("nameless")).toBe(false);
  });

  it("ignores an event without a channel", async () => {
    const { sockets } = await openWorkspace();
    await receive(sockets[0], message("homeless", { channelId: undefined }));

    expect(isShown("homeless")).toBe(false);
  });

  it("keeps a message for another channel out of the active timeline", async () => {
    const { sockets } = await openWorkspace({ channels: [general, ops] });
    await receive(sockets[0], message("elsewhere", { channelId: "ops-id" }));

    expect(isShown("elsewhere")).toBe(false);
  });

  it("does not show a json-render action message", async () => {
    const { sockets } = await openWorkspace();
    await receive(sockets[0], message("clicked", { payload: { eventType: "ui.json-render.action", text: "clicked" } }));

    expect(isShown("clicked")).toBe(false);
  });

  it("ignores websocket frames that are not events", async () => {
    const { sockets } = await openWorkspace();
    await act(async () => {
      sockets[0].receive({ type: "pong", data: message("pong-text") });
    });

    expect(isShown("pong-text")).toBe(false);
  });

  it("survives a malformed websocket frame and keeps handling later events", async () => {
    const { sockets } = await openWorkspace();
    await act(async () => {
      sockets[0].onmessage?.({ data: "{not json" });
    });
    await receive(sockets[0], message("after-garbage"));

    expect(isShown("after-garbage")).toBe(true);
  });

  it("shows an incoming turn failure in the timeline", async () => {
    const { sockets } = await openWorkspace();
    await receive(
      sockets[0],
      getMockEvent({
        id: "failure-1",
        type: "agent.turn.failed",
        payload: { error: "model exploded" },
        createdAt: at(2),
      }),
    );

    expect(screen.queryByText(/model exploded/)).not.toBeNull();
  });
});

describe("New messages below", () => {
  const withMessageOnScreen = async () => {
    const app = await openWorkspace({ events: [message("loaded")] });
    await settle(100);
    return { ...app, panel: panelAround("loaded") };
  };

  it("does not show the button when a message arrives and the reader is at the bottom", async () => {
    const { sockets } = await withMessageOnScreen();
    await receive(sockets[0], message("live", { createdAt: at(2) }));

    expect(showsNewMessagesButton()).toBe(false);
  });

  it("shows the button when a message arrives while the reader is scrolled up", async () => {
    const { sockets, panel } = await withMessageOnScreen();
    scrolledUp(panel);
    await receive(sockets[0], message("live", { createdAt: at(2) }));

    expect(showsNewMessagesButton()).toBe(true);
  });

  it("treats 79px from the bottom as near the bottom", async () => {
    const { sockets, panel } = await withMessageOnScreen();
    scrolledUp(panel, 79);
    await receive(sockets[0], message("live", { createdAt: at(2) }));

    expect(showsNewMessagesButton()).toBe(false);
  });

  it("treats 80px from the bottom as scrolled up", async () => {
    const { sockets, panel } = await withMessageOnScreen();
    scrolledUp(panel, 80);
    await receive(sockets[0], message("live", { createdAt: at(2) }));

    expect(showsNewMessagesButton()).toBe(true);
  });

  it("shows the button for an incoming trace event", async () => {
    const { sockets, panel } = await withMessageOnScreen();
    scrolledUp(panel);
    await receive(sockets[0], trace("tool-live", { createdAt: at(2) }));

    expect(showsNewMessagesButton()).toBe(true);
  });

  it("does not show the button for a hidden json-render action message", async () => {
    const { sockets, panel } = await withMessageOnScreen();
    scrolledUp(panel);
    await receive(sockets[0], message("clicked", { payload: { eventType: "ui.json-render.action" } }));

    expect(showsNewMessagesButton()).toBe(false);
  });

  it("does not show the button for a message in another channel", async () => {
    const { sockets, panel } = await openWorkspace({ channels: [general, ops], events: [message("loaded")] }).then(
      (app) => ({ ...app, panel: panelAround("loaded") }),
    );
    scrolledUp(panel);
    await receive(sockets[0], message("elsewhere", { channelId: "ops-id" }));

    expect(showsNewMessagesButton()).toBe(false);
  });

  it("scrolls smoothly to the bottom when the reader is already there", async () => {
    const { sockets, panel } = await withMessageOnScreen();
    const scrollTo = stubLayout(panel, { scrollHeight: 1000, clientHeight: 200, scrollTop: 800 });
    await receive(sockets[0], message("live", { createdAt: at(2) }));
    await settle(20);

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
  });

  it("does not scroll when the reader is scrolled up", async () => {
    const { sockets, panel } = await withMessageOnScreen();
    const scrollTo = scrolledUp(panel);
    await receive(sockets[0], message("live", { createdAt: at(2) }));
    await settle(20);

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("hides the button and scrolls to the bottom when it is pressed", async () => {
    const { sockets, panel } = await withMessageOnScreen();
    const scrollTo = scrolledUp(panel);
    await receive(sockets[0], message("live", { createdAt: at(2) }));
    await press("New messages below");
    await settle(20);

    expect(showsNewMessagesButton()).toBe(false);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
  });

  it("hides the button when the reader scrolls back near the bottom", async () => {
    const { sockets, panel } = await withMessageOnScreen();
    scrolledUp(panel);
    await receive(sockets[0], message("live", { createdAt: at(2) }));
    stubLayout(panel, { scrollHeight: 1000, clientHeight: 200, scrollTop: 721 });
    fireEvent.scroll(panel);

    expect(showsNewMessagesButton()).toBe(false);
  });

  it("keeps the button while the reader is still far from the bottom after scrolling", async () => {
    const { sockets, panel } = await withMessageOnScreen();
    scrolledUp(panel);
    await receive(sockets[0], message("live", { createdAt: at(2) }));
    stubLayout(panel, { scrollHeight: 1000, clientHeight: 200, scrollTop: 720 });
    fireEvent.scroll(panel);

    expect(showsNewMessagesButton()).toBe(true);
  });

  it("clears the button when another channel is opened", async () => {
    const { sockets, panel } = await openWorkspace({
      channels: [general, ops],
      events: [message("loaded")],
    }).then((app) => ({ ...app, panel: panelAround("loaded") }));
    scrolledUp(panel);
    await receive(sockets[0], message("live", { createdAt: at(2) }));
    await press("# ops");

    expect(showsNewMessagesButton()).toBe(false);
  });

  it("shows the button when a poll finds a newer message while the reader is scrolled up", async () => {
    const { panel } = await openWorkspace({
      routes: [feedWithNewerMessageOnPoll(message("loaded", { createdAt: at(1) }), message("polled", { createdAt: at(2) }))],
    }).then((app) => ({ ...app, panel: panelAround("loaded") }));
    scrolledUp(panel);
    await settle(10_000);

    expect(isShown("polled")).toBe(true);
    expect(showsNewMessagesButton()).toBe(true);
  });

  it("does not show the button when a poll finds a newer message and the reader is at the bottom", async () => {
    await openWorkspace({
      routes: [feedWithNewerMessageOnPoll(message("loaded", { createdAt: at(1) }), message("polled", { createdAt: at(2) }))],
    });
    await settle(10_000);

    expect(isShown("polled")).toBe(true);
    expect(showsNewMessagesButton()).toBe(false);
  });

  it("does not show the button when a poll finds nothing new", async () => {
    const { panel } = await openWorkspace({ events: [message("loaded")] }).then((app) => ({
      ...app,
      panel: panelAround("loaded"),
    }));
    scrolledUp(panel);
    await settle(10_000);

    expect(showsNewMessagesButton()).toBe(false);
  });
});

describe("Polling while the websocket is down", () => {
  it("does not poll before 10 seconds have passed", async () => {
    const { requests } = await openWorkspace();
    const loads = countOf(requests, LOAD_MESSAGES_PATH);
    const notifications = countOf(requests, NOTIFICATIONS_PATH);
    await settle(9_999);

    expect(countOf(requests, LOAD_MESSAGES_PATH)).toBe(loads);
    expect(countOf(requests, NOTIFICATIONS_PATH)).toBe(notifications);
  });

  it("reloads the active channel and the notifications after 10 seconds", async () => {
    const { requests } = await openWorkspace();
    const loads = countOf(requests, LOAD_MESSAGES_PATH);
    const notifications = countOf(requests, NOTIFICATIONS_PATH);
    await settle(10_000);

    expect(countOf(requests, LOAD_MESSAGES_PATH)).toBe(loads + 1);
    expect(countOf(requests, NOTIFICATIONS_PATH)).toBe(notifications + 1);
  });

  it("keeps polling every 10 seconds", async () => {
    const { requests } = await openWorkspace();
    const loads = countOf(requests, LOAD_MESSAGES_PATH);
    await settle(30_000);

    expect(countOf(requests, LOAD_MESSAGES_PATH)).toBe(loads + 3);
  });

  it("shows a message that was only found by polling", async () => {
    await openWorkspace({
      routes: [
        {
          path: LOAD_MESSAGES_PATH,
          respondInOrder: [{ json: [] }, { json: [message("polled")] }],
        },
      ],
    });
    await settle(10_000);

    expect(isShown("polled")).toBe(true);
  });

  it("keeps the messages already shown when a poll returns a newer page", async () => {
    await openWorkspace({
      routes: [
        {
          path: LOAD_MESSAGES_PATH,
          respondInOrder: [{ json: [message("old", { createdAt: at(1) })] }, { json: [message("new", { createdAt: at(2) })] }],
        },
      ],
    });
    await settle(10_000);

    expect(isShown("old")).toBe(true);
    expect(isShown("new")).toBe(true);
  });

  it("stops polling while the websocket is connected", async () => {
    const { requests, sockets } = await openWorkspace();
    await openSocket(sockets[0]);
    const before = countOf(requests, LOAD_MESSAGES_PATH);
    await settle(30_000);

    expect(countOf(requests, LOAD_MESSAGES_PATH)).toBe(before);
  });

  it("resumes polling 10 seconds after the websocket drops", async () => {
    const { requests, sockets } = await openWorkspace();
    await openSocket(sockets[0]);
    const before = countOf(requests, LOAD_MESSAGES_PATH);
    await dropSocket(sockets[0]);
    await settle(9_999);

    expect(countOf(requests, LOAD_MESSAGES_PATH)).toBe(before);

    await settle(1);

    expect(countOf(requests, LOAD_MESSAGES_PATH)).toBe(before + 1);
  });

  it("does not poll a channel when none is selected", async () => {
    const { requests } = await openWorkspace({ channels: [] });
    const notifications = countOf(requests, NOTIFICATIONS_PATH);
    await settle(10_000);

    expect(pathsOf(requests).filter((path) => path.startsWith("/api/events?channelId="))).toEqual([]);
    expect(countOf(requests, NOTIFICATIONS_PATH)).toBe(notifications + 1);
  });
});

describe("Websocket connection", () => {
  it("connects to the /ws endpoint once signed in", async () => {
    const { sockets } = await openWorkspace();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toMatch(socketUrlPattern);
  });

  it("does not connect while signed out", async () => {
    const { sockets } = await renderApp({
      routes: [{ path: "/api/auth/me", respond: { status: 401, text: "Unauthorized" } }],
    });

    expect(sockets).toHaveLength(0);
  });

  it("does not connect while a password change is required", async () => {
    const { sockets } = await renderApp({
      routes: [{ path: "/api/auth/me", respond: { json: getMockAuthMe({ mustChangePassword: true }) } }],
    });

    expect(sockets).toHaveLength(0);
  });

  it("reloads the active channel and notifications when the socket opens", async () => {
    const { requests, sockets } = await openWorkspace();
    const loads = countOf(requests, LOAD_MESSAGES_PATH);
    const notifications = countOf(requests, NOTIFICATIONS_PATH);
    await openSocket(sockets[0]);

    expect(countOf(requests, LOAD_MESSAGES_PATH)).toBe(loads + 1);
    expect(countOf(requests, NOTIFICATIONS_PATH)).toBe(notifications + 1);
  });

  it("closes the socket and stops reconnecting after sign out", async () => {
    const { sockets } = await openWorkspace({
      routes: [{ method: "POST", path: "/api/auth/logout", respond: { json: { ok: true } } }],
    });
    await openSocket(sockets[0]);
    await press("Sign out (alice)");
    await settle(10_000);

    expect(sockets).toHaveLength(1);
    expect(sockets[0].readyState).toBe(3);
  });
});

describe("Websocket reconnect backoff", () => {
  const reconnectsAfter = async (sockets: FakeWebSocketInstance[], delays: readonly number[]) => {
    for (const [index, delay] of delays.entries()) {
      await dropSocket(sockets[index]);
      await settle(delay - 1);
      expect(sockets).toHaveLength(index + 1);
      await settle(1);
      expect(sockets).toHaveLength(index + 2);
    }
  };

  it("reconnects 400ms after the socket closes", async () => {
    const { sockets } = await openWorkspace();

    await reconnectsAfter(sockets, [400]);
  });

  it("doubles the delay for each failed attempt: 400, 800, 1600, 3200", async () => {
    const { sockets } = await openWorkspace();

    await reconnectsAfter(sockets, [400, 800, 1600, 3200]);
  });

  it("caps the delay at 5000ms", async () => {
    const { sockets } = await openWorkspace();

    await reconnectsAfter(sockets, [400, 800, 1600, 3200, 5000, 5000]);
  });

  it("starts over at 400ms after a connection succeeds", async () => {
    const { sockets } = await openWorkspace();
    await reconnectsAfter(sockets, [400, 800]);
    await openSocket(sockets[2]);
    await dropSocket(sockets[2]);
    await settle(399);

    expect(sockets).toHaveLength(3);

    await settle(1);

    expect(sockets).toHaveLength(4);
  });

  it("closes the socket on an error so that it reconnects", async () => {
    const { sockets } = await openWorkspace();
    await act(async () => {
      sockets[0].onerror?.(new Event("error"));
    });
    await settle(400);

    expect(sockets[0].readyState).toBe(3);
    expect(sockets).toHaveLength(2);
  });

  it("connects to the same url when reconnecting", async () => {
    const { sockets } = await openWorkspace();
    await reconnectsAfter(sockets, [400]);

    expect(sockets[1].url).toBe(sockets[0].url);
  });

  it("reloads the active channel when the reconnected socket opens, picking up missed messages", async () => {
    const { sockets } = await openWorkspace({
      routes: [
        {
          path: LOAD_MESSAGES_PATH,
          respondInOrder: [{ json: [] }, { json: [message("missed")] }],
        },
      ],
    });
    await openSocket(sockets[0]);
    await reconnectsAfter(sockets, [400]);
    await openSocket(sockets[1]);

    expect(isShown("missed")).toBe(true);
  });
});

describe("Websocket topics", () => {
  const sentBy = (socket: FakeWebSocketInstance) => socket.sent.map((frame) => JSON.parse(frame));

  it("sends nothing before the socket is open", async () => {
    const { sockets } = await openWorkspace({ channels: [general, ops] });

    expect(sockets[0].sent).toEqual([]);
  });

  it("subscribes to every visible channel when the socket opens", async () => {
    const { sockets } = await openWorkspace({ channels: [general, ops] });
    await openSocket(sockets[0]);

    expect(sentBy(sockets[0])).toEqual([
      { type: "subscribe", topic: "channel:channel-1" },
      { type: "subscribe", topic: "channel:ops-id" },
    ]);
  });

  it("does not subscribe to a channel the viewer cannot see", async () => {
    const { sockets } = await openWorkspace({ channels: [general, someoneElsesPrivate] });
    await openSocket(sockets[0]);

    expect(sentBy(sockets[0])).toEqual([{ type: "subscribe", topic: "channel:channel-1" }]);
  });

  it("subscribes to archived channels as well", async () => {
    const archived = getMockChannel({ id: "old-id", name: "old", archivedAt: at(-5) });
    const { sockets } = await openWorkspace({ channels: [general, archived] });
    await openSocket(sockets[0]);

    expect(sentBy(sockets[0])).toContainEqual({ type: "subscribe", topic: "channel:old-id" });
  });

  it("resubscribes to every channel on a new socket after reconnecting", async () => {
    const { sockets } = await openWorkspace({ channels: [general, ops] });
    await openSocket(sockets[0]);
    await dropSocket(sockets[0]);
    await settle(400);
    await openSocket(sockets[1]);

    expect(sentBy(sockets[1])).toEqual([
      { type: "subscribe", topic: "channel:channel-1" },
      { type: "subscribe", topic: "channel:ops-id" },
    ]);
  });

  it("sends nothing more when the operator switches channel", async () => {
    const { sockets } = await openWorkspace({ channels: [general, ops] });
    await openSocket(sockets[0]);
    await press("# ops");

    expect(sockets[0].sent).toHaveLength(2);
  });

  it("subscribes to a channel that appears while the socket is open", async () => {
    const { sockets } = await openWorkspace({
      routes: [
        {
          path: "/api/channels?includeArchived=1",
          respondInOrder: [{ json: [general] }, { json: [general, ops] }],
        },
        { method: "POST", path: "/api/channels", respond: { json: { id: "ops-id" } } },
      ],
    });
    await openSocket(sockets[0]);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "ops" } });
    await press("Start");

    expect(sentBy(sockets[0])).toContainEqual({ type: "subscribe", topic: "channel:ops-id" });
  });

  it("unsubscribes from a channel that disappears while the socket is open", async () => {
    vi.stubGlobal("confirm", () => true);
    const { sockets } = await openWorkspace({
      routes: [
        {
          path: "/api/channels?includeArchived=1",
          respondInOrder: [{ json: [getMockChannel({ ...general, canManage: true }), ops] }, { json: [ops] }],
        },
        { method: "DELETE", path: "/api/channels/channel-1", respond: { json: { ok: true } } },
      ],
    });
    await openSocket(sockets[0]);
    await press("Manage channel");
    await press("Delete channel");

    expect(sentBy(sockets[0])).toContainEqual({ type: "unsubscribe", topic: "channel:channel-1" });
  });

  it("keeps the other channels subscribed when one disappears", async () => {
    vi.stubGlobal("confirm", () => true);
    const manageable = getMockChannel({ ...general, canManage: true });
    const { sockets } = await openWorkspace({
      routes: [
        {
          path: "/api/channels?includeArchived=1",
          respondInOrder: [{ json: [manageable, ops] }, { json: [ops] }],
        },
        { method: "DELETE", path: "/api/channels/channel-1", respond: { json: { ok: true } } },
      ],
    });
    await openSocket(sockets[0]);
    await press("Manage channel");
    await press("Delete channel");

    expect(sentBy(sockets[0]).filter((frame) => frame.topic === "channel:ops-id")).toEqual([
      { type: "subscribe", topic: "channel:ops-id" },
    ]);
  });
});
