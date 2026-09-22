import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  generate: vi.fn(),
  runRlmEventInChild: vi.fn(),
}));
vi.mock("@orgops/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@orgops/llm")>()),
  generate: runtimeMocks.generate,
}));
vi.mock("./rlm-process", () => ({ runRlmEventInChild: runtimeMocks.runRlmEventInChild }));

import { createTurnExecutor, normalizeFallbackMessageText } from "./turn-executor";
import type { RuntimeGeneration } from "@orgops/schemas";
import type { Agent, Event } from "./types";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
beforeEach(() => {
  runtimeMocks.generate.mockReset();
  runtimeMocks.runRlmEventInChild.mockReset();
});

async function generationFixture(): Promise<{ legacyRoot: string; generation: RuntimeGeneration }> {
  const root = await mkdtemp(join(tmpdir(), "orgops-turn-generation-"));
  temporaryRoots.push(root);
  const legacyRoot = join(root, "legacy");
  const skillRoot = join(root, "skill");
  const promptRoot = join(root, "prompt");
  const eventShapeRoot = join(root, "event-shape");
  await mkdir(legacyRoot);
  for (const [currentRoot, body] of [[skillRoot, "SKILL ROOT BODY"], [promptRoot, "PROMPT ROOT BODY"], [eventShapeRoot, "EVENT ROOT BODY"]]) {
    const directory = join(currentRoot, "alpha");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "SKILL.md"), `---\nname: alpha\ndescription: Alpha generation skill.\n---\n${body}\n`);
  }
  await writeFile(join(eventShapeRoot, "alpha", "event-shapes.js"), "export const eventShapes = [{ type: 'alpha.done', description: 'Generation event.' }];\n");
  return { legacyRoot, generation: Object.freeze({ generation: "generation-a", skillRoot, promptRoot, eventShapeRoot }) };
}

function executorFixture(legacyRoot: string) {
  const emitted: Array<Record<string, unknown>> = [];
  const execute = createTurnExecutor({
    projectRoot: "/project",
    skillRoot: { path: legacyRoot },
    llmCallTimeoutMs: 1_000,
    api: {
      apiFetch: async () => new Response(JSON.stringify([]), { headers: { "content-type": "application/json" } }),
      emitEvent: async (value: Record<string, unknown>) => { emitted.push(value); return value as never; },
      listChannels: async () => [],
      getChannelRecord: async (channelId: string) => ({ id: channelId }),
      getChannelParticipationValidationError: async () => null,
      ensureLifecycleChannel: async () => "lifecycle",
      getPackageSecretsEnv: async () => ({}),
    } as any,
  });
  const agent: Agent = {
    id: "agent-a",
    name: "alpha",
    mode: "CLASSIC",
    systemInstructions: "SYSTEM",
    soulPath: "",
    enabledSkills: ["alpha"],
    alwaysPreloadedSkills: ["alpha"],
    workspacePath: "/workspace",
    modelId: "openai:gpt-4o-mini",
    desiredState: "RUNNING",
    runtimeState: "RUNNING",
    memoryContextMode: "OFF",
  };
  const event: Event = { id: "event-a", type: "message.created", source: "human:admin", channelId: "channel-a", payload: { text: "run" }, createdAt: 1 };
  return { execute, emitted, agent, event };
}

describe("turn generation roots", () => {
  it("uses the supplied generation roots through the CLASSIC prompt and event validation path", async () => {
    const { legacyRoot, generation } = await generationFixture();
    const fixture = executorFixture(legacyRoot);
    runtimeMocks.generate.mockResolvedValue({
      text: JSON.stringify({ type: "alpha.done", payload: {}, source: "agent:alpha", channelId: "channel-a" }),
      finishReason: "stop",
    });

    await fixture.execute(fixture.agent, [fixture.event], generation);

    const messages = runtimeMocks.generate.mock.calls[0]![1] as Array<{ role: string; content: string }>;
    const system = String(messages[0]!.content);
    expect(system).toContain(join(generation.skillRoot, "alpha", "SKILL.md"));
    expect(system).toContain("PROMPT ROOT BODY");
    expect(system).not.toContain("SKILL ROOT BODY");
    expect(fixture.emitted).toContainEqual(expect.objectContaining({ type: "alpha.done", channelId: "channel-a" }));
  });

  it("uses the supplied generation roots before dispatching the RLM_REPL path", async () => {
    const { legacyRoot, generation } = await generationFixture();
    const fixture = executorFixture(legacyRoot);
    fixture.agent.mode = "RLM_REPL";
    runtimeMocks.runRlmEventInChild.mockResolvedValue(undefined);

    await fixture.execute(fixture.agent, [fixture.event], generation);

    const input = runtimeMocks.runRlmEventInChild.mock.calls[0]![0];
    expect(input.systemPrompt).toContain(join(generation.skillRoot, "alpha", "SKILL.md"));
    expect(input.systemPrompt).toContain("PROMPT ROOT BODY");
    expect(input.executeCtx.extraAllowedRoots).toEqual([join(generation.skillRoot, "alpha")]);
    expect(input.executeCtx.validateEvent({ type: "alpha.done", payload: {}, source: "agent:alpha", channelId: "channel-a" }).ok).toBe(true);
  });
});

describe("normalizeFallbackMessageText", () => {
  it("extracts payload.text from JSON event output", () => {
    const raw = JSON.stringify(
      {
        type: "message.created",
        payload: { text: "clean fallback text" },
      },
      null,
      2,
    );

    expect(normalizeFallbackMessageText(raw)).toBe("clean fallback text");
  });

  it("extracts payload.text from fenced JSON event output", () => {
    const raw = [
      "```json",
      '{ "type": "message.created", "payload": { "text": "from fenced json" } }',
      "```",
    ].join("\n");

    expect(normalizeFallbackMessageText(raw)).toBe("from fenced json");
  });

  it("returns a friendly error for JSON without payload.text", () => {
    const raw = JSON.stringify(
      {
        type: "message.created",
        payload: { eventType: "status" },
      },
      null,
      2,
    );

    expect(normalizeFallbackMessageText(raw)).toContain("response-format issue");
  });

  it("keeps plain text unchanged", () => {
    expect(normalizeFallbackMessageText("plain fallback text")).toBe("plain fallback text");
  });
});
