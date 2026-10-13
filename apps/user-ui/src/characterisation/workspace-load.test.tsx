import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Channel } from "../types";
import { getMockAuthMe, getMockChannel, getMockEvent } from "./factories";
import type { FakeRoute } from "./fake-api";
import { renderApp } from "./render-app";

const noEvents: FakeRoute = { path: /^\/api\/events/, respond: { json: [] } };

const workspaceOf = (channels: readonly Channel[]): FakeRoute[] => [
  { path: "/api/auth/me", respond: { json: getMockAuthMe({ id: "human-1", username: "alice" }) } },
  { path: "/api/channels?includeArchived=1", respond: { json: channels } },
  { path: "/api/agents", respond: { json: [] } },
  noEvents,
];

const claimOf = (token: string, response: { status?: number; json?: unknown; text?: string }): FakeRoute => ({
  method: "POST",
  path: `/api/channel-share-links/${token}/claim`,
  respond: response,
});

const openWorkspace = (options: {
  url: string;
  channels: readonly Channel[];
  claim?: FakeRoute;
  extraRoutes?: readonly FakeRoute[];
}) =>
  renderApp({
    url: options.url,
    routes: [
      ...(options.extraRoutes ?? []),
      ...workspaceOf(options.channels),
      ...(options.claim ? [options.claim] : []),
    ],
  });

const openChannelTitle = () => screen.getByRole("heading", { level: 1 }).textContent;

const archivedGroupShows = (channelLabel: string) =>
  screen.queryByRole("button", { name: channelLabel }) !== null;

const general = getMockChannel({ id: "general-id", name: "general" });
const ops = getMockChannel({ id: "ops-id", name: "ops" });
const archivedNews = getMockChannel({
  id: "news-id",
  name: "old-news",
  archivedAt: 1_690_000_000_000,
});
const someoneElsesPrivate = getMockChannel({
  id: "secret-id",
  name: "secret",
  visibility: "PRIVATE",
  ownerHumanId: "human-2",
});

describe("Claiming a share link", () => {
  const shared = getMockChannel({ id: "shared-id", name: "shared-ops" });

  it("sends the token to the claim endpoint before the channels are listed", async () => {
    const { requests } = await openWorkspace({
      url: "/?share=tok-1",
      channels: [general, shared],
      claim: claimOf("tok-1", { json: { ok: true, channelId: "shared-id" } }),
    });
    const paths = requests.map((request) => `${request.method} ${request.path}`);

    expect(paths.indexOf("POST /api/channel-share-links/tok-1/claim")).toBeGreaterThan(-1);
    expect(paths.indexOf("POST /api/channel-share-links/tok-1/claim")).toBeLessThan(
      paths.indexOf("GET /api/channels?includeArchived=1"),
    );
  });

  it("opens the claimed channel instead of the first channel", async () => {
    await openWorkspace({
      url: "/?share=tok-1",
      channels: [general, shared],
      claim: claimOf("tok-1", { json: { ok: true, channelId: "shared-id" } }),
    });

    expect(openChannelTitle()).toBe("# shared-ops");
  });

  it("opens the claimed channel even when the URL names another channel", async () => {
    await openWorkspace({
      url: "/?share=tok-1&channel=general-id",
      channels: [general, shared],
      claim: claimOf("tok-1", { json: { ok: true, channelId: "shared-id" } }),
    });

    expect(openChannelTitle()).toBe("# shared-ops");
  });

  it("replaces the share token in the URL with the claimed channel", async () => {
    await openWorkspace({
      url: "/?share=tok-1",
      channels: [general, shared],
      claim: claimOf("tok-1", { json: { ok: true, channelId: "shared-id" } }),
    });

    expect(window.location.search).toBe("?channel=shared-id");
  });

  it("trims the token before claiming it", async () => {
    const { requests } = await openWorkspace({
      url: "/?share=%20tok-1%20",
      channels: [general, shared],
      claim: claimOf("tok-1", { json: { ok: true, channelId: "shared-id" } }),
    });

    expect(requests.map((request) => request.path)).toContain("/api/channel-share-links/tok-1/claim");
  });

  it("URL-encodes the token in the claim path", async () => {
    const { requests } = await openWorkspace({
      url: "/?share=a%2Fb",
      channels: [general],
    });

    expect(requests.map((request) => request.path)).toContain("/api/channel-share-links/a%2Fb/claim");
  });

  it("does not claim anything when the token is blank", async () => {
    const { requests } = await openWorkspace({
      url: "/?share=%20%20",
      channels: [general, shared],
    });

    expect(requests.filter((request) => request.path.includes("channel-share-links"))).toEqual([]);
  });

  it("falls back to the first visible channel when the claimed channel is not visible to the viewer", async () => {
    await openWorkspace({
      url: "/?share=tok-1",
      channels: [general, someoneElsesPrivate],
      claim: claimOf("tok-1", { json: { ok: true, channelId: "secret-id" } }),
    });

    expect(openChannelTitle()).toBe("# general");
  });

  it("expands the Archived group when the claimed channel is archived", async () => {
    await openWorkspace({
      url: "/?share=tok-1",
      channels: [general, archivedNews],
      claim: claimOf("tok-1", { json: { ok: true, channelId: "news-id" } }),
    });

    expect(openChannelTitle()).toBe("# old-news");
    expect(archivedGroupShows("# old-news")).toBe(true);
  });
});

describe("Claiming a share link fails", () => {
  const expired = claimOf("tok-1", { status: 410, text: "Share link expired" });

  it("shows the server's message", async () => {
    await openWorkspace({ url: "/?share=tok-1", channels: [general], claim: expired });

    expect(screen.getByText("Share link expired")).toBeTruthy();
  });

  it("falls back to a generic message when the server sends none", async () => {
    await openWorkspace({
      url: "/?share=tok-1",
      channels: [general],
      claim: claimOf("tok-1", { status: 500 }),
    });

    expect(screen.getByText("Request failed: 500")).toBeTruthy();
  });

  it("still opens the first channel and removes the token from the URL", async () => {
    await openWorkspace({ url: "/?share=tok-1", channels: [general, ops], claim: expired });

    expect(openChannelTitle()).toBe("# general");
    expect(window.location.search).toBe("?channel=general-id");
  });

  it("keeps honouring the channel link that came with the token", async () => {
    await openWorkspace({ url: "/?share=tok-1&channel=ops-id", channels: [general, ops], claim: expired });

    expect(openChannelTitle()).toBe("# ops");
    expect(window.location.search).toBe("?channel=ops-id");
  });
});

describe("Channel deep link", () => {
  it("opens the channel named in the URL", async () => {
    await openWorkspace({ url: "/?channel=ops-id", channels: [general, ops] });

    expect(openChannelTitle()).toBe("# ops");
    expect(window.location.search).toBe("?channel=ops-id");
  });

  it("falls back to the first channel when the linked channel does not exist", async () => {
    await openWorkspace({ url: "/?channel=missing-id", channels: [general, ops] });

    expect(openChannelTitle()).toBe("# general");
    expect(window.location.search).toBe("?channel=general-id");
  });

  it("falls back when the linked channel is private and belongs to someone else", async () => {
    await openWorkspace({ url: "/?channel=secret-id", channels: [general, someoneElsesPrivate] });

    expect(openChannelTitle()).toBe("# general");
  });

  it("opens a linked private channel that the viewer owns", async () => {
    const mine = getMockChannel({
      id: "mine-id",
      name: "mine",
      visibility: "PRIVATE",
      ownerHumanId: "human-1",
    });
    await openWorkspace({ url: "/?channel=mine-id", channels: [general, mine] });

    expect(openChannelTitle()).toBe("# mine");
  });

  it("opens a linked archived channel", async () => {
    await openWorkspace({ url: "/?channel=news-id", channels: [general, archivedNews] });

    expect(openChannelTitle()).toBe("# old-news");
    expect(screen.getByText("Archived channel")).toBeTruthy();
  });
});

describe("Fallback channel", () => {
  it("opens the first channel and records it in the URL when there is no link", async () => {
    await openWorkspace({ url: "/", channels: [general, ops] });

    expect(openChannelTitle()).toBe("# general");
    expect(window.location.search).toBe("?channel=general-id");
  });

  it("skips archived and invisible channels at the top of the list", async () => {
    await openWorkspace({
      url: "/",
      channels: [archivedNews, someoneElsesPrivate, ops, general],
    });

    expect(openChannelTitle()).toBe("# ops");
  });

  it("selects nothing when every channel is archived", async () => {
    await openWorkspace({ url: "/", channels: [archivedNews] });

    expect(openChannelTitle()).toBe("Select a channel");
    expect(window.location.search).toBe("");
  });

  it("selects nothing when there are no channels", async () => {
    await openWorkspace({ url: "/?channel=general-id", channels: [] });

    expect(openChannelTitle()).toBe("Select a channel");
    expect(window.location.search).toBe("");
  });

  it("selects nothing when the only channels are invisible to the viewer", async () => {
    await openWorkspace({ url: "/", channels: [someoneElsesPrivate] });

    expect(openChannelTitle()).toBe("Select a channel");
  });
});

describe("Archived channels", () => {
  it("are collapsed by default", async () => {
    await openWorkspace({ url: "/", channels: [general, archivedNews] });

    expect(screen.getByRole("button", { name: /^Archived/ })).toBeTruthy();
    expect(archivedGroupShows("# old-news")).toBe(false);
  });

  it("stay collapsed when the fallback opens a regular channel", async () => {
    await openWorkspace({ url: "/?channel=general-id", channels: [general, archivedNews] });

    expect(archivedGroupShows("# old-news")).toBe(false);
  });

  it("expand when a link opens one of them", async () => {
    await openWorkspace({ url: "/?channel=news-id", channels: [general, archivedNews] });

    expect(archivedGroupShows("# old-news")).toBe(true);
  });

  it("do not expand when the linked archived channel is invisible to the viewer", async () => {
    const hiddenArchived = getMockChannel({
      id: "hidden-id",
      name: "hidden-old",
      visibility: "PRIVATE",
      ownerHumanId: "human-2",
      archivedAt: 1_690_000_000_000,
    });
    await openWorkspace({ url: "/?channel=hidden-id", channels: [general, archivedNews, hiddenArchived] });

    expect(archivedGroupShows("# old-news")).toBe(false);
  });
});

describe("Opening the workspace", () => {
  it("shows a loading notice until the channels arrive", async () => {
    await renderApp({
      routes: [
        { path: "/api/channels?includeArchived=1", respond: () => new Promise(() => undefined) },
        ...workspaceOf([general]),
      ],
    });

    expect(screen.getByText("Loading OrgOps...")).toBeTruthy();
  });

  it("removes the loading notice once the channels are loaded", async () => {
    await openWorkspace({ url: "/", channels: [general] });

    expect(screen.queryByText("Loading OrgOps...")).toBeNull();
  });

  it("shows the server's message and selects nothing when the channels cannot be loaded", async () => {
    await renderApp({
      routes: [
        { path: "/api/channels?includeArchived=1", respond: { status: 503, text: "Channels are down" } },
        ...workspaceOf([general]),
      ],
    });

    expect(screen.getByText("Channels are down")).toBeTruthy();
    expect(openChannelTitle()).toBe("Select a channel");
  });

  it("does not load the workspace while a new password is still required", async () => {
    const { requests } = await renderApp({
      routes: [
        {
          path: "/api/auth/me",
          respond: { json: getMockAuthMe({ username: "alice", mustChangePassword: true }) },
        },
        ...workspaceOf([general]).slice(1),
      ],
    });

    expect(requests.map((request) => request.path)).not.toContain("/api/channels?includeArchived=1");
  });

  it("replaces the current history entry instead of adding one", async () => {
    window.history.replaceState(null, "", "/");
    const entriesBefore = window.history.length;
    await openWorkspace({ url: "/", channels: [general] });

    expect(window.history.length).toBe(entriesBefore);
  });

  it("opens a private channel shared with one of the viewer's teams", async () => {
    const teamChannel = getMockChannel({
      id: "team-id",
      name: "team-room",
      visibility: "PRIVATE",
      ownerHumanId: "human-2",
      participants: [{ subscriberType: "TEAM", subscriberId: "team-1" }],
    });
    await openWorkspace({
      url: "/",
      channels: [teamChannel],
      extraRoutes: [{ path: "/api/teams/me", respond: { json: [{ id: "team-1", name: "Platform" }] } }],
    });

    expect(openChannelTitle()).toBe("# team-room");
  });

  it("does not open a private team channel when the viewer is in another team", async () => {
    const teamChannel = getMockChannel({
      id: "team-id",
      name: "team-room",
      visibility: "PRIVATE",
      ownerHumanId: "human-2",
      participants: [{ subscriberType: "TEAM", subscriberId: "team-1" }],
    });
    await openWorkspace({
      url: "/",
      channels: [teamChannel],
      extraRoutes: [{ path: "/api/teams/me", respond: { json: [{ id: "team-9", name: "Other" }] } }],
    });

    expect(openChannelTitle()).toBe("Select a channel");
  });
});

describe("Archived group", () => {
  it("is not listed when there are no archived channels", async () => {
    await openWorkspace({ url: "/", channels: [general] });

    expect(screen.queryByRole("button", { name: /^Archived/ })).toBeNull();
  });

  it("shows the number of archived channels and a plus sign while collapsed", async () => {
    await openWorkspace({ url: "/", channels: [general, archivedNews] });

    expect(screen.getByRole("button", { name: "Archived 1 +" })).toBeTruthy();
  });

  it("opens and closes when the operator clicks it", async () => {
    await openWorkspace({ url: "/", channels: [general, archivedNews] });
    fireEvent.click(screen.getByRole("button", { name: "Archived 1 +" }));
    const shownAfterOpening = archivedGroupShows("# old-news");
    fireEvent.click(screen.getByRole("button", { name: "Archived 1 -" }));

    expect(shownAfterOpening).toBe(true);
    expect(archivedGroupShows("# old-news")).toBe(false);
  });

  it("opens an archived channel when the operator picks it", async () => {
    await openWorkspace({ url: "/?channel=general-id", channels: [general, archivedNews] });
    fireEvent.click(screen.getByRole("button", { name: "Archived 1 +" }));
    fireEvent.click(screen.getByRole("button", { name: "# old-news" }));

    expect(openChannelTitle()).toBe("# old-news");
  });
});

describe("Messages that already exist when the workspace opens", () => {
  it("are not counted as unread in other channels", async () => {
    await openWorkspace({
      url: "/?channel=general-id",
      channels: [general, ops],
      extraRoutes: [
        {
          path: /^\/api\/events\?type=message\.created&limit=100/,
          respond: { json: [getMockEvent({ id: "event-9", channelId: "ops-id", createdAt: 1_700_000_005_000 })] },
        },
      ],
    });

    expect(screen.getByRole("button", { name: "# ops" })).toBeTruthy();
  });
});
