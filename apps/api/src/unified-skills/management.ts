import { randomUUID } from "node:crypto";
import type { OrgOpsDb } from "@orgops/db";
import {
  CatalogAssignmentAuditEventSchema,
  SkillAuditEventSchema,
  SkillDeploymentEventSchema,
  SkillCommandSchema,
  type CatalogLibraryErrorCode,
  type InventoryActor,
  type SkillCommand,
  type SkillSelection,
} from "@orgops/schemas";

const MAX_REVISION = 2_147_483_647;
export type CatalogDesiredAssignment = Readonly<{
  packageReleaseId: string;
  desired: "ENABLED" | "DISABLED";
  preload: boolean;
}>;

export function catalogDesiredSetChanged(before: readonly CatalogDesiredAssignment[], after: readonly CatalogDesiredAssignment[]): boolean {
  const canonical = (set: readonly CatalogDesiredAssignment[]) => [...set].sort((a, b) => a.packageReleaseId.localeCompare(b.packageReleaseId));
  const left = canonical(before);
  const right = canonical(after);
  return left.length !== right.length || left.some((entry, index) => {
    const other = right[index]!;
    return entry.packageReleaseId !== other.packageReleaseId || entry.desired !== other.desired || entry.preload !== other.preload;
  });
}

export class AgentSkillManagementError extends Error {
  constructor(readonly code: CatalogLibraryErrorCode) { super(code); }
}
const fail = (code: CatalogLibraryErrorCode): never => { throw new AgentSkillManagementError(code); };

type AgentRow = Readonly<{ id: string; name: string; revision: number; assigned_runner_id: string | null; enabled_skills_json: string; always_preloaded_skills_json: string }>;
type AssignmentRow = Readonly<{
  assignment_id: string; agent_id: string; release_id: string; local_skill_name: string;
  desired_state: "ENABLED" | "DISABLED"; effective_state: "ENABLED" | "DISABLED";
  deployment_state: "STABLE" | "REQUESTED" | "DEPLOYING" | "FAILED"; removal_requested: number; preload: number;
  effective_preload: number; active_generation: string | null; desired_generation: string; revision: number;
}>;

export type LocalBatch = Readonly<{ agentId: string; enabled: readonly string[]; preloaded: readonly string[]; expectedAgentRevision?: number }>;
type CatalogValidation = Readonly<{ localSkillName: string; runnerId: string; exactRef?: Record<string, unknown>; actorKind?: "ADMIN" | "GRANT"; grantId?: string | null }>;
export type AgentSkillManagementDeps = Readonly<{
  db: OrgOpsDb;
  requireLiveHuman?: (tx: OrgOpsDb, actor: InventoryActor) => void;
  requireManageableAgent?: (tx: OrgOpsDb, agentId: string, actor: InventoryActor) => AgentRow;
  validateCatalog?: (tx: OrgOpsDb, command: Extract<SkillCommand, { kind: "CATALOG" }>, actor: InventoryActor) => CatalogValidation;
  localSkillExists?: (tx: OrgOpsDb, name: string) => boolean;
  localOriginForName?: (tx: OrgOpsDb, name: string) => "BUILT_IN" | "WORKSPACE";
  enqueueCompleteGeneration?: (tx: OrgOpsDb, agentId: string, generation: string, assignments: readonly CatalogDesiredAssignment[]) => string | undefined;
  enqueueLegacyGeneration?: (tx: OrgOpsDb, agentId: string, generation: string, assignments: readonly CatalogDesiredAssignment[]) => string | undefined;
  writeAudit?: (tx: OrgOpsDb, event: unknown) => void;
  now?: () => number;
  newId?: () => string;
}>;

export type SkillMutationResult = Readonly<{
  ref: Readonly<Record<string, unknown>>;
  desired: "ENABLED" | "DISABLED" | "ABSENT";
  effective: "ENABLED" | "DISABLED";
  preload: boolean;
  deployment: "STABLE" | "REQUESTED" | "DEPLOYING" | "FAILED";
  revision: number;
  agentRevision: number;
  deploymentId?: string;
}>;
export type SkillBatchResult = Readonly<{
  agentRevision: number;
  catalogSetChanged: boolean;
  deploymentId?: string;
  results: readonly SkillMutationResult[];
}>;
export type AgentSkillManagement = Readonly<{
  execute(raw: unknown, actor: InventoryActor): Promise<SkillMutationResult>;
  executeBatch(raw: readonly unknown[], actor: InventoryActor): Promise<SkillBatchResult>;
  updateLocalBatch(batch: LocalBatch, actor: InventoryActor): Promise<SkillBatchResult>;
  updateLocalBatchInTransaction(tx: OrgOpsDb, batch: LocalBatch, actor: InventoryActor): SkillBatchResult;
  history(agentId: string, query: unknown, actor: InventoryActor): readonly unknown[];
  executeLegacyCatalog(raw: unknown, actor: InventoryActor): Promise<SkillMutationResult>;
  preflight(agentId: string, selection: readonly SkillSelection[], actor: InventoryActor): unknown;
  inTransaction(tx: OrgOpsDb, actor: InventoryActor, commands: readonly unknown[], expectedAgentRevision: number): { recheck(): void; applyAll(): SkillBatchResult };
}>;

function parseNames(value: string): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { fail("STATE_CONFLICT"); }
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string" || item.length < 1 || item.length > 200) || new Set(parsed).size !== parsed.length) fail("STATE_CONFLICT");
  return parsed as string[];
}
function idWithin(value: string): boolean { return value.length > 0 && value.length <= 200; }
function asCatalogCommand(command: SkillCommand): Extract<SkillCommand, { kind: "CATALOG" }> | undefined { return command.kind === "CATALOG" ? command : undefined; }

export function createAgentSkillManagement(deps: AgentSkillManagementDeps): AgentSkillManagement {
  const now = deps.now ?? Date.now;
  const newId: () => string = deps.newId ?? (() => randomUUID());
  const requireLiveHuman = deps.requireLiveHuman ?? ((tx, actor) => {
    if (actor.kind !== "HUMAN_ADMIN" && actor.kind !== "AUTHENTICATED_HUMAN") fail("FORBIDDEN");
    const human = tx.prepare<[string], { is_admin: number; must_change_password: number }>("SELECT is_admin,must_change_password FROM humans WHERE id=?").get(actor.id);
    if (!human || human.must_change_password !== 0 || (actor.kind === "HUMAN_ADMIN") !== (human.is_admin === 1)) fail("FORBIDDEN");
  });
  const requireManageableAgent = deps.requireManageableAgent ?? ((tx, agentId) => {
    const row = tx.prepare<[string], AgentRow>("SELECT id,name,revision,assigned_runner_id,enabled_skills_json,always_preloaded_skills_json FROM agents WHERE id=?").get(agentId);
    return row ?? fail("FORBIDDEN");
  });
  const localSkillExists = deps.localSkillExists ?? (() => true);
  const localOriginForName = deps.localOriginForName ?? (() => "WORKSPACE" as const);
  const localRef = (tx: OrgOpsDb, name: string) => ({ kind: "LOCAL" as const, name, localOrigin: localOriginForName(tx, name) });
  const writeLocalAudit = (tx: OrgOpsDb, actor: InventoryActor, agentId: string, refs: readonly Record<string, unknown>[], operation: "ADD" | "REMOVE" | "ENABLE" | "DISABLE" | "SET_PRELOAD", revision: number) => {
    for (const ref of refs) deps.writeAudit?.(tx, { type: "audit.skill.changed", source: "system", channelId: null, status: "DELIVERED", payload: { actorKind: actor.kind, actorId: actor.id, agentId, ref, operation, revision, outcome: "SUCCEEDED" } });
  };

  function validateAssignmentRow(row: AssignmentRow): AssignmentRow {
    if (!idWithin(row.assignment_id) || !idWithin(row.agent_id) || !idWithin(row.release_id) || !idWithin(row.local_skill_name)
      || !["ENABLED", "DISABLED"].includes(row.desired_state) || !["ENABLED", "DISABLED"].includes(row.effective_state)
      || !["STABLE", "REQUESTED", "DEPLOYING", "FAILED"].includes(row.deployment_state)
      || ![0, 1].includes(row.removal_requested) || ![0, 1].includes(row.preload) || ![0, 1].includes(row.effective_preload)
      || !idWithin(row.desired_generation) || (row.active_generation !== null && !idWithin(row.active_generation)) || row.revision < 1 || row.revision > MAX_REVISION) fail("STATE_CONFLICT");
    if ((row.effective_state === "ENABLED" && row.active_generation === null) || (row.effective_state === "DISABLED" && row.effective_preload !== 0)) fail("STATE_CONFLICT");
    if (row.deployment_state === "STABLE" && (row.desired_state !== row.effective_state || row.preload !== row.effective_preload || row.active_generation !== row.desired_generation)) fail("STATE_CONFLICT");
    return row;
  }
  function readAssignments(tx: OrgOpsDb, agentId: string): AssignmentRow[] {
    return tx.prepare<[string], AssignmentRow>(`SELECT assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,
      deployment_state,removal_requested,preload,effective_preload,active_generation,desired_generation,revision
      FROM agent_skill_assignments WHERE agent_id=? ORDER BY release_id`).all(agentId).map(validateAssignmentRow);
  }
  function desiredSet(rows: readonly AssignmentRow[]): CatalogDesiredAssignment[] {
    return rows.filter(row => row.removal_requested === 0).map(row => ({ packageReleaseId: row.release_id, desired: row.desired_state, preload: row.preload === 1 }));
  }
  function checkRevision(agent: AgentRow, expected: number): void {
    if (agent.revision !== expected || expected >= MAX_REVISION) fail("REVISION_CONFLICT");
  }
  function checkAssignment(row: AssignmentRow | undefined, expected: number): void {
    if ((row?.revision ?? 0) !== expected || expected >= MAX_REVISION) fail("REVISION_CONFLICT");
  }
  function checkCommandAssignment(row: AssignmentRow | undefined, command: Extract<SkillCommand, { kind: "CATALOG" }>): void {
    // ASSIGN0 is the non-enumerating resurrection token for a hidden tombstone.
    if (command.operation === "ASSIGN" && row?.removal_requested === 1) {
      if (command.expectedAssignmentRevision !== 0 || row.revision >= MAX_REVISION) fail("REVISION_CONFLICT");
      return;
    }
    checkAssignment(row, command.expectedAssignmentRevision);
  }
  function applyLocal(tx: OrgOpsDb, agent: AgentRow, command: Extract<SkillCommand, { kind: "LOCAL" }>, actor: InventoryActor): SkillMutationResult {
    const enabled = parseNames(agent.enabled_skills_json);
    const preloaded = parseNames(agent.always_preloaded_skills_json);
    const enabledSet = new Set(enabled);
    const preloadSet = new Set(preloaded);
    const exists = enabledSet.has(command.name);
    if (!localSkillExists(tx, command.name)) fail("NOT_FOUND");
    if (command.operation === "ADD") {
      if (exists) fail("STATE_CONFLICT");
      enabled.push(command.name); enabledSet.add(command.name);
      if (command.preload) { preloaded.push(command.name); preloadSet.add(command.name); }
    } else if (command.operation === "REMOVE") {
      if (!exists) fail("NOT_FOUND");
      enabled.splice(enabled.indexOf(command.name), 1); enabledSet.delete(command.name);
      if (preloadSet.delete(command.name)) preloaded.splice(preloaded.indexOf(command.name), 1);
    } else if (command.operation === "ENABLE") {
      if (exists) fail("STATE_CONFLICT");
      enabled.push(command.name); enabledSet.add(command.name);
    } else if (command.operation === "DISABLE") {
      if (!exists) fail("NOT_FOUND");
      enabled.splice(enabled.indexOf(command.name), 1); enabledSet.delete(command.name);
      if (preloadSet.delete(command.name)) preloaded.splice(preloaded.indexOf(command.name), 1);
    } else {
      if (!("preload" in command) || !exists || (command.preload && !enabledSet.has(command.name))) fail("STATE_CONFLICT");
      if ("preload" in command && command.preload) { if (!preloadSet.has(command.name)) preloaded.push(command.name); preloadSet.add(command.name); }
      else if (preloadSet.delete(command.name)) preloaded.splice(preloaded.indexOf(command.name), 1);
    }
    tx.prepare("UPDATE agents SET enabled_skills_json=?,always_preloaded_skills_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?")
      .run(JSON.stringify(enabled), JSON.stringify(preloaded.filter(name => enabledSet.has(name))), now(), agent.id, agent.revision);
    writeLocalAudit(tx, actor, agent.id, [localRef(tx, command.name)], command.operation === "SET_PRELOAD" ? "SET_PRELOAD" : command.operation, agent.revision + 1);
    return { ref: { kind: "LOCAL", name: command.name }, desired: enabledSet.has(command.name) ? "ENABLED" : "ABSENT", effective: enabledSet.has(command.name) ? "ENABLED" : "DISABLED", preload: preloadSet.has(command.name), deployment: "STABLE", revision: agent.revision + 1, agentRevision: agent.revision + 1 };
  }

  function applyLocalBatch(tx: OrgOpsDb, batch: LocalBatch, actor: InventoryActor): SkillBatchResult {
    const agent = requireManageableAgent(tx, batch.agentId, actor);
    if (batch.expectedAgentRevision !== undefined) checkRevision(agent, batch.expectedAgentRevision);
    const beforeEnabled = parseNames(agent.enabled_skills_json);
    const beforePreloaded = parseNames(agent.always_preloaded_skills_json);
    const enabled = [...batch.enabled];
    const preloaded = [...batch.preloaded];
    if (new Set(enabled).size !== enabled.length || new Set(preloaded).size !== preloaded.length || preloaded.some(name => !enabled.includes(name))) fail("STATE_CONFLICT");
    for (const name of enabled) if (!localSkillExists(tx, name)) fail("NOT_FOUND");
    if (agent.revision >= MAX_REVISION) fail("REVISION_CONFLICT");
    tx.prepare("UPDATE agents SET enabled_skills_json=?,always_preloaded_skills_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?")
      .run(JSON.stringify(enabled), JSON.stringify(preloaded), now(), agent.id, agent.revision);
    const revision = agent.revision + 1;
    const changedNames = [...new Set([...beforeEnabled, ...beforePreloaded, ...enabled, ...preloaded])].filter(name => beforeEnabled.includes(name) !== enabled.includes(name) || beforePreloaded.includes(name) !== preloaded.includes(name));
    for (const name of changedNames) writeLocalAudit(tx, actor, batch.agentId, [localRef(tx, name)], beforeEnabled.includes(name) !== enabled.includes(name) ? (enabled.includes(name) ? "ADD" : "REMOVE") : "SET_PRELOAD", revision);
    return { agentRevision: revision, catalogSetChanged: false, results: enabled.map(name => ({ ref: { kind: "LOCAL", name }, desired: "ENABLED", effective: "ENABLED", preload: preloaded.includes(name), deployment: "STABLE", revision, agentRevision: revision })) };
  }

  function executeBatchInTransaction(tx: OrgOpsDb, commands: readonly SkillCommand[], actor: InventoryActor, incrementAgentRevision = true, legacy = false): SkillBatchResult {
    if (commands.length === 0) fail("INVALID_REQUEST");
    const agentId = commands[0]!.agentId;
    if (commands.some(command => command.agentId !== agentId)) fail("INVALID_REQUEST");
    requireLiveHuman(tx, actor);
    const agent = requireManageableAgent(tx, agentId, actor);
    if (commands.some(command => command.expectedAgentRevision !== agent.revision)) fail("REVISION_CONFLICT");
    if (commands.length === 1 && commands[0]!.kind === "LOCAL") {
      const result = applyLocal(tx, agent, commands[0]!, actor);
      return { agentRevision: result.agentRevision, catalogSetChanged: false, results: [result] };
    }
    // Validate and derive every operation before the first write.
    const beforeRows = readAssignments(tx, agentId);
    const rows = new Map(beforeRows.map(row => [row.release_id, row]));
    const localCommands = commands.filter((command): command is Extract<SkillCommand, { kind: "LOCAL" }> => command.kind === "LOCAL");
    const catalogCommandsForValidation = commands.map(asCatalogCommand).filter((command): command is Extract<SkillCommand, { kind: "CATALOG" }> => Boolean(command));
    const seenReleases = new Set<string>();
    for (const command of catalogCommandsForValidation) {
      if (seenReleases.has(command.packageReleaseId)) fail("STATE_CONFLICT");
      seenReleases.add(command.packageReleaseId);
      const current = rows.get(command.packageReleaseId);
      checkCommandAssignment(current, command);
      if (command.operation === "ASSIGN" && current && current.removal_requested !== 1) fail("STATE_CONFLICT");
      if (command.operation === "REMOVE" && !current) fail("NOT_FOUND");
      deps.validateCatalog?.(tx, command, actor);
    }
    if (localCommands.length > 0) {
      let localEnabled = parseNames(agent.enabled_skills_json);
      let localPreloaded = parseNames(agent.always_preloaded_skills_json);
      for (const command of localCommands) {
        if (!localSkillExists(tx, command.name)) fail("NOT_FOUND");
        const enabled = new Set(localEnabled); const preloaded = new Set(localPreloaded);
        if (command.operation === "ADD" || command.operation === "ENABLE") { if (enabled.has(command.name)) fail("STATE_CONFLICT"); enabled.add(command.name); if (command.operation === "ADD" && "preload" in command && command.preload) preloaded.add(command.name); }
        else if (command.operation === "REMOVE" || command.operation === "DISABLE") { if (!enabled.has(command.name)) fail("NOT_FOUND"); enabled.delete(command.name); preloaded.delete(command.name); }
        else { const preload = "preload" in command ? command.preload : false; if (!enabled.has(command.name)) fail("STATE_CONFLICT"); preload ? preloaded.add(command.name) : preloaded.delete(command.name); }
        localEnabled = [...enabled]; localPreloaded = [...preloaded];
      }
      tx.prepare("UPDATE agents SET enabled_skills_json=?,always_preloaded_skills_json=?,updated_at=? WHERE id=? AND revision=?").run(JSON.stringify(localEnabled), JSON.stringify(localPreloaded), now(), agent.id, agent.revision);
    }
    const catalogCommands = commands.map(asCatalogCommand).filter((command): command is Extract<SkillCommand, { kind: "CATALOG" }> => Boolean(command));
    const mutatedCatalogCommands: typeof catalogCommands = [];
    const catalogAudits: Array<{ command: Extract<SkillCommand, { kind: "CATALOG" }>; result: SkillMutationResult }> = [];
    const before = desiredSet(beforeRows);
    const results: SkillMutationResult[] = [];
    const batchGeneration = catalogCommands.length > 0 && !legacy ? newId() : undefined;
    for (const command of catalogCommands) {
      const current = rows.get(command.packageReleaseId);
      checkCommandAssignment(current, command);
      if (command.operation === "ASSIGN" && current && current.removal_requested !== 1) fail("STATE_CONFLICT");
      if (command.operation === "REMOVE" && !current) fail("NOT_FOUND");
      const validation = deps.validateCatalog?.(tx, command, actor) ?? { localSkillName: command.packageReleaseId, runnerId: agent.assigned_runner_id ?? fail("STATE_CONFLICT") };
      if (current && current.local_skill_name !== validation.localSkillName) fail("STATE_CONFLICT");
      if (command.operation === "REMOVE") {
        const generation = batchGeneration ?? newId();
        mutatedCatalogCommands.push(command);
        tx.prepare("UPDATE agent_skill_assignments SET desired_state='DISABLED',removal_requested=1,preload=0,deployment_state='REQUESTED',desired_generation=?,revision=?,updated_at=? WHERE assignment_id=? AND revision=?")
          .run(generation, current!.revision + 1, now(), current!.assignment_id, current!.revision);
        rows.delete(command.packageReleaseId);
        const result: SkillMutationResult = { ref: { kind: "CATALOG", packageReleaseId: command.packageReleaseId, assignmentId: current!.assignment_id, desiredGeneration: generation, activeGeneration: current!.active_generation }, desired: "ABSENT", effective: current!.effective_state, preload: false, deployment: "REQUESTED", revision: current!.revision + 1, agentRevision: incrementAgentRevision ? agent.revision + 1 : agent.revision };
        results.push(result); catalogAudits.push({ command, result });
        continue;
      }
      const desired = command.operation === "DISABLE" ? "DISABLED" : command.operation === "ENABLE" || command.operation === "ASSIGN" ? "ENABLED" : current!.desired_state;
      const preload = "preload" in command && command.preload !== undefined ? command.preload : current?.preload === 1;
      if (!legacy && current && current.removal_requested === 0 && current.desired_state === desired && current.preload === (preload ? 1 : 0)) {
        results.push({ ref: { kind: "CATALOG", packageReleaseId: command.packageReleaseId, assignmentId: current.assignment_id, desiredGeneration: current.desired_generation, activeGeneration: current.active_generation }, desired, effective: current.effective_state, preload, deployment: current.deployment_state, revision: current.revision, agentRevision: agent.revision });
        continue;
      }
      const revision = (current?.revision ?? 0) + 1;
      mutatedCatalogCommands.push(command);
      const assignmentId = current?.assignment_id ?? newId();
      const generation = batchGeneration ?? newId();
      if (![generation, assignmentId].every(idWithin)) fail("STORAGE_FAILURE");
      if (current) tx.prepare("UPDATE agent_skill_assignments SET desired_state=?,removal_requested=0,preload=?,deployment_state='REQUESTED',desired_generation=?,revision=?,actor_kind=?,actor_human_id=?,grant_id=?,updated_at=? WHERE assignment_id=?").run(desired, preload ? 1 : 0, generation, revision, validation.actorKind ?? (actor.kind === "HUMAN_ADMIN" ? "ADMIN" : "GRANT"), actor.id, validation.grantId ?? null, now(), assignmentId);
      else tx.prepare(`INSERT INTO agent_skill_assignments (assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,preload,effective_preload,active_generation,desired_generation,revision,actor_kind,actor_human_id,grant_id,created_at,updated_at) VALUES (?,?,?,?,?,'DISABLED','REQUESTED',?,0,NULL,?,?,?,?,?,?,?)`).run(assignmentId, agentId, command.packageReleaseId, validation.localSkillName, desired, preload ? 1 : 0, generation, revision, validation.actorKind ?? (actor.kind === "HUMAN_ADMIN" ? "ADMIN" : "GRANT"), actor.id, validation.grantId ?? null, now(), now());
      rows.set(command.packageReleaseId, { ...(current ?? { assignment_id: assignmentId, agent_id: agentId, release_id: command.packageReleaseId, local_skill_name: validation.localSkillName, removal_requested: 0, effective_state: "DISABLED", deployment_state: "REQUESTED", effective_preload: 0, active_generation: null }), desired_state: desired, removal_requested: 0, preload: preload ? 1 : 0, desired_generation: generation, revision } as AssignmentRow);
      const result: SkillMutationResult = { ref: { kind: "CATALOG", packageReleaseId: command.packageReleaseId, assignmentId, desiredGeneration: generation, activeGeneration: current?.active_generation ?? null }, desired, effective: current?.effective_state ?? "DISABLED", preload, deployment: "REQUESTED", revision, agentRevision: incrementAgentRevision ? agent.revision + 1 : agent.revision };
      results.push(result); catalogAudits.push({ command, result });
    }
    const after = desiredSet([...rows.values()]);
    const changed = catalogCommands.length > 0 && (legacy ? mutatedCatalogCommands.length > 0 : catalogDesiredSetChanged(before, after));
    const generation = changed ? (batchGeneration ?? [...rows.values()][0]?.desired_generation) : undefined;
    const enqueue = legacy ? (deps.enqueueLegacyGeneration ?? deps.enqueueCompleteGeneration) : deps.enqueueCompleteGeneration;
    const deploymentId = changed && generation ? enqueue?.(tx, agentId, generation, after) : undefined;
    for (const command of localCommands) writeLocalAudit(tx, actor, agentId, [localRef(tx, command.name)], command.operation, incrementAgentRevision ? agent.revision + 1 : agent.revision);
    for (const { command, result } of catalogAudits) {
      const ref = result.ref as { desiredGeneration?: unknown; activeGeneration?: unknown };
      deps.writeAudit?.(tx, CatalogAssignmentAuditEventSchema.parse({ type: "audit.catalog.assignment.changed", source: "system", status: "DELIVERED", channelId: null, payload: {
        actorKind: actor.kind, actorId: actor.id, agentId, releaseId: command.packageReleaseId, operation: command.operation,
        outcome: "SUCCEEDED", revision: result.revision, deploymentId, desiredGeneration: ref.desiredGeneration,
        effectiveGeneration: ref.activeGeneration ?? null, state: result.deployment, failureCode: null,
      } }));
    }
    if (incrementAgentRevision && (localCommands.length > 0 || mutatedCatalogCommands.length > 0)) {
      const advanced = tx.prepare("UPDATE agents SET revision=revision+1,updated_at=? WHERE id=? AND revision=?").run(now(), agent.id, agent.revision);
      if (advanced.changes !== 1) fail("REVISION_CONFLICT");
    }
    return { agentRevision: incrementAgentRevision && (localCommands.length > 0 || mutatedCatalogCommands.length > 0) ? agent.revision + 1 : agent.revision, catalogSetChanged: changed, ...(deploymentId ? { deploymentId } : {}), results };
  }

  function inTransaction(tx: OrgOpsDb, actor: InventoryActor, raw: readonly unknown[], expectedAgentRevision: number) {
    const commands = raw.map(command => SkillCommandSchema.parse(command));
    return {
      recheck() {
        requireLiveHuman(tx, actor);
        const agent = requireManageableAgent(tx, commands[0]!.agentId, actor);
        if (agent.revision !== expectedAgentRevision || commands.some(command => command.expectedAgentRevision !== expectedAgentRevision)) fail("REVISION_CONFLICT");
      },
      applyAll() { return executeBatchInTransaction(tx, commands, actor); },
    };
  }
  async function executeBatch(raw: readonly unknown[], actor: InventoryActor): Promise<SkillBatchResult> {
    try {
      const commands = raw.map(command => SkillCommandSchema.parse(command));
      return deps.db.transaction(() => executeBatchInTransaction(deps.db, commands, actor)).immediate();
    } catch (error) {
      if (error instanceof AgentSkillManagementError) throw error;
      if (error && typeof error === "object" && "issues" in error) throw new AgentSkillManagementError("INVALID_REQUEST");
      throw new AgentSkillManagementError("STORAGE_FAILURE");
    }
  }
  async function execute(raw: unknown, actor: InventoryActor): Promise<SkillMutationResult> {
    const batch = await executeBatch([raw], actor);
    const result = batch.results[0];
    if (!result || Object.keys(result.ref).length === 0) {
      // Local command results are reconstructed from the committed command, preserving one write boundary.
      const command = SkillCommandSchema.parse(raw);
      const enabled = command.kind === "LOCAL" && command.operation !== "REMOVE" && command.operation !== "DISABLE";
      return { ref: { kind: "LOCAL", name: command.kind === "LOCAL" ? command.name : "" }, desired: enabled ? "ENABLED" : "ABSENT", effective: enabled ? "ENABLED" : "DISABLED", preload: command.kind === "LOCAL" && "preload" in command ? command.preload : false, deployment: "STABLE", revision: batch.agentRevision, agentRevision: batch.agentRevision };
    }
    return result;
  }
  async function executeLegacyCatalog(raw: unknown, actor: InventoryActor): Promise<SkillMutationResult> {
    try {
      const command = SkillCommandSchema.parse(raw);
      if (command.kind !== "CATALOG") throw new AgentSkillManagementError("INVALID_REQUEST");
      const batch = deps.db.transaction(() => executeBatchInTransaction(deps.db, [command], actor, false, true)).immediate();
      return batch.results[0]!;
    } catch (error) {
      if (error instanceof AgentSkillManagementError) throw error;
      if (error && typeof error === "object" && "issues" in error) throw new AgentSkillManagementError("INVALID_REQUEST");
      throw new AgentSkillManagementError("STORAGE_FAILURE");
    }
  }
  function updateLocalBatchInTransaction(tx: OrgOpsDb, batch: LocalBatch, actor: InventoryActor): SkillBatchResult {
    requireLiveHuman(tx, actor);
    return applyLocalBatch(tx, batch, actor);
  }
  async function updateLocalBatch(batch: LocalBatch, actor: InventoryActor): Promise<SkillBatchResult> {
    try { return deps.db.transaction(() => updateLocalBatchInTransaction(deps.db, batch, actor)).immediate(); }
    catch (error) { throw error instanceof AgentSkillManagementError ? error : new AgentSkillManagementError("STORAGE_FAILURE"); }
  }
  function preflight(agentId: string, selection: readonly SkillSelection[], actor: InventoryActor): unknown {
    return deps.db.transaction(() => {
      requireLiveHuman(deps.db, actor);
      const agent = requireManageableAgent(deps.db, agentId, actor);
      const exactSkillRefs: Record<string, unknown>[] = [];
      const creationBlockers: Array<{ code: string; requirement?: string }> = [];
      const startBlockers: Array<{ code: string; requirement?: string }> = [];
      for (const item of selection) {
        if (item.kind === "LOCAL") {
          if (!localSkillExists(deps.db, item.name)) creationBlockers.push({ code: "NOT_FOUND" });
          else exactSkillRefs.push(localRef(deps.db, item.name));
          continue;
        }
        const rawRow = deps.db.prepare<[string, string], AssignmentRow>("SELECT assignment_id,agent_id,release_id,local_skill_name,desired_state,effective_state,deployment_state,removal_requested,preload,effective_preload,active_generation,desired_generation,revision FROM agent_skill_assignments WHERE agent_id=? AND release_id=?").get(agentId, item.packageReleaseId);
        const row = rawRow === undefined ? undefined : validateAssignmentRow(rawRow);
        try {
          const validation = deps.validateCatalog?.(deps.db, { kind: "CATALOG", operation: row ? "ENABLE" : "ASSIGN", agentId, packageReleaseId: item.packageReleaseId, preload: item.preload, expectedAgentRevision: agent.revision, expectedAssignmentRevision: row?.revision ?? 0 }, actor);
          if (validation?.exactRef) exactSkillRefs.push(validation.exactRef);
          if (!row || row.removal_requested === 1 || row.desired_state !== "ENABLED" || row.effective_state !== "ENABLED" || row.preload !== (item.preload ? 1 : 0) || row.deployment_state !== "STABLE") startBlockers.push({ code: "DEPLOYMENT_REQUIRED" });
        } catch (error) {
          const code = error instanceof AgentSkillManagementError ? error.code : "STORAGE_FAILURE";
          if (["API_ACTIVATION_REQUIRED", "REQUIREMENTS_UNSATISFIED", "OPERATION_IN_PROGRESS"].includes(code)) startBlockers.push({ code });
          else creationBlockers.push({ code });
        }
      }
      return { ok: creationBlockers.length === 0, exactSkillRefs, creationBlockers, startBlockers };
    })();
  }

  function history(agentId: string, query: unknown, actor: InventoryActor): readonly unknown[] {
    const tx = deps.db;
    requireLiveHuman(tx, actor);
    requireManageableAgent(tx, agentId, actor);
    const parsed = query as { kind?: string; packageReleaseId?: string; name?: string; localOrigin?: string };
    try {
      const rows = tx.prepare<[], { id: string; type: string; payload_json: string; source: string; channel_id: string | null; status: string; created_at: number }>(
        "SELECT id,type,payload_json,source,channel_id,status,created_at FROM events WHERE (type='audit.skill.changed' OR type='audit.catalog.assignment.changed') ORDER BY created_at DESC LIMIT 1000",
      ).all();
      const output: unknown[] = [];
      for (const row of rows) {
        let payload: any;
        try { payload = JSON.parse(row.payload_json); } catch { fail("STORAGE_FAILURE"); }
        if (payload.agentId !== agentId) continue;
        if (parsed.kind === "CATALOG") {
          if (row.type !== "audit.catalog.assignment.changed" || payload.releaseId !== parsed.packageReleaseId) continue;
          const event = CatalogAssignmentAuditEventSchema.parse({ type: row.type, source: row.source, status: row.status, channelId: row.channel_id, payload });
          const deployment = tx.prepare<[string], { deployment_id: string; state: "QUEUED" | "CLAIMED" | "STAGED" | "WAITING_FOR_IDLE" | "ACTIVE" | "FAILED" | "SUPERSEDED"; desired_generation: string; failure_code: "DEPLOYMENT_SUPERSEDED" | "INSPECTION_FAILED" | "STORAGE_FAILURE" | null }>("SELECT deployment_id,state,desired_generation,failure_code FROM runner_package_deployments WHERE deployment_id=?").get(event.payload.deploymentId);
          if (deployment && deployment.desired_generation !== event.payload.desiredGeneration) fail("STORAGE_FAILURE");
          const state = !deployment ? event.payload.state : deployment.state === "ACTIVE" ? "STABLE" : deployment.state === "FAILED" ? "FAILED" : deployment.state === "SUPERSEDED" ? "SUPERSEDED" : deployment.state === "STAGED" || deployment.state === "WAITING_FOR_IDLE" ? "DEPLOYING" : "REQUESTED";
          const failureCode = !deployment ? event.payload.failureCode : deployment.failure_code;
          const effectiveGeneration = deployment?.state === "ACTIVE" ? event.payload.desiredGeneration : event.payload.effectiveGeneration;
          output.push(SkillDeploymentEventSchema.parse({ eventId: row.id, operation: event.payload.operation, state, desiredGeneration: event.payload.desiredGeneration, effectiveGeneration, failureCode, revision: event.payload.revision, createdAt: row.created_at }));
        } else if (parsed.kind === "LOCAL") {
          if (row.type !== "audit.skill.changed") continue;
          const refs = payload.refs ?? (payload.ref ? [payload.ref] : undefined);
          const event = SkillAuditEventSchema.parse({ id: row.id, type: row.type, source: row.source, channelId: row.channel_id, status: row.status, createdAt: row.created_at, payload: { ...payload, refs } });
          if (!event.payload.refs?.some(ref => ref.name === parsed.name && ref.localOrigin === parsed.localOrigin)) continue;
          output.push(SkillDeploymentEventSchema.parse({ eventId: event.id, operation: event.payload.operation, state: "STABLE", desiredGeneration: `local:${agentId}:${event.payload.revision}`, effectiveGeneration: `local:${agentId}:${event.payload.revision}`, failureCode: null, revision: event.payload.revision, createdAt: event.createdAt }));
        }
        if (output.length >= 100) break;
      }
      return output;
    } catch (error) {
      if (error instanceof AgentSkillManagementError) throw error;
      throw new AgentSkillManagementError("STORAGE_FAILURE");
    }
  }
  return { execute, executeBatch, updateLocalBatch, updateLocalBatchInTransaction, executeLegacyCatalog, preflight, inTransaction, history };
}
