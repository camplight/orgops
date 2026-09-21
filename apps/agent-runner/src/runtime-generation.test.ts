import { createHash } from "node:crypto";
import { link, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { exportSkillPackage } from "@orgops/skills";
import type { DeploymentCommand, VerifiedArtifactEnvelope } from "@orgops/schemas";
import { computeArtifactSemanticDigest, computePackageSetDigest } from "./package-delivery";
import { createAgentRuntimeGeneration } from "./runtime-generation";

const roots: string[] = [];
afterEach(async () => { const fs = await import("node:fs/promises"); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function root() { const value = await mkdtemp(join(tmpdir(), "orgops-generation-")); roots.push(value); return value; }
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function settlesWithin<T>(promise: Promise<T>, ms = 250): Promise<{ settled: true; value: T } | { settled: false }> {
  return Promise.race([
    promise.then(value => ({ settled: true as const, value })),
    new Promise<{ settled: false }>(resolve => setTimeout(() => resolve({ settled: false }), ms)),
  ]);
}
function delivery(generation = "generation-a", deploymentId = "deploy-a", body = "Body"): { command: DeploymentCommand; artifact: VerifiedArtifactEnvelope } {
  const exported = exportSkillPackage([{ type: "file", path: "SKILL.md", base64: Buffer.from(`---\nname: alpha\ndescription: Alpha.\n---\n${body}\n`).toString("base64"), executable: false }], {
    metadata: { formatVersion: 1, name: "alpha", version: "1.0.0", description: "Alpha.", author: "Test", license: "MIT",
      compatibility: { orgops: { min: "0.0.1" }, platforms: ["linux"], tools: [] }, secrets: [] },
    dependencies: [], executables: [], selectedPaths: ["SKILL.md"],
  });
  if (!exported.ok) throw new Error("fixture");
  const manifest = exported.value.snapshot.manifest;
  const release = { packageReleaseId: "release-alpha", authoritySourceId: "source-a", contentSourceId: "source-a", kind: "skill" as const,
    name: "alpha", version: "1.0.0", catalogCommit: "a".repeat(40), packageCommit: "a".repeat(40), packagePath: "skills/alpha", digest: manifest.digest };
  const packages = [{ release, manifest, direct: true,
    namespace: `packages/000-alpha-${createHash("sha256").update("release-alpha").digest("hex").slice(0, 12)}` }];
  const artifact = { deploymentId, agentId: "agent-a", generation, release, manifest, dependencies: [], packages,
    semanticDigest: "", files: exported.value.snapshot.files.map(file => ({ packageReleaseId: "release-alpha", path: file.path,
      mode: file.executable ? 0o755 as const : 0o644 as const, bytesBase64: file.base64 })) } as VerifiedArtifactEnvelope;
  artifact.semanticDigest = computeArtifactSemanticDigest(artifact);
  return { command: { deploymentId, agentId: "agent-a", agentName: "agent-a", assignedRunnerId: "runner-a",
    releaseId: "release-alpha", desiredGeneration: generation, desiredRoots: [release],
    packageSetDigest: `sha256:${createHash("sha256").update(JSON.stringify([release])).digest("hex")}` }, artifact };
}

it("verifies before writes and stages an exclusive complete generation with exact bytes", async () => {
  const packageRoot = await root();
  const runtime = createAgentRuntimeGeneration({ packageRoot });
  const { command, artifact } = delivery();
  const malformed = structuredClone(artifact) as any; malformed.agentId = "other";
  await expect(runtime.stage(command, malformed)).rejects.toMatchObject({ code: "INSPECTION_FAILED" });
  expect(await readdir(packageRoot)).toEqual([]);
  const staged = await runtime.stage(command, artifact);
  expect(await readFile(join(staged.generation.skillRoot, "alpha", "SKILL.md"), "utf8")).toContain("Body");
  expect(await runtime.stage(command, artifact)).toEqual(staged);
  await writeFile(join(staged.stagedRoot, "unmanaged.txt"), "keep");
  await expect(runtime.stage(command, artifact)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  expect(await readFile(join(staged.stagedRoot, "unmanaged.txt"), "utf8")).toBe("keep");
});

it("stages an empty skills root when the disabled trigger is not in the desired closure", async () => {
  const runtime = createAgentRuntimeGeneration({ packageRoot: await root() });
  const item = delivery();
  item.command.desiredRoots = [];
  item.command.packageSetDigest = computePackageSetDigest([]);
  item.artifact.packages = [];
  item.artifact.dependencies = [];
  item.artifact.files = [];
  item.artifact.semanticDigest = computeArtifactSemanticDigest(item.artifact);
  const staged = await runtime.stage(item.command, item.artifact);
  expect(await readdir(staged.generation.skillRoot)).toEqual([]);
});

it("waits for every captured turn, blocks new capture during swap, and atomically selects the staged generation", async () => {
  const runtime = createAgentRuntimeGeneration({ packageRoot: await root() });
  const first = delivery("generation-a", "deploy-a");
  await runtime.activateWhenIdle(await runtime.stage(first.command, first.artifact));
  const lease = await runtime.captureForTurn("agent-a");
  expect(lease.generation.generation).toBe("generation-a");
  const second = delivery("generation-b", "deploy-b");
  const activating = runtime.activateWhenIdle(await runtime.stage(second.command, second.artifact));
  let activated = false; void activating.then(() => { activated = true; });
  await new Promise(resolve => setImmediate(resolve));
  expect(activated).toBe(false);
  let captured = false;
  const nextLease = runtime.captureForTurn("agent-a").then(value => { captured = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  expect(captured).toBe(false);
  lease.release();
  expect((await activating).generation).toBe("generation-b");
  const next = await nextLease;
  expect(next.generation.generation).toBe("generation-b");
  next.release();
});

it("rejects a pre-existing final-root symlink even when its external target is a complete prior generation", async () => {
  const packageRoot = await root();
  const runtime = createAgentRuntimeGeneration({ packageRoot });
  const item = delivery();
  const staged = await runtime.stage(item.command, item.artifact);
  const external = await root();
  await rename(staged.stagedRoot, join(external, "generation"));
  await symlink(join(external, "generation"), staged.stagedRoot, "dir");
  await expect(runtime.stage(item.command, item.artifact)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
});

it("rejects hard-linked generation files and same-generation artifact drift without overwriting", async () => {
  const packageRoot = await root();
  const runtime = createAgentRuntimeGeneration({ packageRoot });
  const first = delivery();
  const staged = await runtime.stage(first.command, first.artifact);
  const source = join(staged.generation.skillRoot, "alpha", "SKILL.md");
  const alias = join(await root(), "alias");
  await link(source, alias);
  await expect(runtime.activateWhenIdle(staged)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  const drift = delivery("generation-a", "deploy-a", "Changed");
  await expect(runtime.stage(drift.command, drift.artifact)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  expect(await readFile(source, "utf8")).toContain("Body");
});

it.each(["intermediate-symlink", "marker-symlink", "replacement"] as const)("rejects %s introduced after staging before activation", async variant => {
  const runtime = createAgentRuntimeGeneration({ packageRoot: await root() });
  const item = delivery(); const staged = await runtime.stage(item.command, item.artifact);
  if (variant === "intermediate-symlink") {
    const skill = join(staged.generation.skillRoot, "alpha"); const external = await root();
    await rename(skill, join(external, "alpha")); await symlink(join(external, "alpha"), skill, "dir");
  } else if (variant === "marker-symlink") {
    const marker = join(staged.stagedRoot, ".orgops-generation.json"); const external = join(await root(), "marker.json");
    await rename(marker, external); await symlink(external, marker);
  } else {
    const file = join(staged.generation.skillRoot, "alpha", "SKILL.md"); await rm(file); await writeFile(file, "replacement", { mode: 0o644 });
  }
  await expect(runtime.activateWhenIdle(staged)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
});

it("serializes a restart pointer load with activation before an old-generation lease can appear", async () => {
  const packageRoot = await root();
  const initial = createAgentRuntimeGeneration({ packageRoot });
  const first = delivery();
  await initial.activateWhenIdle(await initial.stage(first.command, first.artifact));
  let releaseLoad!: () => void;
  const loadGate = new Promise<void>(resolve => { releaseLoad = resolve; });
  let announceLoad!: () => void;
  const loadStarted = new Promise<void>(resolve => { announceLoad = resolve; });
  const restarted = createAgentRuntimeGeneration({ packageRoot, beforePointerRead: async () => { announceLoad(); await loadGate; } });
  const capture = restarted.captureForTurn("agent-a");
  await loadStarted;
  const second = delivery("generation-b", "deploy-b");
  const activation = restarted.activateWhenIdle(await restarted.stage(second.command, second.artifact));
  releaseLoad();
  const lease = await capture;
  expect(lease.generation.generation).toBe("generation-a");
  let activated = false; void activation.then(() => { activated = true; });
  await new Promise(resolve => setImmediate(resolve));
  expect(activated).toBe(false);
  lease.release(); lease.release();
  await activation;
  const current = await restarted.captureForTurn("agent-a");
  expect(current.generation.generation).toBe("generation-b");
  current.release();
});

it("never overwrites an unmanaged or malformed current pointer", async () => {
  const packageRoot = await root();
  const runtime = createAgentRuntimeGeneration({ packageRoot });
  const item = delivery();
  const staged = await runtime.stage(item.command, item.artifact);
  const pointer = join(staged.stagedRoot, "..", "..", "current.json");
  await writeFile(pointer, "unmanaged", { mode: 0o600 });
  await expect(runtime.activateWhenIdle(staged)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  expect(await readFile(pointer, "utf8")).toBe("unmanaged");
});

it("keeps Task 12 start-gate behavior outside the runtime-generation interface", async () => {
  const runtime = createAgentRuntimeGeneration({ packageRoot: await root() });
  expect(Object.keys(runtime).sort()).toEqual(["activateWhenIdle", "captureForTurn", "stage"]);
});

it("loads and validates the active pointer after restart and rejects corrupt or foreign pointers", async () => {
  const packageRoot = await root();
  const deliveryA = delivery();
  const runtime = createAgentRuntimeGeneration({ packageRoot });
  const staged = await runtime.stage(deliveryA.command, deliveryA.artifact);
  await runtime.activateWhenIdle(staged);
  const restarted = createAgentRuntimeGeneration({ packageRoot });
  const lease = await restarted.captureForTurn("agent-a");
  expect(lease.generation.generation).toBe("generation-a");
  lease.release();
  const restartStaged = await restarted.stage(deliveryA.command, deliveryA.artifact);
  await expect(restarted.activateWhenIdle(restartStaged)).resolves.toMatchObject({ generation: "generation-a" });
  await expect(restarted.activateWhenIdle(restartStaged)).resolves.toMatchObject({ generation: "generation-a" });
  const pointer = join(staged.stagedRoot, "..", "..", "current.json");
  await writeFile(pointer, JSON.stringify({ generation: "generation-a", stagedRoot: "/foreign/root" }));
  const corrupt = createAgentRuntimeGeneration({ packageRoot, fallbackRoot: await root() });
  await expect(corrupt.captureForTurn("agent-a")).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
});

it("waits for every channel lease before swapping and gives waiting captures the new generation", async () => {
  const runtime = createAgentRuntimeGeneration({ packageRoot: await root() });
  const first = delivery("generation-a", "deploy-a");
  await runtime.activateWhenIdle(await runtime.stage(first.command, first.artifact));
  const leaseA = await runtime.captureForTurn("agent-a");
  const leaseB = await runtime.captureForTurn("agent-a");
  const second = delivery("generation-b", "deploy-b");
  const activating = runtime.activateWhenIdle(await runtime.stage(second.command, second.artifact));
  await new Promise(resolve => setImmediate(resolve));
  leaseA.release();
  let activated = false;
  void activating.then(() => { activated = true; });
  await new Promise(resolve => setImmediate(resolve));
  expect(activated).toBe(false);
  const captureC = runtime.captureForTurn("agent-a");
  let captured = false;
  void captureC.then(() => { captured = true; });
  await new Promise(resolve => setImmediate(resolve));
  expect(captured).toBe(false);
  leaseB.release();
  await expect(activating).resolves.toMatchObject({ generation: "generation-b" });
  const leaseC = await captureC;
  expect(leaseC.generation.generation).toBe("generation-b");
  leaseC.release();
});

it("uses an immutable legacy fallback that blocks first activation", async () => {
  const packageRoot = await root();
  const fallbackRoot = await root();
  const runtime = createAgentRuntimeGeneration({ packageRoot, fallbackRoot });
  const lease = await runtime.captureForTurn("agent-a");
  expect(lease.generation).toMatchObject({
    generation: "legacy-fallback",
    skillRoot: fallbackRoot,
    promptRoot: fallbackRoot,
    eventShapeRoot: fallbackRoot,
  });
  expect(Object.isFrozen(lease.generation)).toBe(true);
  expect(() => { (lease.generation as any).skillRoot = "/mutated"; }).toThrow();
  const item = delivery();
  const activation = runtime.activateWhenIdle(await runtime.stage(item.command, item.artifact));
  let activated = false;
  void activation.then(() => { activated = true; });
  await new Promise(resolve => setImmediate(resolve));
  expect(activated).toBe(false);
  lease.release();
  await activation;
  const packageLease = await runtime.captureForTurn("agent-a");
  expect(packageLease.generation.generation).toBe("generation-a");
  packageLease.release();
});

it("rejects forged, cross-instance, and superseded staged bindings while allowing exact idempotent activation", async () => {
  const packageRoot = await root();
  const runtime = createAgentRuntimeGeneration({ packageRoot });
  const otherRuntime = createAgentRuntimeGeneration({ packageRoot });
  const first = delivery("generation-a", "deploy-a");
  const stagedA = await runtime.stage(first.command, first.artifact);
  await expect(runtime.activateWhenIdle(structuredClone(stagedA))).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  await expect(otherRuntime.activateWhenIdle(stagedA)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  await runtime.activateWhenIdle(stagedA);
  await expect(runtime.activateWhenIdle(stagedA)).resolves.toMatchObject({ generation: "generation-a" });
  const second = delivery("generation-b", "deploy-b");
  const stagedB = await runtime.stage(second.command, second.artifact);
  await runtime.activateWhenIdle(stagedB);
  await expect(runtime.activateWhenIdle(stagedA)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
});

it("lets the newest pending token supersede older pending tokens without affecting the active retry", async () => {
  const runtime = createAgentRuntimeGeneration({ packageRoot: await root() });
  const activeItem = delivery("generation-active", "deploy-active", "Active");
  const active = await runtime.stage(activeItem.command, activeItem.artifact);
  await runtime.activateWhenIdle(active);
  const firstItem = delivery("generation-first", "deploy-first", "First");
  const first = await runtime.stage(firstItem.command, firstItem.artifact);
  const newestItem = delivery("generation-newest", "deploy-newest", "Newest");
  const newest = await runtime.stage(newestItem.command, newestItem.artifact);

  await expect(runtime.activateWhenIdle(first)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  await expect(runtime.activateWhenIdle(active)).resolves.toMatchObject({ generation: "generation-active" });
  await expect(runtime.activateWhenIdle(newest)).resolves.toMatchObject({ generation: "generation-newest" });
});

it("revalidates the filesystem marker before idempotent exact activation", async () => {
  const runtime = createAgentRuntimeGeneration({ packageRoot: await root() });
  const item = delivery();
  const staged = await runtime.stage(item.command, item.artifact);
  await runtime.activateWhenIdle(staged);
  await writeFile(join(staged.stagedRoot, ".orgops-generation.json"), "{}", { mode: 0o600 });
  await expect(runtime.activateWhenIdle(staged)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
});

it("retains the prior generation and unblocks waiting captures after activation verification fails", async () => {
  const runtime = createAgentRuntimeGeneration({ packageRoot: await root() });
  const first = delivery("generation-a", "deploy-a");
  await runtime.activateWhenIdle(await runtime.stage(first.command, first.artifact));
  const lease = await runtime.captureForTurn("agent-a");
  const second = delivery("generation-b", "deploy-b");
  const staged = await runtime.stage(second.command, second.artifact);
  const activation = runtime.activateWhenIdle(staged);
  await new Promise(resolve => setImmediate(resolve));
  const waitingCapture = runtime.captureForTurn("agent-a");
  await writeFile(join(staged.generation.skillRoot, "alpha", "SKILL.md"), "tampered", { mode: 0o644 });
  lease.release();
  await expect(activation).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  const retained = await waitingCapture;
  expect(retained.generation.generation).toBe("generation-a");
  retained.release();
});

it("releases the ownership gate before a never-settling pointer observer", async () => {
  const packageRoot = await root();
  const observerStarted = deferred();
  const observerRelease = deferred();
  const runtime = createAgentRuntimeGeneration({
    packageRoot,
    onPointerChange: async () => {
      observerStarted.resolve();
      await observerRelease.promise;
    },
  });
  const item = delivery();
  const staged = await runtime.stage(item.command, item.artifact);
  const activation = runtime.activateWhenIdle(staged);
  await observerStarted.promise;
  const activationResult = await settlesWithin(activation);
  const capture = runtime.captureForTurn("agent-a");
  const captureResult = await settlesWithin(capture);
  observerRelease.resolve();

  expect(activationResult).toMatchObject({ settled: true, value: { generation: "generation-a" } });
  expect(captureResult).toMatchObject({ settled: true, value: { generation: { generation: "generation-a" } } });
  if (captureResult.settled) captureResult.value.release();
  await activation;
});

it("allows a pointer observer to capture and activate a later generation reentrantly", async () => {
  const packageRoot = await root();
  const second = delivery("generation-b", "deploy-b", "Second");
  let runtime!: ReturnType<typeof createAgentRuntimeGeneration>;
  let reentrant: Promise<void> | undefined;
  const callbackGenerations: string[] = [];
  runtime = createAgentRuntimeGeneration({
    packageRoot,
    onPointerChange: async (_agentId, generation) => {
      callbackGenerations.push(generation);
      if (generation !== "generation-a") return;
      reentrant = (async () => {
        const lease = await runtime.captureForTurn("agent-a");
        expect(lease.generation.generation).toBe("generation-a");
        lease.release();
        const staged = await runtime.stage(second.command, second.artifact);
        await runtime.activateWhenIdle(staged);
      })();
      await reentrant;
    },
  });
  const first = delivery();
  const activation = runtime.activateWhenIdle(await runtime.stage(first.command, first.artifact));

  expect(await settlesWithin(activation, 500)).toMatchObject({ settled: true, value: { generation: "generation-a" } });
  for (let attempt = 0; attempt < 100 && !reentrant; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5));
  expect(reentrant).toBeDefined();
  expect(await settlesWithin(reentrant!, 500)).toMatchObject({ settled: true });
  const lease = await runtime.captureForTurn("agent-a");
  expect(lease.generation.generation).toBe("generation-b");
  lease.release();
  expect(callbackGenerations).toEqual(["generation-a", "generation-b"]);
});

it("keeps staged token state bounded to one pending and one active binding", async () => {
  const observations: Array<{ pending: number; active: number }> = [];
  const runtime = createAgentRuntimeGeneration({
    packageRoot: await root(),
    observeBindingStateForTest: (state: { pending: number; active: number }) => { observations.push(state); },
  } as Parameters<typeof createAgentRuntimeGeneration>[0] & {
    observeBindingStateForTest: (state: { pending: number; active: number }) => void;
  });
  const historical = [];
  for (let index = 0; index < 12; index += 1) {
    const item = delivery(`generation-${index}`, `deploy-${index}`, `Body ${index}`);
    const staged = await runtime.stage(item.command, item.artifact);
    historical.push(staged);
    await runtime.activateWhenIdle(staged);
    await expect(runtime.activateWhenIdle(staged)).resolves.toMatchObject({ generation: `generation-${index}` });
  }

  expect(observations.length).toBeGreaterThan(12);
  expect(observations.every(state => state.pending <= 1 && state.active <= 1 && state.pending + state.active <= 2)).toBe(true);
  await expect(runtime.activateWhenIdle(historical[0]!)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  await expect(runtime.activateWhenIdle(historical.at(-1)!)).resolves.toMatchObject({ generation: "generation-11" });
});

it("notifies once after a durable pointer swap and callback failure leaves the new pointer active", async () => {
  const packageRoot = await root();
  const calls: Array<{ agentId: string; generation: string; durableGeneration: string }> = [];
  const runtime = createAgentRuntimeGeneration({
    packageRoot,
    onPointerChange: async (agentId: string, generation: string) => {
      const pointer = JSON.parse(await readFile(join(packageRoot, "agents", createHash("sha256").update(agentId).digest("hex"), "current.json"), "utf8"));
      calls.push({ agentId, generation, durableGeneration: pointer.generation });
      throw new Error("observer failed");
    },
  });
  const item = delivery();
  const staged = await runtime.stage(item.command, item.artifact);
  await expect(runtime.activateWhenIdle(staged)).resolves.toMatchObject({ generation: "generation-a" });
  await expect(runtime.activateWhenIdle(staged)).resolves.toMatchObject({ generation: "generation-a" });
  const failed = delivery("generation-b", "deploy-b", "Second");
  const failedStaged = await runtime.stage(failed.command, failed.artifact);
  await writeFile(join(failedStaged.generation.skillRoot, "alpha", "SKILL.md"), "tampered", { mode: 0o644 });
  await expect(runtime.activateWhenIdle(failedStaged)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  expect(calls).toEqual([{ agentId: "agent-a", generation: "generation-a", durableGeneration: "generation-a" }]);
  const lease = await runtime.captureForTurn("agent-a");
  expect(lease.generation.generation).toBe("generation-a");
  lease.release();
});
