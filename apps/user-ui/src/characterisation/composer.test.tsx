import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Agent, Channel, ChannelParticipant, EventRow } from "../types";
import { getMockAgent, getMockAuthMe, getMockChannel, getMockEvent } from "./factories";
import type { FakeRequest, FakeResponse, FakeRoute } from "./fake-api";
import { renderApp, settle } from "./render-app";

const general = getMockChannel({ id: "channel-1", name: "general" });

type ComposerOptions = {
  channels?: readonly Channel[];
  agents?: readonly Agent[];
  events?: readonly EventRow[];
  routes?: readonly FakeRoute[];
  realtimeAvailable?: boolean;
};

const sendAccepted: FakeRoute = { method: "POST", path: "/api/events", respond: { json: {} } };

const sendNeverFinishes: FakeRoute = {
  method: "POST",
  path: "/api/events",
  respond: () => new Promise<FakeResponse>(() => undefined),
};

const openComposer = async (options: ComposerOptions = {}) => {
  const view = await renderApp({
    realtimeAvailable: options.realtimeAvailable,
    routes: [
      ...(options.routes ?? []),
      { path: "/api/auth/me", respond: { json: getMockAuthMe({ id: "human-1", username: "alice" }) } },
      { path: "/api/channels?includeArchived=1", respond: { json: options.channels ?? [general] } },
      { path: "/api/agents", respond: { json: options.agents ?? [] } },
      { path: /^\/api\/events\?channelId=/, respond: { json: options.events ?? [] } },
    ],
  });
  const user = userEvent.setup({ delay: null, advanceTimers: (milliseconds) => vi.advanceTimersByTime(milliseconds) });
  return { ...view, user };
};

const composerBox = () => {
  const box = screen.getAllByRole("textbox").find((element): element is HTMLTextAreaElement => element instanceof HTMLTextAreaElement);
  if (!box) throw new Error("No composer textarea");
  return box;
};

const fileInput = () => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("No file input");
  return input;
};

const isDisabled = (name: string | RegExp) => (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

const isShown = (text: string) => screen.queryByText(text) !== null;

const fillIn = (value: string) => fireEvent.change(composerBox(), { target: { value } });

const pressEnter = async (modifiers: { isComposing?: boolean; shiftKey?: boolean } = {}) => {
  fireEvent.keyDown(composerBox(), { key: "Enter", ...modifiers });
  await settle();
};

const pressSend = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await settle();
};

const pickFiles = async (...files: File[]) => {
  fireEvent.change(fileInput(), { target: { files } });
  await settle();
};

const fileOf = (name: string, options: { type?: string; bytes?: number } = {}) =>
  new File(["x".repeat(options.bytes ?? 10)], name, { type: options.type ?? "text/plain" });

type StoredFile = { id: string; meta?: Record<string, unknown> };

const filesRoutes = (...stored: readonly StoredFile[]): FakeRoute[] => [
  { method: "POST", path: "/api/files", respondInOrder: stored.map((file) => ({ json: { id: file.id } })) },
  {
    path: /^\/api\/files\/[^/]+\/meta$/,
    respond: ({ path }) => {
      const id = decodeURIComponent(path.split("/")[3]);
      return { json: { id, ...stored.find((file) => file.id === id)?.meta } };
    },
  },
];

const eventPosts = (requests: readonly FakeRequest[]) =>
  requests.filter((request) => request.method === "POST" && request.path === "/api/events");

const fileUploads = (requests: readonly FakeRequest[]) =>
  requests.filter((request) => request.method === "POST" && request.path === "/api/files");

const messageListLoads = (requests: readonly FakeRequest[]) =>
  requests.filter((request) => request.method === "GET" && request.path.includes("type=message.created"));

const uploadedFileOf = (request: FakeRequest) => {
  const file = request.body instanceof FormData ? request.body.get("file") : null;
  if (!(file instanceof File)) throw new Error("No uploaded file in request");
  return file;
};

const pasteIntoComposer = async (items: readonly { type: string; file?: File }[]) => {
  const clipboardData = { items: items.map((item) => ({ type: item.type, getAsFile: () => item.file ?? null })) };
  fireEvent.paste(composerBox(), { clipboardData });
  await settle();
};

const openArchivedChannel = async (channel: Channel) => {
  await openComposer({ channels: [general, channel] });
  fireEvent.click(screen.getByRole("button", { name: "Archived 1 +" }));
  fireEvent.click(screen.getByRole("button", { name: `# ${channel.name}` }));
  await settle();
};

const typeText = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  const typing = user.type(composerBox(), text);
  await settle(10);
  await typing;
  await settle();
};

const agentParticipant = (name: string): ChannelParticipant => ({ subscriberType: "AGENT", subscriberId: name });

describe("Sending with the keyboard", () => {
  it("sends the draft as a message when Enter is pressed", async () => {
    const { user, requests } = await openComposer({ routes: [sendAccepted] });

    await typeText(user, "Hello team{Enter}");

    expect(eventPosts(requests)).toEqual([
      {
        method: "POST",
        path: "/api/events",
        body: {
          type: "message.created",
          payload: { text: "Hello team" },
          source: "human:alice",
          channelId: "channel-1",
        },
      },
    ]);
  });

  it("empties the composer once the message is sent", async () => {
    const { user } = await openComposer({ routes: [sendAccepted] });

    await typeText(user, "Hello team{Enter}");

    expect(composerBox().value).toBe("");
  });

  it("adds a new line instead of sending when Shift+Enter is pressed", async () => {
    const { user, requests } = await openComposer({ routes: [sendAccepted] });

    await typeText(user, "first{Shift>}{Enter}{/Shift}second");

    expect(composerBox().value).toBe("first\nsecond");
    expect(eventPosts(requests)).toEqual([]);
  });

  it("keeps the line break inside a multi-line message", async () => {
    const { user, requests } = await openComposer({ routes: [sendAccepted] });

    await typeText(user, "first{Shift>}{Enter}{/Shift}second{Enter}");

    expect(eventPosts(requests)[0].body).toMatchObject({ payload: { text: "first\nsecond" } });
  });

  it("does not send when Enter confirms an IME composition", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted] });
    fillIn("こんにちは");

    await pressEnter({ isComposing: true });

    expect(eventPosts(requests)).toEqual([]);
    expect(composerBox().value).toBe("こんにちは");
  });

  it("sends once the composition has ended", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted] });
    fillIn("こんにちは");

    await pressEnter({ isComposing: false });

    expect(eventPosts(requests)).toHaveLength(1);
  });

  it("does not send an empty draft when Enter is pressed", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted] });

    await pressEnter();

    expect(eventPosts(requests)).toEqual([]);
  });

  it("does not send a whitespace-only draft when Enter is pressed", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted] });
    fillIn("   \n  ");

    await pressEnter();

    expect(eventPosts(requests)).toEqual([]);
  });

  it("trims the message before sending it", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted] });
    fillIn("  hi there  ");

    await pressEnter();

    expect(eventPosts(requests)[0].body).toMatchObject({ payload: { text: "hi there" } });
  });

  it("sends the draft when the Send button is clicked", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted] });
    fillIn("Hello team");

    await pressSend();

    expect(eventPosts(requests)).toHaveLength(1);
  });

  it("sends the message under the signed-in username", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted] });
    fillIn("Hello");

    await pressEnter();

    expect(eventPosts(requests)[0].body).toMatchObject({ source: "human:alice", channelId: "channel-1" });
  });

  it("sends to the channel that is open", async () => {
    const random = getMockChannel({ id: "channel-2", name: "random" });
    const { requests } = await openComposer({ channels: [general, random], routes: [sendAccepted] });
    fireEvent.click(screen.getByRole("button", { name: /# random/ }));
    await settle();
    fillIn("Hello");

    await pressEnter();

    expect(eventPosts(requests)[0].body).toMatchObject({ channelId: "channel-2" });
  });
});

describe("Send button availability", () => {
  it("is disabled while the draft is empty", async () => {
    await openComposer();

    expect(isDisabled("Send")).toBe(true);
  });

  it("is disabled while the draft is only whitespace", async () => {
    await openComposer();

    fillIn("   ");

    expect(isDisabled("Send")).toBe(true);
  });

  it("is enabled once the draft has text", async () => {
    await openComposer();

    fillIn("a");

    expect(isDisabled("Send")).toBe(false);
  });

  it("is enabled when a ready attachment replaces the text", async () => {
    await openComposer({ routes: filesRoutes({ id: "file-1" }) });

    await pickFiles(fileOf("notes.txt"));

    expect(isDisabled("Send")).toBe(false);
  });
});

describe("While a message is being sent", () => {
  it("shows Sending... on the disabled send button", async () => {
    await openComposer({ routes: [sendNeverFinishes] });
    fillIn("Hello");

    await pressSend();

    expect(isDisabled("Sending...")).toBe(true);
  });

  it("disables the text box and Attach files and keeps the draft", async () => {
    await openComposer({ routes: [sendNeverFinishes] });
    fillIn("Hello");

    await pressSend();

    expect(composerBox().disabled).toBe(true);
    expect(composerBox().value).toBe("Hello");
    expect(isDisabled("Attach files")).toBe(true);
  });
});

describe("When sending fails", () => {
  it("shows the error text from the server", async () => {
    await openComposer({ routes: [{ method: "POST", path: "/api/events", respond: { status: 500, text: "Event rejected" } }] });
    fillIn("Hello");

    await pressEnter();

    expect(isShown("Event rejected")).toBe(true);
  });

  it("shows the status when the server gives no text", async () => {
    await openComposer({ routes: [{ method: "POST", path: "/api/events", respond: { status: 503 } }] });
    fillIn("Hello");

    await pressEnter();

    expect(isShown("Request failed: 503")).toBe(true);
  });

  it("keeps the draft and lets the operator try again", async () => {
    await openComposer({ routes: [{ method: "POST", path: "/api/events", respond: { status: 500, text: "Nope" } }] });
    fillIn("Hello");

    await pressEnter();

    expect(composerBox().value).toBe("Hello");
    expect(composerBox().disabled).toBe(false);
    expect(isDisabled("Send")).toBe(false);
  });

  it("clears the error after the next message is sent", async () => {
    await openComposer({
      routes: [
        {
          method: "POST",
          path: "/api/events",
          respondInOrder: [{ status: 500, text: "Nope" }, { json: {} }],
        },
      ],
    });
    fillIn("Hello");
    await pressEnter();

    await pressEnter();

    expect(isShown("Nope")).toBe(false);
  });
});

describe("After a message is sent", () => {
  it("reloads the messages when the realtime connection is down", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted], realtimeAvailable: false });
    fillIn("Hello");
    const before = messageListLoads(requests).length;

    await pressEnter();

    expect(messageListLoads(requests).length).toBeGreaterThan(before);
  });

  it("does not reload the messages when the realtime connection is up", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted] });
    fillIn("Hello");
    const before = messageListLoads(requests).length;

    await pressEnter();

    expect(messageListLoads(requests).length).toBe(before);
  });
});

describe("Where the composer is not available", () => {
  it("is disabled for an archived channel and asks to restore it", async () => {
    await openArchivedChannel(getMockChannel({ id: "old", name: "old-news", archivedAt: 1_700_000_000_000 }));

    expect(screen.getByPlaceholderText("Restore this channel to send messages")).toBeTruthy();
    expect(composerBox().disabled).toBe(true);
    expect(isDisabled("Attach files")).toBe(true);
    expect(isDisabled("Send")).toBe(true);
  });

  it("is disabled for a read-only shared channel and says so", async () => {
    await openComposer({ channels: [getMockChannel({ canPost: false })] });

    expect(screen.getByPlaceholderText("This channel is shared with you as read-only")).toBeTruthy();
    expect(composerBox().disabled).toBe(true);
    expect(isDisabled("Attach files")).toBe(true);
    expect(isDisabled("Send")).toBe(true);
  });

  it("prefers the archived message over the read-only one", async () => {
    await openArchivedChannel(getMockChannel({ id: "old", name: "old-news", archivedAt: 1_700_000_000_000, canPost: false }));

    expect(screen.getByPlaceholderText("Restore this channel to send messages")).toBeTruthy();
  });

  it("is enabled when the channel does not say whether posting is allowed", async () => {
    await openComposer({ channels: [getMockChannel({ canPost: undefined })] });

    expect(composerBox().disabled).toBe(false);
  });

  it("is disabled with no channel to talk in", async () => {
    await openComposer({ channels: [] });

    expect(screen.getByPlaceholderText("Select a channel first")).toBeTruthy();
    expect(composerBox().disabled).toBe(true);
    expect(isDisabled("Attach files")).toBe(true);
    expect(isDisabled("Send")).toBe(true);
  });
});

describe("Composer placeholder", () => {
  it("invites a first message in an empty channel", async () => {
    await openComposer();

    expect(screen.getByPlaceholderText("Message # general")).toBeTruthy();
  });

  it("explains the keys once the channel has messages", async () => {
    await openComposer({ events: [getMockEvent()] });

    expect(screen.getByPlaceholderText("Message # general (Enter to send, Shift+Enter for newline)")).toBeTruthy();
  });

  it("names a direct message after the other participant", async () => {
    const direct = getMockChannel({
      name: "dm",
      kind: "HUMAN_AGENT_DM",
      participants: [
        { subscriberType: "HUMAN", subscriberId: "alice" },
        agentParticipant("helper"),
      ],
    });
    await openComposer({ channels: [direct], agents: [getMockAgent({ name: "helper" })] });

    expect(screen.getByPlaceholderText("Message helper")).toBeTruthy();
  });
});

describe("Offline agents hint", () => {
  const withParticipants = (...names: string[]) =>
    getMockChannel({ participants: names.map(agentParticipant) });

  it("says a single stopped agent will reply once started", async () => {
    await openComposer({
      channels: [withParticipants("helper")],
      agents: [getMockAgent({ name: "helper", runtimeState: "STOPPED" })],
    });

    expect(isShown("helper is off — will reply once started.")).toBe(true);
  });

  it("lists several stopped agents", async () => {
    await openComposer({
      channels: [withParticipants("helper", "scout")],
      agents: [
        getMockAgent({ name: "helper", runtimeState: "STOPPED" }),
        getMockAgent({ id: "agent-2", name: "scout", runtimeState: "STOPPED" }),
      ],
    });

    expect(isShown("helper, scout are off — will reply once started.")).toBe(true);
  });

  it("names only the stopped agents", async () => {
    await openComposer({
      channels: [withParticipants("helper", "scout")],
      agents: [
        getMockAgent({ name: "helper", runtimeState: "RUNNING" }),
        getMockAgent({ id: "agent-2", name: "scout", runtimeState: "STOPPED" }),
      ],
    });

    expect(isShown("scout is off — will reply once started.")).toBe(true);
  });

  it("stays quiet when every agent is running", async () => {
    await openComposer({
      channels: [withParticipants("helper")],
      agents: [getMockAgent({ name: "helper", runtimeState: "RUNNING" })],
    });

    expect(screen.queryByText(/will reply once started/)).toBeNull();
  });

  it("treats an agent missing from the agent list as off", async () => {
    await openComposer({ channels: [withParticipants("ghost")] });

    expect(isShown("ghost is off — will reply once started.")).toBe(true);
  });
});

describe("Attaching files", () => {
  it("uploads the picked file and asks for its details", async () => {
    const { requests } = await openComposer({ routes: filesRoutes({ id: "file-1" }) });

    await pickFiles(fileOf("notes.txt", { type: "text/plain" }));

    expect(fileUploads(requests).map((request) => uploadedFileOf(request).name)).toEqual(["notes.txt"]);
    expect(requests.map((request) => `${request.method} ${request.path}`)).toContain("GET /api/files/file-1/meta");
  });

  it("encodes the file id when asking for its details", async () => {
    const { requests } = await openComposer({ routes: filesRoutes({ id: "a b/c" }) });

    await pickFiles(fileOf("notes.txt"));

    expect(requests.map((request) => `${request.method} ${request.path}`)).toContain("GET /api/files/a%20b%2Fc/meta");
  });

  it("shows the file as uploading and blocks sending until it is done", async () => {
    await openComposer({ routes: [{ method: "POST", path: "/api/files", respond: () => new Promise<FakeResponse>(() => undefined) }] });
    fillIn("Hello");

    await pickFiles(fileOf("notes.txt"));

    expect(isShown("notes.txt")).toBe(true);
    expect(isShown("Uploading...")).toBe(true);
    expect(isDisabled("Uploading 1...")).toBe(true);
  });

  it("counts every file still uploading", async () => {
    await openComposer({ routes: [{ method: "POST", path: "/api/files", respond: () => new Promise<FakeResponse>(() => undefined) }] });

    await pickFiles(fileOf("a.txt"), fileOf("b.txt"));

    expect(isDisabled("Uploading 2...")).toBe(true);
  });

  it("does not send on Enter while a file is still uploading", async () => {
    const { requests } = await openComposer({
      routes: [sendAccepted, { method: "POST", path: "/api/files", respond: () => new Promise<FakeResponse>(() => undefined) }],
    });
    fillIn("Hello");
    await pickFiles(fileOf("notes.txt"));

    await pressEnter();

    expect(eventPosts(requests)).toEqual([]);
    expect(composerBox().value).toBe("Hello");
  });

  it("does nothing when the picker returns no files", async () => {
    const { requests } = await openComposer({ routes: filesRoutes({ id: "file-1" }) });

    await pickFiles();

    expect(fileUploads(requests)).toEqual([]);
  });

  it("uploads every picked file", async () => {
    const { requests } = await openComposer({ routes: filesRoutes({ id: "file-1" }, { id: "file-2" }) });

    await pickFiles(fileOf("a.txt"), fileOf("b.txt"));

    expect(fileUploads(requests).map((request) => uploadedFileOf(request).name)).toEqual(["a.txt", "b.txt"]);
    expect(isShown("a.txt")).toBe(true);
    expect(isShown("b.txt")).toBe(true);
  });

  it("marks the file ready with its size once uploaded", async () => {
    await openComposer({ routes: filesRoutes({ id: "file-1", meta: { size: 2048 } }) });

    await pickFiles(fileOf("notes.txt"));

    expect(isShown("Ready • 2.0 KB")).toBe(true);
  });

  it.each([
    { size: 512, label: "Ready • 512 B" },
    { size: 1023, label: "Ready • 1023 B" },
    { size: 1024, label: "Ready • 1.0 KB" },
    { size: 1536, label: "Ready • 1.5 KB" },
    { size: 100 * 1024, label: "Ready • 100 KB" },
    { size: 1024 * 1024, label: "Ready • 1.0 MB" },
    { size: 150 * 1024 * 1024, label: "Ready • 150 MB" },
  ])("formats a $size byte file as $label", async ({ size, label }) => {
    await openComposer({ routes: filesRoutes({ id: "file-1", meta: { size } }) });

    await pickFiles(fileOf("notes.txt"));

    expect(isShown(label)).toBe(true);
  });

  it("shows only Ready when the size is zero", async () => {
    await openComposer({ routes: filesRoutes({ id: "file-1", meta: { size: 0 } }) });

    await pickFiles(fileOf("notes.txt"));

    expect(isShown("Ready")).toBe(true);
  });

  it("falls back to the size of the picked file when the server reports none", async () => {
    await openComposer({ routes: filesRoutes({ id: "file-1" }) });

    await pickFiles(fileOf("notes.txt", { bytes: 300 }));

    expect(isShown("Ready • 300 B")).toBe(true);
  });

  it("shows the name the server stored the file under", async () => {
    await openComposer({ routes: filesRoutes({ id: "file-1", meta: { original_name: "report-final.pdf" } }) });

    await pickFiles(fileOf("report.pdf"));

    expect(isShown("report-final.pdf")).toBe(true);
    expect(isShown("report.pdf")).toBe(false);
  });

  it("sends the uploaded files with the message", async () => {
    const { requests } = await openComposer({
      routes: [
        sendAccepted,
        ...filesRoutes({
          id: "file-1",
          meta: { original_name: "report.pdf", mime: "application/pdf", size: 2048, sha256: "abc123" },
        }),
      ],
    });
    await pickFiles(fileOf("report.pdf", { type: "application/pdf" }));
    fillIn("See attached");

    await pressEnter();

    expect(eventPosts(requests)[0].body).toEqual({
      type: "message.created",
      source: "human:alice",
      channelId: "channel-1",
      payload: {
        text: "See attached",
        attachments: [
          {
            localId: expect.any(String),
            fileId: "file-1",
            name: "report.pdf",
            mime: "application/pdf",
            size: 2048,
            sha256: "abc123",
          },
        ],
      },
    });
  });

  it("takes the type of the picked file when the server reports none", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted, ...filesRoutes({ id: "file-1" })] });
    await pickFiles(fileOf("notes.txt", { type: "text/plain", bytes: 5 }));

    await pressEnter();

    expect(eventPosts(requests)[0].body).toMatchObject({
      payload: { attachments: [{ mime: "text/plain", name: "notes.txt", size: 5 }] },
    });
  });

  it("sends application/octet-stream for a file with no type", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted, ...filesRoutes({ id: "file-1" })] });
    await pickFiles(fileOf("blob", { type: "" }));

    await pressEnter();

    expect(eventPosts(requests)[0].body).toMatchObject({ payload: { attachments: [{ mime: "application/octet-stream" }] } });
  });

  it("omits the checksum when the server gives none", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted, ...filesRoutes({ id: "file-1", meta: { sha256: "" } })] });
    await pickFiles(fileOf("notes.txt"));

    await pressEnter();

    expect(eventPosts(requests)[0].body).toMatchObject({ payload: { attachments: [expect.not.objectContaining({ sha256: expect.anything() })] } });
  });

  it("[quirk] sends the browser-local attachment id to the API", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted, ...filesRoutes({ id: "file-1" })] });
    await pickFiles(fileOf("notes.txt"));
    fillIn("x");

    await pressEnter();

    expect(eventPosts(requests)[0].body).toMatchObject({ payload: { attachments: [{ localId: expect.any(String) }] } });
  });

  it("removes an attachment from the list and from the message", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted, ...filesRoutes({ id: "file-1" })] });
    await pickFiles(fileOf("notes.txt"));
    fillIn("Hello");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await pressEnter();

    expect(isShown("notes.txt")).toBe(false);
    expect(eventPosts(requests)[0].body).toEqual({
      type: "message.created",
      source: "human:alice",
      channelId: "channel-1",
      payload: { text: "Hello" },
    });
  });

  it("removes only the attachment whose Remove was clicked", async () => {
    await openComposer({ routes: filesRoutes({ id: "file-1" }, { id: "file-2" }) });
    await pickFiles(fileOf("a.txt"), fileOf("b.txt"));

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);

    expect(isShown("a.txt")).toBe(false);
    expect(isShown("b.txt")).toBe(true);
  });

  it("clears the attachments after the message is sent", async () => {
    await openComposer({ routes: [sendAccepted, ...filesRoutes({ id: "file-1" })] });
    await pickFiles(fileOf("notes.txt"));

    await pressSend();

    expect(isShown("notes.txt")).toBe(false);
  });

  it("keeps the attachments when sending fails", async () => {
    await openComposer({
      routes: [{ method: "POST", path: "/api/events", respond: { status: 500, text: "Nope" } }, ...filesRoutes({ id: "file-1" })],
    });
    await pickFiles(fileOf("notes.txt"));

    await pressSend();

    expect(isShown("notes.txt")).toBe(true);
    expect(isShown("Nope")).toBe(true);
  });

  it("drops the attachments when another channel is opened", async () => {
    const random = getMockChannel({ id: "channel-2", name: "random" });
    await openComposer({ channels: [general, random], routes: filesRoutes({ id: "file-1" }) });
    await pickFiles(fileOf("notes.txt"));

    fireEvent.click(screen.getByRole("button", { name: /# random/ }));
    await settle();

    expect(isShown("notes.txt")).toBe(false);
  });

  it("[quirk] keeps the draft when another channel is opened", async () => {
    const random = getMockChannel({ id: "channel-2", name: "random" });
    await openComposer({ channels: [general, random] });
    fillIn("half written");

    fireEvent.click(screen.getByRole("button", { name: /# random/ }));
    await settle();

    expect(composerBox().value).toBe("half written");
  });
});

describe("When an upload fails", () => {
  const uploadRejected: FakeRoute = { method: "POST", path: "/api/files", respond: { status: 413, text: "File too large" } };

  it("shows the server's reason on the file", async () => {
    await openComposer({ routes: [uploadRejected] });

    await pickFiles(fileOf("huge.bin"));

    expect(isShown("huge.bin")).toBe(true);
    expect(isShown("File too large")).toBe(true);
  });

  it("shows the status when the server gives no reason", async () => {
    await openComposer({ routes: [{ method: "POST", path: "/api/files", respond: { status: 500 } }] });

    await pickFiles(fileOf("huge.bin"));

    expect(isShown("Request failed: 500")).toBe(true);
  });

  it("warns that one or more attachments failed", async () => {
    await openComposer({ routes: [uploadRejected] });

    await pickFiles(fileOf("huge.bin"));

    expect(isShown("One or more attachments failed to upload. Remove them or retry.")).toBe(true);
  });

  it("fails the file when its details cannot be loaded", async () => {
    await openComposer({
      routes: [
        { method: "POST", path: "/api/files", respond: { json: { id: "file-1" } } },
        { path: "/api/files/file-1/meta", respond: { status: 500, text: "Meta broke" } },
      ],
    });

    await pickFiles(fileOf("notes.txt"));

    expect(isShown("Meta broke")).toBe(true);
  });

  it("does not block sending text", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted, uploadRejected] });
    await pickFiles(fileOf("huge.bin"));
    fillIn("Hello");

    await pressEnter();

    expect(eventPosts(requests)[0].body).toEqual({
      type: "message.created",
      source: "human:alice",
      channelId: "channel-1",
      payload: { text: "Hello" },
    });
  });

  it("leaves the Send button disabled when nothing else can be sent", async () => {
    await openComposer({ routes: [uploadRejected] });

    await pickFiles(fileOf("huge.bin"));

    expect(isDisabled("Send")).toBe(true);
  });

  it("only sends the files that uploaded", async () => {
    const { requests } = await openComposer({
      routes: [
        sendAccepted,
        {
          method: "POST",
          path: "/api/files",
          respondInOrder: [{ status: 413, text: "File too large" }, { json: { id: "file-2" } }],
        },
        {
          path: /^\/api\/files\/[^/]+\/meta$/,
          respond: { json: { id: "file-2" } },
        },
      ],
    });
    await pickFiles(fileOf("huge.bin"), fileOf("small.txt"));
    fillIn("Hello");

    await pressEnter();

    expect(eventPosts(requests)[0].body).toMatchObject({
      payload: { text: "Hello", attachments: [{ fileId: "file-2", name: "small.txt" }] },
    });
  });

  it("[quirk] drops the failed file when the message is sent", async () => {
    await openComposer({ routes: [sendAccepted, uploadRejected] });
    await pickFiles(fileOf("huge.bin"));
    fillIn("Hello");

    await pressEnter();

    expect(isShown("huge.bin")).toBe(false);
    expect(isShown("One or more attachments failed to upload. Remove them or retry.")).toBe(false);
  });

  it("clears the warning when the failed file is removed", async () => {
    await openComposer({ routes: [uploadRejected] });
    await pickFiles(fileOf("huge.bin"));

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(isShown("One or more attachments failed to upload. Remove them or retry.")).toBe(false);
  });
});

describe("Attachment-only messages", () => {
  const attachmentSent = async (files: readonly File[], draft: string) => {
    const { requests } = await openComposer({
      routes: [sendAccepted, ...filesRoutes({ id: "file-1" }, { id: "file-2" })],
    });
    await pickFiles(...files);
    fillIn(draft);
    await pressSend();
    return eventPosts(requests)[0].body;
  };

  it("says one file was attached", async () => {
    const body = await attachmentSent([fileOf("a.txt")], "");

    expect(body).toMatchObject({ payload: { text: "Attached 1 file for reference." } });
  });

  it("says how many files were attached", async () => {
    const body = await attachmentSent([fileOf("a.txt"), fileOf("b.txt")], "");

    expect(body).toMatchObject({ payload: { text: "Attached 2 files for reference." } });
  });

  it("uses the fallback when the draft is only whitespace", async () => {
    const body = await attachmentSent([fileOf("a.txt")], "   ");

    expect(body).toMatchObject({ payload: { text: "Attached 1 file for reference." } });
  });

  it("keeps the operator's own text when there is some", async () => {
    const body = await attachmentSent([fileOf("a.txt")], "Look at this");

    expect(body).toMatchObject({ payload: { text: "Look at this" } });
  });

  it("can be sent with Enter", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted, ...filesRoutes({ id: "file-1" })] });
    await pickFiles(fileOf("a.txt"));

    await pressEnter();

    expect(eventPosts(requests)).toHaveLength(1);
  });
});

describe("Pasting images", () => {
  const png = () => new File(["png-bytes"], "image.png", { type: "image/png" });

  it("uploads a pasted image under a generated name", async () => {
    const { requests } = await openComposer({ routes: filesRoutes({ id: "file-1" }) });

    await pasteIntoComposer([{ type: "image/png", file: png() }]);

    const [upload] = fileUploads(requests);
    expect(uploadedFileOf(upload).name).toMatch(/^pasted-\d+-[0-9a-f]+\.png$/);
    expect(uploadedFileOf(upload).type).toBe("image/png");
  });

  it("names the file after the image type", async () => {
    const { requests } = await openComposer({ routes: filesRoutes({ id: "file-1" }) });

    await pasteIntoComposer([{ type: "image/jpeg", file: new File(["x"], "photo", { type: "image/jpeg" }) }]);

    expect(uploadedFileOf(fileUploads(requests)[0]).name).toMatch(/\.jpeg$/);
  });

  it("[quirk] strips symbols from the extension of an svg image", async () => {
    const { requests } = await openComposer({ routes: filesRoutes({ id: "file-1" }) });

    await pasteIntoComposer([{ type: "image/svg+xml", file: new File(["<svg/>"], "logo", { type: "image/svg+xml" }) }]);

    expect(uploadedFileOf(fileUploads(requests)[0]).name).toMatch(/\.svgxml$/);
  });

  it("keeps the pasted image out of the text box", async () => {
    await openComposer({ routes: filesRoutes({ id: "file-1" }) });

    await pasteIntoComposer([{ type: "image/png", file: png() }]);

    expect(composerBox().value).toBe("");
    expect(isShown("Ready • 9 B")).toBe(true);
  });

  it("uploads each pasted image", async () => {
    const { requests } = await openComposer({ routes: filesRoutes({ id: "file-1" }, { id: "file-2" }) });

    await pasteIntoComposer([
      { type: "image/png", file: png() },
      { type: "image/png", file: png() },
    ]);

    expect(fileUploads(requests)).toHaveLength(2);
  });

  it("uploads only the image when text is pasted with it", async () => {
    const { requests } = await openComposer({ routes: filesRoutes({ id: "file-1" }) });

    await pasteIntoComposer([
      { type: "text/plain", file: new File(["hello"], "text.txt", { type: "text/plain" }) },
      { type: "image/png", file: png() },
    ]);

    expect(fileUploads(requests)).toHaveLength(1);
  });

  it("leaves pasted text alone", async () => {
    const { requests } = await openComposer({ routes: filesRoutes({ id: "file-1" }) });

    await pasteIntoComposer([{ type: "text/plain" }]);

    expect(fileUploads(requests)).toEqual([]);
  });

  it("ignores an image the clipboard cannot hand over", async () => {
    const { requests } = await openComposer({ routes: filesRoutes({ id: "file-1" }) });

    await pasteIntoComposer([{ type: "image/png" }]);

    expect(fileUploads(requests)).toEqual([]);
  });

  it("sends a pasted image with the message", async () => {
    const { requests } = await openComposer({ routes: [sendAccepted, ...filesRoutes({ id: "file-1" })] });
    await pasteIntoComposer([{ type: "image/png", file: png() }]);

    await pressEnter();

    expect(eventPosts(requests)[0].body).toMatchObject({
      payload: {
        text: "Attached 1 file for reference.",
        attachments: [{ fileId: "file-1", mime: "image/png", name: expect.stringMatching(/^pasted-/) }],
      },
    });
  });
});
