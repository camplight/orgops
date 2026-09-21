import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { exportSkillPackage } from "@orgops/skills";
import type { DeploymentCommand, RuntimeGeneration, VerifiedArtifactEnvelope } from "@orgops/schemas";
import { createChannelLoopManager } from "./channel-loop";
import { computeArtifactSemanticDigest, computePackageSetDigest } from "./package-delivery";
import { createAgentRuntimeGeneration } from "./runtime-generation";
import { resolveTurnSkillContext } from "./turn-executor";
import type { Agent, Event } from "./types";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function tempRoot(prefix = "orgops-channel-generation-") { const path = await mkdtemp(join(tmpdir(), prefix)); roots.push(path); return path; }
async function waitFor(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(message);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function agent(id: string, name: string, mode: Agent["mode"] = "CLASSIC"): Agent {
  return { id, name, mode, systemInstructions: "", soulPath: "", workspacePath: "/tmp", modelId: "openai:gpt-4o-mini", desiredState: "RUNNING", runtimeState: "RUNNING" };
}
function event(id: string, channelId: string): Event {
  return { id, channelId, type: "message.created", source: "human:admin", payload: { text: id }, createdAt: Date.now() };
}
function delivery(generation: string, deploymentId: string, body: string): { command: DeploymentCommand; artifact: VerifiedArtifactEnvelope } {
  const exported = exportSkillPackage([
    { type: "file", path: "SKILL.md", base64: Buffer.from(`---\nname: alpha\ndescription: Alpha.\n---\n${body}\n`).toString("base64"), executable: false },
    { type: "file", path: "event-shapes.js", base64: Buffer.from(`export const eventShapes = [{ type: "alpha.done", description: ${JSON.stringify(body)} }];\n`).toString("base64"), executable: true },
  ], {
    metadata: { formatVersion: 1, name: "alpha", version: "1.0.0", description: "Alpha.", author: "Test", license: "MIT",
      compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [] },
    dependencies: [], executables: [{ path: "event-shapes.js", execution: "api-event-shapes" }], selectedPaths: ["SKILL.md", "event-shapes.js"],
  });
  if (!exported.ok) throw new Error(`fixture export failed: ${JSON.stringify(exported.issues)}`);
  const manifest = exported.value.snapshot.manifest;
  const release = { packageReleaseId: `release-${generation}`, authoritySourceId: "source-a", contentSourceId: "source-a", kind: "skill" as const,
    name: "alpha", version: "1.0.0", catalogCommit: "a".repeat(40), packageCommit: "a".repeat(40), packagePath: "skills/alpha", digest: manifest.digest };
  const packages = [{ release, manifest, direct: true,
    namespace: `packages/000-alpha-${createHash("sha256").update(release.packageReleaseId).digest("hex").slice(0, 12)}` }];
  const artifact = { deploymentId, agentId: "agent-a", generation, release, manifest, dependencies: [], packages, semanticDigest: "",
    files: exported.value.snapshot.files.map(file => ({ packageReleaseId: release.packageReleaseId, path: file.path,
      mode: file.executable ? 0o755 as const : 0o644 as const, bytesBase64: file.base64 })) } as VerifiedArtifactEnvelope;
  artifact.semanticDigest = computeArtifactSemanticDigest(artifact);
  return { command: { deploymentId, agentId: "agent-a", agentName: "alpha", assignedRunnerId: "runner-a", releaseId: release.packageReleaseId,
    desiredGeneration: generation, desiredRoots: [release], packageSetDigest: computePackageSetDigest([release]) }, artifact };
}

it("holds one agent-wide generation across two channels and makes a third capture wait for activation", async () => {
  const packageRoot = await tempRoot();
  const legacyRoot = await tempRoot();
  const runtime = createAgentRuntimeGeneration({ packageRoot, fallbackRoot: legacyRoot });
  const first = delivery("gen-1", "deploy-1", "generation one");
  await runtime.activateWhenIdle(await runtime.stage(first.command, first.artifact));
  const releases = new Map<string, ReturnType<typeof deferred>>();
  const observations: Array<{ channelId: string; generation: RuntimeGeneration; context: Awaited<ReturnType<typeof resolveTurnSkillContext>> }> = [];
  const manager = createChannelLoopManager({
    captureForTurn: runtime.captureForTurn,
    processBatch: async (current, channelId, _events, generation) => {
      const context = await resolveTurnSkillContext({ legacySkillRoot: { path: legacyRoot }, generation,
        enabledSkills: current.enabledSkills ?? [], alwaysPreloadedSkills: current.alwaysPreloadedSkills ?? [] });
      observations.push({ channelId, generation, context });
      const gate = deferred();
      releases.set(channelId, gate);
      await gate.promise;
    },
  });
  const subject = { ...agent("agent-a", "alpha"), enabledSkills: ["alpha"], alwaysPreloadedSkills: ["alpha"] };
  manager.enqueue(subject, [event("one", "channel-1")]);
  manager.enqueue(subject, [event("two", "channel-2")]);
  await waitFor(() => observations.length === 2, "two channel turns did not start");
  expect(observations.map(item => item.generation.generation)).toEqual(["gen-1", "gen-1"]);
  for (const observation of observations) {
    expect(observation.generation.skillRoot).toBe(observation.generation.promptRoot);
    expect(observation.generation.promptRoot).toBe(observation.generation.eventShapeRoot);
    expect(observation.context.skillIndex).toContain(observation.generation.skillRoot);
    expect(observation.context.preloadedSkillsContext).toContain("generation one");
    expect(observation.context.eventShapes).toMatchObject([{ type: "alpha.done", description: "generation one" }]);
    expect(observation.context.extraAllowedRoots).toEqual([join(observation.generation.skillRoot, "alpha")]);
  }

  const second = delivery("gen-2", "deploy-2", "generation two");
  const activation = runtime.activateWhenIdle(await runtime.stage(second.command, second.artifact));
  await new Promise(resolve => setImmediate(resolve));
  releases.get("channel-1")!.resolve();
  await waitFor(() => !manager.isChannelBusy("alpha", "channel-1"), "first channel did not finish");
  const pointerPath = join(packageRoot, "agents", createHash("sha256").update("agent-a").digest("hex"), "current.json");
  expect(JSON.parse(await readFile(pointerPath, "utf8")).generation).toBe("gen-1");

  manager.enqueue(subject, [event("three", "channel-3")]);
  manager.enqueue(agent("agent-b", "beta"), [event("other", "channel-other")]);
  await waitFor(() => observations.some(item => item.channelId === "channel-other"), "other agent was blocked");
  expect(observations.some(item => item.channelId === "channel-3")).toBe(false);
  releases.get("channel-2")!.resolve();
  await activation;
  await waitFor(() => observations.some(item => item.channelId === "channel-3"), "waiting capture did not resume");
  const third = observations.find(item => item.channelId === "channel-3")!;
  expect(third.generation.generation).toBe("gen-2");
  expect(third.context.skillIndex).toContain(third.generation.skillRoot);
  expect(third.context.preloadedSkillsContext).toContain("generation two");
  expect(third.context.preloadedSkillsContext).not.toContain("generation one");
  expect(third.context.eventShapes).toMatchObject([{ type: "alpha.done", description: "generation two" }]);
  expect(observations.find(item => item.channelId === "channel-other")!.generation.generation).toBe("legacy-fallback");
  releases.get("channel-3")!.resolve();
  releases.get("channel-other")!.resolve();
  await waitFor(() => manager.activeWorkerCount() === 0, "workers did not finish");
});

it("keeps the mode-independent channel dispatch lease through processing and rejecting error callbacks", async () => {
  let captures = 0;
  let releases = 0;
  let activeLeases = 0;
  const handlerLeaseCounts: number[] = [];
  const completed: string[] = [];
  const manager = createChannelLoopManager({
    captureForTurn: async (agentId: string) => {
      captures += 1;
      activeLeases += 1;
      let released = false;
      return { agentId, generation: Object.freeze({ generation: "fixed", skillRoot: "/fixed", promptRoot: "/fixed", eventShapeRoot: "/fixed" }), release() {
        if (released) return;
        released = true;
        releases += 1;
        activeLeases -= 1;
      } };
    },
    processBatch: async (current: Agent) => {
      completed.push(current.mode ?? "CLASSIC");
      if (current.name === "throws" || current.name === "wrapped-failure") throw new Error("turn failed");
    },
    onBatchError: async (current) => {
      handlerLeaseCounts.push(activeLeases);
      if (current.name === "wrapped-failure") throw new Error("reporting failed");
    },
  });
  const cases: Agent[] = [
    agent("classic-id", "classic", "CLASSIC"),
    agent("rlm-id", "rlm", "RLM_REPL"),
    agent("wrapped-id", "wrapped", "WRAPPED"),
    agent("throws-id", "throws", "CLASSIC"),
    agent("wrapped-failure-id", "wrapped-failure", "WRAPPED"),
  ];
  cases.forEach((current, index) => manager.enqueue(current, [event(`event-${index}`, `channel-${index}`)]));
  await waitFor(() => manager.activeWorkerCount() === 0, "mode turns did not finish");
  expect(completed).toHaveLength(5);
  expect(captures).toBe(5);
  expect(releases).toBe(5);
  expect(activeLeases).toBe(0);
  expect(handlerLeaseCounts).toHaveLength(2);
  expect(handlerLeaseCounts.every(count => count > 0)).toBe(true);
});

async function writeSkill(root: string, name: string, body: string, eventType?: string) {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} description\n---\n${body}\n`);
  if (eventType) await writeFile(join(directory, "event-shapes.js"), `export const eventShapes = [{ type: ${JSON.stringify(eventType)}, description: "shape" }];\n`);
}

it("resolves package and legacy skill metadata, prompt markdown, event shapes, and tool roots without mixing roots", async () => {
  const legacyRoot = await tempRoot();
  const skillRoot = await tempRoot();
  const promptRoot = await tempRoot();
  const eventShapeRoot = await tempRoot();
  await writeSkill(legacyRoot, "legacy", "LEGACY PROMPT", "legacy.done");
  await writeSkill(skillRoot, "alpha", "SKILL META ROOT");
  await writeSkill(promptRoot, "alpha", "PACKAGE PROMPT");
  await writeSkill(eventShapeRoot, "alpha", "EVENT ROOT", "alpha.done");
  await writeSkill(skillRoot, "disabled", "DISABLED META");
  await writeSkill(promptRoot, "disabled", "DISABLED PROMPT");
  await writeSkill(eventShapeRoot, "disabled", "DISABLED EVENT", "disabled.done");
  const context = await resolveTurnSkillContext({
    legacySkillRoot: { path: legacyRoot },
    generation: Object.freeze({ generation: "gen-1", skillRoot, promptRoot, eventShapeRoot }),
    enabledSkills: ["alpha", "legacy"],
    alwaysPreloadedSkills: ["alpha", "legacy"],
  });
  expect(context.skillIndex).toContain(join(skillRoot, "alpha", "SKILL.md"));
  expect(context.skillIndex).toContain(join(legacyRoot, "legacy", "SKILL.md"));
  expect(context.preloadedSkillsContext).toContain("PACKAGE PROMPT");
  expect(context.preloadedSkillsContext).toContain("LEGACY PROMPT");
  expect(context.preloadedSkillsContext).not.toContain("SKILL META ROOT");
  expect(context.eventShapes.map((shape: any) => shape.type).sort()).toEqual(["alpha.done", "legacy.done"]);
  expect(context.extraAllowedRoots.sort()).toEqual([join(legacyRoot, "legacy"), join(skillRoot, "alpha")].sort());
  expect(JSON.stringify(context)).not.toContain("disabled");
});

it("rejects enabled duplicate names and divergent package root inventories", async () => {
  const legacyRoot = await tempRoot();
  const skillRoot = await tempRoot();
  const promptRoot = await tempRoot();
  const eventShapeRoot = await tempRoot();
  await writeSkill(legacyRoot, "alpha", "legacy");
  await writeSkill(skillRoot, "alpha", "skill");
  await writeSkill(promptRoot, "alpha", "prompt");
  await writeSkill(eventShapeRoot, "alpha", "event");
  const generation = Object.freeze({ generation: "gen-1", skillRoot, promptRoot, eventShapeRoot });
  await expect(resolveTurnSkillContext({ legacySkillRoot: { path: legacyRoot }, generation, enabledSkills: ["alpha"], alwaysPreloadedSkills: [] }))
    .rejects.toThrow("AMBIGUOUS_SKILL_ROOT");
  await rm(join(legacyRoot, "alpha"), { recursive: true });
  await writeSkill(promptRoot, "orphan", "orphan");
  await expect(resolveTurnSkillContext({ legacySkillRoot: { path: legacyRoot }, generation, enabledSkills: ["alpha"], alwaysPreloadedSkills: [] }))
    .rejects.toThrow("DIVERGENT_GENERATION_ROOTS");
});
