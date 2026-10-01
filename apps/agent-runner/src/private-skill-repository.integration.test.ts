import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { discoverSkills, resolveSkillRoots } from "@orgops/skills";
import { generate } from "@orgops/llm";
import { createTurnExecutor } from "./turn-executor";
import type { Agent } from "./types";
import { resolvePrivateSkillRepositoryAccess } from "./private-skill-repository-access";
import { runRepositoryCommand } from "../../../skills/private-skill-repository/assets/manage-repository";

vi.mock("@orgops/llm", () => ({ generate: vi.fn() }));

const { executeToolMock, createRunnerToolsMock } = vi.hoisted(() => ({
  executeToolMock: vi.fn(async () => ({ ok: true })),
  createRunnerToolsMock: vi.fn((input: unknown) => input),
}));
vi.mock("./tools", () => ({
  createRunnerTools: createRunnerToolsMock,
  executeTool: executeToolMock,
}));

function writeSkill(root: string, name: string, description: string, eventType?: string) {
  const skillDir = join(root, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    [`---`, `name: ${name}`, `description: ${description}`, `---`, `# ${name}`].join("\n"),
  );
  if (eventType) {
    writeFileSync(
      join(skillDir, "event-shapes.ts"),
      `export const eventShapes = [{ type: "${eventType}", description: "fixture event", payloadExample: { ok: true } }];\n`,
    );
  }
}

describe("private skill repository integration boundary", () => {
  it("syncs an offline checkout into discovery, access, preload, event shapes, and duplicate handling", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "orgops-private-project-"));
    const gitRoot = mkdtempSync(join(tmpdir(), "orgops-private-git-"));
    const remote = join(gitRoot, "remote.git");
    const seed = join(gitRoot, "seed");
    const checkout = join(gitRoot, "checkout");
    const builtInSkills = join(projectRoot, "skills");
    const repositorySkills = join(checkout, "skills");
    writeSkill(builtInSkills, "private-skill-repository", "Manage private skills");
    writeSkill(builtInSkills, "duplicate", "Built-in duplicate");
    execFileSync("git", ["init", "--bare", remote]);
    execFileSync("git", ["init", "-b", "main", seed]);
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: seed });
    execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: seed });
    writeSkill(join(seed, "skills"), "private-workflow", "Private workflow", "private.workflow");
    writeSkill(join(seed, "skills"), "duplicate", "Private duplicate");
    execFileSync("git", ["add", "skills"], { cwd: seed });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: seed });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: seed });
    execFileSync("git", ["push", "origin", "main"], { cwd: seed });

    const env = {
      PRIVATE_SKILLS_REPO_URL: remote,
      PRIVATE_SKILLS_REPO_PATH: checkout,
      PRIVATE_SKILLS_REPO_BRANCH: "main",
      ORGOPS_SKILL_ROOTS: repositorySkills,
    };
    try {
      const roots = resolveSkillRoots(projectRoot, repositorySkills);
      const beforeSync = discoverSkills(roots);
      expect(beforeSync.skills.map(({ name }) => name)).toEqual([
        "duplicate",
        "private-skill-repository",
      ]);
      expect(beforeSync.diagnostics).toEqual([
        { path: resolve(repositorySkills), code: "MISSING" },
      ]);

      expect(await runRepositoryCommand(["sync"], { env })).toMatchObject({
        ok: true,
        operation: "sync",
      });
      const afterSync = discoverSkills(roots);
      expect(afterSync.skills.map(({ name }) => name)).toEqual([
        "private-skill-repository",
        "private-workflow",
      ]);
      expect(afterSync.diagnostics).toEqual([]);

      const managementAccess = resolvePrivateSkillRepositoryAccess({
        selectedSkills: afterSync.skills,
        roots,
        repositoryPath: checkout,
      });
      expect(managementAccess).toEqual({ ok: true, skillsPath: resolve(repositorySkills) });
      const generated = vi.mocked(generate);
      generated.mockResolvedValue({
        text: JSON.stringify({
          type: "private.workflow",
          payload: { ok: true },
        }),
      } as never);
      const emitted: unknown[] = [];
      const api = {
        apiFetch: async () => Response.json([]),
        emitEvent: async (event: unknown) => { emitted.push(event); },
        listChannels: async () => [],
        getChannelRecord: async () => ({ id: "private-channel" }),
        getChannelParticipationValidationError: async () => null,
        ensureLifecycleChannel: async () => "lifecycle",
        getPackageSecretsEnv: async () => ({}),
      };
      const agent: Agent = {
        name: "private-skill-agent",
        systemInstructions: "Use the synced private workflow.",
        soulPath: "",
        workspacePath: projectRoot,
        enabledSkills: ["private-skill-repository", "private-workflow", "duplicate"],
        alwaysPreloadedSkills: ["private-workflow"],
        memoryContextMode: "OFF",
        modelId: "stub:model",
        desiredState: "RUNNING",
        runtimeState: "RUNNING",
      };
      const previousRepositoryPath = process.env.PRIVATE_SKILLS_REPO_PATH;
      process.env.PRIVATE_SKILLS_REPO_PATH = checkout;
      try {
        const executeTurn = createTurnExecutor({
          projectRoot,
          skillRoots: roots,
          llmCallTimeoutMs: 1_000,
          api,
        });
        await executeTurn(agent, [{
          id: "private-event",
          type: "message.created",
          payload: { text: "run the synced workflow" },
          source: "human:test",
          channelId: "private-channel",
        }]);

        expect(generated).toHaveBeenCalledOnce();
        const [, messages] = generated.mock.calls[0]!;
        const systemPrompt = String(messages[0]?.content);
        expect(systemPrompt).toContain("# private-workflow");
        expect(systemPrompt).toContain("Private workflow");
        expect(systemPrompt).toContain(join(repositorySkills, "private-workflow", "SKILL.md"));
        expect(systemPrompt).not.toContain("duplicate");
        const runnerInput = createRunnerToolsMock.mock.calls[0]![0] as {
          runTool: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
        };
        await runnerInput.runTool("events_event_types", {});
        const executeCall = (executeToolMock.mock.calls as unknown as Array<[
          { extraAllowedRoots: string[]; listEventTypes: (input: { source: string }) => unknown[] },
        ]>)[0]!;
        const executeContext = executeCall[0];
        expect(executeContext.extraAllowedRoots).toEqual([
          resolve(builtInSkills, "private-skill-repository"),
          resolve(repositorySkills, "private-workflow"),
          resolve(repositorySkills),
        ]);
        expect(executeContext.listEventTypes({ source: "skill:private-workflow" })).toEqual([
          expect.objectContaining({ type: "private.workflow" }),
        ]);
        expect(emitted).toContainEqual(expect.objectContaining({ type: "private.workflow" }));
      } finally {
        if (previousRepositoryPath === undefined) delete process.env.PRIVATE_SKILLS_REPO_PATH;
        else process.env.PRIVATE_SKILLS_REPO_PATH = previousRepositoryPath;
        generated.mockReset();
        executeToolMock.mockReset();
        createRunnerToolsMock.mockClear();
      }

      const duplicateDiscovery = discoverSkills(roots);
      expect(duplicateDiscovery.skills.some(({ name }) => name === "duplicate")).toBe(false);
      expect(duplicateDiscovery.conflicts).toEqual([
        {
          name: "duplicate",
          paths: [
            resolve(builtInSkills, "duplicate"),
            resolve(repositorySkills, "duplicate"),
          ].sort(),
        },
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(gitRoot, { recursive: true, force: true });
    }
  });
});
