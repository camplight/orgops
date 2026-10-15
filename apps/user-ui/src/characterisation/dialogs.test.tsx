import { act, fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Agent, Channel, ChannelParticipant, ChannelShare } from "../types";
import { getMockAgent, getMockAuthMe, getMockChannel } from "./factories";
import type { FakeRequest, FakeResponse, FakeRoute } from "./fake-api";
import { renderApp, settle } from "./render-app";

const general = getMockChannel({ id: "channel-1", name: "general", canManage: true });
const random = getMockChannel({ id: "channel-2", name: "random" });
const launch = getMockChannel({ id: "channel-9", name: "launch", visibility: "PRIVATE", ownerHumanId: "human-1", canManage: true });

const helper = getMockAgent({ id: "agent-1", name: "helper", runtimeState: "RUNNING" });
const builder = getMockAgent({ id: "agent-2", name: "builder", runtimeState: "STOPPED" });

const agentMember = (name: string): ChannelParticipant => ({ subscriberType: "AGENT", subscriberId: name });
const humanMember = (name: string): ChannelParticipant => ({ subscriberType: "HUMAN", subscriberId: name });
const humanViewer = (name: string): ChannelShare => ({ viewerType: "HUMAN", viewerId: name });
const agentViewer = (name: string): ChannelShare => ({ viewerType: "AGENT", viewerId: name });

const never = () => new Promise<FakeResponse>(() => undefined);

const post = (path: string, respond: FakeResponse = { json: {} }): FakeRoute => ({
  method: "POST",
  path,
  respond,
});

type WorkspaceOptions = {
  channels?: readonly Channel[];
  channelsAfter?: readonly Channel[];
  agents?: readonly Agent[];
  humans?: readonly { username: string }[];
  routes?: readonly FakeRoute[];
  url?: string;
};

const openWorkspace = (options: WorkspaceOptions = {}) => {
  const channels = options.channels ?? [general];
  return renderApp({
    url: options.url,
    routes: [
      ...(options.routes ?? []),
      { path: "/api/auth/me", respond: { json: getMockAuthMe({ id: "human-1", username: "alice" }) } },
      {
        path: "/api/channels?includeArchived=1",
        respondInOrder: [{ json: channels }, { json: options.channelsAfter ?? channels }],
      },
      { path: "/api/agents", respond: { json: options.agents ?? [] } },
      { path: "/api/humans", respond: { json: options.humans ?? [] } },
      { path: /^\/api\/events/, respond: { json: [] } },
    ],
  });
};

const press = async (name: string | RegExp) => {
  fireEvent.click(screen.getByRole("button", { name }));
  await settle();
};

const pressIn = async (dialog: HTMLElement, name: string | RegExp) => {
  fireEvent.click(within(dialog).getByRole("button", { name }));
  await settle();
};

const writes = (requests: readonly FakeRequest[]) => requests.filter((request) => request.method !== "GET");

const openChannelTitle = () => screen.getByRole("heading", { level: 1 }).textContent;

const isShown = (text: string) => screen.queryByText(text) !== null;

const isButtonShown = (name: string | RegExp) => screen.queryByRole("button", { name }) !== null;

const dialogs = () => screen.queryAllByRole("dialog");

const dialogTitled = (title: string) => {
  const found = screen
    .queryAllByRole("dialog")
    .find((dialog) => within(dialog).queryByRole("heading", { name: title }) !== null);
  if (!found) throw new Error(`No dialog titled ${title}`);
  return found;
};

const isDialogOpen = (title: string) =>
  screen.queryAllByRole("dialog").some((dialog) => within(dialog).queryByRole("heading", { name: title }) !== null);

const backdropOf = (dialog: HTMLElement) => {
  if (!dialog.parentElement) throw new Error("Dialog has no backdrop");
  return dialog.parentElement;
};

const pressKey = (init: KeyboardEventInit) => fireEvent.keyDown(document.body, init);

const openConversationDialog = async () => {
  await press(/^New conversation/);
  return dialogTitled("New conversation");
};

const fillField = (dialog: HTMLElement, label: string, value: string) =>
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });

const pickAgent = (dialog: HTMLElement, name: string) =>
  fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(`^${name} (Running|Off)$`) }));

const openManageDialog = async () => {
  await press("Manage channel");
  return dialogTitled("Manage channel");
};

const openParticipantsDialog = async () => {
  const manage = await openManageDialog();
  await pressIn(manage, "Manage participants");
  return dialogTitled("Manage participants");
};

const stubClipboard = (writeText: (text: string) => Promise<void>) =>
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

const activityPanel = () => within(screen.getAllByRole("complementary")[1]);

const typeOptions = (listId: string) =>
  Array.from(document.querySelectorAll(`datalist#${listId} option`)).map((option) => option.getAttribute("value"));

describe("Opening and closing the conversation dialog", () => {
  it("opens with the New conversation button", async () => {
    await openWorkspace();

    await press(/^New conversation/);

    expect(isDialogOpen("New conversation")).toBe(true);
  });

  it("opens with Cmd+K", async () => {
    await openWorkspace();

    pressKey({ key: "k", metaKey: true });
    await settle();

    expect(isDialogOpen("New conversation")).toBe(true);
  });

  it("opens with Ctrl+K", async () => {
    await openWorkspace();

    pressKey({ key: "k", ctrlKey: true });
    await settle();

    expect(isDialogOpen("New conversation")).toBe(true);
  });

  it("opens with Cmd+K when caps lock gives a capital K", async () => {
    await openWorkspace();

    pressKey({ key: "K", metaKey: true });
    await settle();

    expect(isDialogOpen("New conversation")).toBe(true);
  });

  it("keeps the browser from handling Cmd+K itself", async () => {
    await openWorkspace();

    const notPrevented = fireEvent.keyDown(document.body, { key: "k", metaKey: true });

    expect(notPrevented).toBe(false);
  });

  it("does not open with K alone", async () => {
    await openWorkspace();

    pressKey({ key: "k" });
    await settle();

    expect(dialogs()).toHaveLength(0);
  });

  it("does not open with Cmd and another letter", async () => {
    await openWorkspace();

    pressKey({ key: "j", metaKey: true });
    await settle();

    expect(dialogs()).toHaveLength(0);
  });

  it("does not open on the sign-in screen", async () => {
    await renderApp({ routes: [{ path: "/api/auth/me", respond: { status: 401, text: "Unauthorized" } }] });

    pressKey({ key: "k", metaKey: true });
    await settle();

    expect(dialogs()).toHaveLength(0);
  });

  it("closes with Escape", async () => {
    await openWorkspace();
    await openConversationDialog();

    pressKey({ key: "Escape" });
    await settle();

    expect(dialogs()).toHaveLength(0);
  });

  it("closes with the Close button", async () => {
    await openWorkspace();
    const dialog = await openConversationDialog();

    await pressIn(dialog, "Close dialog");

    expect(dialogs()).toHaveLength(0);
  });

  it("closes when the backdrop is pressed", async () => {
    await openWorkspace();
    const dialog = await openConversationDialog();

    fireEvent.mouseDown(backdropOf(dialog));
    await settle();

    expect(dialogs()).toHaveLength(0);
  });

  it("stays open when the dialog itself is pressed", async () => {
    await openWorkspace();
    const dialog = await openConversationDialog();

    fireEvent.mouseDown(dialog);
    await settle();

    expect(isDialogOpen("New conversation")).toBe(true);
  });

  it("[quirk] Escape does not close the Manage channel dialog", async () => {
    await openWorkspace();
    await openManageDialog();

    pressKey({ key: "Escape" });
    await settle();

    expect(isDialogOpen("Manage channel")).toBe(true);
  });

  it("[quirk] keeps an abandoned draft when the dialog is opened again", async () => {
    await openWorkspace();
    const first = await openConversationDialog();
    fillField(first, "Channel name", "draft");

    await pressIn(first, "Close dialog");
    const second = await openConversationDialog();

    expect((within(second).getByLabelText("Channel name") as HTMLInputElement).value).toBe("draft");
  });
});

describe("Choosing agents for a conversation", () => {
  it("hints how many agents to pick when none is chosen", async () => {
    await openWorkspace({ agents: [helper] });

    await openConversationDialog();

    expect(isShown("Select one agent for a DM, or many for a channel.")).toBe(true);
  });

  it("lists available agents with their state", async () => {
    await openWorkspace({ agents: [helper, builder] });

    const dialog = await openConversationDialog();

    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(
      expect.arrayContaining(["helperRunning", "builderOff"]),
    );
  });

  it("says no agents are available when there are none", async () => {
    await openWorkspace({ agents: [] });

    await openConversationDialog();

    expect(isShown("No available agents.")).toBe(true);
  });

  it("narrows the suggestions by the search text ignoring case", async () => {
    await openWorkspace({ agents: [helper, builder] });
    const dialog = await openConversationDialog();

    fillField(dialog, "Search agents", "  HELP ");

    expect(within(dialog).queryByRole("button", { name: /^builder/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /^helper/ })).not.toBeNull();
  });

  it("says no agents match when the search finds nothing", async () => {
    await openWorkspace({ agents: [helper] });
    const dialog = await openConversationDialog();

    fillField(dialog, "Search agents", "zzz");

    expect(isShown("No matching agents.")).toBe(true);
  });

  it("shows at most eight suggestions", async () => {
    const agents = Array.from({ length: 9 }, (_, index) => getMockAgent({ id: `a${index}`, name: `agent-${index}` }));
    await openWorkspace({ agents });

    const dialog = await openConversationDialog();

    expect(within(dialog).getAllByRole("button", { name: /^agent-\d (Running|Off)$/ })).toHaveLength(8);
  });

  it("moves a picked agent into the chosen list and clears the search", async () => {
    await openWorkspace({ agents: [helper, builder] });
    const dialog = await openConversationDialog();
    fillField(dialog, "Search agents", "help");

    pickAgent(dialog, "helper");

    expect(within(dialog).getByRole("button", { name: "helper Remove" })).not.toBeNull();
    expect(within(dialog).queryByRole("button", { name: /^helper (Running|Off)$/ })).toBeNull();
    expect((within(dialog).getByLabelText("Search agents") as HTMLInputElement).value).toBe("");
  });

  it("puts a removed agent back among the suggestions", async () => {
    await openWorkspace({ agents: [helper] });
    const dialog = await openConversationDialog();
    pickAgent(dialog, "helper");

    fireEvent.click(within(dialog).getByRole("button", { name: "helper Remove" }));

    expect(within(dialog).queryByRole("button", { name: /^helper (Running|Off)$/ })).not.toBeNull();
    expect(isShown("Select one agent for a DM, or many for a channel.")).toBe(true);
  });

  it("hides a private agent owned by someone else", async () => {
    const secret = getMockAgent({ id: "a-secret", name: "secret", visibility: "PRIVATE", ownerHumanId: "human-2" });
    await openWorkspace({ agents: [helper, secret] });

    const dialog = await openConversationDialog();

    expect(within(dialog).queryByRole("button", { name: /^secret/ })).toBeNull();
  });

  it("offers a private agent owned by the viewer", async () => {
    const mine = getMockAgent({ id: "a-mine", name: "mine", visibility: "PRIVATE", ownerHumanId: "human-1" });
    await openWorkspace({ agents: [mine] });

    const dialog = await openConversationDialog();

    expect(within(dialog).queryByRole("button", { name: /^mine/ })).not.toBeNull();
  });

  it("offers a private agent of someone else when it takes part in a visible channel", async () => {
    const secret = getMockAgent({ id: "a-secret", name: "secret", visibility: "PRIVATE", ownerHumanId: "human-2" });
    const withSecret = getMockChannel({ id: "channel-1", name: "general", participants: [agentMember("secret")] });
    await openWorkspace({ agents: [secret], channels: [withSecret] });

    const dialog = await openConversationDialog();

    expect(within(dialog).queryByRole("button", { name: /^secret/ })).not.toBeNull();
  });
});

describe("Which conversations can be started", () => {
  const startDisabled = (dialog: HTMLElement) => (within(dialog).getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled;

  it("cannot start with no name and no agent", async () => {
    await openWorkspace({ agents: [helper] });

    const dialog = await openConversationDialog();

    expect(startDisabled(dialog)).toBe(true);
  });

  it("can start a channel with a name", async () => {
    await openWorkspace();
    const dialog = await openConversationDialog();

    fillField(dialog, "Channel name", "launch");

    expect(startDisabled(dialog)).toBe(false);
  });

  it("cannot start with a blank name", async () => {
    await openWorkspace();
    const dialog = await openConversationDialog();

    fillField(dialog, "Channel name", "   ");

    expect(startDisabled(dialog)).toBe(true);
  });

  it("can start a direct message with exactly one agent", async () => {
    await openWorkspace({ agents: [helper, builder] });
    const dialog = await openConversationDialog();

    pickAgent(dialog, "helper");

    expect(startDisabled(dialog)).toBe(false);
  });

  it("cannot start a direct message with two agents", async () => {
    await openWorkspace({ agents: [helper, builder] });
    const dialog = await openConversationDialog();

    pickAgent(dialog, "helper");
    pickAgent(dialog, "builder");

    expect(startDisabled(dialog)).toBe(true);
  });

  it("can start a channel with two agents when it has a name", async () => {
    await openWorkspace({ agents: [helper, builder] });
    const dialog = await openConversationDialog();

    pickAgent(dialog, "helper");
    pickAgent(dialog, "builder");
    fillField(dialog, "Channel name", "launch");

    expect(startDisabled(dialog)).toBe(false);
  });
});

describe("Starting a direct message", () => {
  const dm = getMockChannel({
    id: "dm-1",
    name: "dm-alice-helper",
    kind: "HUMAN_AGENT_DM",
    visibility: "PRIVATE",
    participants: [humanMember("alice"), agentMember("helper")],
  });
  const dmRoutes = [post("/api/channels/direct/human-agent", { json: { id: "dm-1" } })];

  const startDm = async (options: { channels?: readonly Channel[] } = {}) => {
    const app = await openWorkspace({
      agents: [helper],
      channels: options.channels ?? [general],
      channelsAfter: [...(options.channels ?? [general]), dm],
      routes: dmRoutes,
    });
    const dialog = await openConversationDialog();
    pickAgent(dialog, "helper");
    return { ...app, dialog };
  };

  it("asks the API for a direct channel with the chosen agent", async () => {
    const { requests, dialog } = await startDm();

    await pressIn(dialog, "Start");

    expect(writes(requests)).toEqual([
      { method: "POST", path: "/api/channels/direct/human-agent", body: { agentName: "helper" } },
    ]);
  });

  it("opens the new direct message named after the agent", async () => {
    const { dialog } = await startDm();

    await pressIn(dialog, "Start");

    expect(openChannelTitle()).toBe("helper");
  });

  it("closes the dialog when the direct message is ready", async () => {
    const { dialog } = await startDm();

    await pressIn(dialog, "Start");

    expect(dialogs()).toHaveLength(0);
  });

  it("expands the Direct group when it was collapsed", async () => {
    const earlier = getMockChannel({ ...dm, id: "dm-0", participants: [humanMember("alice"), agentMember("builder")] });
    await openWorkspace({
      agents: [helper],
      channels: [general, earlier],
      channelsAfter: [general, earlier, dm],
      routes: dmRoutes,
    });
    await press(/^Direct messages 1/);
    const dialog = await openConversationDialog();
    pickAgent(dialog, "helper");

    await pressIn(dialog, "Start");

    expect(isButtonShown("helper")).toBe(true);
  });

  it("ignores the description and visibility when the name is blank", async () => {
    const { requests, dialog } = await startDm();
    fillField(dialog, "Description", "ignored");
    fillField(dialog, "Visibility", "PUBLIC");

    await pressIn(dialog, "Start");

    expect(writes(requests)).toEqual([
      { method: "POST", path: "/api/channels/direct/human-agent", body: { agentName: "helper" } },
    ]);
  });

  it("treats a whitespace name as blank and starts a direct message", async () => {
    const { requests, dialog } = await startDm();
    fillField(dialog, "Channel name", "   ");

    await pressIn(dialog, "Start");

    expect(writes(requests).map((request) => request.path)).toEqual(["/api/channels/direct/human-agent"]);
  });

  it("shows the server message and keeps the dialog open when it fails", async () => {
    await openWorkspace({
      agents: [helper],
      routes: [post("/api/channels/direct/human-agent", { status: 403, json: undefined, text: "Agent not available" })],
    });
    const dialog = await openConversationDialog();
    pickAgent(dialog, "helper");

    await pressIn(dialog, "Start");

    expect(isShown("Agent not available")).toBe(true);
    expect(isDialogOpen("New conversation")).toBe(true);
  });

  it("names the status when the server gives no message", async () => {
    await openWorkspace({ agents: [helper], routes: [post("/api/channels/direct/human-agent", { status: 500 })] });
    const dialog = await openConversationDialog();
    pickAgent(dialog, "helper");

    await pressIn(dialog, "Start");

    expect(isShown("Request failed: 500")).toBe(true);
  });

  it("clears the previous error when starting again", async () => {
    await openWorkspace({
      agents: [helper],
      routes: [
        {
          method: "POST",
          path: "/api/channels/direct/human-agent",
          respondInOrder: [{ status: 500, text: "Agent not available" }, { json: { id: "dm-1" } }],
        },
      ],
    });
    const dialog = await openConversationDialog();
    pickAgent(dialog, "helper");
    await pressIn(dialog, "Start");

    await pressIn(dialog, "Start");

    expect(isShown("Agent not available")).toBe(false);
  });

  it("shows loading and blocks a second start while the request is pending", async () => {
    await openWorkspace({
      agents: [helper],
      routes: [{ method: "POST", path: "/api/channels/direct/human-agent", respond: never }],
    });
    const dialog = await openConversationDialog();
    pickAgent(dialog, "helper");

    await pressIn(dialog, "Start");

    expect(isShown("Loading OrgOps...")).toBe(true);
    expect((within(dialog).getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Starting a channel", () => {
  const createRoutes = [
    post("/api/channels", { json: { id: "channel-9" } }),
    post("/api/channels/channel-9/subscribe"),
  ];

  const startChannel = async (options: { agents?: readonly Agent[]; routes?: readonly FakeRoute[]; channels?: readonly Channel[] } = {}) => {
    const channels = options.channels ?? [general];
    const app = await openWorkspace({
      agents: options.agents ?? [helper, builder],
      channels,
      channelsAfter: [...channels, launch],
      routes: options.routes ?? createRoutes,
    });
    const dialog = await openConversationDialog();
    return { ...app, dialog };
  };

  it("creates a private channel by default and subscribes the viewer", async () => {
    const { requests, dialog } = await startChannel();
    fillField(dialog, "Channel name", "launch");

    await pressIn(dialog, "Start");

    expect(writes(requests)).toEqual([
      { method: "POST", path: "/api/channels", body: { name: "launch", visibility: "PRIVATE" } },
      { method: "POST", path: "/api/channels/channel-9/subscribe", body: { subscriberType: "HUMAN", subscriberId: "alice" } },
    ]);
  });

  it("trims the name and the description and sends the chosen visibility", async () => {
    const { requests, dialog } = await startChannel();
    fillField(dialog, "Channel name", "  launch  ");
    fillField(dialog, "Description", "  Release work ");
    fillField(dialog, "Visibility", "PUBLIC");

    await pressIn(dialog, "Start");

    expect(writes(requests)[0]).toEqual({
      method: "POST",
      path: "/api/channels",
      body: { name: "launch", description: "Release work", visibility: "PUBLIC" },
    });
  });

  it("leaves out a blank description", async () => {
    const { requests, dialog } = await startChannel();
    fillField(dialog, "Channel name", "launch");
    fillField(dialog, "Description", "   ");

    await pressIn(dialog, "Start");

    expect(writes(requests)[0].body).toEqual({ name: "launch", visibility: "PRIVATE" });
  });

  it("subscribes every chosen agent after the viewer", async () => {
    const { requests, dialog } = await startChannel();
    fillField(dialog, "Channel name", "launch");
    pickAgent(dialog, "helper");
    pickAgent(dialog, "builder");

    await pressIn(dialog, "Start");

    expect(writes(requests).slice(1).map((request) => request.body)).toEqual([
      { subscriberType: "HUMAN", subscriberId: "alice" },
      { subscriberType: "AGENT", subscriberId: "helper" },
      { subscriberType: "AGENT", subscriberId: "builder" },
    ]);
  });

  it("creates a channel and not a direct message when one agent comes with a name", async () => {
    const { requests, dialog } = await startChannel();
    fillField(dialog, "Channel name", "launch");
    pickAgent(dialog, "helper");

    await pressIn(dialog, "Start");

    expect(writes(requests).map((request) => request.path)).toEqual([
      "/api/channels",
      "/api/channels/channel-9/subscribe",
      "/api/channels/channel-9/subscribe",
    ]);
  });

  it("opens the new channel and closes the dialog", async () => {
    const { dialog } = await startChannel();
    fillField(dialog, "Channel name", "launch");

    await pressIn(dialog, "Start");

    expect(openChannelTitle()).toBe("# launch");
    expect(dialogs()).toHaveLength(0);
  });

  it("expands the Channels group when it was collapsed", async () => {
    const { dialog } = await startChannel();
    await pressIn(dialog, "Close dialog");
    await press(/^Channels 1/);
    const reopened = await openConversationDialog();
    fillField(reopened, "Channel name", "launch");

    await pressIn(reopened, "Start");

    expect(isButtonShown("# launch")).toBe(true);
  });

  it("clears the form and the channel search after success", async () => {
    const { dialog } = await startChannel();
    fireEvent.change(screen.getByLabelText("Search channels"), { target: { value: "gen" } });
    fillField(dialog, "Channel name", "launch");
    fillField(dialog, "Description", "Release work");
    fillField(dialog, "Visibility", "PUBLIC");
    pickAgent(dialog, "helper");
    await pressIn(dialog, "Start");

    const reopened = await openConversationDialog();

    expect((within(reopened).getByLabelText("Channel name") as HTMLInputElement).value).toBe("");
    expect((within(reopened).getByLabelText("Description") as HTMLInputElement).value).toBe("");
    expect((within(reopened).getByLabelText("Visibility") as HTMLSelectElement).value).toBe("PRIVATE");
    expect(isShown("Select one agent for a DM, or many for a channel.")).toBe(true);
    expect((screen.getByLabelText("Search channels") as HTMLInputElement).value).toBe("");
  });

  it("shows the server message and keeps the dialog open when creating fails", async () => {
    const { requests, dialog } = await startChannel({
      routes: [post("/api/channels", { status: 409, text: "Channel name taken" })],
    });
    fillField(dialog, "Channel name", "launch");

    await pressIn(dialog, "Start");

    expect(isShown("Channel name taken")).toBe(true);
    expect(isDialogOpen("New conversation")).toBe(true);
    expect(writes(requests)).toHaveLength(1);
  });

  it("keeps the form filled in when creating fails", async () => {
    const { dialog } = await startChannel({ routes: [post("/api/channels", { status: 409, text: "Channel name taken" })] });
    fillField(dialog, "Channel name", "launch");

    await pressIn(dialog, "Start");

    expect((within(dialog).getByLabelText("Channel name") as HTMLInputElement).value).toBe("launch");
  });

  it("carries on when subscribing the viewer fails", async () => {
    const { dialog } = await startChannel({
      routes: [
        post("/api/channels", { json: { id: "channel-9" } }),
        {
          method: "POST",
          path: "/api/channels/channel-9/subscribe",
          respondInOrder: [{ status: 500, text: "no" }, { json: {} }],
        },
      ],
    });
    fillField(dialog, "Channel name", "launch");

    await pressIn(dialog, "Start");

    expect(openChannelTitle()).toBe("# launch");
    expect(isShown("no")).toBe(false);
  });

  it("reports a failed agent subscription and keeps the dialog open", async () => {
    const { dialog } = await startChannel({
      routes: [
        post("/api/channels", { json: { id: "channel-9" } }),
        {
          method: "POST",
          path: "/api/channels/channel-9/subscribe",
          respond: ({ body }) =>
            typeof body === "object" && body !== null && "subscriberType" in body && body.subscriberType === "AGENT"
              ? { status: 403, text: "Agent is private" }
              : { json: {} },
        },
      ],
    });
    fillField(dialog, "Channel name", "launch");
    pickAgent(dialog, "helper");

    await pressIn(dialog, "Start");

    expect(isShown("Agent is private")).toBe(true);
    expect(isDialogOpen("New conversation")).toBe(true);
  });
});

describe("Who can manage a channel", () => {
  const openWith = (channel: Channel) => openWorkspace({ channels: [channel] });

  it("offers Manage channel when the server says the viewer can manage it", async () => {
    await openWith(getMockChannel({ canManage: true }));

    expect(isButtonShown("Manage channel")).toBe(true);
  });

  it("hides Manage channel when the server says the viewer cannot, even for the owner", async () => {
    await openWith(getMockChannel({ canManage: false, visibility: "PRIVATE", ownerHumanId: "human-1" }));

    expect(isButtonShown("Manage channel")).toBe(false);
  });

  it("without a server answer, lets the owner manage a private channel", async () => {
    await openWith({ ...getMockChannel({ visibility: "PRIVATE", ownerHumanId: "human-1" }), canManage: undefined });

    expect(isButtonShown("Manage channel")).toBe(true);
  });

  it("without a server answer, stops others managing a private channel", async () => {
    await openWith({
      ...getMockChannel({ visibility: "PRIVATE", ownerHumanId: "human-2", shares: [humanViewer("alice")] }),
      canManage: undefined,
    });

    expect(isButtonShown("Manage channel")).toBe(false);
  });

  it("without a server answer, lets anyone manage a public channel", async () => {
    await openWith({ ...getMockChannel({ visibility: "PUBLIC", ownerHumanId: "human-2" }), canManage: undefined });

    expect(isButtonShown("Manage channel")).toBe(true);
  });

  it("offers no management when no channel is open", async () => {
    await openWorkspace({ channels: [] });

    expect(isButtonShown("Manage channel")).toBe(false);
  });
});

describe("Saving channel settings", () => {
  const saveDisabled = (dialog: HTMLElement) => (within(dialog).getByRole("button", { name: /^Sav/ }) as HTMLButtonElement).disabled;
  const visibilityOf = (dialog: HTMLElement) => (within(dialog).getByLabelText("Visibility") as HTMLSelectElement).value;
  const archivedBox = (dialog: HTMLElement) => within(dialog).getByRole("checkbox", { name: "Archived" }) as HTMLInputElement;

  const publicChannel = getMockChannel({ id: "channel-1", name: "general", visibility: "PUBLIC", canManage: true });
  const archivedChannel = getMockChannel({ id: "channel-3", name: "old", canManage: true, archivedAt: 1_700_000_000_000 });
  const settingsRoutes = [post("/api/channels/channel-1", { json: {} }), post("/api/channels/channel-1/archive"), post("/api/channels/channel-1/unarchive")];
  const patch = (path: string): FakeRoute => ({ method: "PATCH", path, respond: { json: {} } });

  const openSettings = async (options: { channel?: Channel; routes?: readonly FakeRoute[]; after?: readonly Channel[] } = {}) => {
    const channel = options.channel ?? publicChannel;
    const app = await openWorkspace({
      channels: [channel],
      channelsAfter: options.after ?? [channel],
      routes: options.routes ?? [patch("/api/channels/channel-1"), ...settingsRoutes],
    });
    const dialog = await openManageDialog();
    return { ...app, dialog };
  };

  it("starts from the current visibility and archive state", async () => {
    const { dialog } = await openSettings();

    expect(visibilityOf(dialog)).toBe("PUBLIC");
    expect(archivedBox(dialog).checked).toBe(false);
  });

  it("shows a channel without visibility info as private", async () => {
    const { dialog } = await openSettings({ channel: { ...publicChannel, visibility: undefined } });

    expect(visibilityOf(dialog)).toBe("PRIVATE");
  });

  it("disables Save until something changes", async () => {
    const { dialog } = await openSettings();

    expect(saveDisabled(dialog)).toBe(true);
  });

  it("enables Save after a visibility change and disables it again when reverted", async () => {
    const { dialog } = await openSettings();

    fillField(dialog, "Visibility", "PRIVATE");
    const afterChange = saveDisabled(dialog);
    fillField(dialog, "Visibility", "PUBLIC");

    expect(afterChange).toBe(false);
    expect(saveDisabled(dialog)).toBe(true);
  });

  it("enables Save after ticking Archived", async () => {
    const { dialog } = await openSettings();

    fireEvent.click(archivedBox(dialog));

    expect(saveDisabled(dialog)).toBe(false);
  });

  it("sends only the visibility change when only visibility changed", async () => {
    const { requests, dialog } = await openSettings();
    fillField(dialog, "Visibility", "PRIVATE");

    await pressIn(dialog, "Save");

    expect(writes(requests)).toEqual([{ method: "PATCH", path: "/api/channels/channel-1", body: { visibility: "PRIVATE" } }]);
  });

  it("sends only the archive request when only Archived changed", async () => {
    const { requests, dialog } = await openSettings();
    fireEvent.click(archivedBox(dialog));

    await pressIn(dialog, "Save");

    expect(writes(requests)).toEqual([{ method: "POST", path: "/api/channels/channel-1/archive", body: undefined }]);
  });

  it("sends the unarchive request for an archived channel", async () => {
    const app = await openWorkspace({
      channels: [general, archivedChannel],
      routes: [post("/api/channels/channel-3/unarchive")],
    });
    await press(/^Archived 1/);
    await press("# old");
    const dialog = await openManageDialog();
    fireEvent.click(archivedBox(dialog));

    await pressIn(dialog, "Save");

    expect(writes(app.requests)).toEqual([{ method: "POST", path: "/api/channels/channel-3/unarchive", body: undefined }]);
  });

  it("sends the visibility change before the archive change when both changed", async () => {
    const { requests, dialog } = await openSettings();
    fillField(dialog, "Visibility", "PRIVATE");
    fireEvent.click(archivedBox(dialog));

    await pressIn(dialog, "Save");

    expect(writes(requests).map((request) => `${request.method} ${request.path}`)).toEqual([
      "PATCH /api/channels/channel-1",
      "POST /api/channels/channel-1/archive",
    ]);
  });

  it("closes the dialog and keeps the channel open after saving", async () => {
    const { dialog } = await openSettings();
    fillField(dialog, "Visibility", "PRIVATE");

    await pressIn(dialog, "Save");

    expect(dialogs()).toHaveLength(0);
    expect(openChannelTitle()).toBe("# general");
  });

  it("shows an archived channel as archived and lists it under Archived once saved", async () => {
    const archivedNow = { ...publicChannel, archivedAt: 1_700_000_000_000 };
    const { dialog } = await openSettings({ after: [archivedNow, random] });
    fireEvent.click(archivedBox(dialog));

    await pressIn(dialog, "Save");

    expect(isShown("Archived channel")).toBe(true);
    expect(isButtonShown(/^Archived 1 -/)).toBe(true);
    expect(isButtonShown("# general")).toBe(true);
  });

  it("does not expand the Archived group when a channel is unarchived", async () => {
    const restored = { ...archivedChannel, archivedAt: null };
    await openWorkspace({
      channels: [general, archivedChannel],
      channelsAfter: [general, restored],
      routes: [post("/api/channels/channel-3/unarchive")],
    });
    await press(/^Archived 1/);
    await press("# old");
    const dialog = await openManageDialog();
    fireEvent.click(archivedBox(dialog));

    await pressIn(dialog, "Save");

    expect(isButtonShown(/^Archived/)).toBe(false);
  });

  it("shows Saving while the request is pending and locks the form", async () => {
    const { dialog } = await openSettings({
      routes: [{ method: "PATCH", path: "/api/channels/channel-1", respond: never }],
    });
    fillField(dialog, "Visibility", "PRIVATE");

    await pressIn(dialog, "Save");

    expect(within(dialog).getByRole("button", { name: "Saving..." })).not.toBeNull();
    expect((within(dialog).getByLabelText("Visibility") as HTMLSelectElement).disabled).toBe(true);
    expect(archivedBox(dialog).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "Delete channel" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the server message, keeps the dialog open and allows a retry when saving fails", async () => {
    const { dialog } = await openSettings({
      routes: [{ method: "PATCH", path: "/api/channels/channel-1", respond: { status: 403, text: "Not allowed" } }],
    });
    fillField(dialog, "Visibility", "PRIVATE");

    await pressIn(dialog, "Save");

    expect(isShown("Not allowed")).toBe(true);
    expect(isDialogOpen("Manage channel")).toBe(true);
    expect(saveDisabled(dialog)).toBe(false);
  });

  it("does not archive when the visibility change fails", async () => {
    const { requests, dialog } = await openSettings({
      routes: [{ method: "PATCH", path: "/api/channels/channel-1", respond: { status: 403, text: "Not allowed" } }, ...settingsRoutes],
    });
    fillField(dialog, "Visibility", "PRIVATE");
    fireEvent.click(archivedBox(dialog));

    await pressIn(dialog, "Save");

    expect(writes(requests).map((request) => request.path)).toEqual(["/api/channels/channel-1"]);
  });

  it("closes with the Close button and with the backdrop", async () => {
    const { dialog } = await openSettings();

    await pressIn(dialog, "Close dialog");
    const reopened = await openManageDialog();
    fireEvent.mouseDown(backdropOf(reopened));
    await settle();

    expect(dialogs()).toHaveLength(0);
  });

  it("[quirk] keeps an unsaved change when the dialog is closed and opened again", async () => {
    const { dialog } = await openSettings();
    fillField(dialog, "Visibility", "PRIVATE");
    await pressIn(dialog, "Close dialog");

    const reopened = await openManageDialog();

    expect(visibilityOf(reopened)).toBe("PRIVATE");
  });

  it("closes when another channel is opened", async () => {
    await openWorkspace({ channels: [general, random] });
    await openManageDialog();

    await press("# random");

    expect(dialogs()).toHaveLength(0);
  });
});

describe("Deleting a channel", () => {
  const confirmWith = (answer: boolean) => {
    const questions: string[] = [];
    window.confirm = (question?: string) => {
      questions.push(question ?? "");
      return answer;
    };
    return questions;
  };

  const deleteRoutes = [{ method: "DELETE", path: "/api/channels/channel-1", respond: { json: {} } } satisfies FakeRoute];

  it("asks for confirmation naming the channel", async () => {
    const questions = confirmWith(false);
    await openWorkspace({ routes: deleteRoutes });
    const dialog = await openManageDialog();

    await pressIn(dialog, "Delete channel");

    expect(questions).toEqual(["Permanently delete # general?"]);
  });

  it("deletes nothing when the operator declines", async () => {
    confirmWith(false);
    const { requests } = await openWorkspace({ routes: deleteRoutes });
    const dialog = await openManageDialog();

    await pressIn(dialog, "Delete channel");

    expect(writes(requests)).toEqual([]);
    expect(isDialogOpen("Manage channel")).toBe(true);
  });

  it("deletes the channel when the operator confirms", async () => {
    confirmWith(true);
    const { requests } = await openWorkspace({ channels: [general, random], channelsAfter: [random], routes: deleteRoutes });
    const dialog = await openManageDialog();

    await pressIn(dialog, "Delete channel");

    expect(writes(requests)).toEqual([{ method: "DELETE", path: "/api/channels/channel-1", body: undefined }]);
    expect(isButtonShown("# general")).toBe(false);
  });

  it("[quirk] leaves no channel open afterwards even when others remain", async () => {
    confirmWith(true);
    await openWorkspace({ channels: [general, random], channelsAfter: [random], routes: deleteRoutes });
    const dialog = await openManageDialog();

    await pressIn(dialog, "Delete channel");

    expect(openChannelTitle()).toBe("Select a channel");
    expect(isButtonShown("# random")).toBe(true);
    expect(dialogs()).toHaveLength(0);
  });

  it("names a direct message by its display name in the question", async () => {
    const questions = confirmWith(false);
    const dm = getMockChannel({
      id: "channel-1",
      name: "dm-alice-helper",
      kind: "HUMAN_AGENT_DM",
      canManage: true,
      participants: [humanMember("alice"), agentMember("helper")],
    });
    await openWorkspace({ channels: [dm] });
    const dialog = await openManageDialog();

    await pressIn(dialog, "Delete channel");

    expect(questions).toEqual(["Permanently delete helper?"]);
  });

  it("shows the server message and keeps the channel when deleting fails", async () => {
    confirmWith(true);
    await openWorkspace({
      routes: [{ method: "DELETE", path: "/api/channels/channel-1", respond: { status: 403, text: "Cannot delete" } }],
    });
    const dialog = await openManageDialog();

    await pressIn(dialog, "Delete channel");

    expect(isShown("Cannot delete")).toBe(true);
    expect(openChannelTitle()).toBe("# general");
  });
});

describe("Copying a share link", () => {
  const linkRoute = post("/api/channels/channel-1/share-link", { json: { token: "tok-123", channelId: "channel-1" } });

  const openLinkDialog = async (routes: readonly FakeRoute[] = [linkRoute]) => {
    const app = await openWorkspace({ routes });
    const dialog = await openManageDialog();
    return { ...app, dialog };
  };

  it("asks the API for a link to the open channel", async () => {
    stubClipboard(async () => undefined);
    const { requests, dialog } = await openLinkDialog();

    await pressIn(dialog, "Copy share link");

    expect(writes(requests)).toEqual([{ method: "POST", path: "/api/channels/channel-1/share-link", body: undefined }]);
  });

  it("copies this page's address with the share token and channel", async () => {
    const copied: string[] = [];
    stubClipboard(async (text) => void copied.push(text));
    const { dialog } = await openLinkDialog();

    await pressIn(dialog, "Copy share link");

    const link = new URL(copied[0]);
    expect(copied).toHaveLength(1);
    expect(link.searchParams.get("share")).toBe("tok-123");
    expect(link.searchParams.get("channel")).toBe("channel-1");
  });

  it("takes the channel in the link from the API's answer", async () => {
    const copied: string[] = [];
    stubClipboard(async (text) => void copied.push(text));
    const { dialog } = await openLinkDialog([post("/api/channels/channel-1/share-link", { json: { token: "tok-9", channelId: "channel-5" } })]);

    await pressIn(dialog, "Copy share link");

    expect(new URL(copied[0]).searchParams.get("channel")).toBe("channel-5");
  });

  it("confirms with Link copied", async () => {
    stubClipboard(async () => undefined);
    const { dialog } = await openLinkDialog();

    await pressIn(dialog, "Copy share link");

    expect(within(dialog).queryByRole("button", { name: "Link copied" })).not.toBeNull();
  });

  it("still says Link copied just before two seconds pass", async () => {
    stubClipboard(async () => undefined);
    const { dialog } = await openLinkDialog();
    await pressIn(dialog, "Copy share link");

    await settle(1999);

    expect(within(dialog).queryByRole("button", { name: "Link copied" })).not.toBeNull();
  });

  it("goes back to Copy share link after two seconds", async () => {
    stubClipboard(async () => undefined);
    const { dialog } = await openLinkDialog();
    await pressIn(dialog, "Copy share link");

    await settle(2000);

    expect(within(dialog).queryByRole("button", { name: "Copy share link" })).not.toBeNull();
  });

  it("[quirk] a second copy does not extend the confirmation beyond the first timer", async () => {
    stubClipboard(async () => undefined);
    const { dialog } = await openLinkDialog();
    await pressIn(dialog, "Copy share link");
    await settle(1500);
    await pressIn(dialog, "Link copied");

    await settle(500);

    expect(within(dialog).queryByRole("button", { name: "Copy share link" })).not.toBeNull();
  });

  it("tells the operator to copy from the address bar when the clipboard refuses", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    const { dialog } = await openLinkDialog();

    await pressIn(dialog, "Copy share link");

    expect(isShown("Unable to copy link. Please copy it from the address bar.")).toBe(true);
    expect(within(dialog).queryByRole("button", { name: "Copy share link" })).not.toBeNull();
  });

  it("gives the same advice when the link cannot be created", async () => {
    const copied: string[] = [];
    stubClipboard(async (text) => void copied.push(text));
    const { dialog } = await openLinkDialog([post("/api/channels/channel-1/share-link", { status: 500, text: "boom" })]);

    await pressIn(dialog, "Copy share link");

    expect(isShown("Unable to copy link. Please copy it from the address bar.")).toBe(true);
    expect(copied).toEqual([]);
  });
});

describe("Participants panel", () => {
  const panelOf = (channel: Channel, agents: readonly Agent[] = []) => openWorkspace({ channels: [channel], agents });
  const panelTexts = () => activityPanel().getAllByRole("article").map((article) => article.textContent);

  it("lists each participant with name and type", async () => {
    await panelOf(getMockChannel({ participants: [humanMember("alice"), agentMember("helper")] }), [helper]);

    expect(panelTexts().slice(0, 2)).toEqual(["alaliceHuman", "hehelperAgent"]);
  });

  it("labels other participant types by their own type", async () => {
    await panelOf(getMockChannel({ participants: [{ subscriberType: "TEAM", subscriberId: "ops" }] }));

    expect(panelTexts()[0]).toBe("opopsTEAM");
  });

  it("says when nobody is listed", async () => {
    await panelOf(getMockChannel({ participants: [] }));

    expect(isShown("No participants listed for this channel.")).toBe(true);
  });

  it("says nothing is listed when no channel is open", async () => {
    await openWorkspace({ channels: [] });

    expect(isShown("No participants listed for this channel.")).toBe(true);
    expect(isShown("No shared viewers.")).toBe(true);
  });

  it("marks a running agent as running", async () => {
    await panelOf(getMockChannel({ participants: [agentMember("helper")] }), [helper]);

    expect(screen.queryByTitle("Agent running")).not.toBeNull();
    expect(screen.queryByTitle("Agent off")).toBeNull();
  });

  it("marks a stopped agent as off", async () => {
    await panelOf(getMockChannel({ participants: [agentMember("builder")] }), [builder]);

    expect(screen.queryByTitle("Agent off")).not.toBeNull();
  });

  it("marks an agent missing from the agent list as off", async () => {
    await panelOf(getMockChannel({ participants: [agentMember("ghost")] }), [helper]);

    expect(screen.queryByTitle("Agent off")).not.toBeNull();
  });

  it("reads the participant type ignoring case and spaces when deciding it is an agent", async () => {
    await panelOf(getMockChannel({ participants: [{ subscriberType: " agent ", subscriberId: "helper" }] }), [helper]);

    expect(screen.queryByTitle("Agent running")).not.toBeNull();
  });

  it("shows no status for humans and teams", async () => {
    await panelOf(getMockChannel({ participants: [humanMember("alice"), { subscriberType: "TEAM", subscriberId: "ops" }] }));

    expect(screen.queryByTitle("Agent running")).toBeNull();
    expect(screen.queryByTitle("Agent off")).toBeNull();
  });

  it("falls back to the type for a participant without an id", async () => {
    await panelOf(getMockChannel({ participants: [{ subscriberType: "AGENT", subscriberId: "" }] }));

    expect(panelTexts()[0]).toBe("AGAGENTAgent");
  });

  it("falls back to Participant when there is neither id nor type", async () => {
    await panelOf(getMockChannel({ participants: [{ subscriberType: "", subscriberId: "" }] }));

    expect(panelTexts()[0]).toBe("PaParticipantParticipant");
  });

  it("lists shared viewers with a label for their type", async () => {
    await panelOf(
      getMockChannel({
        shares: [humanViewer("bob"), agentViewer("watcher"), { viewerType: "TEAM", viewerId: "ops" }],
      }),
    );

    expect(panelTexts()).toEqual(["bobobShared human viewer", "wawatcherShared agent viewer", "opopsShared viewer"]);
  });

  it("shows SV for a shared viewer without an id", async () => {
    await panelOf(getMockChannel({ shares: [humanViewer("")] }));

    expect(panelTexts()[0]).toBe("SVShared human viewer");
  });

  it("says when nobody has the channel shared", async () => {
    await panelOf(getMockChannel({ shares: [] }));

    expect(isShown("No shared viewers.")).toBe(true);
  });

  it("is visible to someone who cannot manage the channel", async () => {
    await panelOf(getMockChannel({ canManage: false, participants: [agentMember("helper")] }), [helper]);

    expect(panelTexts()).toHaveLength(1);
    expect(isButtonShown("Manage channel")).toBe(false);
  });
});

describe("Managing participants", () => {
  const withMembers = getMockChannel({
    id: "channel-1",
    name: "general",
    canManage: true,
    participants: [humanMember("alice"), agentMember("helper")],
  });
  const subscribe = post("/api/channels/channel-1/subscribe");
  const unsubscribe = post("/api/channels/channel-1/unsubscribe");

  const openParticipants = async (options: { channel?: Channel; after?: readonly Channel[]; routes?: readonly FakeRoute[]; humans?: readonly { username: string }[] } = {}) => {
    const channel = options.channel ?? withMembers;
    const app = await openWorkspace({
      channels: [channel],
      channelsAfter: options.after ?? [channel],
      agents: [helper, builder],
      humans: options.humans,
      routes: options.routes ?? [subscribe, unsubscribe],
    });
    const dialog = await openParticipantsDialog();
    return { ...app, dialog };
  };

  const addValue = (dialog: HTMLElement, placeholder: string, value: string) =>
    fireEvent.change(within(dialog).getByPlaceholderText(placeholder), { target: { value } });

  const rowsOf = (dialog: HTMLElement) => within(dialog).getAllByRole("article").map((row) => row.textContent);

  it("opens on top of Manage channel from its Manage participants button", async () => {
    await openParticipants();

    expect(isDialogOpen("Manage channel")).toBe(true);
    expect(isDialogOpen("Manage participants")).toBe(true);
  });

  it("lists the participants with their type", async () => {
    const { dialog } = await openParticipants();

    expect(rowsOf(dialog).slice(0, 2)).toEqual(["aliceHumanRemove", "helperAgentRemove"]);
  });

  it("says when there are no participants yet", async () => {
    const { dialog } = await openParticipants({ channel: { ...withMembers, participants: [] } });

    expect(within(dialog).queryByText("No participants yet.")).not.toBeNull();
  });

  it("disables Add until a name is typed", async () => {
    const { dialog } = await openParticipants();
    const addButton = () => within(dialog).getByRole("button", { name: "Add" }) as HTMLButtonElement;

    const before = addButton().disabled;
    addValue(dialog, "agent name", "   ");
    const blank = addButton().disabled;
    addValue(dialog, "agent name", "builder");

    expect([before, blank, addButton().disabled]).toEqual([true, true, false]);
  });

  it("adds an agent by default, trimming the name", async () => {
    const { requests, dialog } = await openParticipants();
    addValue(dialog, "agent name", "  builder ");

    await pressIn(dialog, "Add");

    expect(writes(requests)).toEqual([
      { method: "POST", path: "/api/channels/channel-1/subscribe", body: { subscriberType: "AGENT", subscriberId: "builder" } },
    ]);
  });

  it("adds a human after switching the kind", async () => {
    const { requests, dialog } = await openParticipants();
    fireEvent.change(within(dialog).getByDisplayValue("Agent"), { target: { value: "HUMAN" } });
    fireEvent.change(within(dialog).getAllByPlaceholderText("username")[0], { target: { value: "bob" } });

    await pressIn(dialog, "Add");

    expect(writes(requests)[0].body).toEqual({ subscriberType: "HUMAN", subscriberId: "bob" });
  });

  it("shows the new participant and empties the field once added", async () => {
    const after = { ...withMembers, participants: [...(withMembers.participants ?? []), agentMember("builder")] };
    const { dialog } = await openParticipants({ after: [after] });
    addValue(dialog, "agent name", "builder");

    await pressIn(dialog, "Add");

    expect(rowsOf(dialog)).toContain("builderAgentRemove");
    expect((within(dialog).getByPlaceholderText("agent name") as HTMLInputElement).value).toBe("");
  });

  it("suggests visible agents and known humans", async () => {
    await openParticipants({ humans: [{ username: "alice" }, { username: "bob" }] });

    expect(typeOptions("agent-participant-options")).toEqual(["helper", "builder"]);
    expect(typeOptions("human-participant-options")).toEqual(["alice", "bob"]);
  });

  it("shows Adding while the request is pending and locks the form", async () => {
    const { dialog } = await openParticipants({ routes: [{ method: "POST", path: "/api/channels/channel-1/subscribe", respond: never }] });
    addValue(dialog, "agent name", "builder");

    await pressIn(dialog, "Add");

    expect(within(dialog).queryByRole("button", { name: "Adding..." })).not.toBeNull();
    expect((within(dialog).getByPlaceholderText("agent name") as HTMLInputElement).disabled).toBe(true);
  });

  it("shows the server message and keeps the typed name when adding fails", async () => {
    const { dialog } = await openParticipants({
      routes: [post("/api/channels/channel-1/subscribe", { status: 404, text: "No such agent" })],
    });
    addValue(dialog, "agent name", "ghost");

    await pressIn(dialog, "Add");

    expect(isShown("No such agent")).toBe(true);
    expect((within(dialog).getByPlaceholderText("agent name") as HTMLInputElement).value).toBe("ghost");
  });

  it("removes the chosen participant with its stored type and id", async () => {
    const stored = { ...withMembers, participants: [{ subscriberType: "agent", subscriberId: "helper" }] };
    const { requests, dialog } = await openParticipants({ channel: stored });

    await pressIn(dialog, "Remove");

    expect(writes(requests)).toEqual([
      { method: "POST", path: "/api/channels/channel-1/unsubscribe", body: { subscriberType: "agent", subscriberId: "helper" } },
    ]);
  });

  it("drops the participant from the list once removed", async () => {
    const after = { ...withMembers, participants: [humanMember("alice")] };
    const { dialog } = await openParticipants({ after: [after] });

    fireEvent.click(within(dialog).getByTitle("Remove helper"));
    await settle();

    expect(rowsOf(dialog)).toEqual(["aliceHumanRemove"]);
  });

  it("shows Removing only on the participant being removed", async () => {
    const { dialog } = await openParticipants({ routes: [{ method: "POST", path: "/api/channels/channel-1/unsubscribe", respond: never }] });

    fireEvent.click(within(dialog).getByTitle("Remove helper"));
    await settle();

    expect(rowsOf(dialog)).toEqual(["aliceHumanRemove", "helperAgentRemoving..."]);
  });

  it("shows the server message when removing fails", async () => {
    const { dialog } = await openParticipants({
      routes: [post("/api/channels/channel-1/unsubscribe", { status: 403, text: "Cannot remove owner" })],
    });

    fireEvent.click(within(dialog).getByTitle("Remove alice"));
    await settle();

    expect(isShown("Cannot remove owner")).toBe(true);
    expect(rowsOf(dialog)).toEqual(["aliceHumanRemove", "helperAgentRemove"]);
  });

  it("closes with the Close button and leaves Manage channel open", async () => {
    const { dialog } = await openParticipants();

    await pressIn(dialog, "Close dialog");

    expect(isDialogOpen("Manage participants")).toBe(false);
    expect(isDialogOpen("Manage channel")).toBe(true);
  });

  it("closes when another channel is opened", async () => {
    const other = getMockChannel({ id: "channel-2", name: "random" });
    await openWorkspace({ channels: [withMembers, other], routes: [subscribe] });
    await openParticipantsDialog();

    await press("# random");

    expect(dialogs()).toHaveLength(0);
  });
});

describe("Managing shared viewers", () => {
  const shared = getMockChannel({
    id: "channel-1",
    name: "general",
    canManage: true,
    shares: [humanViewer("bob"), agentViewer("watcher")],
  });
  const share = post("/api/channels/channel-1/share");
  const unshare = post("/api/channels/channel-1/unshare");

  const openShares = async (options: { channel?: Channel; after?: readonly Channel[]; routes?: readonly FakeRoute[]; humans?: readonly { username: string }[] } = {}) => {
    const channel = options.channel ?? shared;
    const app = await openWorkspace({
      channels: [channel],
      channelsAfter: options.after ?? [channel],
      agents: [helper],
      humans: options.humans,
      routes: options.routes ?? [share, unshare],
    });
    const dialog = await openParticipantsDialog();
    return { ...app, dialog };
  };

  const rowsOf = (dialog: HTMLElement) =>
    within(dialog)
      .getAllByRole("article")
      .map((row) => row.textContent)
      .filter((text) => text?.includes("Shared"));

  const shareField = (dialog: HTMLElement) => within(dialog).getAllByPlaceholderText(/^(username|agent name)$/)[1];

  it("lists the shared viewers with their type", async () => {
    const { dialog } = await openShares();

    expect(rowsOf(dialog)).toEqual(["bobShared human viewerRemove", "watcherShared agent viewerRemove"]);
  });

  it("says when nobody has it shared yet", async () => {
    const { dialog } = await openShares({ channel: { ...shared, shares: [] } });

    expect(within(dialog).queryByText("No shared viewers yet.")).not.toBeNull();
  });

  it("disables Share until a name is typed", async () => {
    const { dialog } = await openShares();
    const shareButton = () => within(dialog).getByRole("button", { name: "Share" }) as HTMLButtonElement;

    const before = shareButton().disabled;
    fireEvent.change(shareField(dialog), { target: { value: "  " } });
    const blank = shareButton().disabled;
    fireEvent.change(shareField(dialog), { target: { value: "carol" } });

    expect([before, blank, shareButton().disabled]).toEqual([true, true, false]);
  });

  it("shares with a human by default, trimming the name", async () => {
    const { requests, dialog } = await openShares();
    fireEvent.change(shareField(dialog), { target: { value: " carol " } });

    await pressIn(dialog, "Share");

    expect(writes(requests)).toEqual([
      { method: "POST", path: "/api/channels/channel-1/share", body: { viewerType: "HUMAN", viewerId: "carol" } },
    ]);
  });

  it("shares with an agent after switching the kind", async () => {
    const { requests, dialog } = await openShares();
    fireEvent.change(within(dialog).getByDisplayValue("Human viewer"), { target: { value: "AGENT" } });
    fireEvent.change(within(dialog).getAllByPlaceholderText("agent name")[1], { target: { value: "helper" } });

    await pressIn(dialog, "Share");

    expect(writes(requests)[0].body).toEqual({ viewerType: "AGENT", viewerId: "helper" });
  });

  it("shows the new viewer and empties the field once shared", async () => {
    const after = { ...shared, shares: [...(shared.shares ?? []), humanViewer("carol")] };
    const { dialog } = await openShares({ after: [after] });
    fireEvent.change(shareField(dialog), { target: { value: "carol" } });

    await pressIn(dialog, "Share");

    expect(rowsOf(dialog)).toContain("carolShared human viewerRemove");
    expect((shareField(dialog) as HTMLInputElement).value).toBe("");
  });

  it("shows Sharing while the request is pending and locks the form", async () => {
    const { dialog } = await openShares({ routes: [{ method: "POST", path: "/api/channels/channel-1/share", respond: never }] });
    fireEvent.change(shareField(dialog), { target: { value: "carol" } });

    await pressIn(dialog, "Share");

    expect(within(dialog).queryByRole("button", { name: "Sharing..." })).not.toBeNull();
    expect((shareField(dialog) as HTMLInputElement).disabled).toBe(true);
  });

  it("shows the server message and keeps the typed name when sharing fails", async () => {
    const { dialog } = await openShares({ routes: [post("/api/channels/channel-1/share", { status: 404, text: "No such user" })] });
    fireEvent.change(shareField(dialog), { target: { value: "ghost" } });

    await pressIn(dialog, "Share");

    expect(isShown("No such user")).toBe(true);
    expect((shareField(dialog) as HTMLInputElement).value).toBe("ghost");
  });

  it("removes the chosen viewer with its stored type and id", async () => {
    const { requests, dialog } = await openShares();

    fireEvent.click(within(dialog).getByTitle("Remove shared viewer watcher"));
    await settle();

    expect(writes(requests)).toEqual([
      { method: "POST", path: "/api/channels/channel-1/unshare", body: { viewerType: "AGENT", viewerId: "watcher" } },
    ]);
  });

  it("drops the viewer from the list once removed", async () => {
    const after = { ...shared, shares: [humanViewer("bob")] };
    const { dialog } = await openShares({ after: [after] });

    fireEvent.click(within(dialog).getByTitle("Remove shared viewer watcher"));
    await settle();

    expect(rowsOf(dialog)).toEqual(["bobShared human viewerRemove"]);
  });

  it("shows Removing only on the viewer being removed", async () => {
    const { dialog } = await openShares({ routes: [{ method: "POST", path: "/api/channels/channel-1/unshare", respond: never }] });

    fireEvent.click(within(dialog).getByTitle("Remove shared viewer bob"));
    await settle();

    expect(rowsOf(dialog)).toEqual(["bobShared human viewerRemoving...", "watcherShared agent viewerRemove"]);
  });

  it("shows the server message when removing a viewer fails", async () => {
    const { dialog } = await openShares({ routes: [post("/api/channels/channel-1/unshare", { status: 500, text: "Unshare failed" })] });

    fireEvent.click(within(dialog).getByTitle("Remove shared viewer bob"));
    await settle();

    expect(isShown("Unshare failed")).toBe(true);
    expect(rowsOf(dialog)).toHaveLength(2);
  });

  it("suggests visible agents and known humans for sharing", async () => {
    await openShares({ humans: [{ username: "carol" }] });

    expect(typeOptions("agent-share-options")).toEqual(["helper"]);
    expect(typeOptions("human-share-options")).toEqual(["carol"]);
  });
});

describe("Browser history", () => {
  const goTo = async (search: string) => {
    window.history.replaceState(null, "", search);
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await settle();
  };

  it("opens the channel named in the address when the operator navigates back", async () => {
    await openWorkspace({ channels: [general, random] });

    await goTo("/?channel=channel-2");

    expect(openChannelTitle()).toBe("# random");
  });

  it("opens no channel when the address names an unknown channel", async () => {
    await openWorkspace({ channels: [general, random] });

    await goTo("/?channel=channel-404");

    expect(openChannelTitle()).toBe("Select a channel");
  });

  it("opens no channel when the address names a channel the viewer may not see", async () => {
    const hidden = getMockChannel({ id: "channel-3", name: "hidden", visibility: "PRIVATE", ownerHumanId: "human-2" });
    await openWorkspace({ channels: [general, hidden] });

    await goTo("/?channel=channel-3");

    expect(openChannelTitle()).toBe("Select a channel");
  });

  it("opens no channel when the address names none", async () => {
    await openWorkspace({ channels: [general] });

    await goTo("/");

    expect(openChannelTitle()).toBe("Select a channel");
  });

  it("expands the Archived group for an archived channel in the address", async () => {
    const old = getMockChannel({ id: "channel-3", name: "old", archivedAt: 1_700_000_000_000 });
    await openWorkspace({ channels: [general, old] });

    await goTo("/?channel=channel-3");

    expect(openChannelTitle()).toBe("# old");
    expect(isButtonShown(/^Archived 1 -/)).toBe(true);
  });
});
