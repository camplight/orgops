import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Agent, Channel, EventRow } from "../types";
import { getMockAgent, getMockAuthMe, getMockChannel, getMockEvent } from "./factories";
import type { FakeResponse, FakeRoute } from "./fake-api";
import { renderApp, settle } from "./render-app";

const BASE_TIME = 1_700_000_000_000;
const at = (step: number) => BASE_TIME + step * 1000;

const general = getMockChannel({ id: "channel-1", name: "general" });

const matchesQuery = (event: EventRow, params: URLSearchParams) => {
  const type = params.get("type");
  const prefix = params.get("typePrefix");
  if (type) return event.type === type;
  if (prefix) return event.type.startsWith(prefix);
  return true;
};

const eventsRoute = (events: readonly EventRow[]): FakeRoute => ({
  path: /^\/api\/events\?channelId=/,
  respond: ({ path }) => {
    const params = new URL(path, "http://localhost").searchParams;
    return { json: params.has("before") ? [] : events.filter((event) => matchesQuery(event, params)) };
  },
});

type TimelineOptions = {
  events?: readonly EventRow[];
  channel?: Channel;
  agents?: readonly Agent[];
  routes?: readonly FakeRoute[];
  url?: string;
};

const openTimeline = (options: TimelineOptions = {}) =>
  renderApp({
    url: options.url,
    routes: [
      ...(options.routes ?? []),
      { path: "/api/auth/me", respond: { json: getMockAuthMe({ id: "human-1", username: "alice" }) } },
      { path: "/api/channels?includeArchived=1", respond: { json: [options.channel ?? general] } },
      { path: "/api/agents", respond: { json: options.agents ?? [] } },
      eventsRoute(options.events ?? []),
    ],
  });

const message = (text: string, overrides?: Partial<EventRow>) =>
  getMockEvent({ id: `message-${text}`, createdAt: at(1), payload: { text }, ...overrides });

const trace = (type: string, payload?: unknown, overrides?: Partial<EventRow>) =>
  getMockEvent({ id: `trace-${type}`, type, createdAt: at(1), payload, ...overrides });

const articleOf = (text: string) => {
  const article = screen.getByText(text).closest("article");
  if (!article) throw new Error(`No article around "${text}"`);
  return article;
};

const press = async (name: string, container: HTMLElement = document.body) => {
  fireEvent.click(within(container).getByRole("button", { name }));
  await settle();
};

const fillIn = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });

const isDisabled = (name: string, container: HTMLElement = document.body) =>
  (within(container).getByRole("button", { name }) as HTMLButtonElement).disabled;

const isShown = (text: string) => screen.queryByText(text) !== null;

const preWithText = (expected: string) =>
  screen.queryByText((_, element) => element?.tagName === "PRE" && element.textContent === expected) !== null;

const jsonRender = (spec: unknown) => "```json-render\n" + JSON.stringify(spec) + "\n```";

const secretInputTag = (attributes: string) => `<orgops-secret-input ${attributes} />`;

const specOf = (root: string, elements: Record<string, unknown>) => ({ root, elements });

const openBlock = (spec: unknown, options: TimelineOptions = {}) =>
  openTimeline({ ...options, events: [message(jsonRender(spec))] });

const pageWith = (children: Record<string, unknown>, rootProps: Record<string, unknown> = { title: "Form" }) =>
  specOf("page", {
    page: { type: "Page", props: rootProps, children: Object.keys(children) },
    ...children,
  });

const appearsBefore = (first: string, second: string) =>
  Boolean(
    screen.getByText(first).compareDocumentPosition(screen.getByText(second)) & Node.DOCUMENT_POSITION_FOLLOWING,
  );

const chipBefore = (chipName: string, text: string) =>
  Boolean(
    screen.getByRole("button", { name: chipName }).compareDocumentPosition(screen.getByText(text)) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  );

const textBeforeChip = (text: string, chipName: string) =>
  Boolean(
    screen.getByText(text).compareDocumentPosition(screen.getByRole("button", { name: chipName })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  );

describe("Messages and traces in the timeline", () => {
  it("shows a message with its sender and text", async () => {
    await openTimeline({ events: [message("Hello team", { source: "human:bob" })] });
    const article = articleOf("Hello team");

    expect(within(article).getByText("bob")).toBeTruthy();
  });

  it.each([
    { source: "human:bob", label: "bob" },
    { source: "agent:helper", label: "helper" },
    { source: "human:", label: "Human" },
    { source: "agent:", label: "Agent" },
    { source: "scheduler", label: "scheduler" },
    { source: "", label: "System" },
  ])("labels a message from source '$source' as '$label'", async ({ source, label }) => {
    await openTimeline({ events: [message("Ping", { source })] });

    expect(within(articleOf("Ping")).getByText(label)).toBeTruthy();
  });

  it("shows an empty-conversation notice when the channel has no timeline events", async () => {
    await openTimeline({ events: [] });

    expect(isShown("No messages yet")).toBe(true);
  });

  it("does not show the empty notice when there is a message", async () => {
    await openTimeline({ events: [message("Hello")] });

    expect(isShown("No messages yet")).toBe(false);
  });

  it("shows a loading notice while the channel's messages are being fetched", async () => {
    await openTimeline({
      routes: [{ path: /^\/api\/events\?channelId=/, respond: () => new Promise(() => undefined) }],
    });

    expect(isShown("Loading messages...")).toBe(true);
  });

  it("keeps messages in time order", async () => {
    await openTimeline({
      events: [message("second", { createdAt: at(2) }), message("first", { createdAt: at(1) })],
    });

    expect(appearsBefore("first", "second")).toBe(true);
  });

  it("[quirk] orders a scheduled message by its delivery time instead of its creation time", async () => {
    await openTimeline({
      events: [
        message("scheduled", { createdAt: at(1), deliverAt: at(10) }),
        message("later", { createdAt: at(5) }),
      ],
    });

    expect(appearsBefore("later", "scheduled")).toBe(true);
  });

  it("puts trace events that follow a message after it", async () => {
    await openTimeline({
      events: [message("Question", { createdAt: at(1) }), trace("agent.turn.started", {}, { createdAt: at(2) })],
    });

    expect(textBeforeChip("Question", "Agent is thinking")).toBe(true);
  });

  it("puts trace events that precede a message before it", async () => {
    await openTimeline({
      events: [trace("agent.turn.started", {}, { createdAt: at(1) }), message("Answer", { createdAt: at(2) })],
    });

    expect(chipBefore("Agent is thinking", "Answer")).toBe(true);
  });

  it("keeps trace events on either side of a message apart", async () => {
    await openTimeline({
      events: [
        trace("agent.turn.started", {}, { createdAt: at(1) }),
        message("Middle", { createdAt: at(2) }),
        trace("agent.turn.completed", {}, { createdAt: at(3) }),
      ],
    });

    expect(
      chipBefore("Agent is thinking", "Middle") && textBeforeChip("Middle", "Agent finished turn"),
    ).toBe(true);
  });

  it("lists consecutive trace events as chips in time order", async () => {
    await openTimeline({
      events: [
        trace("tool.executed", { tool: "fs_read" }, { createdAt: at(2) }),
        trace("tool.started", { tool: "fs_read" }, { createdAt: at(1) }),
      ],
    });
    const chips = screen.getAllByRole("button", { name: /^fs_read / }).map((chip) => chip.textContent);

    expect(chips).toEqual(["R", "E"]);
  });

  it("ignores events whose type is not a known trace type", async () => {
    await openTimeline({ events: [trace("agent.turn.queued", {})] });

    expect(isShown("No messages yet")).toBe(true);
  });

  it("[quirk] shows a message with no text as an empty bubble", async () => {
    await openTimeline({ events: [message("ignored", { payload: { text: 42 }, source: "human:carol" })] });

    expect([isShown("No messages yet"), screen.getAllByText("carol").length]).toEqual([false, 2]);
  });
});

describe("Hidden json-render action messages", () => {
  it("hides a message whose payload marks it as a json-render action", async () => {
    await openTimeline({
      events: [message("Clicked approve", { payload: { eventType: "ui.json-render.action", text: "Clicked approve" } })],
    });

    expect(isShown("Clicked approve")).toBe(false);
  });

  it("hides a message whose text starts with 'json-render action:'", async () => {
    await openTimeline({ events: [message("json-render action: approve\nelement: go")] });

    expect(screen.queryByText(/json-render action/)).toBeNull();
  });

  it("hides the action text regardless of case and leading spaces", async () => {
    await openTimeline({ events: [message("   JSON-Render Action: approve")] });

    expect(screen.queryByText(/approve/i)).toBeNull();
  });

  it("shows a message that only mentions the action prefix further along", async () => {
    await openTimeline({ events: [message("I saw a json-render action: approve")] });

    expect(isShown("I saw a json-render action: approve")).toBe(true);
  });

  it("shows a message with another payload event type", async () => {
    await openTimeline({
      events: [message("Plain", { payload: { eventType: "something.else", text: "Plain" } })],
    });

    expect(isShown("Plain")).toBe(true);
  });

  it("shows the conversation as empty when the only message is a hidden action", async () => {
    await openTimeline({
      events: [message("x", { payload: { eventType: "ui.json-render.action", text: "x" } })],
    });

    expect(isShown("No messages yet")).toBe(true);
  });
});

describe("Plain text and markdown messages", () => {
  it("shows plain text as it is", async () => {
    await openTimeline({ events: [message("Deploy finished at noon")] });

    expect(isShown("Deploy finished at noon")).toBe(true);
  });

  it("shows markdown syntax literally when the text has no markdown hint", async () => {
    await openTimeline({ events: [message("this was ~~wrong~~ before")] });

    expect(isShown("this was ~~wrong~~ before")).toBe(true);
  });

  it("renders a heading", async () => {
    await openTimeline({ events: [message("# Release notes")] });

    expect(screen.getByRole("heading", { name: "Release notes" })).toBeTruthy();
  });

  it("renders a heading after other text on an earlier line", async () => {
    await openTimeline({ events: [message("Intro line\n## Details")] });

    expect(screen.getByRole("heading", { name: "Details" })).toBeTruthy();
  });

  it("renders a bullet list", async () => {
    await openTimeline({ events: [message("- first item\n- second item")] });

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["first item", "second item"]);
  });

  it("renders a numbered list", async () => {
    await openTimeline({ events: [message("1. open it\n2. close it")] });

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["open it", "close it"]);
  });

  it("renders a block quote", async () => {
    await openTimeline({ events: [message("> quoted words")] });

    expect(screen.getByRole("blockquote").textContent).toContain("quoted words");
  });

  it("renders inline code", async () => {
    await openTimeline({ events: [message("run `npm test` now")] });

    expect(screen.getByRole("code").textContent).toBe("npm test");
  });

  it("renders bold text", async () => {
    await openTimeline({ events: [message("this is **important** news")] });

    expect(screen.getByText("important", { selector: "strong" })).toBeTruthy();
  });

  it("renders underscore bold text", async () => {
    await openTimeline({ events: [message("this is __important__ news")] });

    expect(screen.getByText("important", { selector: "strong" })).toBeTruthy();
  });

  it("renders emphasised text", async () => {
    await openTimeline({ events: [message("this is *quite* nice")] });

    expect(screen.getByText("quite", { selector: "em" })).toBeTruthy();
  });

  it("renders underscore emphasis", async () => {
    await openTimeline({ events: [message("this is _quite_ nice")] });

    expect(screen.getByText("quite", { selector: "em" })).toBeTruthy();
  });

  it("renders a markdown link that opens in a new tab", async () => {
    await openTimeline({ events: [message("read [the docs](https://example.com/docs) first")] });
    const link = screen.getByRole("link", { name: "the docs" });

    expect([link.getAttribute("href"), link.getAttribute("target"), link.getAttribute("rel")]).toEqual([
      "https://example.com/docs",
      "_blank",
      "noreferrer",
    ]);
  });

  it("turns a bare URL into a link", async () => {
    await openTimeline({ events: [message("see https://example.com/status for more")] });

    expect(screen.getByRole("link", { name: "https://example.com/status" }).getAttribute("href")).toBe(
      "https://example.com/status",
    );
  });

  it("renders an image", async () => {
    await openTimeline({ events: [message("![diagram](https://example.com/d.png)")] });

    expect(screen.getByRole("img", { name: "diagram" }).getAttribute("src")).toBe("https://example.com/d.png");
  });

  it("renders a table", async () => {
    await openTimeline({ events: [message("| name | count |\n|------|-------|\n| apples | 3 |")] });

    expect(screen.getByRole("cell", { name: "apples" })).toBeTruthy();
  });

  it("renders strikethrough when the text also has a markdown hint", async () => {
    await openTimeline({ events: [message("**fixed** ~~broken~~")] });

    expect(screen.getByText("broken", { selector: "del" })).toBeTruthy();
  });
});

describe("Secret-input blocks in messages", () => {
  const tag = secretInputTag('package="github" key="TOKEN" label="GitHub token" submit-label="Store token" description="Needed to open pull requests"');

  it("renders a form with its label, target and description", async () => {
    await openTimeline({ events: [message(tag)] });

    expect([isShown("GitHub token"), isShown("github/TOKEN"), isShown("Needed to open pull requests")]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("uses the given submit label", async () => {
    await openTimeline({ events: [message(tag)] });

    expect(screen.getByRole("button", { name: "Store token" })).toBeTruthy();
  });

  it("falls back to a generated label and 'Save secret' when none are given", async () => {
    await openTimeline({ events: [message(secretInputTag('package="github" key="TOKEN"'))] });

    expect([isShown("Set secret TOKEN"), screen.queryByRole("button", { name: "Save secret" }) !== null]).toEqual([
      true,
      true,
    ]);
  });

  it("accepts name and packageid as alternative attribute names", async () => {
    await openTimeline({ events: [message(secretInputTag('packageid="aws" name="KEY"'))] });

    expect(isShown("aws/KEY")).toBe(true);
  });

  it("accepts single-quoted attribute values", async () => {
    await openTimeline({ events: [message(secretInputTag("package='aws' key='KEY'"))] });

    expect(isShown("aws/KEY")).toBe(true);
  });

  it("accepts the paired tag form", async () => {
    await openTimeline({
      events: [message('<orgops-secret-input package="aws" key="KEY"></orgops-secret-input>')],
    });

    expect(isShown("aws/KEY")).toBe(true);
  });

  it("renders no form when the tag has no key", async () => {
    await openTimeline({ events: [message(secretInputTag('package="github"'))] });

    expect(screen.queryByPlaceholderText("Enter secret value")).toBeNull();
  });

  it("renders no form when the tag has no package", async () => {
    await openTimeline({ events: [message(secretInputTag('key="TOKEN"'))] });

    expect(screen.queryByPlaceholderText("Enter secret value")).toBeNull();
  });

  it("keeps the text around the form", async () => {
    await openTimeline({ events: [message(`Please set it:\n\n${tag}\n\nThanks!`)] });

    expect([isShown("Please set it:"), isShown("Thanks!"), isShown("GitHub token")]).toEqual([true, true, true]);
  });

  it("keeps the save button disabled until a value is typed", async () => {
    await openTimeline({ events: [message(tag)] });

    expect(isDisabled("Store token")).toBe(true);
  });

  it("enables the save button once a value is typed", async () => {
    await openTimeline({ events: [message(tag)] });
    fillIn(screen.getByPlaceholderText("Enter secret value"), "ghp_123");

    expect(isDisabled("Store token")).toBe(false);
  });

  it("posts the secret with its package and key", async () => {
    const { requests } = await openTimeline({
      events: [message(tag)],
      routes: [{ method: "POST", path: "/api/secrets", respond: { json: { ok: true } } }],
    });
    fillIn(screen.getByPlaceholderText("Enter secret value"), "ghp_123");
    await press("Store token");

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/secrets",
      body: { package: "github", key: "TOKEN", value: "ghp_123" },
    });
  });

  it("includes the scope when the tag names one", async () => {
    const { requests } = await openTimeline({
      events: [message(secretInputTag('package="github" key="TOKEN" scope-type="AGENT" scope-id="helper"'))],
      routes: [{ method: "POST", path: "/api/secrets", respond: { json: { ok: true } } }],
    });
    fillIn(screen.getByPlaceholderText("Enter secret value"), "v");
    await press("Save secret");

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/secrets",
      body: { package: "github", key: "TOKEN", value: "v", scopeType: "AGENT", scopeId: "helper" },
    });
  });

  it("accepts scopetype and scopeid spellings", async () => {
    const { requests } = await openTimeline({
      events: [message(secretInputTag('package="github" key="TOKEN" scopetype="TEAM" scopeid="ops"'))],
      routes: [{ method: "POST", path: "/api/secrets", respond: { json: { ok: true } } }],
    });
    fillIn(screen.getByPlaceholderText("Enter secret value"), "v");
    await press("Save secret");

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/secrets",
      body: { package: "github", key: "TOKEN", value: "v", scopeType: "TEAM", scopeId: "ops" },
    });
  });

  it("confirms the save and clears the typed value", async () => {
    await openTimeline({
      events: [message(tag)],
      routes: [{ method: "POST", path: "/api/secrets", respond: { json: { ok: true } } }],
    });
    const input = screen.getByPlaceholderText("Enter secret value") as HTMLInputElement;
    fillIn(input, "ghp_123");
    await press("Store token");

    expect([isShown("Saved TOKEN."), input.value]).toEqual([true, ""]);
  });

  it("shows the server's message when saving fails", async () => {
    await openTimeline({
      events: [message(tag)],
      routes: [{ method: "POST", path: "/api/secrets", respond: { status: 403, text: "Not allowed" } }],
    });
    const input = screen.getByPlaceholderText("Enter secret value") as HTMLInputElement;
    fillIn(input, "ghp_123");
    await press("Store token");

    expect([isShown("Not allowed"), input.value]).toEqual([true, "ghp_123"]);
  });

  it("shows 'Saving...' while the secret is being sent", async () => {
    await openTimeline({
      events: [message(tag)],
      routes: [{ method: "POST", path: "/api/secrets", respond: () => new Promise(() => undefined) }],
    });
    fillIn(screen.getByPlaceholderText("Enter secret value"), "ghp_123");
    await press("Store token");

    expect(screen.getByRole("button", { name: "Saving..." })).toBeTruthy();
  });
});

describe("Json-render blocks in messages", () => {
  it("shows the json-render badge and the page content", async () => {
    await openBlock(pageWith({}, { title: "Survey", description: "Two quick questions" }));

    expect([isShown("json-render"), isShown("Survey"), isShown("Two quick questions")]).toEqual([true, true, true]);
  });

  it("keeps the text before and after the block", async () => {
    await openTimeline({
      events: [message("Before\n" + jsonRender(pageWith({}, { title: "Survey" })) + "\nAfter")],
    });

    expect([isShown("Before"), isShown("Survey"), isShown("After")]).toEqual([true, true, true]);
  });

  it("recognises a block fenced with tildes", async () => {
    await openTimeline({
      events: [message("~~~json-render\n" + JSON.stringify(pageWith({}, { title: "Tilde" })) + "\n~~~")],
    });

    expect(isShown("Tilde")).toBe(true);
  });

  it("recognises a block fenced with a longer fence", async () => {
    await openTimeline({
      events: [message("````json-render\n" + JSON.stringify(pageWith({}, { title: "Long" })) + "\n````")],
    });

    expect(isShown("Long")).toBe(true);
  });

  it("recognises a block whose fence info has extra words", async () => {
    await openTimeline({
      events: [message("```json-render v2\n" + JSON.stringify(pageWith({}, { title: "Extra" })) + "\n```")],
    });

    expect(isShown("Extra")).toBe(true);
  });

  it("recognises the fence name in any case", async () => {
    await openTimeline({
      events: [message("```JSON-Render\n" + JSON.stringify(pageWith({}, { title: "Upper" })) + "\n```")],
    });

    expect(isShown("Upper")).toBe(true);
  });

  it("renders an unclosed block up to the end of the message", async () => {
    await openTimeline({
      events: [message("```json-render\n" + JSON.stringify(pageWith({}, { title: "Open" })))],
    });

    expect(isShown("Open")).toBe(true);
  });

  it("does not treat a plain json fence as a block", async () => {
    await openTimeline({ events: [message("```json\n{\"root\":\"a\"}\n```")] });

    expect(isShown("json-render")).toBe(false);
  });

  it("does not treat a fence named json-render-draft as a block", async () => {
    await openTimeline({
      events: [message("```json-render-draft\n" + JSON.stringify(pageWith({}, { title: "Draft" })) + "\n```")],
    });

    expect(isShown("json-render")).toBe(false);
  });

  it("shows the raw text with an error when the spec is not valid JSON", async () => {
    await openTimeline({ events: [message("```json-render\n{not json\n```")] });

    expect([isShown("json-render preview failed"), preWithText("{not json")]).toEqual([true, true]);
  });

  it("shows an error when the spec is an array", async () => {
    await openTimeline({ events: [message("```json-render\n[1,2]\n```")] });

    expect(isShown("json-render spec must be an object")).toBe(true);
  });

  it("shows an error when the spec is null", async () => {
    await openTimeline({ events: [message("```json-render\nnull\n```")] });

    expect(isShown("json-render spec must be an object")).toBe(true);
  });

  it("uses the first element when the spec names no root", async () => {
    await openBlock({ elements: { first: { type: "Page", props: { title: "First" } } } });

    expect(isShown("First")).toBe(true);
  });

  it("says so when the spec has no elements", async () => {
    await openBlock({ elements: {} });

    expect(isShown("No root element in spec.")).toBe(true);
  });

  it("renders nothing for a root that does not exist", async () => {
    await openBlock({ root: "missing", elements: { other: { type: "Page", props: { title: "Other" } } } });

    expect([isShown("Other"), isShown("No root element in spec.")]).toEqual([false, false]);
  });

  it("renders a section with a heading and text", async () => {
    await openBlock(pageWith({ s: { type: "Section", props: { title: "Part one", description: "About it" } } }));

    expect([screen.getByRole("heading", { name: "Part one" }) !== null, isShown("About it")]).toEqual([true, true]);
  });

  it("renders unknown element types as cards", async () => {
    await openBlock(pageWith({ c: { type: "Gizmo", props: { title: "Mystery", text: "Body" } } }));

    expect([isShown("Mystery"), isShown("Body")]).toEqual([true, true]);
  });

  it("renders elements without a type as cards", async () => {
    await openBlock(pageWith({ c: { props: { title: "Untyped" } } }));

    expect(isShown("Untyped")).toBe(true);
  });

  it("reads props written directly on the element", async () => {
    await openBlock(pageWith({ s: { type: "Section", title: "Flat title" } }));

    expect(isShown("Flat title")).toBe(true);
  });

  it("prefers nested props over props written directly on the element", async () => {
    await openBlock(pageWith({ s: { type: "Section", title: "Flat", props: { title: "Nested" } } }));

    expect([isShown("Nested"), isShown("Flat")]).toEqual([true, false]);
  });

  it("falls back from title to label, heading and question", async () => {
    await openBlock(
      pageWith({
        a: { type: "Section", props: { label: "From label" } },
        b: { type: "Section", props: { heading: "From heading" } },
        c: { type: "Section", props: { question: "From question" } },
      }),
    );

    expect([isShown("From label"), isShown("From heading"), isShown("From question")]).toEqual([true, true, true]);
  });

  it("falls back from description to subtitle, body, text and helpText", async () => {
    await openBlock(
      pageWith({
        a: { type: "Section", props: { subtitle: "From subtitle" } },
        b: { type: "Section", props: { body: "From body" } },
        c: { type: "Section", props: { text: "From text" } },
        d: { type: "Section", props: { helpText: "From help" } },
      }),
    );

    expect([isShown("From subtitle"), isShown("From body"), isShown("From text"), isShown("From help")]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("renders children listed in slots", async () => {
    await openBlock(
      specOf("page", {
        page: { type: "Page", props: { title: "Shell" }, slots: { main: ["inner"] } },
        inner: { type: "Section", props: { title: "In a slot" } },
      }),
    );

    expect(isShown("In a slot")).toBe(true);
  });

  it("skips children that do not exist", async () => {
    await openBlock(
      specOf("page", {
        page: { type: "Page", props: { title: "Shell" }, children: ["ghost", "real"] },
        real: { type: "Section", props: { title: "Real one" } },
      }),
    );

    expect(isShown("Real one")).toBe(true);
  });

  it("renders a recommendation with its confidence", async () => {
    await openBlock(pageWith({ r: { type: "Recommendation", props: { title: "Use Postgres", confidence: "high" } } }));

    expect([isShown("Recommendation · high"), isShown("Use Postgres")]).toEqual([true, true]);
  });

  it("renders a recommendation without a confidence", async () => {
    await openBlock(pageWith({ r: { type: "Recommendation", props: { title: "Use Postgres" } } }));

    expect(isShown("Recommendation")).toBe(true);
  });

  it("accepts a score in place of a confidence", async () => {
    await openBlock(pageWith({ r: { type: "Recommendation", props: { score: "9/10" } } }));

    expect(isShown("Recommendation · 9/10")).toBe(true);
  });

  it("renders a checklist from text items", async () => {
    await openBlock(pageWith({ c: { type: "Checklist", props: { title: "Steps", items: ["Build", "Ship"] } } }));

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Build", "Ship"]);
  });

  it("renders a checklist from item objects and skips blank ones", async () => {
    await openBlock(
      pageWith({
        c: { type: "Checklist", props: { steps: [{ label: "Plan" }, { title: "Do" }, { text: "Review" }, {}] } },
      }),
    );

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Plan", "Do", "Review"]);
  });

  it("renders a question with its own placeholder", async () => {
    await openBlock(pageWith({ q: { type: "Question", props: { title: "Your name", placeholder: "Jane" } } }));

    expect([screen.getByLabelText("Your name") !== null, screen.getByPlaceholderText("Jane") !== null]).toEqual([
      true,
      true,
    ]);
  });

  it("renders a question with default title and placeholder", async () => {
    await openBlock(pageWith({ q: { type: "Question", props: {} } }));

    expect(screen.getByLabelText("Question").getAttribute("placeholder")).toBe("Type your answer...");
  });

  it("shows a question's description", async () => {
    await openBlock(pageWith({ q: { type: "Question", props: { title: "Name", description: "As on your badge" } } }));

    expect(isShown("As on your badge")).toBe(true);
  });

  it("keeps what is typed into a question", async () => {
    await openBlock(pageWith({ q: { type: "Question", props: { title: "Your name" } } }));
    fillIn(screen.getByLabelText("Your name"), "Jane");

    expect((screen.getByLabelText("Your name") as HTMLTextAreaElement).value).toBe("Jane");
  });

  it("renders a single-choice list as radio buttons", async () => {
    await openBlock(
      pageWith({ c: { type: "ChoiceList", props: { title: "Colour", options: ["Red", "Blue"] } } }),
    );

    expect(screen.getAllByRole("radio").map((radio) => radio.parentElement?.textContent)).toEqual(["Red", "Blue"]);
  });

  it("selects only one option in a single-choice list", async () => {
    await openBlock(pageWith({ c: { type: "ChoiceList", props: { options: ["Red", "Blue"] } } }));
    fireEvent.click(screen.getByRole("radio", { name: "Red" }));
    fireEvent.click(screen.getByRole("radio", { name: "Blue" }));

    expect(screen.getAllByRole("radio").map((radio) => (radio as HTMLInputElement).checked)).toEqual([false, true]);
  });

  it("renders a multiple-choice list as checkboxes that can be ticked together", async () => {
    await openBlock(pageWith({ c: { type: "ChoiceList", props: { multiple: true, options: ["Red", "Blue"] } } }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Red" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Blue" }));

    expect(screen.getAllByRole("checkbox").map((box) => (box as HTMLInputElement).checked)).toEqual([true, true]);
  });

  it("unticks a checkbox that is ticked again", async () => {
    await openBlock(pageWith({ c: { type: "ChoiceList", props: { multiple: true, options: ["Red", "Blue"] } } }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Red" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Red" }));

    expect((screen.getByRole("checkbox", { name: "Red" }) as HTMLInputElement).checked).toBe(false);
  });

  it("renders an integration picker as checkboxes with a default title", async () => {
    await openBlock(pageWith({ p: { type: "IntegrationPicker", props: { options: ["Slack"] } } }));

    expect([screen.getByRole("checkbox", { name: "Slack" }) !== null, isShown("Integrations")]).toEqual([true, true]);
  });

  it("gives a choice list a default title", async () => {
    await openBlock(pageWith({ c: { type: "ChoiceList", props: { options: ["Red"] } } }));

    expect(isShown("Choose an option")).toBe(true);
  });

  it("describes choice options from objects", async () => {
    await openBlock(
      pageWith({
        c: {
          type: "ChoiceList",
          props: { choices: [{ label: "Fast", value: "f", description: "Quick but rough" }, { title: "Slow" }, {}] },
        },
      }),
    );

    expect([isShown("Fast"), isShown("Quick but rough"), isShown("Slow")]).toEqual([true, true, true]);
  });

  it("reads choice options from items when there are no options or choices", async () => {
    await openBlock(pageWith({ c: { type: "ChoiceList", props: { items: ["Only"] } } }));

    expect(screen.getByRole("radio", { name: "Only" })).toBeTruthy();
  });

  it("says there is no chart data for an empty bar graph", async () => {
    await openBlock(pageWith({ g: { type: "BarGraph", props: { title: "Sales", data: [] } } }));

    expect([isShown("Sales"), isShown("No chart data.")]).toEqual([true, true]);
  });

  it("says there is no chart data for an empty line graph", async () => {
    await openBlock(pageWith({ g: { type: "LineGraph", props: { title: "Visits" } } }));

    expect(isShown("No chart data.")).toBe(true);
  });

  it("says there is no chart data when no point has a numeric value", async () => {
    await openBlock(pageWith({ g: { type: "BarGraph", props: { data: [{ label: "a", value: "x" }, "y", null] } } }));

    expect(isShown("No chart data.")).toBe(true);
  });

  it("draws a bar graph from numbers", async () => {
    await openBlock(pageWith({ g: { type: "BarGraph", props: { title: "Sales", data: [3, 5] } } }));

    expect(screen.getByRole("img", { name: "Sales" })).toBeTruthy();
  });

  it("draws a line graph from labelled points", async () => {
    await openBlock(
      pageWith({ g: { type: "LineGraph", props: { title: "Visits", values: [{ label: "Mon", y: 2 }] } } }),
    );

    expect(screen.getByRole("img", { name: "Visits" })).toBeTruthy();
  });

  it("names an untitled bar graph 'Bar chart'", async () => {
    await openBlock(pageWith({ g: { type: "BarGraph", props: { series: [{ x: "a", amount: 1 }] } } }));

    expect(screen.getByRole("img", { name: "Bar chart" })).toBeTruthy();
  });

  it("names an untitled line graph 'Line chart'", async () => {
    await openBlock(pageWith({ g: { type: "LineGraph", props: { data: [{ name: "a", count: 1 }] } } }));

    expect(screen.getByRole("img", { name: "Line chart" })).toBeTruthy();
  });
});

describe("Json-render actions", () => {
  const approve = pageWith({
    go: { type: "ActionButton", props: { title: "Approve", action: { name: "approve", params: { ticket: "T-1" } } } },
  });
  const postEvent: FakeRoute = { method: "POST", path: "/api/events", respond: { json: { ok: true } } };

  it("posts the action as a message from the operator", async () => {
    const { requests } = await openBlock(approve, { routes: [postEvent] });
    await press("Approve");

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/events",
      body: {
        type: "message.created",
        source: "human:alice",
        channelId: "channel-1",
        payload: {
          eventType: "ui.json-render.action",
          text: 'json-render action: approve\nelement: go\nparams: {\n  "ticket": "T-1"\n}\nformState: {}',
        },
      },
    });
  });

  it("includes what was typed into the form", async () => {
    const spec = pageWith({
      q: { type: "Question", props: { title: "Reason" } },
      go: { type: "ActionButton", props: { title: "Reply now", action: { name: "reply" } } },
    });
    const { requests } = await openBlock(spec, { routes: [postEvent] });
    fillIn(screen.getByLabelText("Reason"), "because");
    await press("Reply now");

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/events",
      body: {
        type: "message.created",
        source: "human:alice",
        channelId: "channel-1",
        payload: {
          eventType: "ui.json-render.action",
          text: 'json-render action: reply\nelement: go\nparams: {}\nformState: {\n  "q": "because"\n}',
        },
      },
    });
  });

  it("confirms the action was sent", async () => {
    await openBlock(approve, { routes: [postEvent] });
    await press("Approve");

    expect(isShown("Sent action: approve")).toBe(true);
  });

  it("shows the server's message when sending fails", async () => {
    await openBlock(approve, {
      routes: [{ method: "POST", path: "/api/events", respond: { status: 500, text: "Queue is full" } }],
    });
    await press("Approve");

    expect(isShown("Queue is full")).toBe(true);
  });

  it("shows 'Sending...' while the action is in flight", async () => {
    await openBlock(approve, {
      routes: [{ method: "POST", path: "/api/events", respond: () => new Promise(() => undefined) }],
    });
    await press("Approve");

    expect(isDisabled("Sending...")).toBe(true);
  });

  it("takes the action name from its type when it has no name", async () => {
    const spec = pageWith({ go: { type: "ActionButton", props: { title: "Go", action: { type: "launch" } } } });
    await openBlock(spec, { routes: [postEvent] });
    await press("Go");

    expect(isShown("Sent action: launch")).toBe(true);
  });

  it("takes the action name from the button title when the action has none", async () => {
    const spec = pageWith({ go: { type: "ActionButton", props: { title: "Launch it" } } });
    await openBlock(spec, { routes: [postEvent] });
    await press("Launch it");

    expect(isShown("Sent action: Launch it")).toBe(true);
  });

  it("uses a generic action name and label when the button has neither", async () => {
    const spec = pageWith({ go: { type: "ActionButton", props: {} } });
    await openBlock(spec, { routes: [postEvent] });
    await press("Run action");

    expect(isShown("Sent action: json_render_action")).toBe(true);
  });

  it("labels a button with the action name when it has no title", async () => {
    const spec = pageWith({ go: { type: "ActionButton", props: { action: { name: "deploy" } } } });
    await openBlock(spec);

    expect(screen.getByRole("button", { name: "deploy" })).toBeTruthy();
  });

  it("reads the action from onClick and the parameters from payload", async () => {
    const spec = pageWith({
      go: { type: "ActionButton", props: { title: "Go", onClick: { name: "act", payload: { a: 1 } } } },
    });
    const { requests } = await openBlock(spec, { routes: [postEvent] });
    await press("Go");

    expect(requests).toContainEqual(
      expect.objectContaining({
        body: expect.objectContaining({
          payload: expect.objectContaining({ text: 'json-render action: act\nelement: go\nparams: {\n  "a": 1\n}\nformState: {}' }),
        }),
      }),
    );
  });

  it("disables action buttons when the channel does not accept posts", async () => {
    await openBlock(approve, { channel: getMockChannel({ id: "channel-1", name: "general", canPost: false }) });

    expect(isDisabled("Approve")).toBe(true);
  });

  it("disables action buttons in an archived channel", async () => {
    await openBlock(approve, {
      channel: getMockChannel({ id: "channel-1", name: "general", archivedAt: 1_690_000_000_000 }),
      url: "/?channel=channel-1",
    });

    expect(isDisabled("Approve")).toBe(true);
  });

  it("enables action buttons in a channel that accepts posts", async () => {
    await openBlock(approve);

    expect(isDisabled("Approve")).toBe(false);
  });

  const saveSecret = pageWith({
    q: { type: "Question", props: { title: "Token" } },
    go: {
      type: "ActionButton",
      props: {
        title: "Save",
        action: { name: "secret.set", params: { package: "github", key: "TOKEN", valueField: "q" } },
      },
    },
  });
  const postSecret: FakeRoute = { method: "POST", path: "/api/secrets", respond: { json: { ok: true } } };

  it("saves a secret from a form field when the action is secret.set", async () => {
    const { requests } = await openBlock(saveSecret, { routes: [postSecret] });
    fillIn(screen.getByLabelText("Token"), "ghp_1");
    await press("Save");

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/secrets",
      body: { package: "github", key: "TOKEN", value: "ghp_1" },
    });
  });

  it("confirms the secret was saved", async () => {
    await openBlock(saveSecret, { routes: [postSecret] });
    fillIn(screen.getByLabelText("Token"), "ghp_1");
    await press("Save");

    expect(isShown("Saved secret: github/TOKEN")).toBe(true);
  });

  it("can save a secret even in a channel that does not accept posts", async () => {
    const { requests } = await openBlock(saveSecret, {
      routes: [postSecret],
      channel: getMockChannel({ id: "channel-1", name: "general", canPost: false }),
    });
    fillIn(screen.getByLabelText("Token"), "ghp_1");
    await press("Save");

    expect(requests.some((request) => request.path === "/api/secrets")).toBe(true);
  });

  it("recognises secrets.set and orgops.secret.set as secret actions", async () => {
    const spec = pageWith({
      a: { type: "ActionButton", props: { title: "A", action: { name: "secrets.set", params: { package: "p", key: "k", value: "v1" } } } },
      b: { type: "ActionButton", props: { title: "B", action: { name: " ORGOPS.secret.set ", params: { package: "p", key: "k2", value: "v2" } } } },
    });
    const { requests } = await openBlock(spec, { routes: [postSecret] });
    await press("A");
    await press("B");

    expect(requests.filter((request) => request.path === "/api/secrets").map((request) => request.body)).toEqual([
      { package: "p", key: "k", value: "v1" },
      { package: "p", key: "k2", value: "v2" },
    ]);
  });

  it("includes the scope from the action parameters", async () => {
    const spec = pageWith({
      go: {
        type: "ActionButton",
        props: {
          title: "Save",
          action: {
            name: "secret.set",
            params: { packageId: "p", name: "k", value: "v", scopeType: "AGENT", scopeId: "helper" },
          },
        },
      },
    });
    const { requests } = await openBlock(spec, { routes: [postSecret] });
    await press("Save");

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/secrets",
      body: { package: "p", key: "k", value: "v", scopeType: "AGENT", scopeId: "helper" },
    });
  });

  it("uses the only filled text field when the action names no value field", async () => {
    const spec = pageWith({
      q: { type: "Question", props: { title: "Token" } },
      go: { type: "ActionButton", props: { title: "Save", action: { name: "secret.set", params: { package: "p", key: "k" } } } },
    });
    const { requests } = await openBlock(spec, { routes: [postSecret] });
    fillIn(screen.getByLabelText("Token"), "only-one");
    await press("Save");

    expect(requests).toContainEqual({ method: "POST", path: "/api/secrets", body: { package: "p", key: "k", value: "only-one" } });
  });

  it("refuses to guess the value when two text fields are filled", async () => {
    const spec = pageWith({
      q1: { type: "Question", props: { title: "One" } },
      q2: { type: "Question", props: { title: "Two" } },
      go: { type: "ActionButton", props: { title: "Save", action: { name: "secret.set", params: { package: "p", key: "k" } } } },
    });
    await openBlock(spec, { routes: [postSecret] });
    fillIn(screen.getByLabelText("One"), "a");
    fillIn(screen.getByLabelText("Two"), "b");
    await press("Save");

    expect(isShown("Missing secret value. Provide action.params.valueField (or valueFrom) that points to a Question field.")).toBe(true);
  });

  it("does not use a single field when the action names a value field that is empty", async () => {
    const spec = pageWith({
      q1: { type: "Question", props: { title: "One" } },
      go: {
        type: "ActionButton",
        props: { title: "Save", action: { name: "secret.set", params: { package: "p", key: "k", valueFrom: "other" } } },
      },
    });
    const { requests } = await openBlock(spec, { routes: [postSecret] });
    fillIn(screen.getByLabelText("One"), "a");
    await press("Save");

    expect(requests.some((request) => request.path === "/api/secrets")).toBe(false);
  });

  it("explains that the package is missing", async () => {
    const spec = pageWith({
      go: { type: "ActionButton", props: { title: "Save", action: { name: "secret.set", params: { key: "k", value: "v" } } } },
    });
    await openBlock(spec, { routes: [postSecret] });
    await press("Save");

    expect(isShown("Missing secret package in action params.")).toBe(true);
  });

  it("explains that the key is missing", async () => {
    const spec = pageWith({
      go: { type: "ActionButton", props: { title: "Save", action: { name: "secret.set", params: { package: "p", value: "v" } } } },
    });
    await openBlock(spec, { routes: [postSecret] });
    await press("Save");

    expect(isShown("Missing secret key in action params.")).toBe(true);
  });

  it("shows the server's message when saving the secret fails", async () => {
    await openBlock(saveSecret, {
      routes: [{ method: "POST", path: "/api/secrets", respond: { status: 403, text: "Not allowed" } }],
    });
    fillIn(screen.getByLabelText("Token"), "ghp_1");
    await press("Save");

    expect(isShown("Not allowed")).toBe(true);
  });

  it("shows 'Saving...' while the secret is in flight", async () => {
    await openBlock(saveSecret, {
      routes: [{ method: "POST", path: "/api/secrets", respond: () => new Promise(() => undefined) }],
    });
    fillIn(screen.getByLabelText("Token"), "ghp_1");
    await press("Save");

    expect(isDisabled("Saving...")).toBe(true);
  });
});

describe("Json-render secret inputs", () => {
  const secretField = pageWith({
    s: { type: "SecretInput", props: { title: "API key", package: "stripe", key: "KEY" } },
  });
  const postSecret: FakeRoute = { method: "POST", path: "/api/secrets", respond: { json: { ok: true } } };

  it("shows the target and a default save label", async () => {
    await openBlock(secretField);

    expect([isShown("stripe/KEY"), screen.queryByRole("button", { name: "Save secret" }) !== null]).toEqual([true, true]);
  });

  it("shows placeholder names when package and key are missing", async () => {
    await openBlock(pageWith({ s: { type: "SecretInput", props: {} } }));

    expect(isShown("package/key")).toBe(true);
  });

  it("uses the given placeholder and submit label", async () => {
    await openBlock(
      pageWith({ s: { type: "SecretInput", props: { package: "p", key: "k", placeholder: "paste here", submitLabel: "Keep" } } }),
    );

    expect([screen.getByPlaceholderText("paste here") !== null, screen.getByRole("button", { name: "Keep" }) !== null]).toEqual([
      true,
      true,
    ]);
  });

  it("keeps the save button disabled until a value is typed", async () => {
    await openBlock(secretField);

    expect(isDisabled("Save secret")).toBe(true);
  });

  it("posts the typed value with its package and key", async () => {
    const { requests } = await openBlock(secretField, { routes: [postSecret] });
    fillIn(screen.getByPlaceholderText("Enter secret value"), "sk_live");
    await press("Save secret");

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/secrets",
      body: { package: "stripe", key: "KEY", value: "sk_live" },
    });
  });

  it("includes the scope from the element props", async () => {
    const spec = pageWith({
      s: { type: "SecretInput", props: { package: "p", key: "k", scopeType: "TEAM", scopeId: "ops" } },
    });
    const { requests } = await openBlock(spec, { routes: [postSecret] });
    fillIn(screen.getByPlaceholderText("Enter secret value"), "v");
    await press("Save secret");

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/secrets",
      body: { package: "p", key: "k", value: "v", scopeType: "TEAM", scopeId: "ops" },
    });
  });

  it("confirms the save and clears the field", async () => {
    await openBlock(secretField, { routes: [postSecret] });
    const input = screen.getByPlaceholderText("Enter secret value") as HTMLInputElement;
    fillIn(input, "sk_live");
    await press("Save secret");

    expect([isShown("Saved secret: stripe/KEY"), input.value]).toEqual([true, ""]);
  });

  it("explains that the package is missing", async () => {
    await openBlock(pageWith({ s: { type: "SecretInput", props: { key: "k" } } }));
    fillIn(screen.getByPlaceholderText("Enter secret value"), "v");
    await press("Save secret");

    expect(isShown("Missing secret package in SecretInput props.")).toBe(true);
  });

  it("explains that the key is missing", async () => {
    await openBlock(pageWith({ s: { type: "SecretInput", props: { package: "p" } } }));
    fillIn(screen.getByPlaceholderText("Enter secret value"), "v");
    await press("Save secret");

    expect(isShown("Missing secret key in SecretInput props.")).toBe(true);
  });

  it("takes the value from another field when valueField is set", async () => {
    const spec = pageWith({
      q: { type: "Question", props: { title: "Token" } },
      s: { type: "SecretInput", props: { package: "p", key: "k", valueField: "q" } },
    });
    const { requests } = await openBlock(spec, { routes: [postSecret] });
    fillIn(screen.getByLabelText("Token"), "from-question");
    fillIn(screen.getByPlaceholderText("Enter secret value"), "typed-here");
    await press("Save secret");

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/secrets",
      body: { package: "p", key: "k", value: "from-question" },
    });
  });

  it("asks for a value when the named value field is empty", async () => {
    const spec = pageWith({
      s: { type: "SecretInput", props: { package: "p", key: "k", valueField: "q" } },
    });
    await openBlock(spec, { routes: [postSecret] });
    fillIn(screen.getByPlaceholderText("Enter secret value"), "typed-here");
    await press("Save secret");

    expect(isShown("Enter a secret value before saving.")).toBe(true);
  });

  it("shows the server's message when saving fails", async () => {
    await openBlock(secretField, {
      routes: [{ method: "POST", path: "/api/secrets", respond: { status: 403, text: "Not allowed" } }],
    });
    fillIn(screen.getByPlaceholderText("Enter secret value"), "v");
    await press("Save secret");

    expect(isShown("Not allowed")).toBe(true);
  });

  it("shows 'Saving...' while the secret is in flight", async () => {
    await openBlock(secretField, {
      routes: [{ method: "POST", path: "/api/secrets", respond: () => new Promise(() => undefined) }],
    });
    fillIn(screen.getByPlaceholderText("Enter secret value"), "v");
    await press("Save secret");

    expect(isDisabled("Saving...")).toBe(true);
  });
});

describe("Agent turn failures", () => {
  const failure = (error: unknown, overrides?: Partial<EventRow>) =>
    trace("agent.turn.failed", { error }, { source: "agent:helper", ...overrides });

  const AUTH = {
    title: "Authentication failed",
    message: "The agent could not connect to its AI service because access is not configured. Contact your administrator.",
  };
  const CONFIG = {
    title: "Invalid configuration",
    message: "The agent is not set up correctly and cannot respond. Contact your administrator.",
  };
  const LIMIT = {
    title: "Usage limit reached",
    message:
      "The agent's AI service has reached its usage limit. Try again later. If the problem persists, contact your administrator.",
  };
  const DOWN = {
    title: "Service unavailable",
    message: "The agent's AI service is temporarily unavailable. Try again in a few minutes.",
  };
  const SLOW = {
    title: "Request timed out",
    message: "The agent took too long to respond. Try again or simplify your request.",
  };
  const RUNTIME = {
    title: "Runtime error",
    message: "The agent's runtime stopped with an error. Contact your administrator.",
  };
  const OTHER = {
    title: "Unexpected error",
    message: "The agent could not complete your request. Try again. If the problem persists, contact your administrator.",
  };

  it("shows a failed turn as a system message from the agent with its raw error", async () => {
    await openTimeline({ events: [failure("boom")] });
    const article = articleOf("boom");

    expect([within(article).getByText("System · helper") !== null, within(article).getByText("Technical details") !== null]).toEqual([
      true,
      true,
    ]);
  });

  it.each([
    { raw: "Missing API key for provider", expected: AUTH },
    { raw: "api_key not set", expected: AUTH },
    { raw: "api-key invalid", expected: AUTH },
    { raw: "apikey invalid", expected: AUTH },
    { raw: "Authentication error", expected: AUTH },
    { raw: "request was unauthorized", expected: AUTH },
    { raw: "Unauthorised", expected: AUTH },
    { raw: "HTTP 401", expected: AUTH },
    { raw: "HTTP 403 forbidden", expected: AUTH },
    { raw: "Invalid modelId gpt-9", expected: CONFIG },
    { raw: "Unsupported provider: acme", expected: CONFIG },
    { raw: "NoSuchModelError", expected: CONFIG },
    { raw: "model gpt-9 does not exist", expected: CONFIG },
    { raw: "the model x was not found", expected: CONFIG },
    { raw: "Unsupported wrapped harness", expected: CONFIG },
    { raw: "Missing wrappedConfig", expected: CONFIG },
    { raw: "HTTP 429", expected: LIMIT },
    { raw: "Rate limit exceeded", expected: LIMIT },
    { raw: "quota used up", expected: LIMIT },
    { raw: "insufficient funds", expected: LIMIT },
    { raw: "Your credit balance is too low", expected: LIMIT },
    { raw: "HTTP 500", expected: DOWN },
    { raw: "502 bad gateway", expected: DOWN },
    { raw: "HTTP 503", expected: DOWN },
    { raw: "504 gateway", expected: DOWN },
    { raw: "529 busy", expected: DOWN },
    { raw: "provider overloaded", expected: DOWN },
    { raw: "Service Unavailable", expected: DOWN },
    { raw: "connect ECONNREFUSED 127.0.0.1", expected: DOWN },
    { raw: "getaddrinfo ENOTFOUND api.example", expected: DOWN },
    { raw: "fetch failed", expected: DOWN },
    { raw: "cannot connect to host", expected: DOWN },
    { raw: "RetryError after 3 attempts", expected: DOWN },
    { raw: "The operation timed out", expected: SLOW },
    { raw: "Timeout while waiting", expected: SLOW },
    { raw: "wrapped runtime exited", expected: RUNTIME },
    { raw: "wrapped setup failed", expected: RUNTIME },
    { raw: "source checkout failed", expected: RUNTIME },
    { raw: "source update failed", expected: RUNTIME },
    { raw: "process terminated unexpectedly", expected: RUNTIME },
    { raw: "something odd happened", expected: OTHER },
    { raw: "error 4010 occurred", expected: OTHER },
    { raw: "error 5000 occurred", expected: OTHER },
    { raw: "error 4290 occurred", expected: OTHER },
  ])("classifies '$raw' as '$expected.title'", async ({ raw, expected }) => {
    await openTimeline({ events: [failure(raw)] });
    const article = articleOf(raw);

    expect([
      within(article).getByRole("heading", { name: expected.title }) !== null,
      within(article).getByText(expected.message) !== null,
    ]).toEqual([true, true]);
  });

  it.each([
    { raw: "401 unauthorized, then timed out", winner: AUTH.title },
    { raw: "model not found after 429", winner: CONFIG.title },
    { raw: "429 rate limit and service unavailable", winner: LIMIT.title },
    { raw: "503 timed out", winner: DOWN.title },
    { raw: "timeout in wrapped runtime", winner: SLOW.title },
    { raw: "api key rejected: invalid modelid", winner: AUTH.title },
  ])("picks the first matching rule for '$raw'", async ({ raw, winner }) => {
    await openTimeline({ events: [failure(raw)] });

    expect(within(articleOf(raw)).getByRole("heading").textContent).toBe(winner);
  });

  it("shows the raw error under the technical details", async () => {
    await openTimeline({ events: [failure("  spaced out error  ")] });

    expect(preWithText("spaced out error")).toBe(true);
  });

  it("falls back to the event's last error when the payload has no error text", async () => {
    await openTimeline({ events: [failure(undefined, { lastError: "  HTTP 503 from provider  " })] });

    expect([preWithText("HTTP 503 from provider"), isShown(DOWN.title)]).toEqual([true, true]);
  });

  it("falls back to the last error when the payload error is blank", async () => {
    await openTimeline({ events: [failure("   ", { lastError: "fetch failed" })] });

    expect(isShown(DOWN.title)).toBe(true);
  });

  it("falls back to a generic text when there is no error at all", async () => {
    await openTimeline({ events: [failure(undefined)] });

    expect([preWithText("Agent turn failed."), isShown(OTHER.title)]).toEqual([true, true]);
  });

  it("falls back to the generic text when the payload is missing", async () => {
    await openTimeline({ events: [trace("agent.turn.failed", undefined, { lastError: "  " })] });

    expect(preWithText("Agent turn failed.")).toBe(true);
  });

  it("ignores a payload error that is not text", async () => {
    await openTimeline({ events: [failure(503, { lastError: "timed out" })] });

    expect(isShown(SLOW.title)).toBe(true);
  });

  it("ends the thinking indicator and splits the trace around a failure", async () => {
    await openTimeline({
      events: [
        trace("agent.turn.started", {}, { createdAt: at(1) }),
        failure("boom", { createdAt: at(2) }),
        trace("tool.started", { tool: "fs_read" }, { createdAt: at(3) }),
      ],
    });

    expect([
      isShown("Agent is thinking..."),
      chipBefore("Agent is thinking", "boom") && textBeforeChip("boom", "fs_read started"),
    ]).toEqual([false, true]);
  });
});

describe("Trace chips", () => {
  it.each([
    { name: "turn started", type: "agent.turn.started", payload: {}, title: "Agent is thinking", code: "T" },
    { name: "turn completed", type: "agent.turn.completed", payload: {}, title: "Agent finished turn", code: "D" },
    { name: "turn phase", type: "agent.turn.phase", payload: { phase: "planning" }, title: "Agent phase: planning", code: "P" },
    { name: "turn phase in lower case", type: "agent.turn.phase", payload: { phase: "act" }, title: "Agent phase: act", code: "A" },
    { name: "turn phase without a phase", type: "agent.turn.phase", payload: {}, title: "Agent phase: progress", code: "P" },
    { name: "turn phase with a blank phase", type: "agent.turn.phase", payload: { phase: "" }, title: "Agent phase:", code: "P" },
    { name: "wrapped turn started", type: "wrapper.turn.started", payload: {}, title: "Wrapped turn started", code: "W" },
    { name: "wrapped turn completed", type: "wrapper.turn.completed", payload: {}, title: "Wrapped turn completed", code: "D" },
    { name: "wrapped turn failed", type: "wrapper.turn.failed", payload: {}, title: "Wrapped turn failed", code: "F" },
    { name: "process started", type: "process.started", payload: {}, title: "Wrapped process started", code: "P" },
    { name: "process exited with a code", type: "process.exited", payload: { exitCode: 0 }, title: "Wrapped process exited (0)", code: "X" },
    { name: "process exited without a code", type: "process.exited", payload: {}, title: "Wrapped process exited", code: "X" },
    { name: "process output", type: "process.output", payload: { stream: "STDOUT", seq: 3 }, title: "Wrapped output #3 (STDOUT)", code: "O" },
    { name: "process error output", type: "process.output", payload: { stream: "STDERR", seq: 4 }, title: "Wrapped output #4 (STDERR)", code: "!" },
    { name: "process output without details", type: "process.output", payload: {}, title: "Wrapped output (STDOUT)", code: "O" },
    { name: "process output with a stream only", type: "process.output", payload: { stream: "STDERR" }, title: "Wrapped output (STDERR)", code: "!" },
    { name: "process output with a sequence only", type: "process.output", payload: { seq: 0 }, title: "Wrapped output #0 (STDOUT)", code: "O" },
    { name: "tool started", type: "tool.started", payload: { tool: "fs_read" }, title: "fs_read started", code: "R" },
    { name: "tool executed", type: "tool.executed", payload: { tool: "fs_read" }, title: "fs_read completed", code: "E" },
    { name: "tool failed", type: "tool.failed", payload: { tool: "fs_read" }, title: "fs_read failed", code: "F" },
    { name: "tool without a name", type: "tool.started", payload: {}, title: "tool started", code: "R" },
    { name: "context usage", type: "telemetry.context.window.updated", payload: { estimatedUsedTokens: 1200, contextWindowTokens: 8000 }, title: "Context usage: 1200/8000 tokens", code: "C" },
    { name: "context usage with zero used", type: "telemetry.context.window.updated", payload: { estimatedUsedTokens: 0, contextWindowTokens: 8000 }, title: "Context usage: 0/8000 tokens", code: "C" },
    { name: "context usage with a missing total", type: "telemetry.context.window.updated", payload: { estimatedUsedTokens: 1200 }, title: "Context usage updated", code: "C" },
    { name: "context usage with a missing used count", type: "telemetry.context.window.updated", payload: { contextWindowTokens: 8000 }, title: "Context usage updated", code: "C" },
  ])("labels the chip for $name", async ({ type, payload, title, code }) => {
    await openTimeline({ events: [trace(type, payload)] });

    expect(screen.getByRole("button", { name: title }).textContent).toBe(code);
  });

  it("treats a non-object payload as empty when naming the chip", async () => {
    await openTimeline({ events: [trace("tool.executed", "plain")] });

    expect(screen.getByRole("button", { name: "tool completed" })).toBeTruthy();
  });

  it("treats a missing payload as empty when naming the chip", async () => {
    await openTimeline({ events: [trace("process.exited", undefined)] });

    expect(screen.getByRole("button", { name: "Wrapped process exited" })).toBeTruthy();
  });
});

describe("Trace detail expansion", () => {
  const detailOf = async (event: EventRow, chipName: string) => {
    await openTimeline({ events: [event] });
    await press(chipName);
  };

  it("shows no detail until a chip is clicked", async () => {
    await openTimeline({ events: [trace("tool.executed", { tool: "fs_read", output: "ok" })] });

    expect(isShown("fs_read completed")).toBe(false);
  });

  it("shows the chip's title with its detail when it is clicked", async () => {
    await detailOf(trace("tool.executed", { tool: "fs_read", output: "ok" }), "fs_read completed");

    expect([isShown("fs_read completed"), preWithText("output: ok")]).toEqual([true, true]);
  });

  it("hides the detail when the same chip is clicked again", async () => {
    await detailOf(trace("tool.executed", { tool: "fs_read", output: "ok" }), "fs_read completed");
    await press("fs_read completed");

    expect(isShown("fs_read completed")).toBe(false);
  });

  it("switches the detail to another chip", async () => {
    await openTimeline({
      events: [
        trace("tool.started", { tool: "fs_read", args: "a" }, { createdAt: at(1) }),
        trace("tool.executed", { tool: "fs_read", output: "b" }, { createdAt: at(2) }),
      ],
    });
    await press("fs_read started");
    await press("fs_read completed");

    expect([preWithText("args: a"), preWithText("output: b")]).toEqual([false, true]);
  });

  it("shows details for a chip in another trace group", async () => {
    await openTimeline({
      events: [
        trace("tool.started", { tool: "fs_read", args: "a" }, { createdAt: at(1) }),
        message("between", { createdAt: at(2) }),
        trace("tool.executed", { tool: "fs_read", output: "b" }, { createdAt: at(3) }),
      ],
    });
    await press("fs_read completed");

    expect(preWithText("output: b")).toBe(true);
  });

  it("shows tool arguments, output and error on separate lines", async () => {
    await detailOf(
      trace("tool.failed", { tool: "shell_run", args: { cmd: "ls" }, output: "partial", error: "denied" }),
      "shell_run failed",
    );

    expect(preWithText('args: {\n  "cmd": "ls"\n}\noutput: partial\nerror: denied')).toBe(true);
  });

  it("leaves out the tool fields that are missing", async () => {
    await detailOf(trace("tool.failed", { tool: "shell_run", error: "denied" }), "shell_run failed");

    expect(preWithText("error: denied")).toBe(true);
  });

  it("shows a text argument as it is", async () => {
    await detailOf(trace("tool.started", { tool: "shell_run", args: "ls -la" }), "shell_run started");

    expect(preWithText("args: ls -la")).toBe(true);
  });

  it("says there are no details for a tool event with nothing to show", async () => {
    await detailOf(trace("tool.started", { tool: "shell_run" }), "shell_run started");

    expect(isShown("No additional details.")).toBe(true);
  });

  it("ignores a tool error that is not text", async () => {
    await detailOf(trace("tool.failed", { tool: "shell_run", error: 500 }), "shell_run failed");

    expect(isShown("No additional details.")).toBe(true);
  });

  it("shows the text of process output", async () => {
    await detailOf(trace("process.output", { stream: "STDOUT", seq: 1, text: "hello\nworld" }), "Wrapped output #1 (STDOUT)");

    expect(preWithText("hello\nworld")).toBe(true);
  });

  it("shows the whole payload for process output without text", async () => {
    await detailOf(trace("process.output", { stream: "STDERR", seq: 2 }), "Wrapped output #2 (STDERR)");

    expect(preWithText('{\n  "stream": "STDERR",\n  "seq": 2\n}')).toBe(true);
  });

  it("shows the exit code of a finished process", async () => {
    await detailOf(trace("process.exited", { exitCode: 2, signal: null }), "Wrapped process exited (2)");

    expect(preWithText("exitCode: 2")).toBe(true);
  });

  it("shows the exit code zero", async () => {
    await detailOf(trace("process.exited", { exitCode: 0 }), "Wrapped process exited (0)");

    expect(preWithText("exitCode: 0")).toBe(true);
  });

  it("shows the whole payload for a process that ended without an exit code", async () => {
    await detailOf(trace("process.exited", { signal: "SIGKILL" }), "Wrapped process exited");

    expect(preWithText('{\n  "signal": "SIGKILL"\n}')).toBe(true);
  });

  it("shows the payload of other trace events as formatted JSON", async () => {
    await detailOf(trace("agent.turn.phase", { phase: "planning", step: 2 }), "Agent phase: planning");

    expect(preWithText('{\n  "phase": "planning",\n  "step": 2\n}')).toBe(true);
  });

  it("shows an empty payload as an empty object", async () => {
    await detailOf(trace("agent.turn.completed", {}), "Agent finished turn");

    expect(preWithText("{}")).toBe(true);
  });

  it("shows a text payload as it is", async () => {
    await detailOf(trace("wrapper.turn.started", "booting"), "Wrapped turn started");

    expect(preWithText("booting")).toBe(true);
  });

  it("says there are no details when there is no payload", async () => {
    await detailOf(trace("wrapper.turn.failed", undefined), "Wrapped turn failed");

    expect(isShown("No additional details.")).toBe(true);
  });
});

describe("Attachments on messages", () => {
  const withAttachments = (attachments: unknown) => message("See attached", { payload: { text: "See attached", attachments } });

  it("lists an attachment as a link to the file", async () => {
    await openTimeline({ events: [withAttachments([{ fileId: "f-1", name: "report.pdf" }])] });
    const link = screen.getByRole("link", { name: "report.pdf" });

    expect([link.getAttribute("href"), link.getAttribute("target"), link.getAttribute("rel"), isShown("Attachments")]).toEqual([
      "/api/files/f-1",
      "_blank",
      "noreferrer",
      true,
    ]);
  });

  it("shows no attachments section when there are none", async () => {
    await openTimeline({ events: [withAttachments([])] });

    expect(isShown("Attachments")).toBe(false);
  });

  it("encodes the file id in the link", async () => {
    await openTimeline({ events: [withAttachments([{ fileId: "a b/c", name: "x.txt" }])] });

    expect(screen.getByRole("link", { name: "x.txt" }).getAttribute("href")).toBe("/api/files/a%20b%2Fc");
  });

  it("names an attachment by its file id when it has no name", async () => {
    await openTimeline({ events: [withAttachments([{ fileId: "f-9" }])] });

    expect(screen.getByRole("link", { name: "f-9" })).toBeTruthy();
  });

  it("names an attachment by its file id when the name is blank", async () => {
    await openTimeline({ events: [withAttachments([{ fileId: "f-9", name: "   " }])] });

    expect(screen.getByRole("link", { name: "f-9" })).toBeTruthy();
  });

  it("trims the file id", async () => {
    await openTimeline({ events: [withAttachments([{ fileId: "  f-3  ", name: "a.txt" }])] });

    expect(screen.getByRole("link", { name: "a.txt" }).getAttribute("href")).toBe("/api/files/f-3");
  });

  it("skips entries without a usable file id", async () => {
    await openTimeline({
      events: [withAttachments([{ name: "no-id.txt" }, { fileId: "  ", name: "blank.txt" }, { fileId: 7, name: "num.txt" }, { fileId: "ok", name: "ok.txt" }])],
    });

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["ok.txt"]);
  });

  it("skips entries that are not objects", async () => {
    await openTimeline({ events: [withAttachments(["text", 5, null, { fileId: "ok", name: "ok.txt" }])] });

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["ok.txt"]);
  });

  it("ignores attachments that are not a list", async () => {
    await openTimeline({ events: [withAttachments({ fileId: "f-1", name: "x" })] });

    expect(isShown("Attachments")).toBe(false);
  });

  it("shows a message that has attachments but no text", async () => {
    await openTimeline({
      events: [message("x", { payload: { attachments: [{ fileId: "f-1", name: "only.bin" }] } })],
    });

    expect(isShown("only.bin")).toBe(true);
  });

  it("shows the type and size beside the name", async () => {
    await openTimeline({
      events: [withAttachments([{ fileId: "f-1", name: "r.pdf", mime: "application/pdf", size: 2048 }])],
    });

    expect(isShown("application/pdf • 2.0 KB")).toBe(true);
  });

  it("shows only the type when the size is unknown", async () => {
    await openTimeline({ events: [withAttachments([{ fileId: "f-1", name: "r.pdf", mime: " text/plain " }])] });

    expect(isShown("text/plain")).toBe(true);
  });

  it("shows only the size when the type is unknown", async () => {
    await openTimeline({ events: [withAttachments([{ fileId: "f-1", name: "r.pdf", size: 512 }])] });

    expect(isShown("512 B")).toBe(true);
  });

  it("shows the size alone without a separator when the type is blank", async () => {
    await openTimeline({ events: [withAttachments([{ fileId: "f-1", name: "r.pdf", mime: "  ", size: 512 }])] });

    expect(screen.getByText("512 B").textContent).toBe("512 B");
  });

  it("shows no details line when neither type nor size is known", async () => {
    await openTimeline({ events: [withAttachments([{ fileId: "f-1", name: "r.pdf" }])] });

    expect(screen.getByRole("link", { name: "r.pdf" }).parentElement?.querySelector("span")).toBeNull();
  });

  it("shows no size for an empty file", async () => {
    await openTimeline({ events: [withAttachments([{ fileId: "f-1", name: "r.pdf", mime: "text/plain", size: 0 }])] });

    expect(isShown("text/plain")).toBe(true);
  });

  it("shows no size for a negative size", async () => {
    await openTimeline({ events: [withAttachments([{ fileId: "f-1", name: "r.pdf", mime: "text/plain", size: -5 }])] });

    expect(isShown("text/plain")).toBe(true);
  });

  it("ignores a size that is not a number", async () => {
    await openTimeline({ events: [withAttachments([{ fileId: "f-1", name: "r.pdf", mime: "text/plain", size: "big" }])] });

    expect(isShown("text/plain")).toBe(true);
  });

  it.each([
    { size: 1, label: "1 B" },
    { size: 1023, label: "1023 B" },
    { size: 1024, label: "1.0 KB" },
    { size: 1536, label: "1.5 KB" },
    { size: 102_400, label: "100 KB" },
    { size: 1_048_575, label: "1024 KB" },
    { size: 1_048_576, label: "1.0 MB" },
    { size: 1_572_864, label: "1.5 MB" },
    { size: 104_857_600, label: "100 MB" },
    { size: 5_368_709_120, label: "5120 MB" },
  ])("shows a size of $size bytes as $label", async ({ size, label }) => {
    await openTimeline({ events: [withAttachments([{ fileId: "f-1", name: "r.bin", size }])] });

    expect(isShown(label)).toBe(true);
  });

  it("[quirk] shows a size just under 100 KB rounded up to '100.0 KB'", async () => {
    await openTimeline({ events: [withAttachments([{ fileId: "f-1", name: "r.bin", size: 102_399 }])] });

    expect(isShown("100.0 KB")).toBe(true);
  });

  it("lists several attachments in order", async () => {
    await openTimeline({
      events: [withAttachments([{ fileId: "a", name: "one.txt" }, { fileId: "b", name: "two.txt" }])],
    });

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["one.txt", "two.txt"]);
  });
});

describe("Sensitive messages", () => {
  const sensitive = (overrides: Partial<EventRow> = {}, extra: Record<string, unknown> = {}) =>
    message("Credentials attached", {
      payload: { text: "Credentials attached", sensitive: { ciphertextB64: "Zm9v", hint: "Ask ops", ...extra } },
      ...overrides,
    });
  const revealRoute = (response: FakeResponse | (() => Promise<FakeResponse>)): FakeRoute => ({
    method: "POST",
    path: "/api/events/message-Credentials%20attached/reveal-sensitive",
    respond: response,
  });
  const reveal = async (password: string) => {
    const article = articleOf("Credentials attached");
    fillIn(within(article).getByPlaceholderText("Enter your password"), password);
    await press("Reveal sensitive content", article);
  };

  it("shows a protected block with its hint instead of the content", async () => {
    await openTimeline({ events: [sensitive()] });
    const article = articleOf("Credentials attached");

    expect([
      within(article).getByText("Sensitive content") !== null,
      within(article).getByText("Protected") !== null,
      within(article).getByText("Ask ops") !== null,
    ]).toEqual([true, true, true]);
  });

  it("asks for the operator's password", async () => {
    await openTimeline({ events: [sensitive()] });

    expect(within(articleOf("Credentials attached")).getByPlaceholderText("Enter your password")).toBeTruthy();
  });

  it("shows no hint line when the message has no hint", async () => {
    await openTimeline({
      events: [message("Credentials attached", { payload: { text: "Credentials attached", sensitive: { ciphertextB64: "Zm9v" } } })],
    });

    expect(within(articleOf("Credentials attached")).queryByText("Ask ops")).toBeNull();
  });

  it("shows a message without a sensitive block as plain", async () => {
    await openTimeline({ events: [message("Plain words")] });

    expect(isShown("Sensitive content")).toBe(false);
  });

  it("does not treat an empty ciphertext as sensitive", async () => {
    await openTimeline({
      events: [message("Plain words", { payload: { text: "Plain words", sensitive: { ciphertextB64: "   " } } })],
    });

    expect(isShown("Sensitive content")).toBe(false);
  });

  it("does not treat a missing ciphertext as sensitive", async () => {
    await openTimeline({
      events: [message("Plain words", { payload: { text: "Plain words", sensitive: { hint: "x" } } })],
    });

    expect(isShown("Sensitive content")).toBe(false);
  });

  it("does not treat a non-object sensitive field as sensitive", async () => {
    await openTimeline({
      events: [message("Plain words", { payload: { text: "Plain words", sensitive: ["Zm9v"] } })],
    });

    expect(isShown("Sensitive content")).toBe(false);
  });

  it("does not treat a null sensitive field as sensitive", async () => {
    await openTimeline({
      events: [message("Plain words", { payload: { text: "Plain words", sensitive: null } })],
    });

    expect(isShown("Sensitive content")).toBe(false);
  });

  it("[quirk] still asks for a password when the message says none is required", async () => {
    await openTimeline({ events: [sensitive({}, { requiresPassword: false })] });

    expect(within(articleOf("Credentials attached")).getByPlaceholderText("Enter your password")).toBeTruthy();
  });

  it("keeps the reveal button disabled until a password is typed", async () => {
    await openTimeline({ events: [sensitive()] });

    expect(isDisabled("Reveal sensitive content")).toBe(true);
  });

  it("enables the reveal button once a password is typed", async () => {
    await openTimeline({ events: [sensitive()] });
    fillIn(within(articleOf("Credentials attached")).getByPlaceholderText("Enter your password"), "pw");

    expect(isDisabled("Reveal sensitive content")).toBe(false);
  });

  it("sends the password to the reveal endpoint for that message", async () => {
    const { requests } = await openTimeline({
      events: [sensitive()],
      routes: [revealRoute({ json: { text: "s3cret" } })],
    });
    await reveal("hunter2");

    expect(requests).toContainEqual({
      method: "POST",
      path: "/api/events/message-Credentials%20attached/reveal-sensitive",
      body: { password: "hunter2" },
    });
  });

  it("shows the revealed content with a hide button", async () => {
    await openTimeline({ events: [sensitive()], routes: [revealRoute({ json: { text: "s3cret value" } })] });
    await reveal("hunter2");

    expect([preWithText("s3cret value"), screen.queryByRole("button", { name: "Hide sensitive content" }) !== null]).toEqual([
      true,
      true,
    ]);
  });

  it("replaces the password form with the revealed content", async () => {
    await openTimeline({ events: [sensitive()], routes: [revealRoute({ json: { text: "s3cret value" } })] });
    await reveal("hunter2");

    expect(screen.queryByPlaceholderText("Enter your password")).toBeNull();
  });

  it("keeps the hint visible after the reveal", async () => {
    await openTimeline({ events: [sensitive()], routes: [revealRoute({ json: { text: "s3cret value" } })] });
    await reveal("hunter2");

    expect(isShown("Ask ops")).toBe(true);
  });

  it("renders revealed markdown", async () => {
    await openTimeline({ events: [sensitive()], routes: [revealRoute({ json: { text: "# Vault entry" } })] });
    await reveal("hunter2");

    expect(screen.getByRole("heading", { name: "Vault entry" })).toBeTruthy();
  });

  it("renders a revealed link that opens in a new tab", async () => {
    await openTimeline({
      events: [sensitive()],
      routes: [revealRoute({ json: { text: "login at [the vault](https://vault.example.com)" } })],
    });
    await reveal("hunter2");
    const link = screen.getByRole("link", { name: "the vault" });

    expect([link.getAttribute("href"), link.getAttribute("target"), link.getAttribute("rel")]).toEqual([
      "https://vault.example.com",
      "_blank",
      "noreferrer",
    ]);
  });

  it("renders a revealed secret-input form", async () => {
    await openTimeline({
      events: [sensitive()],
      routes: [revealRoute({ json: { text: secretInputTag('package="vault" key="ROOT"') } })],
    });
    await reveal("hunter2");

    expect(isShown("vault/ROOT")).toBe(true);
  });

  it("posts a revealed secret-input form's value", async () => {
    const { requests } = await openTimeline({
      events: [sensitive()],
      routes: [
        revealRoute({ json: { text: secretInputTag('package="vault" key="ROOT"') } }),
        { method: "POST", path: "/api/secrets", respond: { json: { ok: true } } },
      ],
    });
    await reveal("hunter2");
    fillIn(screen.getByPlaceholderText("Enter secret value"), "v");
    await press("Save secret");

    expect(requests).toContainEqual({ method: "POST", path: "/api/secrets", body: { package: "vault", key: "ROOT", value: "v" } });
  });

  it("renders a revealed json-render block", async () => {
    await openTimeline({
      events: [sensitive()],
      routes: [revealRoute({ json: { text: jsonRender(pageWith({}, { title: "Revealed form" })) } })],
    });
    await reveal("hunter2");

    expect(isShown("Revealed form")).toBe(true);
  });

  it("lets a revealed json-render action post to the channel", async () => {
    const { requests } = await openTimeline({
      events: [sensitive()],
      routes: [
        revealRoute({
          json: { text: jsonRender(pageWith({ go: { type: "ActionButton", props: { title: "Confirm", action: { name: "ok" } } } })) },
        }),
        { method: "POST", path: "/api/events", respond: { json: { ok: true } } },
      ],
    });
    await reveal("hunter2");
    await press("Confirm");

    expect(requests).toContainEqual(
      expect.objectContaining({ method: "POST", path: "/api/events", body: expect.objectContaining({ channelId: "channel-1", source: "human:alice" }) }),
    );
  });

  it("disables revealed json-render actions in a channel that does not accept posts", async () => {
    await openTimeline({
      events: [sensitive()],
      channel: getMockChannel({ id: "channel-1", name: "general", canPost: false }),
      routes: [
        revealRoute({
          json: { text: jsonRender(pageWith({ go: { type: "ActionButton", props: { title: "Confirm", action: { name: "ok" } } } })) },
        }),
      ],
    });
    await reveal("hunter2");

    expect(isDisabled("Confirm")).toBe(true);
  });

  it("hides the content again and asks for the password anew", async () => {
    await openTimeline({ events: [sensitive()], routes: [revealRoute({ json: { text: "s3cret value" } })] });
    await reveal("hunter2");
    await press("Hide sensitive content");

    expect([preWithText("s3cret value"), isDisabled("Reveal sensitive content")]).toEqual([false, true]);
  });

  it("clears the typed password after a successful reveal", async () => {
    await openTimeline({ events: [sensitive()], routes: [revealRoute({ json: { text: "s3cret value" } })] });
    await reveal("hunter2");
    await press("Hide sensitive content");

    expect((screen.getByPlaceholderText("Enter your password") as HTMLInputElement).value).toBe("");
  });

  it("reveals only the message that was asked about", async () => {
    await openTimeline({
      events: [
        sensitive(),
        message("Other secret", {
          createdAt: at(2),
          payload: { text: "Other secret", sensitive: { ciphertextB64: "YmFy" } },
        }),
      ],
      routes: [revealRoute({ json: { text: "s3cret value" } })],
    });
    await reveal("hunter2");

    expect(within(articleOf("Other secret")).queryByPlaceholderText("Enter your password")).not.toBeNull();
  });

  it("shows the server's message when the password is wrong", async () => {
    await openTimeline({ events: [sensitive()], routes: [revealRoute({ status: 403, text: "Wrong password" })] });
    await reveal("nope");

    expect([isShown("Wrong password"), preWithText("s3cret value")]).toEqual([true, false]);
  });

  it("falls back to the request status when the server gives no message", async () => {
    await openTimeline({ events: [sensitive()], routes: [revealRoute({ status: 500 })] });
    await reveal("nope");

    expect(isShown("Request failed: 500")).toBe(true);
  });

  it("says nothing was returned when the server sends no content", async () => {
    await openTimeline({ events: [sensitive()], routes: [revealRoute({ json: {} })] });
    await reveal("hunter2");

    expect(isShown("No sensitive content was returned.")).toBe(true);
  });

  it("says nothing was returned when the content is not text", async () => {
    await openTimeline({ events: [sensitive()], routes: [revealRoute({ json: { text: 12 } })] });
    await reveal("hunter2");

    expect(isShown("No sensitive content was returned.")).toBe(true);
  });

  it("keeps the typed password after a failed reveal", async () => {
    await openTimeline({ events: [sensitive()], routes: [revealRoute({ status: 403, text: "Wrong password" })] });
    await reveal("nope");

    expect((screen.getByPlaceholderText("Enter your password") as HTMLInputElement).value).toBe("nope");
  });

  it("clears the error as soon as the operator types again", async () => {
    await openTimeline({ events: [sensitive()], routes: [revealRoute({ status: 403, text: "Wrong password" })] });
    await reveal("nope");
    fillIn(screen.getByPlaceholderText("Enter your password"), "nope2");

    expect(isShown("Wrong password")).toBe(false);
  });

  it("shows 'Revealing...' and blocks a second attempt while waiting", async () => {
    await openTimeline({ events: [sensitive()], routes: [revealRoute(() => new Promise(() => undefined))] });
    await reveal("hunter2");

    expect(isDisabled("Revealing...")).toBe(true);
  });

  it("clears the previous error while the next attempt is in flight", async () => {
    const attempts: string[] = [];
    await openTimeline({
      events: [sensitive()],
      routes: [
        revealRoute(() => {
          attempts.push("attempt");
          return attempts.length === 1
            ? Promise.resolve({ status: 403, text: "Wrong password" })
            : new Promise(() => undefined);
        }),
      ],
    });
    await reveal("nope");
    await press("Reveal sensitive content");

    expect(isShown("Wrong password")).toBe(false);
  });
});

describe("Agent is thinking", () => {
  const started = (id: string, step: number) => trace("agent.turn.started", {}, { id, createdAt: at(step) });
  const completed = (id: string, step: number) => trace("agent.turn.completed", {}, { id, createdAt: at(step) });
  const failed = (id: string, step: number) => trace("agent.turn.failed", { error: "x" }, { id, createdAt: at(step) });

  it("shows the indicator while a turn has started and not finished", async () => {
    await openTimeline({ events: [started("a", 1)] });

    expect(isShown("Agent is thinking...")).toBe(true);
  });

  it("does not show the indicator when there is no turn", async () => {
    await openTimeline({ events: [message("hi")] });

    expect(isShown("Agent is thinking...")).toBe(false);
  });

  it("hides the indicator once the turn completes", async () => {
    await openTimeline({ events: [started("a", 1), completed("b", 2)] });

    expect(isShown("Agent is thinking...")).toBe(false);
  });

  it("hides the indicator once the turn fails", async () => {
    await openTimeline({ events: [started("a", 1), failed("b", 2)] });

    expect(isShown("Agent is thinking...")).toBe(false);
  });

  it("keeps the indicator while one of two turns is still running", async () => {
    await openTimeline({ events: [started("a", 1), started("b", 2), completed("c", 3)] });

    expect(isShown("Agent is thinking...")).toBe(true);
  });

  it("hides the indicator once both turns finish", async () => {
    await openTimeline({ events: [started("a", 1), started("b", 2), completed("c", 3), failed("d", 4)] });

    expect(isShown("Agent is thinking...")).toBe(false);
  });

  it("shows the indicator for a new turn after an earlier one finished", async () => {
    await openTimeline({ events: [started("a", 1), completed("b", 2), started("c", 3)] });

    expect(isShown("Agent is thinking...")).toBe(true);
  });

  it("does not let an unmatched completion cancel a later turn", async () => {
    await openTimeline({ events: [completed("a", 1), started("b", 2)] });

    expect(isShown("Agent is thinking...")).toBe(true);
  });

  it("does not let two unmatched completions cancel a later turn", async () => {
    await openTimeline({ events: [completed("a", 1), failed("b", 2), started("c", 3)] });

    expect(isShown("Agent is thinking...")).toBe(true);
  });

  it("is not affected by wrapper turn events", async () => {
    await openTimeline({ events: [trace("wrapper.turn.started", {})] });

    expect(isShown("Agent is thinking...")).toBe(false);
  });
});

describe("Offline agent hint", () => {
  const agentParticipant = (name: string, subscriberType = "AGENT") => ({ subscriberType, subscriberId: name });
  const channelWith = (...participants: ReturnType<typeof agentParticipant>[]) =>
    getMockChannel({ id: "channel-1", name: "general", participants });

  it("names a participating agent that is not running", async () => {
    await openTimeline({
      channel: channelWith(agentParticipant("helper")),
      agents: [getMockAgent({ name: "helper", runtimeState: "STOPPED" })],
    });

    expect(isShown("helper is off — will reply once started.")).toBe(true);
  });

  it("names several offline agents in the plural", async () => {
    await openTimeline({
      channel: channelWith(agentParticipant("helper"), agentParticipant("scout")),
      agents: [getMockAgent({ name: "helper", runtimeState: "STOPPED" }), getMockAgent({ id: "agent-2", name: "scout", runtimeState: "ERROR" })],
    });

    expect(isShown("helper, scout are off — will reply once started.")).toBe(true);
  });

  it("names only the agents that are off", async () => {
    await openTimeline({
      channel: channelWith(agentParticipant("helper"), agentParticipant("scout")),
      agents: [getMockAgent({ name: "helper", runtimeState: "RUNNING" }), getMockAgent({ id: "agent-2", name: "scout", runtimeState: "STOPPED" })],
    });

    expect(isShown("scout is off — will reply once started.")).toBe(true);
  });

  it("shows no hint when every agent is running", async () => {
    await openTimeline({
      channel: channelWith(agentParticipant("helper")),
      agents: [getMockAgent({ name: "helper", runtimeState: "RUNNING" })],
    });

    expect(screen.queryByText(/will reply once started/)).toBeNull();
  });

  it("treats an agent the server does not list as off", async () => {
    await openTimeline({ channel: channelWith(agentParticipant("ghost")), agents: [] });

    expect(isShown("ghost is off — will reply once started.")).toBe(true);
  });

  it("treats an agent with no runtime state as off", async () => {
    await openTimeline({
      channel: channelWith(agentParticipant("helper")),
      agents: [getMockAgent({ name: "helper", runtimeState: undefined })],
    });

    expect(isShown("helper is off — will reply once started.")).toBe(true);
  });

  it("matches the participant type in any case", async () => {
    await openTimeline({ channel: channelWith(agentParticipant("helper", " agent ")), agents: [] });

    expect(isShown("helper is off — will reply once started.")).toBe(true);
  });

  it("ignores human participants", async () => {
    await openTimeline({ channel: channelWith(agentParticipant("bob", "HUMAN")), agents: [] });

    expect(screen.queryByText(/will reply once started/)).toBeNull();
  });

  it("shows no hint in a channel without participants", async () => {
    await openTimeline({ agents: [getMockAgent({ name: "helper", runtimeState: "STOPPED" })] });

    expect(screen.queryByText(/will reply once started/)).toBeNull();
  });
});
