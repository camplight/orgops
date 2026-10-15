import { describe, expect, it, vi } from "vitest";
import {
  getMockAgent,
  getMockChannelRecord,
  getMockEvent,
  getMockExecutor,
  getMockSkillRoot,
} from "./factories";
import { useFakeNetwork } from "./lifecycle";
import { createFakeOrgops } from "./orgops-api";
import { createFakeProvider, replyWithEvent } from "./provider";
import { server } from "./server";
import type { Agent, Event } from "../types";
import type { ChannelRecord } from "../models/channel";

vi.mock("../wrapped-runtime", () => ({ runWrappedAgentTurn: vi.fn() }));
vi.mock("../rlm-process", () => ({ runRlmEventInChild: vi.fn() }));

useFakeNetwork();

type PromptTelemetry = {
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
};

type RunTurnOptions = {
  agent?: Partial<Agent>;
  events?: Event[];
  channels?: ChannelRecord[];
  channelHistory?: Event[];
  skillRoots?: string[];
};

const runTurn = async (options: RunTurnOptions = {}) => {
  const {
    agent,
    events = [getMockEvent()],
    channels = [getMockChannelRecord()],
    channelHistory,
    skillRoots = [],
  } = options;
  const orgops = createFakeOrgops({ channels, channelHistory });
  const provider = createFakeProvider([
    replyWithEvent({ type: "message.created", payload: { text: "hi" } }),
  ]);
  server.use(...orgops.handlers, provider.handler);
  await getMockExecutor({ skillRoots: skillRoots.map((path) => ({ path })) })(
    getMockAgent(agent),
    events,
  );
  const emitted = orgops.emitted();
  const telemetry = emitted.find((event) => event.type === "telemetry.prompt.composed")!
    .payload as PromptTelemetry;
  return { emitted, provider, telemetry, systemPrompt: telemetry.systemPrompt };
};

const GUIDANCE_START = "- You are running inside OrgOps' agent-runner and receive events per channels.";
const skillRootsLine = (roots: string) =>
  `- Skills root folder paths for resolving skill-relative references: ${roots}\n- When creating/updating skills`;

describe("System prompt section order", () => {
  it("orders instructions, runner guidance, workspace, project root, channel context, soul, skills, preloaded skills", async () => {
    const root = getMockSkillRoot([{ name: "alpha" }]);

    const { systemPrompt } = await runTurn({
      agent: {
        soulContents: "Be kind.",
        enabledSkills: ["alpha"],
        alwaysPreloadedSkills: ["alpha"],
      },
      skillRoots: [root],
    });

    const markers = [
      "You are alice.",
      GUIDANCE_START,
      "Your own workspace:\n/workspaces/alice\n",
      "OrgOps system path:\n/orgops\n",
      'Current channel context:\n{\n  "id": "chan-1"',
      "Your soul:\nBe kind.",
      "Your skills:\nalpha | ",
      "Always pre-loaded skills (full SKILL.md contents):\n# alpha\n",
    ];
    const positions = markers.map((marker) => systemPrompt.indexOf(marker));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("starts with the agent instructions followed by the runner guidance", async () => {
    const { systemPrompt } = await runTurn();

    expect(systemPrompt.startsWith(`You are alice.\n\n${GUIDANCE_START}\n`)).toBe(true);
  });

  it("renders the workspace, project root and channel sections joined by blank lines", async () => {
    const { systemPrompt } = await runTurn();

    expect(systemPrompt).toContain(
      "\n\nYour own workspace:\n/workspaces/alice\n\n\nOrgOps system path:\n/orgops\n\n\nCurrent channel context:\n{",
    );
  });

  it("sends the composed system prompt to the provider and records it in the prompt telemetry", async () => {
    const { systemPrompt, provider, telemetry } = await runTurn({
      agent: { memoryContextMode: "FULL_CHANNEL_EVENTS" },
      channelHistory: [getMockEvent({ id: "evt-0", createdAt: 5 })],
    });

    expect(provider.requests[0]!.messages[0]).toEqual({ role: "system", content: systemPrompt });
    expect(telemetry.messages[0]).toEqual({ role: "system", content: systemPrompt });
  });
});

describe("Channel context", () => {
  it("renders the resolved channel record as indented JSON", async () => {
    const record = getMockChannelRecord({ name: "ops" });

    const { systemPrompt } = await runTurn({ channels: [record] });

    expect(systemPrompt).toContain(`Current channel context:\n${JSON.stringify(record, null, 2)}`);
  });

  it("renders an unknown channel as its id marked unresolved", async () => {
    const { systemPrompt } = await runTurn({ channels: [] });

    expect(systemPrompt).toContain(
      'Current channel context:\n{\n  "id": "chan-1",\n  "unresolved": true\n}',
    );
  });

  it("uses the trigger channel of the last event for the channel context", async () => {
    const { systemPrompt } = await runTurn({
      channels: [getMockChannelRecord({ id: "chan-1" }), getMockChannelRecord({ id: "chan-2", name: "other" })],
      events: [getMockEvent({ id: "evt-1", channelId: "chan-1" }), getMockEvent({ id: "evt-2", channelId: "chan-2" })],
    });

    expect(systemPrompt).toContain('"id": "chan-2"');
    expect(systemPrompt).not.toContain('"id": "chan-1"');
  });
});

describe("Soul section", () => {
  it("adds the soul contents under a soul heading", async () => {
    const { systemPrompt } = await runTurn({ agent: { soulContents: "Be kind." } });

    expect(systemPrompt).toContain("\n\nYour soul:\nBe kind.\n\nYour skills:");
  });

  it("omits the soul section when the soul is empty", async () => {
    const { systemPrompt } = await runTurn({ agent: { soulContents: "" } });

    expect(systemPrompt).not.toContain("Your soul:");
    expect(systemPrompt).toContain("\n  ]\n}\n\nYour skills:");
  });

  it("omits the soul section when the agent has no soul contents", async () => {
    const { systemPrompt } = await runTurn({ agent: { soulContents: undefined } });

    expect(systemPrompt).not.toContain("Your soul:");
    expect(systemPrompt).toContain("\n  ]\n}\n\nYour skills:");
  });
});

describe("Skills section", () => {
  it("ends with an empty skills heading when the agent has no skills", async () => {
    const { systemPrompt } = await runTurn();

    expect(systemPrompt.endsWith("\n\nYour skills:\n")).toBe(true);
    expect(systemPrompt).not.toContain("Always pre-loaded skills");
  });

  it("indexes an enabled skill as name, description and SKILL.md path", async () => {
    const root = getMockSkillRoot([{ name: "alpha", description: "Does alpha things" }]);

    const { systemPrompt } = await runTurn({
      agent: { enabledSkills: ["alpha"] },
      skillRoots: [root],
    });

    expect(systemPrompt).toContain(
      `\n\nYour skills:\nalpha | Does alpha things | ${root}/alpha/SKILL.md`,
    );
    expect(systemPrompt.endsWith(`${root}/alpha/SKILL.md`)).toBe(true);
  });

  it("indexes several enabled skills one per line", async () => {
    const root = getMockSkillRoot([
      { name: "alpha", description: "First" },
      { name: "beta", description: "Second" },
    ]);

    const { systemPrompt } = await runTurn({
      agent: { enabledSkills: ["alpha", "beta"] },
      skillRoots: [root],
    });

    const indexLines = systemPrompt.split("\nYour skills:\n")[1]!.split("\n");
    expect([...indexLines].sort()).toEqual([
      `alpha | First | ${root}/alpha/SKILL.md`,
      `beta | Second | ${root}/beta/SKILL.md`,
    ]);
  });

  it("leaves skills that are on disk but not enabled out of the index", async () => {
    const root = getMockSkillRoot([{ name: "alpha" }, { name: "beta" }]);

    const { systemPrompt } = await runTurn({
      agent: { enabledSkills: ["alpha"] },
      skillRoots: [root],
    });

    expect(systemPrompt).toContain("alpha | ");
    expect(systemPrompt).not.toContain("beta");
  });

  it("indexes no skills when the agent has no enabled skills", async () => {
    const root = getMockSkillRoot([{ name: "alpha" }]);

    const { systemPrompt } = await runTurn({ skillRoots: [root] });

    expect(systemPrompt.endsWith("\n\nYour skills:\n")).toBe(true);
  });

  it("ignores an enabled skill name that exists in no root", async () => {
    const root = getMockSkillRoot([{ name: "alpha" }]);

    const { systemPrompt } = await runTurn({
      agent: { enabledSkills: ["ghost"] },
      skillRoots: [root],
    });

    expect(systemPrompt).not.toContain("ghost");
    expect(systemPrompt.endsWith("\n\nYour skills:\n")).toBe(true);
  });

  it("skips an enabled skill whose directory has no SKILL.md without failing the turn", async () => {
    const root = getMockSkillRoot([{ name: "alpha" }, { name: "hollow", withSkillFile: false }]);

    const { systemPrompt, emitted } = await runTurn({
      agent: { enabledSkills: ["alpha", "hollow"], alwaysPreloadedSkills: ["hollow"] },
      skillRoots: [root],
    });

    expect(systemPrompt).not.toContain("hollow");
    expect(systemPrompt).not.toContain("Always pre-loaded skills");
    expect(emitted.map((event) => event.type)).toContain("agent.turn.completed");
  });
});

describe("Always-preloaded skills", () => {
  it("adds the full SKILL.md text of an enabled, always-preloaded skill under its name", async () => {
    const root = getMockSkillRoot([{ name: "alpha", description: "Does alpha", body: "Alpha body text" }]);

    const { systemPrompt } = await runTurn({
      agent: { enabledSkills: ["alpha"], alwaysPreloadedSkills: ["alpha"] },
      skillRoots: [root],
    });

    expect(systemPrompt).toContain(
      "\n\nAlways pre-loaded skills (full SKILL.md contents):\n# alpha\n---\nname: alpha\ndescription: Does alpha\n---\nAlpha body text\n",
    );
  });

  it("separates several preloaded skills with a blank line", async () => {
    const root = getMockSkillRoot([
      { name: "alpha", body: "Alpha body" },
      { name: "beta", body: "Beta body" },
    ]);

    const { systemPrompt } = await runTurn({
      agent: { enabledSkills: ["alpha", "beta"], alwaysPreloadedSkills: ["alpha", "beta"] },
      skillRoots: [root],
    });

    expect(systemPrompt).toContain("Alpha body\n\n\n# beta\n");
    expect(systemPrompt).toContain("# beta\n---\nname: beta");
  });

  it("keeps the body of an enabled skill that is not preloaded out of the prompt", async () => {
    const root = getMockSkillRoot([{ name: "alpha", body: "Alpha body text" }]);

    const { systemPrompt } = await runTurn({
      agent: { enabledSkills: ["alpha"] },
      skillRoots: [root],
    });

    expect(systemPrompt).toContain("alpha | ");
    expect(systemPrompt).not.toContain("Alpha body text");
    expect(systemPrompt).not.toContain("Always pre-loaded skills");
  });

  it("ignores a preloaded skill that is not enabled", async () => {
    const root = getMockSkillRoot([{ name: "alpha", body: "Alpha body text" }]);

    const { systemPrompt } = await runTurn({
      agent: { alwaysPreloadedSkills: ["alpha"] },
      skillRoots: [root],
    });

    expect(systemPrompt).not.toContain("alpha");
    expect(systemPrompt).not.toContain("Always pre-loaded skills");
  });
});

describe("Skill roots", () => {
  it("lists the runner skill roots in the guidance", async () => {
    const first = getMockSkillRoot();
    const second = getMockSkillRoot();

    const { systemPrompt } = await runTurn({ skillRoots: [first, second] });

    expect(systemPrompt).toContain(skillRootsLine(`${first}, ${second}`));
  });

  it("says no root is configured when there are none", async () => {
    const { systemPrompt } = await runTurn();

    expect(systemPrompt).toContain(skillRootsLine("(none configured)"));
  });

  it("trims whitespace around runner roots and uses the trimmed path for skills", async () => {
    const root = getMockSkillRoot([{ name: "alpha" }]);

    const { systemPrompt } = await runTurn({
      agent: { enabledSkills: ["alpha"] },
      skillRoots: [`  ${root}\t`],
    });

    expect(systemPrompt).toContain(skillRootsLine(root));
    expect(systemPrompt).toContain(`alpha | alpha description | ${root}/alpha/SKILL.md`);
  });

  it("drops blank runner roots", async () => {
    const root = getMockSkillRoot();

    const { systemPrompt } = await runTurn({ skillRoots: ["", "   ", root] });

    expect(systemPrompt).toContain(skillRootsLine(root));
  });

  it("de-duplicates runner roots that are equal after trimming", async () => {
    const root = getMockSkillRoot();

    const { systemPrompt } = await runTurn({ skillRoots: [root, ` ${root} `, root] });

    expect(systemPrompt).toContain(skillRootsLine(root));
  });

  it("puts the agent's additional roots after the runner roots", async () => {
    const runnerRoot = getMockSkillRoot();
    const additionalRoot = getMockSkillRoot();

    const { systemPrompt } = await runTurn({
      agent: { additionalSkillRoots: [additionalRoot] },
      skillRoots: [runnerRoot],
    });

    expect(systemPrompt).toContain(skillRootsLine(`${runnerRoot}, ${additionalRoot}`));
  });

  it("trims, drops blanks and de-duplicates the agent's additional roots, also against the runner roots", async () => {
    const runnerRoot = getMockSkillRoot();
    const additionalRoot = getMockSkillRoot();

    const { systemPrompt } = await runTurn({
      agent: {
        additionalSkillRoots: [` ${runnerRoot} `, "", "  ", `  ${additionalRoot}`, additionalRoot],
      },
      skillRoots: [runnerRoot],
    });

    expect(systemPrompt).toContain(skillRootsLine(`${runnerRoot}, ${additionalRoot}`));
  });

  it("finds skills in the agent's additional roots", async () => {
    const additionalRoot = getMockSkillRoot([{ name: "beta", description: "From extra root" }]);

    const { systemPrompt } = await runTurn({
      agent: { enabledSkills: ["beta"], additionalSkillRoots: [additionalRoot] },
    });

    expect(systemPrompt).toContain(`beta | From extra root | ${additionalRoot}/beta/SKILL.md`);
  });

  it("prefers the runner root's skill over an additional root's skill of the same name", async () => {
    const runnerRoot = getMockSkillRoot([{ name: "alpha", description: "Runner version" }]);
    const additionalRoot = getMockSkillRoot([{ name: "alpha", description: "Agent version" }]);

    const { systemPrompt } = await runTurn({
      agent: { enabledSkills: ["alpha"], additionalSkillRoots: [additionalRoot] },
      skillRoots: [runnerRoot],
    });

    expect(systemPrompt).toContain(`alpha | Runner version | ${runnerRoot}/alpha/SKILL.md`);
    expect(systemPrompt).not.toContain("Agent version");
  });

  it("[quirk] keeps two spellings of the same directory as separate roots", async () => {
    const root = getMockSkillRoot();

    const { systemPrompt } = await runTurn({ skillRoots: [root, `${root}/`] });

    expect(systemPrompt).toContain(skillRootsLine(`${root}, ${root}/`));
  });
});

describe("Skill event shapes", () => {
  it("accepts an event type defined by an enabled skill's event shapes", async () => {
    const root = getMockSkillRoot([
      {
        name: "shapely",
        eventShapesFile: {
          filename: "event-shapes.js",
          contents:
            'export const eventShapes = [{ type: "shapely.ping", description: "Ping", payloadSchema: { safeParse: (value) => ({ success: true, data: value }) } }];',
        },
      },
    ]);
    const orgops = createFakeOrgops({ channels: [getMockChannelRecord()] });
    const provider = createFakeProvider([replyWithEvent({ type: "shapely.ping", payload: {} })]);
    server.use(...orgops.handlers, provider.handler);

    await getMockExecutor({ skillRoots: [{ path: root }] })(
      getMockAgent({ enabledSkills: ["shapely"] }),
      [getMockEvent()],
    );

    expect(provider.requests).toHaveLength(1);
    expect(orgops.emitted().map((event) => event.type)).toContain("shapely.ping");
  });

  it("lists only core event types in the runner guidance, not the enabled skill's", async () => {
    const root = getMockSkillRoot([
      {
        name: "shapely",
        eventShapesFile: {
          filename: "event-shapes.js",
          contents:
            'export const eventShapes = [{ type: "shapely.ping", description: "Ping", payloadSchema: { safeParse: (value) => ({ success: true, data: value }) } }];',
        },
      },
    ]);

    const { systemPrompt } = await runTurn({
      agent: { enabledSkills: ["shapely"] },
      skillRoots: [root],
    });

    expect(systemPrompt).toContain("  - message.created: ");
    expect(systemPrompt).not.toContain("shapely.ping");
  });

  it("warns about an event-shapes file that fails to load and still completes the turn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const root = getMockSkillRoot([
      {
        name: "broken",
        eventShapesFile: { filename: "event-shapes.js", contents: 'throw new Error("boom");' },
      },
    ]);

    const { emitted } = await runTurn({
      agent: { enabledSkills: ["broken"] },
      skillRoots: [root],
    });

    expect(warn).toHaveBeenCalledWith("skill event shape load errors", [
      { skill: "broken", error: "Error: boom" },
    ]);
    expect(emitted.map((event) => event.type)).toEqual([
      "agent.turn.started",
      "telemetry.prompt.composed",
      "telemetry.context.window.updated",
      "telemetry.context.window.updated",
      "message.created",
      "agent.turn.completed",
    ]);
  });

  it("warns about an event-shapes file without usable exports", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const root = getMockSkillRoot([
      {
        name: "empty",
        eventShapesFile: { filename: "event-shapes.js", contents: "export const eventShapes = [];" },
      },
    ]);

    await runTurn({ agent: { enabledSkills: ["empty"] }, skillRoots: [root] });

    expect(warn).toHaveBeenCalledWith("skill event shape load errors", [
      {
        skill: "empty",
        error:
          "event-shapes module found but no valid shape exports (expected eventShapes/default array).",
      },
    ]);
  });

  it("does not load event shapes of a skill that is not enabled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const root = getMockSkillRoot([
      {
        name: "broken",
        eventShapesFile: { filename: "event-shapes.js", contents: 'throw new Error("boom");' },
      },
    ]);

    await runTurn({ skillRoots: [root] });

    expect(warn).not.toHaveBeenCalledWith("skill event shape load errors", expect.anything());
  });

  it("does not warn when every event-shapes file loads", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await runTurn();

    expect(warn).not.toHaveBeenCalledWith("skill event shape load errors", expect.anything());
  });
});

describe("Merged trigger message", () => {
  it("adds no merged message for a single event", async () => {
    const { telemetry } = await runTurn({
      agent: { memoryContextMode: "OFF" },
      events: [getMockEvent()],
    });

    expect(telemetry.messages.map((message) => message.role)).toEqual(["system"]);
  });

  it("appends one system.pending.events.merged message after the history for several events", async () => {
    const history = getMockEvent({ id: "evt-0", createdAt: 5, payload: { text: "earlier" } });
    const first = getMockEvent({ id: "evt-1", source: "human:admin", payload: { text: "one" }, createdAt: 10 });
    const second = getMockEvent({
      id: "evt-2",
      type: "noop",
      source: "agent:bob",
      payload: undefined,
      createdAt: 20,
    });

    const { telemetry } = await runTurn({
      agent: { memoryContextMode: "FULL_CHANNEL_EVENTS" },
      channelHistory: [history],
      events: [first, second],
    });

    expect(telemetry.messages.map((message) => message.role)).toEqual(["system", "user", "system"]);
    expect(telemetry.messages[1]!.content).toContain('"eventId": "evt-0"');
    expect(JSON.parse(telemetry.messages[2]!.content)).toEqual({
      type: "system.pending.events.merged",
      mergedCount: 2,
      newestEventId: "evt-2",
      events: [
        {
          eventId: "evt-1",
          type: "message.created",
          source: "human:admin",
          channelId: "chan-1",
          payload: { text: "one" },
          createdAt: 10,
        },
        {
          eventId: "evt-2",
          type: "noop",
          source: "agent:bob",
          channelId: "chan-1",
          payload: {},
          createdAt: 20,
        },
      ],
    });
  });

  it("renders the merged message as indented JSON", async () => {
    const { telemetry } = await runTurn({
      agent: { memoryContextMode: "OFF" },
      events: [getMockEvent({ id: "evt-1" }), getMockEvent({ id: "evt-2" })],
    });

    const merged = telemetry.messages[1]!.content;
    expect(merged).toBe(JSON.stringify(JSON.parse(merged), null, 2));
  });

  it("[quirk] reaches the provider inside the system message, ahead of the history", async () => {
    const { provider, telemetry } = await runTurn({
      agent: { memoryContextMode: "FULL_CHANNEL_EVENTS" },
      channelHistory: [getMockEvent({ id: "evt-0", createdAt: 5 })],
      events: [getMockEvent({ id: "evt-1" }), getMockEvent({ id: "evt-2" })],
    });

    const [system, ...rest] = provider.requests[0]!.messages;
    expect(system!.content).toBe(`${telemetry.messages[0]!.content}\n\n${telemetry.messages[2]!.content}`);
    expect(rest.map((message) => message.role)).toEqual(["user"]);
  });
});
