import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generate } from "@orgops/llm";
import { createTurnExecutor, normalizeFallbackMessageText } from "./turn-executor";
import type { Agent } from "./types";

vi.mock("@orgops/llm", () => ({ generate: vi.fn() }));

const { executeToolMock, createRunnerToolsMock } = vi.hoisted(() => ({
  executeToolMock: vi.fn(async () => ({ ok: true })),
  createRunnerToolsMock: vi.fn(() => ({})),
}));
vi.mock("./tools", () => ({
  createRunnerTools: createRunnerToolsMock,
  executeTool: executeToolMock,
}));

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

describe("createTurnExecutor multi-root CLASSIC wiring", () => {
  it("indexes, preloads, validates, and grants only selected non-conflicting skill paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-turn-skills-"));
    const builtInRoot = join(root, "built-in");
    const externalRoot = join(root, "external", "skills");
    const repositoryPath = join(root, "external");
    const managementPath = join(builtInRoot, "private-skill-repository");
    const externalSkillPath = join(externalRoot, "external-workflow");
    const duplicateBuiltInPath = join(builtInRoot, "duplicate");
    const duplicateExternalPath = join(externalRoot, "duplicate");
    const writeSkill = (path: string, name: string, body: string) => {
      mkdirSync(path, { recursive: true });
      writeFileSync(
        join(path, "SKILL.md"),
        ["---", `name: ${name}`, `description: ${name} skill`, "---", body].join("\n"),
        "utf-8",
      );
    };
    writeSkill(managementPath, "private-skill-repository", "# Management");
    writeSkill(externalSkillPath, "external-workflow", "# External workflow body");
    writeSkill(duplicateBuiltInPath, "duplicate", "# Built-in duplicate");
    writeSkill(duplicateExternalPath, "duplicate", "# External duplicate");
    writeFileSync(
      join(externalSkillPath, "event-shapes.ts"),
      [
        "export const eventShapes = [{",
        '  type: "external.workflow.completed",',
        '  description: "External workflow completed",',
        "  payloadExample: { ok: true },",
        "}];",
      ].join("\n"),
      "utf-8",
    );

    const previousRepositoryPath = process.env.PRIVATE_SKILLS_REPO_PATH;
    process.env.PRIVATE_SKILLS_REPO_PATH = repositoryPath;
    const generated = vi.mocked(generate);
    generated.mockResolvedValue({
      text: JSON.stringify({
        type: "message.created",
        payload: { text: "done" },
      }),
    } as never);
    executeToolMock.mockClear();
    createRunnerToolsMock.mockClear();

    const emitted: unknown[] = [];
    const api = {
      apiFetch: async () => Response.json([]),
      emitEvent: async (event: unknown) => {
        emitted.push(event);
      },
      listChannels: async () => [],
      getChannelRecord: async () => ({ id: "channel-1" }),
      getChannelParticipationValidationError: async () => null,
      ensureLifecycleChannel: async () => "lifecycle",
      getPackageSecretsEnv: async () => ({}),
    };
    const agent: Agent = {
      name: "multi-root-agent",
      systemInstructions: "Follow the enabled skills.",
      soulPath: "",
      workspacePath: root,
      enabledSkills: ["private-skill-repository", "external-workflow", "duplicate"],
      alwaysPreloadedSkills: ["external-workflow"],
      memoryContextMode: "OFF",
      modelId: "stub:model",
      desiredState: "RUNNING",
      runtimeState: "RUNNING",
    };

    try {
      const executeTurn = createTurnExecutor({
        projectRoot: root,
        skillRoots: [
          { path: builtInRoot, kind: "BUILT_IN" },
          { path: externalRoot, kind: "EXTERNAL" },
        ],
        llmCallTimeoutMs: 1_000,
        api,
      });
      await executeTurn(agent, [
        {
          id: "event-1",
          type: "message.created",
          payload: { text: "start" },
          source: "human:test",
          channelId: "channel-1",
        },
      ]);

      expect(generated).toHaveBeenCalledOnce();
      const [_modelId, messages, options] = generated.mock.calls[0]!;
      const systemPrompt = String(messages[0]?.content);
      expect(systemPrompt).toContain("external-workflow");
      expect(systemPrompt).toContain(join(externalSkillPath, "SKILL.md"));
      expect(systemPrompt).toContain("# external-workflow");
      expect(systemPrompt).toContain("External workflow body");
      expect(systemPrompt).not.toContain("duplicate");
      expect(options).toEqual(expect.objectContaining({ tools: {} }));

      const runnerDeps = (
        createRunnerToolsMock.mock.calls as unknown as Array<
          [{ runTool: (tool: string, args: Record<string, unknown>) => Promise<unknown> }]
        >
      )[0]![0];
      await runnerDeps.runTool("events_event_types", {});
      const executeContext = (
        executeToolMock.mock.calls as unknown as Array<[
          {
            extraAllowedRoots: string[];
            listEventTypes: (input: { source: string }) => unknown[];
          },
        ]>
      )[0]![0];
      expect(executeContext.extraAllowedRoots).toHaveLength(3);
      expect(executeContext.extraAllowedRoots).toEqual(
        expect.arrayContaining([managementPath, externalSkillPath, repositoryPath + "/skills"]),
      );
      expect(executeContext.listEventTypes({ source: "skill:external-workflow" })).toEqual([
        expect.objectContaining({ type: "external.workflow.completed" }),
      ]);
      expect(executeContext.listEventTypes({ source: "skill:duplicate" })).toEqual([]);
      expect(emitted.some((event: any) => event.type === "message.created")).toBe(true);
    } finally {
      if (previousRepositoryPath === undefined) delete process.env.PRIVATE_SKILLS_REPO_PATH;
      else process.env.PRIVATE_SKILLS_REPO_PATH = previousRepositoryPath;
      rmSync(root, { recursive: true, force: true });
      generated.mockReset();
      executeToolMock.mockReset();
      createRunnerToolsMock.mockReset();
    }
  });
});
