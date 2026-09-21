import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  DeploymentCommandSchema,
  RuntimeGenerationSchema,
  StagedGenerationSchema,
  type AgentRuntimeGeneration,
  type RuntimeGeneration,
  type StagedGeneration,
  type TurnLease,
  type VerifiedArtifactEnvelope,
} from "@orgops/schemas";
import { verifyArtifact } from "./package-delivery";

class RuntimeGenerationError extends Error { constructor(readonly code: "INSPECTION_FAILED" | "STORAGE_FAILURE") { super(code); } }
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fileDigest = (value: Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const missing = (error: unknown) => (error as { code?: unknown })?.code === "ENOENT";
const inside = (root: string, target: string) => { const path = relative(resolve(root), resolve(target)); return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep)); };

type Marker = { agentId: string; deploymentId: string; generation: string; packageSetDigest: string; semanticDigest: string;
  files: Array<{ path: string; mode: 0o644 | 0o755; digest: string }> };
type Pointer = { agentId: string; deploymentId: string; generation: string; packageSetDigest: string; semanticDigest: string;
  stagedRoot: string; skillRoot: string; promptRoot: string; eventShapeRoot: string };
type StagedBinding = { staged: StagedGeneration; status: "staged" | "active" | "superseded" };
type AgentState = {
  leases: number;
  idleWaiters: Set<() => void>;
  pointer?: Pointer;
  gate: Promise<void>;
  pendingBinding?: StagedBinding;
  activeBinding?: StagedBinding;
};

type RuntimeDeps = {
  packageRoot: string;
  fallbackRoot?: string;
  beforePointerRead?: () => Promise<void>;
  onPointerChange?: (agentId: string, generation: string) => Promise<void> | void;
  observeBindingStateForTest?: (state: { pending: number; active: number }) => void;
};

async function openRegular(path: string, maxBytes: number): Promise<{ bytes: Buffer; stat: Awaited<ReturnType<fs.FileHandle["stat"]>> }> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const first = await handle.stat();
    if (!first.isFile() || first.nlink !== 1 || first.size > maxBytes) throw new RuntimeGenerationError("STORAGE_FAILURE");
    const bytes = await handle.readFile(); const second = await handle.stat();
    if (first.dev !== second.dev || first.ino !== second.ino || first.size !== second.size || first.mtimeMs !== second.mtimeMs)
      throw new RuntimeGenerationError("STORAGE_FAILURE");
    return { bytes, stat: second };
  } catch (error) { if (error instanceof RuntimeGenerationError) throw error; throw new RuntimeGenerationError("STORAGE_FAILURE"); }
  finally { await handle?.close().catch(() => undefined); }
}
async function readJson(path: string): Promise<unknown> {
  const { bytes } = await openRegular(path, 256 * 1024);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new RuntimeGenerationError("STORAGE_FAILURE"); }
}
function parseMarker(value: unknown): Marker {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RuntimeGenerationError("STORAGE_FAILURE");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join() !== "agentId,deploymentId,files,generation,packageSetDigest,semanticDigest"
    || typeof row.agentId !== "string" || typeof row.deploymentId !== "string" || typeof row.generation !== "string"
    || typeof row.packageSetDigest !== "string" || typeof row.semanticDigest !== "string" || !Array.isArray(row.files) || row.files.length > 256)
    throw new RuntimeGenerationError("STORAGE_FAILURE");
  for (const file of row.files as unknown[]) {
    if (!file || typeof file !== "object" || Array.isArray(file)) throw new RuntimeGenerationError("STORAGE_FAILURE");
    const f = file as Record<string, unknown>;
    if (Object.keys(f).sort().join() !== "digest,mode,path" || typeof f.path !== "string"
      || (f.mode !== 0o644 && f.mode !== 0o755) || typeof f.digest !== "string") throw new RuntimeGenerationError("STORAGE_FAILURE");
  }
  return row as Marker;
}
function parsePointer(value: unknown): Pointer {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RuntimeGenerationError("STORAGE_FAILURE");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join() !== "agentId,deploymentId,eventShapeRoot,generation,packageSetDigest,promptRoot,semanticDigest,skillRoot,stagedRoot"
    || Object.values(row).some(value => typeof value !== "string")) throw new RuntimeGenerationError("STORAGE_FAILURE");
  return row as Pointer;
}

export function createAgentRuntimeGeneration({ packageRoot, fallbackRoot, beforePointerRead, onPointerChange, observeBindingStateForTest }: RuntimeDeps): AgentRuntimeGeneration {
  const root = resolve(packageRoot);
  const fallbackGeneration = fallbackRoot === undefined ? undefined : Object.freeze(RuntimeGenerationSchema.parse({
    generation: "legacy-fallback",
    skillRoot: resolve(fallbackRoot),
    promptRoot: resolve(fallbackRoot),
    eventShapeRoot: resolve(fallbackRoot),
  }));
  const states = new Map<string, AgentState>();
  const stagedBindings = new WeakMap<object, StagedBinding>();
  const stateFor = (agentId: string) => { let state = states.get(agentId); if (!state) { state = { leases: 0, idleWaiters: new Set(), gate: Promise.resolve() }; states.set(agentId, state); } return state; };
  const acquire = async (state: AgentState) => { let release!: () => void; const prior = state.gate; state.gate = new Promise<void>(resolve => { release = resolve; }); await prior; return release; };
  const observeBindings = (state: AgentState) => {
    try { observeBindingStateForTest?.({ pending: state.pendingBinding ? 1 : 0, active: state.activeBinding ? 1 : 0 }); }
    catch { /* Test observation cannot affect runtime state. */ }
  };
  const agentRoot = (agentId: string) => join(root, "agents", hash(agentId));
  const generationRoot = (agentId: string, generation: string) => join(agentRoot(agentId), "generations", hash(generation));
  const immutableGeneration = (generation: RuntimeGeneration): RuntimeGeneration => Object.freeze({ ...generation });
  const bindStaged = (value: StagedGeneration): StagedGeneration => {
    const staged = Object.freeze({ ...value, generation: immutableGeneration(value.generation) });
    const binding: StagedBinding = { staged, status: "staged" };
    stagedBindings.set(staged, binding);
    const state = stateFor(staged.agentId);
    if (state.pendingBinding) state.pendingBinding.status = "superseded";
    state.pendingBinding = binding;
    observeBindings(state);
    return staged;
  };

  async function safeDirectory(path: string, canonicalRoot: string): Promise<string> {
    const stat = await fs.lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new RuntimeGenerationError("STORAGE_FAILURE");
    const real = await fs.realpath(path); if (!inside(canonicalRoot, real)) throw new RuntimeGenerationError("STORAGE_FAILURE"); return real;
  }
  async function ensureRoot(agentId: string): Promise<string> {
    try { await fs.mkdir(root, { mode: 0o700 }); } catch (error) { if ((error as { code?: unknown }).code !== "EEXIST") throw error; }
    const stat = await fs.lstat(root); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new RuntimeGenerationError("STORAGE_FAILURE");
    const canonicalRoot = await fs.realpath(root); if (canonicalRoot !== root) throw new RuntimeGenerationError("STORAGE_FAILURE");
    for (const path of [join(root, "agents"), agentRoot(agentId), join(agentRoot(agentId), "generations")]) {
      try { await fs.mkdir(path, { mode: 0o700 }); } catch (error) { if ((error as { code?: unknown }).code !== "EEXIST") throw error; }
      await safeDirectory(path, canonicalRoot);
    }
    return canonicalRoot;
  }

  async function verifyComplete(staged: StagedGeneration): Promise<Marker> {
    const canonicalRoot = await ensureRoot(staged.agentId);
    if (!inside(root, staged.stagedRoot) || resolve(staged.stagedRoot) !== generationRoot(staged.agentId, staged.generation.generation))
      throw new RuntimeGenerationError("STORAGE_FAILURE");
    const realStaged = await safeDirectory(staged.stagedRoot, canonicalRoot);
    if (realStaged !== resolve(staged.stagedRoot)) throw new RuntimeGenerationError("STORAGE_FAILURE");
    const marker = parseMarker(await readJson(join(staged.stagedRoot, ".orgops-generation.json")));
    if (marker.agentId !== staged.agentId || marker.deploymentId !== staged.deploymentId || marker.generation !== staged.generation.generation
      || marker.packageSetDigest !== staged.packageSetDigest || marker.semanticDigest !== staged.semanticDigest) throw new RuntimeGenerationError("STORAGE_FAILURE");
    const actual = new Set<string>();
    const walk = async (directoryPath: string, prefix = "") => {
      const before = await safeDirectory(directoryPath, canonicalRoot);
      for (const entry of await fs.readdir(directoryPath, { withFileTypes: true })) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (path === ".orgops-generation.json") continue;
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new RuntimeGenerationError("STORAGE_FAILURE");
        if (entry.isDirectory()) await walk(join(directoryPath, entry.name), path); else actual.add(path);
      }
      if (await fs.realpath(directoryPath) !== before) throw new RuntimeGenerationError("STORAGE_FAILURE");
    };
    await walk(staged.stagedRoot);
    if (actual.size !== marker.files.length) throw new RuntimeGenerationError("STORAGE_FAILURE");
    for (const expected of marker.files) {
      if (!actual.has(expected.path)) throw new RuntimeGenerationError("STORAGE_FAILURE");
      const path = join(staged.stagedRoot, ...expected.path.split("/")); if (!inside(staged.stagedRoot, path)) throw new RuntimeGenerationError("STORAGE_FAILURE");
      const { bytes, stat } = await openRegular(path, 1_048_576);
      if ((Number(stat.mode) & 0o777) !== expected.mode || fileDigest(bytes) !== expected.digest) throw new RuntimeGenerationError("STORAGE_FAILURE");
    }
    if (await fs.realpath(staged.stagedRoot) !== realStaged || await fs.realpath(root) !== canonicalRoot) throw new RuntimeGenerationError("STORAGE_FAILURE");
    return marker;
  }

  async function ensureTempDirectory(path: string, canonicalRoot: string): Promise<void> {
    await fs.mkdir(path, { mode: 0o700 }); await safeDirectory(path, canonicalRoot);
  }
  async function ensureParents(tempRoot: string, target: string, canonicalRoot: string): Promise<void> {
    const relativePath = relative(tempRoot, dirname(target)); let current = tempRoot;
    for (const component of relativePath.split(sep).filter(Boolean)) {
      current = join(current, component);
      try { await fs.mkdir(current, { mode: 0o700 }); } catch (error) { if ((error as { code?: unknown }).code !== "EEXIST") throw error; }
      await safeDirectory(current, canonicalRoot);
    }
  }

  async function stage(rawCommand: unknown, rawArtifact: VerifiedArtifactEnvelope): Promise<StagedGeneration> {
    const command = DeploymentCommandSchema.safeParse(rawCommand);
    if (!command.success || !verifyArtifact(command.data, rawArtifact).ok) throw new RuntimeGenerationError("INSPECTION_FAILED");
    const artifact = rawArtifact; const finalRoot = generationRoot(command.data.agentId, command.data.desiredGeneration);
    const generation: RuntimeGeneration = { generation: command.data.desiredGeneration, skillRoot: join(finalRoot, "skills"), promptRoot: join(finalRoot, "skills"), eventShapeRoot: join(finalRoot, "skills") };
    const staged = StagedGenerationSchema.parse({ agentId: command.data.agentId, deploymentId: command.data.deploymentId, generation, stagedRoot: finalRoot,
      packageSetDigest: command.data.packageSetDigest, semanticDigest: artifact.semanticDigest });
    const canonicalRoot = await ensureRoot(command.data.agentId);
    try { await fs.lstat(finalRoot); await verifyComplete(staged); return bindStaged(staged); }
    catch (error) { if (!missing(error)) {
      try { await fs.lstat(finalRoot); throw error; } catch (statError) { if (!missing(statError)) throw error; }
    } }
    const tempRoot = join(agentRoot(command.data.agentId), "generations", `.tmp-${hash(command.data.deploymentId)}-${randomUUID()}`);
    await ensureTempDirectory(tempRoot, canonicalRoot);
    try {
      await ensureTempDirectory(join(tempRoot, "skills"), canonicalRoot);
      const marker: Marker = { agentId: command.data.agentId, deploymentId: command.data.deploymentId, generation: command.data.desiredGeneration,
        packageSetDigest: command.data.packageSetDigest, semanticDigest: artifact.semanticDigest, files: [] };
      for (const file of artifact.files) {
        const pkg = artifact.packages.find(item => item.release.packageReleaseId === file.packageReleaseId)!;
        const relativePath = `skills/${pkg.release.name}/${file.path}`; const target = join(tempRoot, ...relativePath.split("/"));
        if (!inside(tempRoot, target)) throw new RuntimeGenerationError("STORAGE_FAILURE");
        await ensureParents(tempRoot, target, canonicalRoot);
        const bytes = Buffer.from(file.bytesBase64, "base64"); await fs.writeFile(target, bytes, { flag: "wx", mode: file.mode }); await fs.chmod(target, file.mode);
        marker.files.push({ path: relativePath, mode: file.mode, digest: fileDigest(bytes) });
      }
      marker.files.sort((a, b) => a.path.localeCompare(b.path));
      await fs.writeFile(join(tempRoot, ".orgops-generation.json"), JSON.stringify(marker), { flag: "wx", mode: 0o600 });
      try { await fs.lstat(finalRoot); throw new RuntimeGenerationError("STORAGE_FAILURE"); } catch (error) { if (!missing(error)) throw error; }
      await fs.rename(tempRoot, finalRoot); await verifyComplete(staged); return bindStaged(staged);
    } catch (error) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
      if ((error as { code?: unknown }).code === "EEXIST" || (error as { code?: unknown }).code === "ENOTEMPTY") { await verifyComplete(staged); return bindStaged(staged); }
      throw error instanceof RuntimeGenerationError ? error : new RuntimeGenerationError("STORAGE_FAILURE");
    }
  }

  async function loadPointer(agentId: string): Promise<Pointer> {
    const state = stateFor(agentId); if (state.pointer) return state.pointer;
    await ensureRoot(agentId); await beforePointerRead?.();
    const pointer = parsePointer(await readJson(join(agentRoot(agentId), "current.json")));
    if (pointer.agentId !== agentId || !inside(root, pointer.stagedRoot) || resolve(pointer.stagedRoot) !== generationRoot(agentId, pointer.generation)
      || pointer.skillRoot !== join(pointer.stagedRoot, "skills") || pointer.promptRoot !== pointer.skillRoot || pointer.eventShapeRoot !== pointer.skillRoot)
      throw new RuntimeGenerationError("STORAGE_FAILURE");
    await verifyComplete({ agentId, deploymentId: pointer.deploymentId, stagedRoot: pointer.stagedRoot, packageSetDigest: pointer.packageSetDigest,
      semanticDigest: pointer.semanticDigest, generation: { generation: pointer.generation, skillRoot: pointer.skillRoot, promptRoot: pointer.promptRoot, eventShapeRoot: pointer.eventShapeRoot } });
    state.pointer = pointer; return pointer;
  }

  async function captureForTurn(agentId: string): Promise<TurnLease> {
    const state = stateFor(agentId); const unlock = await acquire(state);
    let generation: RuntimeGeneration;
    try {
      if (state.pointer) {
        generation = immutableGeneration({ generation: state.pointer.generation, skillRoot: state.pointer.skillRoot,
          promptRoot: state.pointer.promptRoot, eventShapeRoot: state.pointer.eventShapeRoot });
      } else {
        await ensureRoot(agentId);
        try {
          await fs.lstat(join(agentRoot(agentId), "current.json"));
          const pointer = await loadPointer(agentId);
          generation = immutableGeneration({ generation: pointer.generation, skillRoot: pointer.skillRoot,
            promptRoot: pointer.promptRoot, eventShapeRoot: pointer.eventShapeRoot });
        } catch (error) {
          if (!missing(error) || !fallbackGeneration) throw error;
          generation = immutableGeneration(fallbackGeneration);
        }
      }
      state.leases++;
    } finally { unlock(); }
    let released = false;
    return Object.freeze({ agentId, generation, release() {
      if (released) return; released = true; state.leases--; if (state.leases === 0) for (const wake of [...state.idleWaiters]) wake();
    } });
  }

  async function activateWhenIdle(rawStaged: StagedGeneration) {
    const binding = rawStaged && typeof rawStaged === "object" ? stagedBindings.get(rawStaged) : undefined;
    if (!binding) throw new RuntimeGenerationError("STORAGE_FAILURE");
    const parsed = StagedGenerationSchema.safeParse(binding.staged); if (!parsed.success) throw new RuntimeGenerationError("STORAGE_FAILURE");
    const staged = binding.staged;
    const state = stateFor(staged.agentId);
    const unlock = await acquire(state);
    let swapped = false;
    let claimedPending = false;
    let result: { agentId: string; deploymentId: string; generation: string };
    try {
      const isPending = state.pendingBinding === binding && binding.status === "staged";
      const isActive = state.activeBinding === binding && binding.status === "active";
      if (!isPending && !isActive) throw new RuntimeGenerationError("STORAGE_FAILURE");
      if (!state.pointer) {
        const pointerPath = join(agentRoot(staged.agentId), "current.json");
        try { await fs.lstat(pointerPath); await loadPointer(staged.agentId); } catch (error) { if (!missing(error)) throw error; }
      }
      if (state.pointer?.deploymentId === staged.deploymentId && state.pointer.generation === staged.generation.generation
        && state.pointer.packageSetDigest === staged.packageSetDigest && state.pointer.semanticDigest === staged.semanticDigest) {
        await verifyComplete(staged);
        if (isPending) {
          if (state.pendingBinding !== binding || binding.status !== "staged") throw new RuntimeGenerationError("STORAGE_FAILURE");
          if (state.activeBinding) state.activeBinding.status = "superseded";
          binding.status = "active";
          state.activeBinding = binding;
          state.pendingBinding = undefined;
          observeBindings(state);
        }
        result = { agentId: staged.agentId, deploymentId: staged.deploymentId, generation: staged.generation.generation };
      } else {
        if (!isPending) throw new RuntimeGenerationError("STORAGE_FAILURE");
        await verifyComplete(staged);
        if (state.leases > 0) await new Promise<void>(resolveIdle => { const wake = () => { if (state.leases === 0) { state.idleWaiters.delete(wake); resolveIdle(); } }; state.idleWaiters.add(wake); });
        if (state.pendingBinding !== binding || binding.status !== "staged") throw new RuntimeGenerationError("STORAGE_FAILURE");
        await verifyComplete(staged);
        if (state.pendingBinding !== binding || binding.status !== "staged") throw new RuntimeGenerationError("STORAGE_FAILURE");
        state.pendingBinding = undefined;
        claimedPending = true;
        const pointer: Pointer = { agentId: staged.agentId, deploymentId: staged.deploymentId, generation: staged.generation.generation,
          packageSetDigest: staged.packageSetDigest, semanticDigest: staged.semanticDigest, stagedRoot: staged.stagedRoot,
          skillRoot: staged.generation.skillRoot, promptRoot: staged.generation.promptRoot, eventShapeRoot: staged.generation.eventShapeRoot };
        const pointerPath = join(agentRoot(staged.agentId), "current.json");
        try { const stat = await fs.lstat(pointerPath); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new RuntimeGenerationError("STORAGE_FAILURE"); }
        catch (error) { if (!missing(error)) throw error; }
        const temporary = `${pointerPath}.tmp-${randomUUID()}`;
        try { await fs.writeFile(temporary, JSON.stringify(pointer), { flag: "wx", mode: 0o600 }); await fs.rename(temporary, pointerPath); }
        catch (error) { await fs.rm(temporary, { force: true }).catch(() => undefined); throw error; }
        state.pointer = pointer;
        if (state.activeBinding) state.activeBinding.status = "superseded";
        binding.status = "active";
        state.activeBinding = binding;
        claimedPending = false;
        observeBindings(state);
        swapped = true;
        result = { agentId: staged.agentId, deploymentId: staged.deploymentId, generation: staged.generation.generation };
      }
    } catch (error) {
      if (claimedPending) {
        if (state.pendingBinding) binding.status = "superseded";
        else state.pendingBinding = binding;
        observeBindings(state);
      }
      unlock();
      throw error instanceof RuntimeGenerationError ? error : new RuntimeGenerationError("STORAGE_FAILURE");
    }
    unlock();
    if (swapped && onPointerChange) {
      try {
        void Promise.resolve(onPointerChange(staged.agentId, staged.generation.generation)).catch(() => undefined);
      } catch { /* The durable pointer remains authoritative. */ }
    }
    return result;
  }

  return { captureForTurn, stage, activateWhenIdle };
}
