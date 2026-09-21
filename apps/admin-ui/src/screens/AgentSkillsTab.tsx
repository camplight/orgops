import { useEffect, useRef, useState } from "react";
import type { SkillCommand, SkillInventoryItem, SkillRef } from "@orgops/schemas";
import type { Result, SkillDeploymentEvent, SkillMutationResult, UnifiedSkillApi } from "../unified-skills/api";

export type AgentSkillsManagement = {
  listForAgent?: UnifiedSkillApi["listForAgent"];
  execute(command: SkillCommand): Promise<AgentSkillOperationResult>;
  history(agentId: string, query: { kind: "LOCAL"; name: string; localOrigin: "BUILT_IN" | "WORKSPACE" } | { kind: "CATALOG"; packageReleaseId: string }, signal?: AbortSignal): Promise<SkillDeploymentEvent[] | Result<SkillDeploymentEvent[]>>;
};
export type AgentSkillsTabProps = {
  agentId: string;
  agentRevision?: number;
  items?: readonly SkillInventoryItem[];
  inventory?: { items: readonly SkillInventoryItem[]; agentRevision: number; history?: readonly SkillDeploymentEvent[] };
  history?: readonly SkillDeploymentEvent[];
  localEnabled?: readonly string[];
  localPreloaded?: readonly string[];
  management: AgentSkillsManagement;
  onReload?: () => void | Promise<void>;
  busy?: boolean;
};

export type AgentSkillOperationResult = SkillMutationResult | Result<SkillMutationResult>;
type Projection = { desired: "ENABLED" | "DISABLED" | "ABSENT"; effective: "ENABLED" | "DISABLED"; preload: boolean; deployment: "STABLE" | "REQUESTED" | "DEPLOYING" | "FAILED"; revision: number };
const key = (ref: SkillRef) => ref.kind === "LOCAL" ? `LOCAL:${ref.localOrigin}:${ref.name}` : `CATALOG:${ref.packageReleaseId}`;
const displayName = (item: SkillInventoryItem) => item.ref.kind === "LOCAL" ? item.ref.name : item.ref.name;
const publicDeployment = (state: Projection["deployment"]) => state === "REQUESTED" || state === "DEPLOYING" ? "DEPLOYING" : state;
const EMPTY_HISTORY: readonly SkillDeploymentEvent[] = [];

class SkillOperationError extends Error { constructor(readonly code: string, message: string) { super(message); } }
function normalizeResult(value: AgentSkillOperationResult): SkillMutationResult {
  if ("ok" in value) {
    if (!value.ok) throw new SkillOperationError(value.error.code, value.error.message);
    return value.value;
  }
  return value;
}

function commandFor(item: SkillInventoryItem, operation: SkillCommand["operation"], agentId: string, agentRevision: number, preload?: boolean): SkillCommand {
  if (item.ref.kind === "LOCAL") {
    if (operation === "ADD") return { kind: "LOCAL", operation, agentId, name: item.ref.name, preload: preload === true, expectedAgentRevision: agentRevision };
    if (operation === "SET_PRELOAD") return { kind: "LOCAL", operation, agentId, name: item.ref.name, preload: preload === true, expectedAgentRevision: agentRevision };
    return { kind: "LOCAL", operation: operation as "REMOVE" | "ENABLE" | "DISABLE", agentId, name: item.ref.name, expectedAgentRevision: agentRevision };
  }
  const assignmentRevision = item.assignment?.revision ?? 0;
  if (operation === "ASSIGN") return { kind: "CATALOG", operation, agentId, packageReleaseId: item.ref.packageReleaseId, preload: preload === true, expectedAgentRevision: agentRevision, expectedAssignmentRevision: assignmentRevision };
  if (operation === "SET_PRELOAD") return { kind: "CATALOG", operation, agentId, packageReleaseId: item.ref.packageReleaseId, preload: preload === true, expectedAgentRevision: agentRevision, expectedAssignmentRevision: assignmentRevision };
  if (operation === "REMOVE") return { kind: "CATALOG", operation, agentId, packageReleaseId: item.ref.packageReleaseId, expectedAgentRevision: agentRevision, expectedAssignmentRevision: assignmentRevision };
  return { kind: "CATALOG", operation: operation as "ENABLE" | "DISABLE", agentId, packageReleaseId: item.ref.packageReleaseId, ...(preload === undefined ? {} : { preload }), expectedAgentRevision: agentRevision, expectedAssignmentRevision: assignmentRevision };
}

export function AgentSkillsTab({ agentId, agentRevision: explicitAgentRevision, items: explicitItems, inventory, history: explicitHistory, localEnabled = [], localPreloaded = [], management, onReload, busy = false }: AgentSkillsTabProps) {
  const items = inventory?.items ?? explicitItems ?? [];
  const agentRevision = inventory?.agentRevision ?? explicitAgentRevision ?? 1;
  const history = inventory?.history ?? explicitHistory ?? EMPTY_HISTORY;
  const [overrides, setOverrides] = useState<Record<string, Projection>>({});
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());
  const [events, setEvents] = useState<readonly SkillDeploymentEvent[]>(history);
  const generation = useRef(0);
  const historyAbort = useRef<AbortController | null>(null);
  const historyGeneration = useRef(0);
  const conflictReloaded = useRef(new Set<string>());

  useEffect(() => { setEvents(history); }, [history]);
  useEffect(() => {
    generation.current += 1;
    historyGeneration.current += 1;
    historyAbort.current?.abort();
    historyAbort.current = null;
    setEvents(history);
    setError(null);
  }, [agentId, agentRevision]);
  useEffect(() => () => { historyAbort.current?.abort(); }, []);

  useEffect(() => {
    setOverrides(previous => {
      let changed = false;
      const next = { ...previous };
      for (const [refKey, override] of Object.entries(previous)) {
        const item = items.find(candidate => key(candidate.ref) === refKey);
        if (!item) continue;
        const confirmed = item.ref.kind === "LOCAL"
          ? (override.desired === "ENABLED" ? localEnabled.includes(item.ref.name) && localPreloaded.includes(item.ref.name) === override.preload : !localEnabled.includes(item.ref.name))
          : Boolean(item.assignment && item.assignment.revision >= override.revision && item.assignment.desired === override.desired && item.assignment.effective === override.effective && item.assignment.preload === override.preload && item.assignment.deployment === override.deployment);
        if (confirmed) { delete next[refKey]; changed = true; }
      }
      return changed ? next : previous;
    });
  }, [agentId, agentRevision, items, localEnabled, localPreloaded]);

  const projectionFor = (item: SkillInventoryItem): Projection => {
    const override = overrides[key(item.ref)];
    if (override) return override;
    if (item.ref.kind === "LOCAL") {
      const enabled = localEnabled.includes(item.ref.name);
      return { desired: enabled ? "ENABLED" : "ABSENT", effective: enabled ? "ENABLED" : "DISABLED", preload: localPreloaded.includes(item.ref.name), deployment: "STABLE", revision: agentRevision };
    }
    return item.assignment ?? { desired: "DISABLED", effective: "DISABLED", preload: false, deployment: "STABLE", revision: 0 };
  };

  const execute = async (item: SkillInventoryItem, operation: SkillCommand["operation"], preload?: boolean) => {
    const command = commandFor(item, operation, agentId, agentRevision, preload);
    const operationKey = JSON.stringify(command);
    if (inFlight.current.has(operationKey)) return;
    inFlight.current.add(operationKey); setError(null); setStatus("Saving skill assignment…");
    const requestGeneration = generation.current;
    try {
      const result = normalizeResult(await management.execute(command));
      if (requestGeneration !== generation.current) return;
      const next: Projection = { desired: result.desired, effective: result.effective, preload: result.preload, deployment: result.deployment, revision: result.revision };
      setOverrides(previous => ({ ...previous, [key(item.ref)]: next }));
      setStatus(item.ref.kind === "CATALOG" && (next.deployment === "REQUESTED" || next.deployment === "DEPLOYING")
        ? "Waiting for agent to become idle"
        : item.ref.kind === "CATALOG" && next.deployment === "FAILED"
          ? "Deployment failed; prior active skills remain. Retry or reload."
          : "Skill assignment saved for future turns.");
      if (onReload) await onReload();
    } catch (value) {
      if (requestGeneration === generation.current) {
        const operationError = value instanceof SkillOperationError ? value : null;
        setError(operationError?.code === "REVISION_CONFLICT" ? "Skills changed; reload before using this inventory." : value instanceof Error ? value.message : "The skill assignment could not be confirmed. Reload and try again.");
        if (operationError?.code === "REVISION_CONFLICT" && onReload && !conflictReloaded.current.has(operationKey)) {
          conflictReloaded.current.add(operationKey);
          await onReload();
        }
      }
    } finally { inFlight.current.delete(operationKey); }
  };

  const loadHistory = async (item: SkillInventoryItem) => {
    const query = item.ref.kind === "LOCAL" ? { kind: "LOCAL" as const, name: item.ref.name, localOrigin: item.ref.localOrigin } : { kind: "CATALOG" as const, packageReleaseId: item.ref.packageReleaseId };
    historyAbort.current?.abort();
    const controller = new AbortController(); historyAbort.current = controller;
    const request = ++historyGeneration.current; const targetAgent = agentId; const targetRef = key(item.ref);
    setEvents([]); setError(null);
    try {
      const result = await management.history(targetAgent, query, controller.signal);
      if (controller.signal.aborted || request !== historyGeneration.current || targetAgent !== agentId || targetRef !== key(item.ref)) return;
      if (result && "ok" in result) { if (result.ok) setEvents(result.value); else setError(result.error.message); }
      else if (result) setEvents(result as unknown as SkillDeploymentEvent[]);
    } catch (value) { if (!controller.signal.aborted && request === historyGeneration.current) setError(value instanceof Error ? value.message : "Skill history could not be loaded."); }
  };

  return <section aria-labelledby="agent-skills-title" aria-busy={busy} className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 id="agent-skills-title" className="text-sm font-semibold text-slate-100">Skills</h3><p className="text-xs text-slate-500">Changes are revision-checked and apply to future turns. An active turn keeps its captured snapshot.</p></div><button type="button" onClick={() => void onReload?.()} disabled={busy} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200">Reload</button></div>
    <div className="space-y-2">
      {items.map(item => {
        const projection = projectionFor(item);
        const catalog = item.ref.kind === "CATALOG";
        const enabled = projection.desired === "ENABLED";
        const effective = projection.effective;
        const deployment = publicDeployment(projection.deployment);
        const absent = projection.desired === "ABSENT" || (!item.assignment && catalog);
        const operation: SkillCommand["operation"] = catalog ? (absent ? "ASSIGN" : enabled ? "DISABLE" : "ENABLE") : (projection.desired === "ABSENT" ? "ADD" : enabled ? "DISABLE" : "ENABLE");
        const revision = projection.revision;
        return <article key={key(item.ref)} className="rounded border border-slate-800 bg-slate-950 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-sm text-slate-200">{displayName(item)}</div><div className="break-words text-xs text-slate-500">{item.description}</div></div><span className="text-xs text-slate-500">{catalog ? "Catalog" : "Local"}</span></div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"><span>Desired: {projection.desired}</span><span>Effective: {effective}</span><span>{deployment}</span><span>Revision: {revision}</span></div>
          {catalog && deployment === "DEPLOYING" ? <p className="mt-2 text-xs text-amber-300">Waiting for agent to become idle. Effective state remains {effective} until deployment succeeds.</p> : null}
          {catalog && deployment === "FAILED" ? <p className="mt-2 text-xs text-rose-300">Deployment failed; prior active skills remain. Retry or reload.</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={enabled} aria-label={`${enabled ? "Disable" : "Enable"} ${item.ref.name}`} onChange={() => void execute(item, operation, projection.preload)} disabled={busy || inFlight.current.size > 0} />{absent ? "Add" : enabled ? "Enabled" : "Enable"}</label>
            {(enabled || (catalog && !absent)) && <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={projection.preload} aria-label={`Preload ${item.ref.name}`} onChange={event => void execute(item, "SET_PRELOAD", event.target.checked)} disabled={busy || inFlight.current.size > 0} />Preload later</label>}
            {(enabled || (!catalog && projection.desired !== "ABSENT")) && <button type="button" className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200" onClick={() => void execute(item, catalog ? "REMOVE" : "REMOVE")} disabled={busy || inFlight.current.size > 0}>Remove</button>}
            <button type="button" className="rounded bg-slate-900 px-2 py-1 text-xs text-slate-400" onClick={() => void loadHistory(item)}>History</button>
          </div>
        </article>;
      })}
      {items.length === 0 ? <p className="text-xs text-slate-500">No skills are available.</p> : null}
    </div>
    {status ? <div role="status" className="text-sm text-slate-300">{status}</div> : null}
    {error ? <div role="alert" className="rounded border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">{error}</div> : null}
    <section aria-labelledby="agent-skills-history-title" className="space-y-2"><h4 id="agent-skills-history-title" className="text-sm text-slate-300">Assignment history</h4>{events.slice(0, 100).map(event => <div key={event.eventId} className="break-words rounded border border-slate-800 px-2 py-2 text-xs text-slate-400">{event.operation} · {event.state} · revision {event.revision}{event.failureCode ? ` · ${event.failureCode}` : ""}{event.state === "SUPERSEDED" ? " · Deployment superseded; prior active skills remain." : ""}</div>)}{events.length === 0 ? <p className="text-xs text-slate-500">No assignment history.</p> : null}</section>
  </section>;
}
