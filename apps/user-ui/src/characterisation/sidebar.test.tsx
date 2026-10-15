import { act, fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Channel, ChannelParticipant, ChannelShare, EventRow, Team } from "../types";
import { getMockAuthMe, getMockChannel, getMockEvent } from "./factories";
import type { FakeRoute } from "./fake-api";
import type { FakeWebSocketInstance } from "./fake-websocket";
import { renderApp, settle } from "./render-app";

const noEvents: FakeRoute = { path: /^\/api\/events/, respond: { json: [] } };

const openSidebar = (options: {
  channels: readonly Channel[];
  teams?: readonly Team[];
  url?: string;
  extraRoutes?: readonly FakeRoute[];
}) =>
  renderApp({
    url: options.url ?? "/",
    routes: [
      ...(options.extraRoutes ?? []),
      { path: "/api/auth/me", respond: { json: getMockAuthMe({ id: "human-1", username: "alice" }) } },
      { path: "/api/channels?includeArchived=1", respond: { json: options.channels } },
      { path: "/api/agents", respond: { json: [] } },
      { path: "/api/teams/me", respond: { json: options.teams ?? [] } },
      noEvents,
    ],
  });

const buttonText = (button: HTMLElement) =>
  Array.from(button.children).map((part) => part.textContent).join(" ");

const sidebarOutline = () =>
  within(screen.getAllByRole("complementary")[0])
    .getAllByRole("button")
    .filter((button) => !/^(Close|New conversation|Sign out)/.test(button.textContent ?? ""))
    .map(buttonText);

const openChannelTitle = () => screen.getByRole("heading", { level: 1 }).textContent;

const search = (query: string) =>
  fireEvent.change(screen.getByLabelText("Search channels"), { target: { value: query } });

const press = async (name: string) => {
  fireEvent.click(screen.getByRole("button", { name }));
  await settle();
};

const receive = async (app: { sockets: FakeWebSocketInstance[] }, event: EventRow) => {
  await act(async () => {
    app.sockets[0].receive({ type: "event", topic: `channel:${event.channelId}`, data: event });
  });
};

const LATER = Date.UTC(2100, 0, 1);

const messageFeed = (options: { atLoad: readonly EventRow[]; later: readonly EventRow[] }): FakeRoute => ({
  path: "/api/events?type=message.created&limit=100&order=desc",
  respond: () => ({ json: Date.now() >= LATER ? options.later : options.atLoad }),
});

const pollForNewMessages = async () => {
  vi.setSystemTime(LATER);
  await settle(10_000);
};

const human = (subscriberId: string): ChannelParticipant => ({ subscriberType: "HUMAN", subscriberId });
const agent = (subscriberId: string): ChannelParticipant => ({ subscriberType: "AGENT", subscriberId });
const sharedWithHuman = (viewerId: string): ChannelShare => ({ viewerType: "HUMAN", viewerId });

const general = getMockChannel({ id: "general-id", name: "general" });
const ops = getMockChannel({ id: "ops-id", name: "ops" });
const archivedNews = getMockChannel({ id: "news-id", name: "old-news", archivedAt: 1_690_000_000_000 });
const someoneElsesPrivate = getMockChannel({
  id: "secret-id",
  name: "secret",
  visibility: "PRIVATE",
  ownerHumanId: "human-2",
});
const directWithHelper = getMockChannel({
  id: "dm-id",
  name: "dm-7",
  kind: "HUMAN_AGENT_DM",
  visibility: "PRIVATE",
  participants: [human("alice"), agent("helper")],
});
const groupChat = getMockChannel({
  id: "group-id",
  name: "group-1",
  kind: "DIRECT_GROUP",
  visibility: "PRIVATE",
  participants: [human("alice"), human("bob"), agent("helper")],
});

const messageIn = (channelId: string, overrides?: Partial<EventRow>) =>
  getMockEvent({ channelId, createdAt: 1_700_000_001_000, ...overrides });

describe("Which channels the viewer sees", () => {
  it("lists a public channel with a hash prefix", async () => {
    await openSidebar({ channels: [general] });

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# general"]);
  });

  it("lists a channel that carries no visibility information", async () => {
    await openSidebar({ channels: [getMockChannel({ visibility: undefined })] });

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# general"]);
  });

  it("lists a private channel owned by the viewer", async () => {
    const mine = getMockChannel({ name: "mine", visibility: "PRIVATE", ownerHumanId: "human-1" });
    await openSidebar({ channels: [mine] });

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# mine"]);
  });

  it("hides a private channel owned by someone else", async () => {
    await openSidebar({ channels: [general, someoneElsesPrivate] });

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# general"]);
  });

  it("lists a private channel shared with the viewer under Shared channels", async () => {
    const shared = getMockChannel({
      name: "shared-ops",
      visibility: "PRIVATE",
      ownerHumanId: "human-2",
      shares: [sharedWithHuman("alice")],
    });
    await openSidebar({ channels: [shared] });

    expect(sidebarOutline()).toEqual(["Shared channels 1 -", "# shared-ops"]);
  });

  it("hides a private channel shared with another human", async () => {
    const shared = getMockChannel({
      name: "shared-ops",
      visibility: "PRIVATE",
      ownerHumanId: "human-2",
      shares: [sharedWithHuman("bob")],
    });
    await openSidebar({ channels: [shared] });

    expect(sidebarOutline()).toEqual([]);
  });

  it("[quirk] does not count a share made to the viewer's id instead of their username", async () => {
    const shared = getMockChannel({
      name: "shared-ops",
      visibility: "PRIVATE",
      ownerHumanId: "human-2",
      shares: [sharedWithHuman("human-1")],
    });
    await openSidebar({ channels: [shared] });

    expect(sidebarOutline()).toEqual([]);
  });

  it("does not count a share made to an agent that has the viewer's name", async () => {
    const shared = getMockChannel({
      name: "shared-ops",
      visibility: "PRIVATE",
      ownerHumanId: "human-2",
      shares: [{ viewerType: "AGENT", viewerId: "alice" }],
    });
    await openSidebar({ channels: [shared] });

    expect(sidebarOutline()).toEqual([]);
  });

  it("reads the share's viewer type ignoring case and surrounding spaces", async () => {
    const shared = getMockChannel({
      name: "shared-ops",
      visibility: "PRIVATE",
      ownerHumanId: "human-2",
      shares: [{ viewerType: " human ", viewerId: "alice" }],
    });
    await openSidebar({ channels: [shared] });

    expect(sidebarOutline()).toEqual(["Shared channels 1 -", "# shared-ops"]);
  });

  it("lists a private channel shared with one of the viewer's teams under Channels", async () => {
    const teamRoom = getMockChannel({
      name: "team-room",
      visibility: "PRIVATE",
      ownerHumanId: "human-2",
      participants: [{ subscriberType: "TEAM", subscriberId: "team-1" }],
    });
    await openSidebar({ channels: [teamRoom], teams: [{ id: "team-1", name: "Platform" }] });

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# team-room"]);
  });

  it("reads the team participant type ignoring case", async () => {
    const teamRoom = getMockChannel({
      name: "team-room",
      visibility: "PRIVATE",
      ownerHumanId: "human-2",
      participants: [{ subscriberType: "team", subscriberId: "team-1" }],
    });
    await openSidebar({ channels: [teamRoom], teams: [{ id: "team-1", name: "Platform" }] });

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# team-room"]);
  });

  it("hides a private team channel when the viewer belongs to another team", async () => {
    const teamRoom = getMockChannel({
      name: "team-room",
      visibility: "PRIVATE",
      ownerHumanId: "human-2",
      participants: [{ subscriberType: "TEAM", subscriberId: "team-1" }],
    });
    await openSidebar({ channels: [teamRoom], teams: [{ id: "team-9", name: "Other" }] });

    expect(sidebarOutline()).toEqual([]);
  });

  it("does not take an agent whose id equals one of the viewer's team ids for the team", async () => {
    const lookalike = getMockChannel({
      name: "team-room",
      visibility: "PRIVATE",
      ownerHumanId: "human-2",
      participants: [agent("team-1")],
    });
    await openSidebar({ channels: [lookalike], teams: [{ id: "team-1", name: "Platform" }] });

    expect(sidebarOutline()).toEqual([]);
  });

  it("hides lifecycle channels even when they are public", async () => {
    const lifecycle = getMockChannel({ name: "agent.lifecycle.helper" });
    await openSidebar({ channels: [general, lifecycle] });

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# general"]);
  });

  it("recognises lifecycle channels whatever the case of their name", async () => {
    const lifecycle = getMockChannel({ name: "Agent.Lifecycle.helper" });
    await openSidebar({ channels: [general, lifecycle] });

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# general"]);
  });

  it("only treats names that start with agent.lifecycle. as lifecycle channels", async () => {
    const embedded = getMockChannel({ id: "embedded-id", name: "my.agent.lifecycle.x" });
    const noDot = getMockChannel({ id: "no-dot-id", name: "agent.lifecycle" });
    await openSidebar({ channels: [embedded, noDot] });

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# my.agent.lifecycle.x", "# agent.lifecycle"]);
  });

  it("lists a direct message the viewer takes part in under Direct messages", async () => {
    await openSidebar({ channels: [directWithHelper] });

    expect(sidebarOutline()).toEqual(["Direct messages 1 -", "helper"]);
  });

  it("hides a direct message the viewer does not take part in", async () => {
    const others = getMockChannel({ ...directWithHelper, participants: [human("bob"), agent("helper")] });
    await openSidebar({ channels: [others] });

    expect(sidebarOutline()).toEqual([]);
    expect(openChannelTitle()).toBe("Select a channel");
  });

  it("does not take an agent named like the viewer for the viewer", async () => {
    const lookalike = getMockChannel({ ...directWithHelper, participants: [agent("alice"), agent("helper")] });
    await openSidebar({ channels: [lookalike] });

    expect(sidebarOutline()).toEqual([]);
    expect(openChannelTitle()).toBe("Select a channel");
  });

  it("lists channels that come without participants or shares", async () => {
    const bare = getMockChannel({ participants: undefined, shares: undefined });
    await openSidebar({ channels: [bare] });

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# general"]);
  });

  it("hides a direct message that comes without participants", async () => {
    const bare = getMockChannel({ ...directWithHelper, participants: undefined });
    await openSidebar({ channels: [bare] });

    expect(sidebarOutline()).toEqual([]);
  });

  it("hides a private channel of someone else that comes without participants", async () => {
    const bare = getMockChannel({ ...someoneElsesPrivate, participants: undefined });
    await openSidebar({ channels: [bare] });

    expect(sidebarOutline()).toEqual([]);
  });

  it("[quirk] hides a direct message whose human participant is stored under the viewer's id", async () => {
    const byId = getMockChannel({ ...directWithHelper, participants: [human("human-1"), agent("helper")] });
    await openSidebar({ channels: [byId] });

    expect(sidebarOutline()).toEqual([]);
  });

  it("reads the direct message kind and participant type ignoring case and surrounding spaces", async () => {
    const lowerCase = getMockChannel({
      ...directWithHelper,
      kind: "human_agent_dm",
      participants: [{ subscriberType: " human ", subscriberId: "alice" }, agent("helper")],
    });
    await openSidebar({ channels: [lowerCase] });

    expect(sidebarOutline()).toEqual(["Direct messages 1 -", "helper"]);
  });

  it("lists a direct message shared with the viewer under Shared channels", async () => {
    const shared = getMockChannel({
      ...directWithHelper,
      participants: [agent("helper"), human("bob")],
      shares: [sharedWithHuman("alice")],
    });
    await openSidebar({ channels: [shared] });

    expect(sidebarOutline()).toEqual(["Shared channels 1 -", "helper"]);
  });

  it("hides a group chat the viewer does not take part in and opens nothing", async () => {
    const others = getMockChannel({ ...groupChat, participants: [human("bob"), agent("helper")] });
    await openSidebar({ channels: [others] });

    expect(sidebarOutline()).toEqual([]);
    expect(openChannelTitle()).toBe("Select a channel");
  });

  it("[quirk] lists no group chat the viewer takes part in, yet opens it as the first channel", async () => {
    await openSidebar({ channels: [groupChat, general] });

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# general"]);
    expect(openChannelTitle()).toBe("Direct: bob, helper");
  });

  it("[quirk] lists no agent-to-agent direct message the viewer takes part in, yet opens it", async () => {
    const agentsOnly = getMockChannel({
      id: "agents-id",
      name: "agents-1",
      kind: "AGENT_AGENT_DM",
      visibility: "PRIVATE",
      participants: [human("alice"), agent("helper"), agent("reviewer")],
    });
    await openSidebar({ channels: [agentsOnly, general] });

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# general"]);
    expect(openChannelTitle()).toBe("Direct: helper, reviewer");
  });

  it("opens nothing for an agent-to-agent direct message without the viewer", async () => {
    const agentsOnly = getMockChannel({
      id: "agents-id",
      name: "agents-1",
      kind: "AGENT_AGENT_DM",
      visibility: "PRIVATE",
      participants: [agent("helper"), agent("reviewer")],
    });
    await openSidebar({ channels: [agentsOnly] });

    expect(openChannelTitle()).toBe("Select a channel");
  });

  it("[quirk] lists an archived group chat under Archived although active ones are never listed", async () => {
    const archivedGroup = getMockChannel({ ...groupChat, archivedAt: 1_690_000_000_000 });
    await openSidebar({ channels: [archivedGroup, general] });
    await press("Archived 1 +");

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# general", "Archived 1 -", "Direct: bob, helper"]);
  });
});

describe("Grouping", () => {
  it("lists Direct messages, then Channels, then Shared channels, each in the order the API gave", async () => {
    const shared = getMockChannel({
      id: "shared-id",
      name: "shared-ops",
      shares: [sharedWithHuman("alice")],
    });
    await openSidebar({ channels: [shared, ops, directWithHelper, general] });

    expect(sidebarOutline()).toEqual([
      "Direct messages 1 -",
      "helper",
      "Channels 2 -",
      "# ops",
      "# general",
      "Shared channels 1 -",
      "# shared-ops",
    ]);
  });

  it("lists a public channel shared with the viewer only under Shared channels", async () => {
    const shared = getMockChannel({ id: "shared-id", name: "shared-ops", shares: [sharedWithHuman("alice")] });
    await openSidebar({ channels: [general, shared] });

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# general", "Shared channels 1 -", "# shared-ops"]);
  });

  it("[quirk] lists a direct message the viewer takes part in under Shared channels when it is also shared with them", async () => {
    const shared = getMockChannel({ ...directWithHelper, shares: [sharedWithHuman("alice")] });
    await openSidebar({ channels: [shared] });

    expect(sidebarOutline()).toEqual(["Shared channels 1 -", "helper"]);
  });

  it("lists channels of any other kind under Channels", async () => {
    const withoutKind = getMockChannel({ id: "plain-id", name: "plain", kind: undefined });
    const other = getMockChannel({ id: "other-id", name: "other", kind: "BROADCAST" });
    await openSidebar({ channels: [withoutKind, other] });

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# plain", "# other"]);
  });

  it("lists archived channels only under Archived, whatever their kind", async () => {
    const archivedDirect = getMockChannel({ ...directWithHelper, archivedAt: 1_690_000_000_000 });
    await openSidebar({ channels: [archivedNews, archivedDirect] });
    await press("Archived 2 +");

    expect(sidebarOutline()).toEqual(["Archived 2 -", "# old-news", "helper"]);
  });

  it("opens an archived channel the operator picks from the Archived group", async () => {
    await openSidebar({ channels: [general, archivedNews] });
    await press("Archived 1 +");
    await press("# old-news");

    expect(openChannelTitle()).toBe("# old-news");
  });

  it("hides the channels of a group when the operator collapses it, leaving other groups open", async () => {
    await openSidebar({ channels: [directWithHelper, general, ops] });
    await press("Channels 2 -");

    expect(sidebarOutline()).toEqual(["Direct messages 1 -", "helper", "Channels 2 +"]);
  });

  it("shows the channels of a collapsed group again when the operator expands it", async () => {
    await openSidebar({ channels: [general, ops] });
    await press("Channels 2 -");
    await press("Channels 2 +");

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops"]);
  });

  it("opens the channel the operator picks and adds a history entry for it", async () => {
    await openSidebar({ channels: [general, ops] });
    const entriesBefore = window.history.length;
    await press("# ops");

    expect(openChannelTitle()).toBe("# ops");
    expect(window.location.search).toBe("?channel=ops-id");
    expect(window.history.length).toBe(entriesBefore + 1);
  });

  it("opens a direct message the operator picks under the agent's name", async () => {
    await openSidebar({ channels: [general, directWithHelper] });
    await press("helper");

    expect(openChannelTitle()).toBe("helper");
  });
});

describe("Names", () => {
  it("names a direct message after its first participant who is not the viewer", async () => {
    const crowd = getMockChannel({
      ...directWithHelper,
      participants: [human("alice"), agent("helper"), agent("reviewer")],
    });
    await openSidebar({ channels: [crowd] });

    expect(sidebarOutline()).toEqual(["Direct messages 1 -", "helper"]);
  });

  it("[quirk] names a direct message 'you' when the viewer is its only participant", async () => {
    const alone = getMockChannel({ ...directWithHelper, participants: [human("alice")] });
    await openSidebar({ channels: [alone] });

    expect(sidebarOutline()).toEqual(["Direct messages 1 -", "you"]);
  });

  it("[quirk] names a direct message after the participant's type when the participant has no id", async () => {
    const unnamed = getMockChannel({
      ...directWithHelper,
      participants: [human("alice"), { subscriberType: "AGENT", subscriberId: "" }],
    });
    await openSidebar({ channels: [unnamed] });

    expect(sidebarOutline()).toEqual(["Direct messages 1 -", "AGENT"]);
  });

  it("[quirk] names a shared group chat 'Direct:' followed by everyone except the viewer", async () => {
    const shared = getMockChannel({ ...groupChat, shares: [sharedWithHuman("alice")] });
    await openSidebar({ channels: [shared] });

    expect(sidebarOutline()).toEqual(["Shared channels 1 -", "Direct: bob, helper"]);
  });

  it("[quirk] names a shared group chat 'Direct: you' when the viewer is its only participant", async () => {
    const shared = getMockChannel({
      ...groupChat,
      participants: [human("alice")],
      shares: [sharedWithHuman("alice")],
    });
    await openSidebar({ channels: [shared] });

    expect(sidebarOutline()).toEqual(["Shared channels 1 -", "Direct: you"]);
  });

  it("[quirk] names a shared group chat after its channel name when it has no participants", async () => {
    const shared = getMockChannel({ ...groupChat, participants: [], shares: [sharedWithHuman("alice")] });
    await openSidebar({ channels: [shared] });

    expect(sidebarOutline()).toEqual(["Shared channels 1 -", "group-1"]);
  });

  it("shows an agent named like the viewer by its name", async () => {
    const lookalike = getMockChannel({ ...directWithHelper, participants: [human("alice"), agent("alice")] });
    await openSidebar({ channels: [lookalike] });

    expect(sidebarOutline()).toEqual(["Direct messages 1 -", "alice"]);
  });

  it("[quirk] names a direct message 'participant' when its participant has neither id nor type", async () => {
    const blank = getMockChannel({
      ...directWithHelper,
      participants: [human("alice"), { subscriberType: "", subscriberId: "" }],
    });
    await openSidebar({ channels: [blank] });

    expect(sidebarOutline()).toEqual(["Direct messages 1 -", "participant"]);
  });

  it("[quirk] names a shared group chat after its channel name when it comes without participants", async () => {
    const shared = getMockChannel({ ...groupChat, participants: undefined, shares: [sharedWithHuman("alice")] });
    await openSidebar({ channels: [shared] });

    expect(sidebarOutline()).toEqual(["Shared channels 1 -", "group-1"]);
  });

  it("shows another human participant by their id", async () => {
    const shared = getMockChannel({
      ...groupChat,
      participants: [human("bob")],
      shares: [sharedWithHuman("alice")],
    });
    await openSidebar({ channels: [shared] });

    expect(sidebarOutline()).toEqual(["Shared channels 1 -", "Direct: bob"]);
  });
});

describe("Search", () => {
  it("narrows the list to channels whose name contains the text, ignoring case", async () => {
    await openSidebar({ channels: [general, ops] });
    search("OPS");

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# ops"]);
  });

  it("matches the text anywhere in the name", async () => {
    await openSidebar({ channels: [general, ops] });
    search("ener");

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# general"]);
  });

  it("ignores spaces around the text", async () => {
    await openSidebar({ channels: [general, ops] });
    search("  ops ");

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# ops"]);
  });

  it("treats a blank query as no search and leaves collapsed groups collapsed", async () => {
    await openSidebar({ channels: [general, ops] });
    await press("Channels 2 -");
    search("   ");

    expect(sidebarOutline()).toEqual(["Channels 2 +"]);
  });

  it("matches a direct message by the name it is shown under", async () => {
    await openSidebar({ channels: [general, directWithHelper] });
    search("help");

    expect(sidebarOutline()).toEqual(["Direct messages 1 -", "helper"]);
  });

  it("matches a direct message by its channel name too", async () => {
    await openSidebar({ channels: [general, directWithHelper] });
    search("dm-7");

    expect(sidebarOutline()).toEqual(["Direct messages 1 -", "helper"]);
  });

  it("counts only the matches in each group and drops groups without any", async () => {
    const opsEast = getMockChannel({ id: "east-id", name: "ops-east" });
    const opsWest = getMockChannel({ id: "west-id", name: "ops-west" });
    await openSidebar({ channels: [directWithHelper, general, opsEast, opsWest] });
    search("ops");

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# ops-east", "# ops-west"]);
  });

  it("does not match a regular channel by its participants", async () => {
    const withHelper = getMockChannel({ participants: [agent("helper")] });
    await openSidebar({ channels: [withHelper] });
    search("helper");

    expect(screen.getByText('No channels match "helper".')).toBeTruthy();
  });

  it("narrows the archived channels too", async () => {
    const archivedMisc = getMockChannel({ id: "misc-id", name: "old-misc", archivedAt: 1_690_000_000_000 });
    await openSidebar({ channels: [general, archivedNews, archivedMisc] });
    search("news");

    expect(sidebarOutline()).toEqual(["Archived 1 -", "# old-news"]);
  });

  it("ignores spaces around the text when it narrows archived channels", async () => {
    await openSidebar({ channels: [general, archivedNews] });
    search("  news ");

    expect(sidebarOutline()).toEqual(["Archived 1 -", "# old-news"]);
  });

  it("tells the operator when nothing matches, quoting the trimmed query", async () => {
    await openSidebar({ channels: [general, ops] });
    search(" zzz ");

    expect(screen.getByText('No channels match "zzz".')).toBeTruthy();
    expect(sidebarOutline()).toEqual([]);
  });

  it("does not show the no-match notice when the list is not empty", async () => {
    await openSidebar({ channels: [general, ops] });
    search("ops");

    expect(screen.queryByText(/No channels match/)).toBeNull();
  });

  it("does not tell the operator nothing matches while the channels are still loading", async () => {
    await renderApp({
      routes: [
        { path: "/api/auth/me", respond: { json: getMockAuthMe({ id: "human-1", username: "alice" }) } },
        { path: "/api/channels?includeArchived=1", respond: () => new Promise(() => undefined) },
        { path: "/api/agents", respond: { json: [] } },
      ],
    });
    search("ops");

    expect(screen.getByText("Loading OrgOps...")).toBeTruthy();
    expect(screen.queryByText(/No channels match/)).toBeNull();
  });

  it("does not tell the operator nothing matches for a blank query on an empty workspace", async () => {
    await openSidebar({ channels: [] });
    search("   ");

    expect(screen.queryByText(/No channels match/)).toBeNull();
  });

  it("[quirk] does not match the hash prefix that the list shows", async () => {
    await openSidebar({ channels: [general] });
    search("#");

    expect(screen.getByText('No channels match "#".')).toBeTruthy();
  });

  it("never reveals a channel the viewer may not see", async () => {
    await openSidebar({ channels: [general, someoneElsesPrivate] });
    search("secret");

    expect(screen.getByText('No channels match "secret".')).toBeTruthy();
  });

  it("[quirk] shows an empty list without the no-match notice when only a group chat matches", async () => {
    await openSidebar({ channels: [groupChat, general] });
    search("group-1");

    expect(sidebarOutline()).toEqual([]);
    expect(screen.queryByText(/No channels match/)).toBeNull();
  });

  it("includes matching archived channels and expands the Archived group", async () => {
    await openSidebar({ channels: [general, archivedNews] });
    search("news");

    expect(sidebarOutline()).toEqual(["Archived 1 -", "# old-news"]);
    expect(screen.queryByText(/No channels match/)).toBeNull();
  });

  it("collapses the Archived group again when the search is cleared", async () => {
    await openSidebar({ channels: [general, archivedNews] });
    search("news");
    search("");

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# general", "Archived 1 +"]);
  });

  it("expands a collapsed group while a search is active", async () => {
    await openSidebar({ channels: [general, ops] });
    await press("Channels 2 -");
    search("ops");

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# ops"]);
  });

  it("collapses the group again when the search is cleared", async () => {
    await openSidebar({ channels: [general, ops] });
    await press("Channels 2 -");
    search("ops");
    search("");

    expect(sidebarOutline()).toEqual(["Channels 2 +"]);
  });

  it("[quirk] ignores a click on a group header during a search but applies it once the search is cleared", async () => {
    await openSidebar({ channels: [general, ops] });
    search("ops");
    await press("Channels 1 -");
    const duringSearch = sidebarOutline();
    search("");

    expect(duringSearch).toEqual(["Channels 1 -", "# ops"]);
    expect(sidebarOutline()).toEqual(["Channels 2 +"]);
  });
});

describe("Unread badges", () => {
  it("counts each new message that arrives in another channel", async () => {
    const app = await openSidebar({ channels: [general, ops] });
    await receive(app, messageIn("ops-id", { id: "event-1" }));
    await receive(app, messageIn("ops-id", { id: "event-2" }));

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops 2"]);
  });

  it("counts a message that is delivered twice only once", async () => {
    const app = await openSidebar({ channels: [general, ops] });
    await receive(app, messageIn("ops-id", { id: "event-1" }));
    await receive(app, messageIn("ops-id", { id: "event-1" }));

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops 1"]);
  });

  it("shows the badge on a direct message", async () => {
    const app = await openSidebar({ channels: [general, directWithHelper] });
    await receive(app, messageIn("dm-id", { id: "event-1" }));

    expect(sidebarOutline()).toEqual(["Direct messages 1 -", "helper 1", "Channels 1 -", "# general"]);
  });

  it("removes the badge when the operator opens the channel", async () => {
    const app = await openSidebar({ channels: [general, ops] });
    await receive(app, messageIn("ops-id", { id: "event-1" }));
    await press("# ops 1");

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops"]);
  });

  it("keeps the badges of the other channels when the operator opens one", async () => {
    const app = await openSidebar({ channels: [general, ops, directWithHelper] });
    await receive(app, messageIn("ops-id", { id: "event-1" }));
    await receive(app, messageIn("dm-id", { id: "event-2" }));
    await press("# ops 1");

    expect(sidebarOutline()).toEqual(["Direct messages 1 -", "helper 1", "Channels 2 -", "# general", "# ops"]);
  });

  it("keeps the badges of the other channels when a message arrives in the open one", async () => {
    const app = await openSidebar({ channels: [general, ops] });
    await receive(app, messageIn("ops-id", { id: "event-1" }));
    await receive(app, messageIn("general-id", { id: "event-2" }));

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops 1"]);
  });

  it("[quirk] keeps the badge of an opened channel until its messages have loaded", async () => {
    const app = await openSidebar({
      channels: [general, ops],
      extraRoutes: [{ path: /^\/api\/events\?channelId=ops-id&type=message\.created/, respond: () => new Promise(() => undefined) }],
    });
    await receive(app, messageIn("ops-id", { id: "event-1" }));
    await press("# ops 1");

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops 1"]);
  });

  it("removes the badge of a channel that was just opened when another message arrives in it", async () => {
    const app = await openSidebar({
      channels: [general, ops],
      extraRoutes: [{ path: /^\/api\/events\?channelId=ops-id&type=message\.created/, respond: () => new Promise(() => undefined) }],
    });
    await receive(app, messageIn("ops-id", { id: "event-1" }));
    await press("# ops 1");
    await receive(app, messageIn("ops-id", { id: "event-2" }));

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops"]);
  });

  it("keeps the badges of other channels when a message arrives in a channel that was just opened", async () => {
    const app = await openSidebar({
      channels: [general, ops, directWithHelper],
      extraRoutes: [{ path: /^\/api\/events\?channelId=ops-id&type=message\.created/, respond: () => new Promise(() => undefined) }],
    });
    await receive(app, messageIn("ops-id", { id: "event-1" }));
    await receive(app, messageIn("dm-id", { id: "event-2" }));
    await press("# ops 1");
    await receive(app, messageIn("ops-id", { id: "event-3" }));

    expect(sidebarOutline()).toEqual(["Direct messages 1 -", "helper 1", "Channels 2 -", "# general", "# ops"]);
  });

  it("does not count a message that is not newer than the last one the operator read in that channel", async () => {
    const read = messageIn("ops-id", { id: "event-0", createdAt: 1_700_000_005_000 });
    const app = await openSidebar({
      channels: [general, ops],
      url: "/?channel=ops-id",
      extraRoutes: [{ path: /^\/api\/events\?channelId=ops-id&type=message\.created/, respond: { json: [read] } }],
    });
    await press("# general");
    await receive(app, messageIn("ops-id", { id: "event-1", createdAt: 1_700_000_005_000 }));

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops"]);
  });

  it("counts a message that is newer than the last one the operator read in that channel", async () => {
    const read = messageIn("ops-id", { id: "event-0", createdAt: 1_700_000_005_000 });
    const app = await openSidebar({
      channels: [general, ops],
      url: "/?channel=ops-id",
      extraRoutes: [{ path: /^\/api\/events\?channelId=ops-id&type=message\.created/, respond: { json: [read] } }],
    });
    await press("# general");
    await receive(app, messageIn("ops-id", { id: "event-1", createdAt: 1_700_000_005_001 }));

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops 1"]);
  });

  it("does not badge the channel that is open", async () => {
    const app = await openSidebar({ channels: [general, ops] });
    await receive(app, messageIn("general-id", { id: "event-1" }));

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops"]);
  });

  it("does not count events that are not messages", async () => {
    const app = await openSidebar({ channels: [general, ops] });
    await receive(app, messageIn("ops-id", { id: "event-1", type: "tool.started" }));

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops"]);
  });

  it("does not count json-render action messages", async () => {
    const app = await openSidebar({ channels: [general, ops] });
    await receive(
      app,
      messageIn("ops-id", { id: "event-1", payload: { eventType: "ui.json-render.action", text: "Approve" } }),
    );

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops"]);
  });

  it("does not count messages that announce a json-render action in their text", async () => {
    const app = await openSidebar({ channels: [general, ops] });
    await receive(app, messageIn("ops-id", { id: "event-1", payload: { text: "  JSON-render action: approve" } }));

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops"]);
  });

  it("counts a message whose text only mentions json-render action later on", async () => {
    const app = await openSidebar({ channels: [general, ops] });
    await receive(app, messageIn("ops-id", { id: "event-1", payload: { text: "see json-render action: docs" } }));

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops 1"]);
  });

  it("counts a message that has no payload", async () => {
    const app = await openSidebar({ channels: [general, ops] });
    await receive(app, messageIn("ops-id", { id: "event-1", payload: null }));

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops 1"]);
  });

  it("counts a message whose payload has no text", async () => {
    const app = await openSidebar({ channels: [general, ops] });
    await receive(app, messageIn("ops-id", { id: "event-1", payload: {} }));

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops 1"]);
  });

  it("does not badge an archived channel", async () => {
    const app = await openSidebar({ channels: [general, archivedNews] });
    await press("Archived 1 +");
    await receive(app, messageIn("news-id", { id: "event-1" }));

    expect(sidebarOutline()).toEqual(["Channels 1 -", "# general", "Archived 1 -", "# old-news"]);
  });

  it("does not count a message that is not newer than the last one already seen in that channel", async () => {
    const seen = messageIn("ops-id", { id: "event-0", createdAt: 1_700_000_005_000 });
    const app = await openSidebar({
      channels: [general, ops],
      extraRoutes: [messageFeed({ atLoad: [seen], later: [seen] })],
    });
    await receive(app, messageIn("ops-id", { id: "event-1", createdAt: 1_700_000_005_000 }));

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops"]);
  });

  it("counts a message that is one millisecond newer than the last one already seen", async () => {
    const seen = messageIn("ops-id", { id: "event-0", createdAt: 1_700_000_005_000 });
    const app = await openSidebar({
      channels: [general, ops],
      extraRoutes: [messageFeed({ atLoad: [seen], later: [seen] })],
    });
    await receive(app, messageIn("ops-id", { id: "event-1", createdAt: 1_700_000_005_001 }));

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops 1"]);
  });

  it("does not count a message that has no timestamp", async () => {
    const app = await openSidebar({ channels: [general, ops] });
    await receive(app, messageIn("ops-id", { id: "event-1", createdAt: undefined }));

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops"]);
  });

  it("counts every message it finds in another channel when it polls", async () => {
    await openSidebar({
      channels: [general, ops],
      extraRoutes: [
        messageFeed({
          atLoad: [],
          later: [
            messageIn("ops-id", { id: "event-1", createdAt: 1_700_000_002_000 }),
            messageIn("ops-id", { id: "event-2", createdAt: 1_700_000_001_000 }),
          ],
        }),
      ],
    });
    await pollForNewMessages();

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops 2"]);
  });

  it("does not count messages in the open channel when it polls", async () => {
    await openSidebar({
      channels: [general, ops],
      extraRoutes: [messageFeed({ atLoad: [], later: [messageIn("general-id", { id: "event-1" })] })],
    });
    await pollForNewMessages();

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops"]);
  });

  it("does not count json-render action messages when it polls", async () => {
    await openSidebar({
      channels: [general, ops],
      extraRoutes: [
        messageFeed({
          atLoad: [],
          later: [messageIn("ops-id", { id: "event-1", payload: { eventType: "ui.json-render.action" } })],
        }),
      ],
    });
    await pollForNewMessages();

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops"]);
  });

  it("does not count messages that were already there when the workspace opened", async () => {
    const seen = messageIn("ops-id", { id: "event-0" });
    await openSidebar({
      channels: [general, ops],
      extraRoutes: [messageFeed({ atLoad: [seen], later: [seen] })],
    });
    await pollForNewMessages();

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops"]);
  });

  it("counts only the messages that arrived after the workspace opened", async () => {
    const seen = messageIn("ops-id", { id: "event-0", createdAt: 1_700_000_001_000 });
    const fresh = messageIn("ops-id", { id: "event-1", createdAt: 1_700_000_002_000 });
    await openSidebar({
      channels: [general, ops],
      extraRoutes: [messageFeed({ atLoad: [seen], later: [fresh, seen] })],
    });
    await pollForNewMessages();

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops 1"]);
  });

  it("shows the latest poll's count rather than adding to the previous one", async () => {
    await openSidebar({
      channels: [general, ops],
      extraRoutes: [messageFeed({ atLoad: [], later: [messageIn("ops-id", { id: "event-1" })] })],
    });
    await pollForNewMessages();
    await settle(10_000);

    expect(sidebarOutline()).toEqual(["Channels 2 -", "# general", "# ops 1"]);
  });
});
