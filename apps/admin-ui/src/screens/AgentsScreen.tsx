import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type {
  Agent,
  AgentWorkspaceFileResponse,
  AgentWorkspaceListResponse,
  AgentProvisioningReceipt,
  AgentStartReadiness,
  EventRow,
  ProvisionAgentHttpInput,
  ProvisioningTemplateOptions,
  RunnerNode,
  SealedSecretBinding,
  SkillInventoryItem,
  SkillMeta,
  SkillRef
} from "../types";
import { getAgentStartReadiness, getProvisioningTemplateOptions, provisionAgent } from "../api";
import { UnifiedSkillPicker } from "../components/skills/UnifiedSkillPicker";
import { AgentSkillsTab, type AgentSkillsManagement } from "./AgentSkillsTab";
import { Button, Card, Input, Textarea } from "../components/ui";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { formatTimestamp } from "../utils/formatTimestamp";
import { createStartReadinessOwner } from "./start-readiness-owner";

type AgentForm = {
  name: string;
  modelId: string;
  visibility: "PUBLIC" | "PRIVATE";
  mode: "CLASSIC" | "RLM_REPL" | "WRAPPED";
  memoryContextMode: "PER_CHANNEL_CROSS_CHANNEL" | "FULL_CHANNEL_EVENTS" | "OFF";
  emitAuditEvents: boolean;
  llmCallTimeoutMs: string;
  contextSessionGapMs: string;
  workspacePath: string;
  allowOutsideWorkspace: boolean;
  assignedRunnerId: string;
  soulContents: string;
  enabledSkills: string[];
  alwaysPreloadedSkills: string[];
  wrappedConfigJson: string;
  wrappedConfig?: Record<string, unknown>;
};

const DEFAULT_WRAPPED_CONFIG = JSON.stringify(
  {
    kind: "custom",
    harness: "command",
    runtime: {
      command: 'printf "%s" "$ORGOPS_WRAPPED_MESSAGE"',
      parse: "text",
      timeoutMs: 600000
    },
    session: {
      scope: "per-channel"
    }
  },
  null,
  2
);

const DEFAULT_AGENT_FORM: AgentForm = {
  name: "",
  modelId: "openai:gpt-4o-mini",
  visibility: "PUBLIC",
  mode: "CLASSIC",
  memoryContextMode: "PER_CHANNEL_CROSS_CHANNEL",
  emitAuditEvents: true,
  llmCallTimeoutMs: "",
  contextSessionGapMs: "",
  workspacePath: ".orgops-data/workspaces/default",
  allowOutsideWorkspace: false,
  assignedRunnerId: "",
  soulContents: "",
  enabledSkills: [],
  alwaysPreloadedSkills: [],
  wrappedConfigJson: DEFAULT_WRAPPED_CONFIG
};

function parseOptionalPositiveIntInput(
  value: string,
  fieldName: string
): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer when provided.`);
  }
  return Math.floor(parsed);
}

function stringifyWrappedConfig(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return JSON.stringify(value, null, 2);
  }
  return DEFAULT_WRAPPED_CONFIG;
}

function parseWrappedConfigJson(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Wrapped config must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function readWrappedDisplayValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatAgentModelLabel(agent: Agent): string {
  if ((agent.mode ?? "CLASSIC") !== "WRAPPED") return agent.modelId ?? "-";
  const config = agent.wrappedConfig ?? {};
  const kind = readWrappedDisplayValue(config.kind);
  const name = readWrappedDisplayValue(config.name);
  const harness = readWrappedDisplayValue(config.harness) ?? readWrappedDisplayValue(config.transport);
  return `wrapped: ${kind ?? name ?? harness ?? "custom"}`;
}

type CreateAgentStep = "ORIGIN" | "TEMPLATE" | "BINDINGS" | "SKILLS" | "REVIEW";
type CreationOrigin = "BLANK" | "TEMPLATE";
type CreationDraft = {
  idempotencyKey: string;
  origin: CreationOrigin | null;
  packageReleaseId: string;
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
  mode: "CLASSIC" | "RLM_REPL" | "WRAPPED";
  modelId: string;
  workspacePath: string;
  runnerId: string;
  desiredState: "RUNNING" | "STOPPED";
  secretBindings: readonly SealedSecretBinding[];
  localSkills: readonly { name: string; preload: boolean }[];
  catalogSkills: readonly { packageReleaseId: string; preload: boolean }[];
  selectedSkills: readonly { ref: SkillRef; preload: boolean; mandatory: boolean; source: "TEMPLATE" | "USER" }[];
};

type CreateAgentFlowProps = {
  runners: RunnerNode[];
  skills: SkillMeta[];
  principalKey?: string;
  onProvisionAgent: (input: ProvisionAgentHttpInput, signal?: AbortSignal) => Promise<AgentProvisioningReceipt>;
  loadProvisioningOptions?: (signal?: AbortSignal) => Promise<ProvisioningTemplateOptions>;
  loadSkillInventory?: (signal?: AbortSignal) => Promise<SkillInventoryItem[]>;
  loadStartReadiness?: (name: string, signal?: AbortSignal) => Promise<AgentStartReadiness>;
  onStartAgent?: (name: string) => Promise<void>;
  onDone: (receipt?: AgentProvisioningReceipt) => void;
  onCancel: () => void;
};

const emptyCreationDraft = (): CreationDraft => ({
  idempotencyKey: crypto.randomUUID(), origin: null, packageReleaseId: "", name: "", visibility: "PUBLIC", mode: "CLASSIC",
  modelId: "openai:gpt-4o-mini", workspacePath: ".orgops-data/workspaces/default", runnerId: "",
  desiredState: "RUNNING", secretBindings: [], localSkills: [], catalogSkills: [], selectedSkills: []
});
function refKey(ref: SkillRef) { return ref.kind === "LOCAL" ? `LOCAL:${ref.localOrigin}:${ref.name}` : `CATALOG:${ref.packageReleaseId}`; }
function refsForDraft(draft: CreationDraft): SkillRef[] { return draft.selectedSkills.map((skill) => skill.ref); }
type StartChainToken = Readonly<{ principalKey: string | undefined; receiptAgentId: string; generation: number }>;
function TemplateSummary({ template, heading }: { template: ProvisioningTemplateOptions["templates"][number]; heading: string }) {
  const preloadValue = (template.exactConfig as { skillPreloads?: unknown }).skillPreloads;
  const preloads = Array.isArray(preloadValue) ? preloadValue.filter((value): value is string => typeof value === "string") : [];
  return <section className="min-w-0 rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400" aria-label={heading}>
    <h5 className="mb-2 text-slate-200">{heading}</h5>
    <dl className="grid gap-1 break-words"><div><dt>Template</dt><dd>{template.name} · {template.version}</dd></div><div><dt>Package release</dt><dd className="break-all">{template.packageReleaseId}</dd></div><div><dt>Digest</dt><dd className="break-all">{template.digest}</dd></div><div><dt>Description</dt><dd>{template.description}</dd></div><div><dt>Readiness</dt><dd>{template.readiness.state}{template.readiness.state === "BLOCKED" ? ` · ${template.readiness.blockers.map(blocker => blocker.requirement ? `${blocker.code}: ${blocker.requirement}` : blocker.code).join(", ")}` : ""}</dd></div></dl>
    <div className="mt-2 text-slate-200">Exact portable configuration (read-only)</div><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(template.exactConfig, null, 2)}</pre>
    <div className="mt-2 text-slate-200">Exact dependency skill refs</div><div>Dependency skill refs: {template.skillRefs.length}</div><ul className="space-y-1 break-all">{template.skillRefs.length ? template.skillRefs.map(ref => <li key={refKey(ref)}>{ref.kind === "LOCAL" ? `${ref.name} · ${ref.localOrigin}` : `${ref.name} · ${ref.version} · ${ref.packageReleaseId} · ${ref.digest}`}</li>) : <li>None</li>}</ul>
    <div className="mt-2">Exact preloads: {preloads.join(", ") || "None"}</div>
  </section>;
}

function fixedProvisioningMessage(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  const messages: Record<string, string> = {
    REQUIREMENTS_UNSATISFIED: "Required bindings are missing; no agent was created.",
    GRANT_REQUIRED: "A current catalog grant is required; no agent was created.",
    INSTALLATION_REQUIRED: "Install the selected catalog release before creating this agent.",
    REVISION_CONFLICT: "The selected catalog data changed; reload before creating this agent.",
    STORAGE_FAILURE: "The agent could not be saved; no agent was created."
  };
  return messages[code] ?? (error instanceof Error ? error.message : "The agent could not be created.");
}

export function CreateAgentFlow({ runners, skills, principalKey, onProvisionAgent, loadProvisioningOptions, loadSkillInventory, loadStartReadiness = getAgentStartReadiness, onStartAgent, onDone, onCancel }: CreateAgentFlowProps) {
  const [step, setStep] = useState<CreateAgentStep>("ORIGIN");
  const [draft, setDraft] = useState<CreationDraft>(emptyCreationDraft);
  const [options, setOptions] = useState<ProvisioningTemplateOptions | null>(null);
  const [inventory, setInventory] = useState<SkillInventoryItem[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<ProvisioningTemplateOptions["templates"][number] | null>(null);
  const [reviewSnapshot, setReviewSnapshot] = useState<CreationDraft | null>(null);
  const [receipt, setReceipt] = useState<AgentProvisioningReceipt | null>(null);
  const [startReadiness, setStartReadiness] = useState<AgentStartReadiness | null>(null);
  const [startReadinessOwnership, setStartReadinessOwnership] = useState<{ principalKey: string | undefined; agentId: string } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const submitInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const principalKeyRef = useRef(principalKey);
  principalKeyRef.current = principalKey;
  const startChainGenerationRef = useRef(0);
  const startChainRef = useRef<StartChainToken | null>(null);
  const startReadinessOwnerRef = useRef(createStartReadinessOwner());
  const fallbackInventory = useMemo<SkillInventoryItem[]>(() => skills.map((skill) => ({ ref: { kind: "LOCAL", name: skill.name, localOrigin: "BUILT_IN" }, description: skill.description || skill.name, readiness: { state: "READY" }, provenance: "FULL_ADMIN", adminProvenance: { kind: "LOCAL" } })), [skills]);
  const availableInventory = useMemo(() => {
    const base = inventory.length > 0 ? inventory : fallbackInventory;
    const known = new Set(base.map((item) => refKey(item.ref)));
    const dependencies = (selectedTemplate?.skillRefs ?? []).filter((ref) => !known.has(refKey(ref))).map((ref) => ({ ref, description: "Template dependency", readiness: { state: "READY" as const }, provenance: "BOUNDED_HUMAN" as const }));
    return [...base, ...dependencies];
  }, [fallbackInventory, inventory, selectedTemplate]);
  const templateRequirements = selectedTemplate?.requirements ?? [];
  const hasCatalogSkills = draft.catalogSkills.length > 0;

  const invalidateStartChain = () => {
    startChainGenerationRef.current += 1;
    startChainRef.current = null;
    startReadinessOwnerRef.current.invalidate();
    setStartReadiness(null);
    setStartReadinessOwnership(null);
  };
  const isCurrentStartToken = (token: StartChainToken) => mountedRef.current
    && principalKeyRef.current === token.principalKey
    && startChainRef.current?.generation === token.generation
    && startChainRef.current?.receiptAgentId === token.receiptAgentId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      startChainGenerationRef.current += 1;
      startChainRef.current = null;
      startReadinessOwnerRef.current.invalidate();
    };
  }, []);
  useEffect(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    submitInFlightRef.current = false;
    invalidateStartChain();
    setBusy(false);
    setOptions(null);
    setInventory([]);
    setSelectedTemplate(null);
    setReviewSnapshot(null);
    setReceipt(null);
    setAcknowledged(false);
    setError(null);
    setStep("ORIGIN");
    setDraft(emptyCreationDraft());
  }, [principalKey]);

  const setField = <K extends keyof CreationDraft>(field: K, value: CreationDraft[K]) => setDraft((previous) => ({ ...previous, idempotencyKey: crypto.randomUUID(), [field]: value }));
  const loadOptions = async () => {
    if (options || !loadProvisioningOptions) return;
    const generation = ++generationRef.current; const principal = principalKey; const controller = new AbortController(); abortRef.current?.abort(); abortRef.current = controller; setBusy(true); setError(null);
    try { const nextOptions = await loadProvisioningOptions(controller.signal); if (generation === generationRef.current && principal === principalKey && mountedRef.current && !controller.signal.aborted) setOptions(nextOptions); }
    catch (nextError) { if (generation === generationRef.current && principal === principalKey && !controller.signal.aborted && mountedRef.current) setError(fixedProvisioningMessage(nextError)); }
    finally { if (generation === generationRef.current && principal === principalKey && mountedRef.current) setBusy(false); }
  };
  const loadSkills = async () => {
    if (!loadSkillInventory || inventory.length > 0) return;
    const generation = ++generationRef.current; const principal = principalKey; const controller = new AbortController(); abortRef.current?.abort(); abortRef.current = controller;
    try { const nextInventory = await loadSkillInventory(controller.signal); if (generation === generationRef.current && principal === principalKey && mountedRef.current && !controller.signal.aborted) setInventory(nextInventory); } catch (nextError) { if (generation === generationRef.current && principal === principalKey && !controller.signal.aborted && mountedRef.current) setError(fixedProvisioningMessage(nextError)); }
  };
  const chooseOrigin = (origin: CreationOrigin) => {
    setDraft((previous) => ({ ...previous, origin })); setError(null);
    if (origin === "TEMPLATE") void loadOptions();
  };
  const chooseTemplate = (packageReleaseId: string) => {
    const template = options?.templates.find((candidate) => candidate.packageReleaseId === packageReleaseId) ?? null;
    const preloadValue = (template?.exactConfig as { skillPreloads?: unknown } | undefined)?.skillPreloads;
    const mandatoryPreloads = new Set(Array.isArray(preloadValue) ? preloadValue.filter((item: unknown): item is string => typeof item === "string") : []);
    const mandatoryRefs = new Set((template?.skillRefs ?? []).map(refKey));
    const inventoryKeys = new Set((inventory.length > 0 ? inventory : fallbackInventory).map((item) => refKey(item.ref)));
    const templateSkills = (template?.skillRefs ?? []).map((ref) => ({ ref, preload: ref.kind === "CATALOG" && mandatoryPreloads.has(ref.name), mandatory: true, source: "TEMPLATE" as const }));
    setSelectedTemplate(template);
    setDraft((previous) => {
      const retainedUserSkills = previous.selectedSkills.filter((skill) => skill.source === "USER" && !mandatoryRefs.has(refKey(skill.ref)) && inventoryKeys.has(refKey(skill.ref)));
      const selectedSkills = [...templateSkills, ...retainedUserSkills];
      return {
        ...previous,
        idempotencyKey: crypto.randomUUID(),
        packageReleaseId,
        mode: template?.mode ?? previous.mode,
        runnerId: "",
        modelId: "",
        secretBindings: [],
        selectedSkills,
        localSkills: selectedSkills.filter((skill) => skill.ref.kind === "LOCAL").map((skill) => ({ name: skill.ref.name, preload: skill.preload })),
        catalogSkills: selectedSkills.filter((skill) => skill.ref.kind === "CATALOG").map((skill) => ({ packageReleaseId: skill.ref.kind === "CATALOG" ? skill.ref.packageReleaseId : "", preload: skill.preload })),
      };
    });
    setReviewSnapshot(null);
    setAcknowledged(false);
    setReceipt(null);
    setError(null);
  };
  const toggleSkill = (ref: SkillRef) => setDraft((previous) => {
    const exists = previous.selectedSkills.some((skill) => refKey(skill.ref) === refKey(ref));
    if (exists && previous.selectedSkills.some((skill) => refKey(skill.ref) === refKey(ref) && skill.mandatory)) return previous;
    const selectedSkills = exists ? previous.selectedSkills.filter((skill) => refKey(skill.ref) !== refKey(ref)) : [...previous.selectedSkills, { ref, preload: false, mandatory: false, source: "USER" as const }];
    return { ...previous, idempotencyKey: crypto.randomUUID(), selectedSkills, localSkills: selectedSkills.filter((skill) => skill.ref.kind === "LOCAL").map((skill) => ({ name: skill.ref.name, preload: skill.preload })), catalogSkills: selectedSkills.filter((skill) => skill.ref.kind === "CATALOG").map((skill) => ({ packageReleaseId: skill.ref.kind === "CATALOG" ? skill.ref.packageReleaseId : "", preload: skill.preload })) };
  });
  const setSkillPreload = (ref: SkillRef, preload: boolean) => setDraft((previous) => {
    const selectedSkills = previous.selectedSkills.map((skill) => refKey(skill.ref) === refKey(ref) && !skill.mandatory ? { ...skill, preload } : skill);
    return { ...previous, idempotencyKey: crypto.randomUUID(), selectedSkills, localSkills: selectedSkills.filter((skill) => skill.ref.kind === "LOCAL").map((skill) => ({ name: skill.ref.name, preload: skill.preload })), catalogSkills: selectedSkills.filter((skill) => skill.ref.kind === "CATALOG").map((skill) => ({ packageReleaseId: skill.ref.kind === "CATALOG" ? skill.ref.packageReleaseId : "", preload: skill.preload })) };
  });
  const buildCommand = (snapshot: CreationDraft): ProvisionAgentHttpInput => snapshot.origin === "TEMPLATE"
    ? { kind: "TEMPLATE", idempotencyKey: snapshot.idempotencyKey, name: snapshot.name.trim(), visibility: snapshot.visibility, packageReleaseId: snapshot.packageReleaseId, modelId: snapshot.modelId.trim(), workspacePath: snapshot.workspacePath.trim(), runnerId: snapshot.runnerId, secretBindings: [...snapshot.secretBindings], localSkills: [...snapshot.localSkills], catalogSkills: [...snapshot.catalogSkills] }
    : { kind: "BLANK", idempotencyKey: snapshot.idempotencyKey, name: snapshot.name.trim(), visibility: snapshot.visibility, mode: snapshot.mode, modelId: snapshot.modelId.trim(), workspacePath: snapshot.workspacePath.trim(), runnerId: snapshot.runnerId, desiredState: snapshot.catalogSkills.length > 0 ? "STOPPED" : snapshot.desiredState, localSkills: [...snapshot.localSkills], catalogSkills: [...snapshot.catalogSkills] };
  const next = async () => {
    setError(null);
    if (step === "ORIGIN") { if (!draft.origin) return setError("Choose Blank agent or Installed template first."); return setStep(draft.origin === "TEMPLATE" ? "TEMPLATE" : "BINDINGS"); }
    if (step === "TEMPLATE") { if (!selectedTemplate) return setError("Choose an installed template first."); return setStep("BINDINGS"); }
    if (step === "BINDINGS") { if (!draft.name.trim() || !draft.runnerId || !draft.workspacePath.trim() || (!draft.modelId.trim() && draft.origin === "BLANK")) return setError("Name, runner, workspace, and model are required."); if (draft.origin === "TEMPLATE" && (!options?.runners.some((runner) => runner.id === draft.runnerId) || !options.models.some((model) => model.id === draft.modelId))) return setError("Choose a runner and model from the server-provided template options."); await loadSkills(); return setStep("SKILLS"); }
    if (step === "SKILLS") { const snapshot = { ...draft, localSkills: [...draft.localSkills], catalogSkills: [...draft.catalogSkills], selectedSkills: [...draft.selectedSkills], secretBindings: [...draft.secretBindings] }; setReviewSnapshot(snapshot); setAcknowledged(false); return setStep("REVIEW"); }
    if (step === "REVIEW" && !acknowledged) return setError("Acknowledge the reviewed configuration before creating the agent.");
    await submit();
  };
  const submit = async () => {
    if (busy || submitInFlightRef.current || !reviewSnapshot) return;
    submitInFlightRef.current = true;
    setBusy(true); setError(null);
    const generation = ++generationRef.current; const principal = principalKey; const controller = new AbortController(); abortRef.current?.abort(); abortRef.current = controller;
    try {
      const command = buildCommand(reviewSnapshot);
      const result = await onProvisionAgent(command, controller.signal);
      if (generation === generationRef.current && principal === principalKey && mountedRef.current && !controller.signal.aborted) { invalidateStartChain(); setReceipt(result); }
    } catch (nextError) { if (generation === generationRef.current && principal === principalKey && !controller.signal.aborted && mountedRef.current) setError(fixedProvisioningMessage(nextError)); }
    finally { if (generation === generationRef.current && principal === principalKey) submitInFlightRef.current = false; if (generation === generationRef.current && principal === principalKey && mountedRef.current) setBusy(false); }
  };
  const stepIndex = ["ORIGIN", "TEMPLATE", "BINDINGS", "SKILLS", "REVIEW"].indexOf(step);
  if (receipt) {
    const ownsReadiness = startReadinessOwnership?.principalKey === principalKey && startReadinessOwnership?.agentId === receipt.id;
    const blockers = ownsReadiness && startReadiness ? startReadiness.blockers : receipt.startBlockers.map(blocker => ({ code: blocker.code, ...(blocker.requirement ? { requirement: blocker.requirement } : {}) }));
    const queued = ownsReadiness && startReadiness ? startReadiness.queuedDeployment : receipt.queuedDeploymentIds.length > 0;
    const ready = ownsReadiness && startReadiness?.ready === true && !queued;
    const createStartToken = (): StartChainToken => {
      const token = Object.freeze({ principalKey, receiptAgentId: receipt.id, generation: ++startChainGenerationRef.current });
      startChainRef.current = token;
      return token;
    };
    const refreshReadiness = async (token = createStartToken()): Promise<boolean> => {
      if (!isCurrentStartToken(token)) return false;
      const operation = startReadinessOwnerRef.current.begin(token.principalKey, token.receiptAgentId);
      setStartReadiness(null); setStartReadinessOwnership(null); setBusy(true); setError(null);
      try {
        const next = await loadStartReadiness(receipt.name, operation.signal);
        if (!isCurrentStartToken(token) || !operation.isCurrent()) return false;
        setStartReadiness(next); setStartReadinessOwnership({ principalKey: operation.principalKey, agentId: operation.agentId });
        return true;
      } catch (nextError) {
        if (isCurrentStartToken(token) && operation.isCurrent()) setError(fixedProvisioningMessage(nextError));
        return false;
      } finally {
        if (isCurrentStartToken(token) && operation.isCurrent()) setBusy(false);
      }
    };
    const close = () => { invalidateStartChain(); setBusy(false); onDone(receipt); };
    const start = async () => {
      if (!ready || !ownsReadiness || !onStartAgent) return;
      const token = createStartToken();
      setBusy(true); setError(null);
      try {
        await onStartAgent(receipt.name);
        if (!isCurrentStartToken(token)) return;
        const refreshed = await refreshReadiness(token);
        if (refreshed && isCurrentStartToken(token)) onDone(receipt);
      } catch (nextError) {
        if (isCurrentStartToken(token)) { setError(fixedProvisioningMessage(nextError)); setBusy(false); }
      } finally {
        if (isCurrentStartToken(token)) setBusy(false);
      }
    };
    return <div className="space-y-4" role="status"><div className="rounded border border-emerald-800 bg-emerald-950/30 p-3 text-emerald-200">{receipt.desiredState === "STOPPED" ? "Created stopped; deployment queued" : "Agent created"}</div><div className="text-sm text-slate-300">Agent <strong>{receipt.name}</strong> {receipt.desiredState === "STOPPED" ? "is stopped until deployment and start requirements are ready." : "is ready for its requested runtime state."}</div>{queued ? <div className="text-xs text-slate-400">Deployment queued or pending.</div> : null}{blockers.length ? <div className="rounded border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">Start blockers: {blockers.map((blocker) => blocker.requirement ? `${blocker.code}: ${blocker.requirement}` : blocker.code).join(", ")}</div> : null}{error ? <div role="alert">{error}</div> : null}<div className="flex gap-2"><button type="button" className="rounded bg-slate-800 px-3 py-2 text-sm text-slate-200" disabled={busy} onClick={() => void refreshReadiness()}>Refresh readiness</button>{ready && onStartAgent ? <button type="button" className="rounded bg-blue-600 px-3 py-2 text-sm text-white" disabled={busy} onClick={() => void start()}>Start</button> : null}<button type="button" className="rounded bg-slate-800 px-3 py-2 text-sm text-slate-200" onClick={close}>Close</button></div></div>;
  }
  return <div className="space-y-4" aria-label="Create agent setup">
    <div className="flex flex-wrap gap-2 text-xs text-slate-500" aria-label="Create agent steps">{["Origin", "Template", "Bindings", "Skills", "Review"].map((label, index) => <span key={label} className={index === stepIndex ? "font-semibold text-blue-300" : ""}>{index + 1}. {label}</span>)}</div>
    {step === "ORIGIN" ? <div className="space-y-3"><h4 className="text-sm font-semibold text-slate-100">Choose agent origin</h4><div className="grid gap-3 sm:grid-cols-2"><button type="button" className={`rounded border p-3 text-left ${draft.origin === "BLANK" ? "border-blue-500" : "border-slate-800"}`} onClick={() => chooseOrigin("BLANK")}><strong className="block text-slate-200">Blank agent</strong><span className="text-xs text-slate-500">Use local configuration and optional catalog skills.</span></button><button type="button" className={`rounded border p-3 text-left ${draft.origin === "TEMPLATE" ? "border-blue-500" : "border-slate-800"}`} onClick={() => chooseOrigin("TEMPLATE")}><strong className="block text-slate-200">Installed template</strong><span className="text-xs text-slate-500">Use the server-provided exact template configuration.</span></button></div></div> : null}
    {step === "TEMPLATE" ? <div className="space-y-3"><label className="block text-sm text-slate-300">Installed template<select value={draft.packageReleaseId} onChange={(event) => chooseTemplate(event.target.value)} disabled={busy} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"><option value="">Choose a template</option>{options?.templates.map((template) => <option key={template.packageReleaseId} value={template.packageReleaseId}>{template.name} {template.version} · {template.packageReleaseId} · {template.digest} · {template.description} · {template.readiness.state} · {template.mode}</option>)}</select></label>{selectedTemplate ? <TemplateSummary template={selectedTemplate} heading="Selected template identity and configuration" /> : null}</div> : null}
    {step === "BINDINGS" ? <div className="space-y-3"><label className="block text-sm text-slate-300">Agent name<Input value={draft.name} onChange={(event) => setField("name", event.target.value)} autoFocus placeholder="Agent name" /></label><label className="block text-sm text-slate-300">Visibility<select value={draft.visibility} onChange={(event) => setField("visibility", event.target.value === "PRIVATE" ? "PRIVATE" : "PUBLIC")} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"><option value="PUBLIC">Public</option><option value="PRIVATE">Private</option></select></label>{draft.origin === "BLANK" ? <label className="block text-sm text-slate-300">Mode<select value={draft.mode} onChange={(event) => setField("mode", event.target.value as CreationDraft["mode"])} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"><option>CLASSIC</option><option>RLM_REPL</option><option>WRAPPED</option></select></label> : <div className="text-sm text-slate-300">Mode: <strong>{selectedTemplate?.mode}</strong> (from exact template)</div>}{draft.origin === "TEMPLATE" ? <label className="block text-sm text-slate-300">Model<select value={draft.modelId} onChange={(event) => setField("modelId", event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"><option value="">Choose a model</option>{options?.models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}</select></label> : <label className="block text-sm text-slate-300">Model<Input value={draft.modelId} onChange={(event) => setField("modelId", event.target.value)} placeholder="Model ID" /></label>}<label className="block text-sm text-slate-300">Workspace directory<Input value={draft.workspacePath} onChange={(event) => setField("workspacePath", event.target.value)} /></label><label className="block text-sm text-slate-300">Assigned runner<select value={draft.runnerId} onChange={(event) => setField("runnerId", event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"><option value="">Choose a runner</option>{(draft.origin === "TEMPLATE" ? options?.runners.map((runner) => ({ id: runner.id, displayName: runner.id })) ?? [] : runners).map((runner) => <option key={runner.id} value={runner.id}>{runner.displayName}</option>)}</select></label>{draft.origin === "TEMPLATE" ? templateRequirements.map((requirement) => <label key={requirement.name} className="block text-sm text-slate-300">{requirement.name}{requirement.required ? " (required)" : ""}<select value={draft.secretBindings.find((binding) => binding.requirementName === requirement.name)?.secretReferenceId ? String((options?.secretReferences.findIndex((secret) => secret.secretReferenceId === draft.secretBindings.find((binding) => binding.requirementName === requirement.name)?.secretReferenceId) ?? -1) + 1) : ""} onChange={(event) => { const secret = options?.secretReferences[Number(event.target.value) - 1]; if (!secret) return; setDraft((previous) => ({ ...previous, idempotencyKey: crypto.randomUUID(), secretBindings: [...previous.secretBindings.filter((binding) => binding.requirementName !== requirement.name), { requirementName: requirement.name, secretReferenceId: secret.secretReferenceId }] })); }} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"><option value="">Choose a secret reference</option>{options?.secretReferences.map((secret, index) => <option key={secret.name} value={index + 1}>{secret.name}</option>)}</select></label>) : null}</div> : null}
    {step === "SKILLS" ? <div className="space-y-3"><UnifiedSkillPicker items={availableInventory} selected={null} onChange={() => undefined} selectedRefs={refsForDraft(draft)} onToggle={toggleSkill} preloads={Object.fromEntries(draft.selectedSkills.map((skill) => [refKey(skill.ref), skill.preload]))} mandatoryRefs={draft.selectedSkills.filter((skill) => skill.mandatory).map((skill) => skill.ref)} onPreloadChange={setSkillPreload} disabled={busy} /><p className="text-xs text-slate-500">Local and catalog references are captured exactly. Catalog selections create this agent stopped.</p></div> : null}
    {step === "REVIEW" && reviewSnapshot ? <div className="space-y-3"><h4 className="text-sm font-semibold text-slate-100">Review and confirm</h4><div className="rounded border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300"><div>Name: {reviewSnapshot.name}</div><div>Origin: {reviewSnapshot.origin}</div><div>Mode: {reviewSnapshot.mode}</div><div>Runner: {reviewSnapshot.runnerId}</div><div>Workspace: {reviewSnapshot.workspacePath}</div><div>Local skills: {reviewSnapshot.localSkills.map((skill) => skill.name).join(", ") || "None"}</div><div>Selected skills: {reviewSnapshot.selectedSkills.map((skill) => `${skill.ref.kind === "LOCAL" ? `${skill.ref.name} (${skill.ref.localOrigin})` : `${skill.ref.name} ${skill.ref.version} ${skill.ref.digest}`}${skill.preload ? " · preload" : ""}`).join(", ") || "None"}</div></div>{selectedTemplate ? <><TemplateSummary template={selectedTemplate} heading="Reviewed template root and exact configuration" /><div className="rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400"><div>Requirements: {templateRequirements.map((requirement) => requirement.name).join(", ") || "None"}</div><div>Missing secret bindings: {templateRequirements.filter((requirement) => requirement.required && !reviewSnapshot.secretBindings.some((binding) => binding.requirementName === requirement.name)).map((requirement) => requirement.name).join(", ") || "None"}</div></div></> : null}{hasCatalogSkills ? <div className="rounded border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">Catalog selections create this agent stopped; deployment is queued and Start is a separate later action.</div> : null}<label className="flex items-start gap-2 text-sm text-slate-300"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1" /><span>I confirm this reviewed snapshot and understand that creation is the only action taken.</span></label></div> : null}
    {error ? <div role="alert" className="rounded border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">{error}</div> : null}
    <div className="flex flex-wrap justify-between gap-2"><button type="button" className="rounded bg-slate-800 px-3 py-2 text-sm text-slate-200" onClick={onCancel}>Cancel</button><div className="flex gap-2">{stepIndex > 0 ? <button type="button" className="rounded bg-slate-800 px-3 py-2 text-sm text-slate-200" onClick={() => setStep(["ORIGIN", "TEMPLATE", "BINDINGS", "SKILLS", "REVIEW"][stepIndex - 1] as CreateAgentStep)}>Back</button> : null}<button type="button" className="rounded bg-blue-600 px-3 py-2 text-sm text-white" disabled={busy || (step === "TEMPLATE" && !options) || (step === "REVIEW" && !acknowledged)} onClick={() => void next()}>{busy ? "Working..." : step === "REVIEW" ? "Create agent" : "Continue"}</button></div></div>
  </div>;
}

type AgentsScreenProps = {
  agents: Agent[];
  runners: RunnerNode[];
  skills: SkillMeta[];
  principalKey?: string;
  onProvisionAgent: (input: ProvisionAgentHttpInput, signal?: AbortSignal) => Promise<AgentProvisioningReceipt>;
  loadProvisioningOptions?: (signal?: AbortSignal) => Promise<ProvisioningTemplateOptions>;
  loadSkillInventory?: (signal?: AbortSignal) => Promise<SkillInventoryItem[]>;
  onUpdateAgent: (name: string, agent: Omit<AgentForm, "name">) => Promise<void>;
  onDeleteAgent: (name: string) => Promise<void>;
  onStartAgent: (name: string) => Promise<void>;
  onStopAgent: (name: string) => Promise<void>;
  onCleanupAgentWorkspace: (name: string) => Promise<void>;
  loadAgentCrossMemory: (
    name: string
  ) => Promise<{ recent: string; full: string; updatedAtRecent?: number; updatedAtFull?: number }>;
  loadAgentEvents: (name: string) => Promise<EventRow[]>;
  loadAgentWorkspace: (
    name: string,
    path?: string
  ) => Promise<AgentWorkspaceListResponse>;
  loadAgentWorkspaceFile: (
    name: string,
    path: string
  ) => Promise<AgentWorkspaceFileResponse>;
  loadAgentSystemPrompt: (
    name: string
  ) => Promise<{
    found: boolean;
    promptText?: string;
    error?: string;
    createdAt?: number;
    channelId?: string | null;
    modelId?: string | null;
    triggerEventId?: string | null;
  }>;
  onDownloadAgentWorkspaceFile: (name: string, path: string) => void;
  focusAgentName?: string | null;
  onFocusAgentApplied?: () => void;
  drawerOnly?: boolean;
  skillManagement?: AgentSkillsManagement;
  onRefreshAgents?: () => void | Promise<void>;
};

export function AgentsScreen({
  agents,
  runners,
  skills,
  principalKey,
  onProvisionAgent,
  loadProvisioningOptions,
  loadSkillInventory,
  onUpdateAgent,
  onDeleteAgent,
  onStartAgent,
  onStopAgent,
  onCleanupAgentWorkspace,
  loadAgentCrossMemory,
  loadAgentEvents,
  loadAgentWorkspace,
  loadAgentWorkspaceFile,
  loadAgentSystemPrompt,
  onDownloadAgentWorkspaceFile,
  focusAgentName,
  onFocusAgentApplied,
  drawerOnly = false,
  skillManagement,
  onRefreshAgents
}: AgentsScreenProps) {
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);
  const createInvokerRef = useRef<HTMLButtonElement | null>(null);
  const drawerPanelRef = useRef<HTMLElement | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "skills" | "events" | "workspace">(
    "details"
  );
  const [form, setForm] = useState<AgentForm>(DEFAULT_AGENT_FORM);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTogglingRuntime, setIsTogglingRuntime] = useState(false);
  const [isDeletingAgent, setIsDeletingAgent] = useState(false);
  const [agentEvents, setAgentEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [workspaceData, setWorkspaceData] = useState<AgentWorkspaceListResponse | null>(
    null
  );
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [fileLoadingPath, setFileLoadingPath] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<AgentWorkspaceFileResponse | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [agentSkillItems, setAgentSkillItems] = useState<SkillInventoryItem[]>([]);
  const [agentSkillRevision, setAgentSkillRevision] = useState<number | null>(null);
  const [agentSkillsLoading, setAgentSkillsLoading] = useState(false);
  const skillLoadGeneration = useRef(0);
  const skillLoadAbort = useRef<AbortController | null>(null);
  const [crossMemoryDrawerOpen, setCrossMemoryDrawerOpen] = useState(false);
  const [systemPromptDrawerOpen, setSystemPromptDrawerOpen] = useState(false);
  const [systemPromptLoading, setSystemPromptLoading] = useState(false);
  const [systemPromptError, setSystemPromptError] = useState<string | null>(null);
  const [systemPromptText, setSystemPromptText] = useState("");
  const [systemPromptMeta, setSystemPromptMeta] = useState<{
    createdAt?: number;
    channelId?: string | null;
    modelId?: string | null;
    triggerEventId?: string | null;
  } | null>(null);
  const [crossMemoryLoading, setCrossMemoryLoading] = useState(false);
  const [crossMemoryError, setCrossMemoryError] = useState<string | null>(null);
  const [crossMemory, setCrossMemory] = useState<{
    recent: string;
    full: string;
    updatedAtRecent?: number;
    updatedAtFull?: number;
  } | null>(null);
  const crossMemoryCacheRef = useRef<
    Map<string, { recent: string; full: string; updatedAtRecent?: number; updatedAtFull?: number }>
  >(new Map());
  const systemPromptCacheRef = useRef<
    Map<
      string,
      {
        promptText: string;
        createdAt?: number;
        channelId?: string | null;
        modelId?: string | null;
        triggerEventId?: string | null;
      }
    >
  >(new Map());

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.name === selectedAgentName) ?? null,
    [agents, selectedAgentName]
  );
  const selectedEvent = useMemo(
    () => agentEvents.find((event) => event.id === selectedEventId) ?? null,
    [agentEvents, selectedEventId]
  );
  const publicAgents = agents.filter((agent) => agent.visibility !== "PRIVATE");
  const privateAgents = agents.filter((agent) => agent.visibility === "PRIVATE");
  const drawerOpen = Boolean(selectedAgent || isCreating);
  const eventDetailsDrawerOpen = activeTab === "events" && Boolean(selectedEvent);
  const isWrappedMode = form.mode === "WRAPPED";
  const workspaceSegments =
    workspaceData && workspaceData.path !== "."
      ? workspaceData.path.split("/").filter(Boolean)
      : [];
  const headerValidationMessage =
    !form.name.trim()
      ? "Name is required."
      : !isWrappedMode && !form.modelId.trim()
        ? "Model is required."
        : !form.workspacePath.trim()
          ? "Workspace directory is required."
          : null;
  const wrappedConfigValidationMessage = useMemo(() => {
    if (form.mode !== "WRAPPED") return null;
    try {
      parseWrappedConfigJson(form.wrappedConfigJson);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Wrapped config must be valid JSON.";
    }
  }, [form.mode, form.wrappedConfigJson]);

  useEffect(() => {
    if (isCreating) return;
    if (!selectedAgent) return;
    if (isFormDirty) return;
    setForm({
      name: selectedAgent.name,
      modelId: selectedAgent.modelId ?? "openai:gpt-4o-mini",
      visibility: selectedAgent.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC",
      mode: selectedAgent.mode ?? "CLASSIC",
      memoryContextMode: selectedAgent.memoryContextMode ?? "PER_CHANNEL_CROSS_CHANNEL",
      emitAuditEvents: selectedAgent.emitAuditEvents !== false,
      llmCallTimeoutMs:
        selectedAgent.llmCallTimeoutMs && selectedAgent.llmCallTimeoutMs > 0
          ? String(selectedAgent.llmCallTimeoutMs)
          : "",
      contextSessionGapMs:
        selectedAgent.contextSessionGapMs && selectedAgent.contextSessionGapMs > 0
          ? String(selectedAgent.contextSessionGapMs)
          : "",
      workspacePath:
        selectedAgent.workspacePath ??
        `.orgops-data/workspaces/${selectedAgent.name}`,
      allowOutsideWorkspace: Boolean(selectedAgent.allowOutsideWorkspace),
      assignedRunnerId: selectedAgent.assignedRunnerId ?? "",
      soulContents: selectedAgent.soulContents ?? "",
      enabledSkills: selectedAgent.enabledSkills ?? [],
      alwaysPreloadedSkills: selectedAgent.alwaysPreloadedSkills ?? [],
      wrappedConfigJson: stringifyWrappedConfig(selectedAgent.wrappedConfig)
    });
  }, [isCreating, selectedAgent, isFormDirty]);

  useEffect(() => {
    if (!focusAgentName) return;
    if (!agents.some((agent) => agent.name === focusAgentName)) return;
    setSelectedAgentName(focusAgentName);
    setIsCreating(false);
    setActiveTab("details");
    setIsFormDirty(false);
    setSaveStatus(null);
    setPanelError(null);
    setSelectedEventId(null);
    setOpenFile(null);
    setCrossMemoryDrawerOpen(false);
    setSystemPromptDrawerOpen(false);
    setSystemPromptLoading(false);
    setSystemPromptError(null);
    setSystemPromptText("");
    setSystemPromptMeta(null);
    onFocusAgentApplied?.();
  }, [agents, focusAgentName, onFocusAgentApplied]);

  const loadSelectedAgentSkills = async () => {
    const capturedAgentId = selectedAgent?.id;
    const capturedPrincipal = principalKey;
    if (!capturedAgentId || !skillManagement?.listForAgent || activeTab !== "skills") return;
    skillLoadAbort.current?.abort();
    const controller = new AbortController();
    skillLoadAbort.current = controller;
    const request = ++skillLoadGeneration.current;
    setAgentSkillsLoading(true);
    try {
      const result = await skillManagement.listForAgent(capturedAgentId, { query: "", origin: "ALL", availability: "ALL" }, controller.signal);
      if (controller.signal.aborted || request !== skillLoadGeneration.current || selectedAgent?.id !== capturedAgentId || principalKey !== capturedPrincipal || activeTab !== "skills") return;
      if (result.ok) { setAgentSkillItems(result.value.items); setAgentSkillRevision(result.value.agentRevision); }
      else setPanelError(result.error.message);
    } catch (error) {
      if (!controller.signal.aborted && request === skillLoadGeneration.current && selectedAgent?.id === capturedAgentId && principalKey === capturedPrincipal) setPanelError(error instanceof Error ? error.message : "Failed to load agent skills.");
    } finally {
      if (request === skillLoadGeneration.current) setAgentSkillsLoading(false);
    }
  };

  useEffect(() => {
    skillLoadAbort.current?.abort();
    skillLoadGeneration.current += 1;
    setAgentSkillItems([]);
    setAgentSkillRevision(null);
    if (!selectedAgent || isCreating || activeTab !== "skills") {
      setAgentEvents([]);
      setSelectedEventId(null);
      setWorkspaceData(null);
      setOpenFile(null);
      setCrossMemoryDrawerOpen(false);
      setSystemPromptDrawerOpen(false);
      setSystemPromptLoading(false);
      setSystemPromptError(null);
      setSystemPromptText("");
      setSystemPromptMeta(null);
      setCrossMemory(null);
      setCrossMemoryError(null);
      setCrossMemoryLoading(false);
      return;
    }
    setPanelError(null);
    void loadSelectedAgentSkills();
    return () => { skillLoadAbort.current?.abort(); skillLoadGeneration.current += 1; };
  }, [selectedAgent?.id, principalKey, isCreating, activeTab, skillManagement]);

  const handleNewAgent = () => {
    setSelectedAgentName(null);
    setIsCreating(true);
    setActiveTab("details");
    setForm(DEFAULT_AGENT_FORM);
    setIsFormDirty(false);
    setSaveStatus(null);
    setPanelError(null);
    setSelectedEventId(null);
    setOpenFile(null);
    setCrossMemoryDrawerOpen(false);
    setSystemPromptDrawerOpen(false);
    setSystemPromptLoading(false);
    setSystemPromptError(null);
    setSystemPromptText("");
    setSystemPromptMeta(null);
  };

  const handleSelectAgent = (name: string) => {
    setSelectedAgentName(name);
    setIsCreating(false);
    setActiveTab("details");
    setIsFormDirty(false);
    setSaveStatus(null);
    setPanelError(null);
    setSelectedEventId(null);
    setOpenFile(null);
    setCrossMemoryDrawerOpen(false);
    setSystemPromptDrawerOpen(false);
    setSystemPromptLoading(false);
    setSystemPromptError(null);
    setSystemPromptText("");
    setSystemPromptMeta(null);
  };

  const closeDrawer = () => {
    setSelectedAgentName(null);
    setIsCreating(false);
    setSaveStatus(null);
    setPanelError(null);
    setSelectedEventId(null);
    setOpenFile(null);
    setCrossMemoryDrawerOpen(false);
    window.setTimeout(() => createInvokerRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!drawerOpen) return;
    const panel = drawerPanelRef.current;
    const first = panel?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])");
    first?.focus();
  }, [drawerOpen]);

  const trapDrawerFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(drawerPanelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])") ?? []);
    if (!focusable.length) return;
    const first = focusable[0]!; const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  useEscapeKey(
    drawerOpen ||
      eventDetailsDrawerOpen ||
      crossMemoryDrawerOpen ||
      systemPromptDrawerOpen ||
      Boolean(openFile),
    () => {
      if (systemPromptDrawerOpen) {
        setSystemPromptDrawerOpen(false);
        return;
      }
      if (crossMemoryDrawerOpen) {
        setCrossMemoryDrawerOpen(false);
        return;
      }
      if (openFile) {
        setOpenFile(null);
        return;
      }
      if (eventDetailsDrawerOpen) {
        setSelectedEventId(null);
        return;
      }
      if (drawerOpen) {
        closeDrawer();
      }
    }
  );

  const openEventsTab = async () => {
    if (!selectedAgent) return;
    setActiveTab("events");
    setPanelError(null);
    setEventsLoading(true);
    try {
      const data = await loadAgentEvents(selectedAgent.name);
      setAgentEvents(data);
      setSelectedEventId((prev) =>
        prev && data.some((event) => event.id === prev) ? prev : null
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load agent events.";
      setPanelError(message);
    } finally {
      setEventsLoading(false);
    }
  };

  const openWorkspacePath = async (path = ".") => {
    if (!selectedAgent) return;
    setActiveTab("workspace");
    setPanelError(null);
    setWorkspaceLoading(true);
    try {
      const data = await loadAgentWorkspace(selectedAgent.name, path);
      setWorkspaceData(data);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load workspace contents.";
      setPanelError(message);
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const handleOpenWorkspaceEntry = async (entry: AgentWorkspaceListResponse["entries"][number]) => {
    if (!selectedAgent) return;
    if (entry.kind === "directory") {
      await openWorkspacePath(entry.path);
      return;
    }
    if (!entry.isTextFile) {
      onDownloadAgentWorkspaceFile(selectedAgent.name, entry.path);
      return;
    }
    setPanelError(null);
    setFileLoadingPath(entry.path);
    try {
      const file = await loadAgentWorkspaceFile(selectedAgent.name, entry.path);
      setOpenFile(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load file.";
      setPanelError(message);
    } finally {
      setFileLoadingPath(null);
    }
  };

  const refreshCrossMemory = async (agentName: string) => {
    try {
      setCrossMemoryLoading(true);
      setCrossMemoryError(null);
      const data = await loadAgentCrossMemory(agentName);
      crossMemoryCacheRef.current.set(agentName, data);
      setCrossMemory(data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load cross-channel memory.";
      setCrossMemoryError(message);
    } finally {
      setCrossMemoryLoading(false);
    }
  };

  const openCrossMemoryDrawer = async () => {
    if (!selectedAgent) return;
    setCrossMemoryDrawerOpen(true);
    setCrossMemoryError(null);
    const cached = crossMemoryCacheRef.current.get(selectedAgent.name);
    if (cached) {
      setCrossMemory(cached);
      setCrossMemoryLoading(false);
      return;
    }
    await refreshCrossMemory(selectedAgent.name);
  };

  const openSystemPromptDrawer = async () => {
    if (!selectedAgent) return;
    setSystemPromptDrawerOpen(true);
    setSystemPromptError(null);
    const cached = systemPromptCacheRef.current.get(selectedAgent.name);
    if (cached) {
      setSystemPromptText(cached.promptText);
      setSystemPromptMeta({
        createdAt: cached.createdAt,
        channelId: cached.channelId,
        modelId: cached.modelId,
        triggerEventId: cached.triggerEventId
      });
      setSystemPromptLoading(false);
      return;
    }
    setSystemPromptLoading(true);
    try {
      const data = await loadAgentSystemPrompt(selectedAgent.name);
      if (!data.found || !data.promptText?.trim()) {
        setSystemPromptText("");
        setSystemPromptMeta(null);
        setSystemPromptError(
          data.error ??
            "No composed prompt found yet for this agent. Wait for the next agent turn, then refresh."
        );
        return;
      }
      const payload = {
        promptText: data.promptText,
        createdAt: data.createdAt,
        channelId: data.channelId,
        modelId: data.modelId,
        triggerEventId: data.triggerEventId
      };
      systemPromptCacheRef.current.set(selectedAgent.name, payload);
      setSystemPromptText(payload.promptText);
      setSystemPromptMeta({
        createdAt: payload.createdAt,
        channelId: payload.channelId,
        modelId: payload.modelId,
        triggerEventId: payload.triggerEventId
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load composed system prompt.";
      setSystemPromptError(message);
    } finally {
      setSystemPromptLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || (!isWrappedMode && !form.modelId.trim()) || !form.workspacePath.trim()) {
      return;
    }
    setIsSubmitting(true);
    setSaveStatus(null);
    try {
      const llmCallTimeoutMs = isWrappedMode
        ? null
        : parseOptionalPositiveIntInput(form.llmCallTimeoutMs, "LLM call timeout");
      const contextSessionGapMs = isWrappedMode
        ? null
        : parseOptionalPositiveIntInput(form.contextSessionGapMs, "Context session gap");
      const wrappedConfig =
        isWrappedMode ? parseWrappedConfigJson(form.wrappedConfigJson) : {};
      const modelId = isWrappedMode ? "wrapped:none" : form.modelId.trim();
      const memoryContextMode = isWrappedMode ? "OFF" : form.memoryContextMode;
      const emitAuditEvents = isWrappedMode ? true : form.emitAuditEvents;
      const soulContents = isWrappedMode ? "" : form.soulContents;
      const enabledSkills = isWrappedMode ? [] : form.enabledSkills;
      const alwaysPreloadedSkills = isWrappedMode ? [] : form.alwaysPreloadedSkills;
      const allowOutsideWorkspace = isWrappedMode ? false : form.allowOutsideWorkspace;
      if (!selectedAgent) return;
      await onUpdateAgent(selectedAgent.name, {
        modelId,
        visibility: form.visibility,
        mode: form.mode,
        memoryContextMode,
        emitAuditEvents,
        llmCallTimeoutMs: llmCallTimeoutMs === null ? "" : String(llmCallTimeoutMs),
        contextSessionGapMs:
          contextSessionGapMs === null ? "" : String(contextSessionGapMs),
        workspacePath: form.workspacePath.trim(),
        allowOutsideWorkspace,
        assignedRunnerId: form.assignedRunnerId.trim(),
        soulContents,
        enabledSkills,
        alwaysPreloadedSkills,
        wrappedConfigJson: JSON.stringify(wrappedConfig),
        wrappedConfig
      });
      setIsFormDirty(false);
      setSaveStatus({
        kind: "success",
        message: `Agent "${selectedAgent.name}" was saved successfully.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save agent.";
      setSaveStatus({ kind: "error", message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleRuntime = async () => {
    if (!selectedAgent) return;
    const isRunning = selectedAgent.runtimeState === "RUNNING";
    setIsTogglingRuntime(true);
    setSaveStatus(null);
    try {
      if (isRunning) {
        await onStopAgent(selectedAgent.name);
      } else {
        await onStartAgent(selectedAgent.name);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update agent state.";
      setSaveStatus({ kind: "error", message });
    } finally {
      setIsTogglingRuntime(false);
    }
  };

  const handleDeleteAgent = async () => {
    if (!selectedAgent) return;
    const agentName = selectedAgent.name;
    const confirmed = window.confirm(
      `Delete agent "${agentName}"? This removes its runtime state, memory, and channel memberships. This cannot be undone.`
    );
    if (!confirmed) return;
    setIsDeletingAgent(true);
    setSaveStatus(null);
    setPanelError(null);
    try {
      await onDeleteAgent(agentName);
      crossMemoryCacheRef.current.delete(agentName);
      systemPromptCacheRef.current.delete(agentName);
      setSelectedAgentName(null);
      setIsCreating(false);
      setActiveTab("details");
      setForm(DEFAULT_AGENT_FORM);
      setIsFormDirty(false);
      setAgentEvents([]);
      setSelectedEventId(null);
      setWorkspaceData(null);
      setOpenFile(null);
      setCrossMemoryDrawerOpen(false);
      setSystemPromptDrawerOpen(false);
      setCrossMemory(null);
      setSystemPromptText("");
      setSystemPromptMeta(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete agent.";
      setSaveStatus({ kind: "error", message });
    } finally {
      setIsDeletingAgent(false);
    }
  };

  const toggleSkill = (skillName: string) => {
    setIsFormDirty(true);
    setSaveStatus(null);
    setForm((prev) => {
      const exists = prev.enabledSkills.includes(skillName);
      if (exists) {
        return {
          ...prev,
          enabledSkills: prev.enabledSkills.filter((name) => name !== skillName),
          alwaysPreloadedSkills: prev.alwaysPreloadedSkills.filter(
            (name) => name !== skillName
          )
        };
      }
      return { ...prev, enabledSkills: [...prev.enabledSkills, skillName] };
    });
  };

  const toggleAlwaysPreloadedSkill = (skillName: string) => {
    setIsFormDirty(true);
    setSaveStatus(null);
    setForm((prev) => {
      const isEnabled = prev.enabledSkills.includes(skillName);
      if (!isEnabled) {
        return {
          ...prev,
          enabledSkills: [...prev.enabledSkills, skillName],
          alwaysPreloadedSkills: [...prev.alwaysPreloadedSkills, skillName]
        };
      }
      const exists = prev.alwaysPreloadedSkills.includes(skillName);
      if (exists) {
        return {
          ...prev,
          alwaysPreloadedSkills: prev.alwaysPreloadedSkills.filter(
            (name) => name !== skillName
          )
        };
      }
      return {
        ...prev,
        alwaysPreloadedSkills: [...prev.alwaysPreloadedSkills, skillName]
      };
    });
  };

  const renderVisibilityBadge = (agent: Pick<Agent, "visibility">) => (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] ${
        agent.visibility === "PRIVATE"
          ? "border border-violet-700/70 bg-violet-950/40 text-violet-200"
          : "border border-slate-700 bg-slate-900 text-slate-300"
      }`}
    >
      {agent.visibility === "PRIVATE" ? "Private" : "Public"}
    </span>
  );

  const renderAgentRows = (list: Agent[]) =>
    list.map((agent) => (
      <tr
        key={agent.name}
        className={`cursor-pointer border-b border-slate-900 align-top hover:bg-slate-900/40 ${
          selectedAgentName === agent.name && !isCreating ? "bg-slate-900/70" : ""
        }`}
        onClick={() => handleSelectAgent(agent.name)}
      >
        <td className="whitespace-nowrap px-2 py-2">
          {renderVisibilityBadge(agent)}
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-slate-200">
          {agent.name}
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-slate-300">
          {agent.runtimeState}
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-slate-400">
          {agent.desiredState}
        </td>
        <td className="max-w-[220px] truncate px-2 py-2 text-slate-400">
          {formatAgentModelLabel(agent)}
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-slate-400">
          {agent.mode ?? "CLASSIC"}
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-slate-400">
          {agent.memoryContextMode ?? "PER_CHANNEL_CROSS_CHANNEL"}
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-slate-400">
          {agent.assignedRunnerId ?? "-"}
        </td>
        <td className="max-w-[420px] truncate px-2 py-2 text-slate-500">
          {agent.workspacePath ?? "-"}
        </td>
      </tr>
    ));

  return (
    <div className="space-y-4">
      {!drawerOnly ? (
      <Card title={`Agents (${agents.length})`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            Click an agent row to open details, events, and workspace.
          </div>
          <Button onClick={(event) => { createInvokerRef.current = event.currentTarget; handleNewAgent(); }}>New agent</Button>
        </div>
        <div className="space-y-6 overflow-x-auto">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
              <span>Public agents</span>
              <span className="rounded bg-slate-900 px-1.5 py-0.5 text-slate-400">
                {publicAgents.length}
              </span>
            </div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-300">
                <th className="px-2 py-2">Visibility</th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Runtime</th>
                <th className="px-2 py-2">Desired</th>
                <th className="px-2 py-2">Model</th>
                <th className="px-2 py-2">Mode</th>
                <th className="px-2 py-2">Memory Context</th>
                <th className="px-2 py-2">Runner</th>
                <th className="px-2 py-2">Workspace</th>
              </tr>
            </thead>
            <tbody>{renderAgentRows(publicAgents)}</tbody>
          </table>
          {publicAgents.length === 0 && (
            <div className="py-4 text-center text-slate-500">No public agents found.</div>
          )}
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-violet-300">
              <span>Private agents visible to you</span>
              <span className="rounded bg-violet-950/60 px-1.5 py-0.5 text-violet-200">
                {privateAgents.length}
              </span>
            </div>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-slate-300">
                  <th className="px-2 py-2">Visibility</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Runtime</th>
                  <th className="px-2 py-2">Desired</th>
                  <th className="px-2 py-2">Model</th>
                  <th className="px-2 py-2">Mode</th>
                  <th className="px-2 py-2">Memory Context</th>
                  <th className="px-2 py-2">Runner</th>
                  <th className="px-2 py-2">Workspace</th>
                </tr>
              </thead>
              <tbody>{renderAgentRows(privateAgents)}</tbody>
            </table>
            {privateAgents.length === 0 && (
              <div className="py-4 text-center text-slate-500">
                No private agents visible to you.
              </div>
            )}
          </div>

          {agents.length === 0 && (
            <div className="py-8 text-center text-slate-500">No agents found.</div>
          )}
        </div>
      </Card>
      ) : null}

      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity lg:left-56 ${
          drawerOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={closeDrawer}
      />

      <aside
        className={`fixed bottom-0 right-0 top-0 z-50 w-full max-w-4xl border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-300 ${
          drawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-drawer-title"
        aria-hidden={!drawerOpen}
        tabIndex={-1}
        ref={drawerPanelRef}
        onKeyDown={trapDrawerFocus}
      >
        <div className="relative flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
            <div>
              <h3 id="agent-drawer-title" className="text-sm font-semibold text-slate-100">
                {isCreating
                  ? "Create Agent"
                  : selectedAgent
                    ? `Agent: ${selectedAgent.name}`
                    : "Agent"}
              </h3>
              <p className="text-xs text-slate-500">
                {isCreating
                  ? "Set up a new agent."
                  : selectedAgent
                    ? `${selectedAgent.runtimeState} | ${formatAgentModelLabel(selectedAgent)} | ${
                        selectedAgent.visibility === "PRIVATE" ? "Private" : "Public"
                      }`
                    : "Select an agent row."}
              </p>
              {activeTab === "details" && (isCreating || selectedAgent) ? (
                <p
                  className={`mt-1 text-xs ${
                    saveStatus
                      ? saveStatus.kind === "success"
                        ? "text-emerald-300"
                        : "text-rose-400"
                      : headerValidationMessage
                        ? "text-amber-300"
                        : "text-slate-500"
                  }`}
                >
                  {saveStatus?.message ??
                    headerValidationMessage ??
                    (isFormDirty ? "Unsaved changes." : "No unsaved changes.")}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {activeTab === "details" && !isCreating && selectedAgent ? (
                <>
                  <Button
                    onClick={handleSubmit}
                    disabled={
                      isSubmitting ||
                      !isFormDirty ||
                      !form.name.trim() ||
                      (!isWrappedMode && !form.modelId.trim()) ||
                      !form.workspacePath.trim() ||
                      Boolean(wrappedConfigValidationMessage)
                    }
                  >
                    {isSubmitting ? "Saving..." : "Save Details"}
                  </Button>
                  {!isCreating && selectedAgent && (
                    <Button
                      variant="secondary"
                      onClick={handleToggleRuntime}
                      disabled={isTogglingRuntime}
                    >
                      {isTogglingRuntime
                        ? selectedAgent.runtimeState === "RUNNING"
                          ? "Stopping..."
                          : "Starting..."
                        : selectedAgent.runtimeState === "RUNNING"
                          ? "Stop"
                          : "Start"}
                    </Button>
                  )}
                </>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={closeDrawer}
              >
                Close
              </Button>
            </div>
          </div>

          <div className="flex shrink-0 gap-2 border-b border-slate-800 px-4 py-3">
            <Button
              variant={activeTab === "details" ? "primary" : "secondary"}
              className="px-3 py-1 text-xs"
              onClick={() => setActiveTab("details")}
            >
              Details
            </Button>
            <Button
              variant={activeTab === "skills" ? "primary" : "secondary"}
              className="px-3 py-1 text-xs"
              onClick={() => setActiveTab("skills")}
              disabled={!selectedAgent || !skillManagement}
            >
              Skills
            </Button>
            <Button
              variant={activeTab === "events" ? "primary" : "secondary"}
              className="px-3 py-1 text-xs"
              onClick={openEventsTab}
              disabled={!selectedAgent}
            >
              Events
            </Button>
            <Button
              variant={activeTab === "workspace" ? "primary" : "secondary"}
              className="px-3 py-1 text-xs"
              onClick={() => openWorkspacePath(".")}
              disabled={!selectedAgent}
            >
              Workspace
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
            {activeTab === "details" && isCreating && (
              <CreateAgentFlow
                runners={runners}
                skills={skills}
                principalKey={principalKey}
                onProvisionAgent={onProvisionAgent}
                loadProvisioningOptions={loadProvisioningOptions}
                loadSkillInventory={loadSkillInventory}
                loadStartReadiness={getAgentStartReadiness}
                onStartAgent={onStartAgent}
                onDone={(createdReceipt) => {
                  setIsCreating(false);
                  setSelectedAgentName(createdReceipt?.name ?? null);
                  setForm(DEFAULT_AGENT_FORM);
                  setIsFormDirty(false);
                  setSaveStatus({ kind: "success", message: createdReceipt ? "Created stopped; deployment queued" : "Agent was saved successfully." });
                }}
                onCancel={closeDrawer}
              />
            )}

            {activeTab === "details" && !isCreating && (
              <div className="space-y-4">
                {!selectedAgent ? (
                  <div className="text-sm text-slate-500">
                    Select an existing agent or create a new one.
                  </div>
                ) : (
                  <>
                    {!isWrappedMode && !isCreating && selectedAgent && (
                      <div className="rounded border border-slate-800 bg-slate-950 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm text-slate-300">Cross-Channel Memory</div>
                          <Button
                            type="button"
                            variant="secondary"
                            className="px-2 py-1 text-xs"
                            onClick={() => {
                              void openCrossMemoryDrawer();
                            }}
                          >
                            View memory
                          </Button>
                        </div>
                      </div>
                    )}
                    {!isWrappedMode ? (
                    <div className="rounded border border-slate-800 bg-slate-950 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm text-slate-300">System Prompt</div>
                        <Button
                          type="button"
                          variant="secondary"
                          className="px-2 py-1 text-xs"
                          onClick={() => {
                            void openSystemPromptDrawer();
                          }}
                          disabled={!selectedAgent}
                        >
                          View system prompt
                        </Button>
                      </div>
                    </div>
                    ) : null}
                    <div className="space-y-1">
                      <div className="text-sm text-slate-400">Name</div>
                      <Input
                        value={form.name}
                        disabled={!isCreating}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          setForm((prev) => ({ ...prev, name: e.target.value }));
                        }}
                        placeholder="Agent name"
                      />
                    </div>
                    {!isWrappedMode ? (
                    <div className="space-y-1">
                      <div className="text-sm text-slate-400">Model</div>
                      <Input
                        value={form.modelId}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          setForm((prev) => ({ ...prev, modelId: e.target.value }));
                        }}
                        placeholder="openai:gpt-4o-mini"
                      />
                    </div>
                    ) : null}
                    <div className="space-y-1">
                      <div className="text-sm text-slate-400">Visibility</div>
                      <select
                        value={form.visibility}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          setForm((prev) => ({
                            ...prev,
                            visibility: e.target.value === "PRIVATE" ? "PRIVATE" : "PUBLIC"
                          }));
                        }}
                        className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                      >
                        <option value="PUBLIC">Public (discoverable by everyone)</option>
                        <option value="PRIVATE">
                          Private (owner + humans sharing a channel)
                        </option>
                      </select>
                      <p className="text-xs text-slate-500">
                        Private agents can still participate in channels but are hidden from global discovery.
                      </p>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-slate-400">Mode</div>
                      <select
                        value={form.mode}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          const nextMode =
                            e.target.value === "WRAPPED"
                              ? "WRAPPED"
                              : e.target.value === "RLM_REPL"
                                ? "RLM_REPL"
                                : "CLASSIC";
                          setForm((prev) => ({
                            ...prev,
                            mode: nextMode,
                            modelId:
                              nextMode === "WRAPPED" && prev.modelId === "openai:gpt-4o-mini"
                                ? "wrapped:none"
                                : nextMode !== "WRAPPED" && prev.modelId === "wrapped:none"
                                  ? "openai:gpt-4o-mini"
                                  : prev.modelId
                          }));
                        }}
                        className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                      >
                        <option value="CLASSIC">CLASSIC</option>
                        <option value="RLM_REPL">RLM_REPL</option>
                        <option value="WRAPPED">WRAPPED</option>
                      </select>
                      {form.mode === "WRAPPED" ? (
                        <p className="text-xs text-slate-500">
                          Wrapped agents use an external runtime harness. OrgOps manages lifecycle and routing.
                        </p>
                      ) : null}
                    </div>
                    {form.mode === "WRAPPED" ? (
                      <div className="space-y-2 rounded border border-slate-800 bg-slate-950 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm text-slate-300">Wrapped runtime config</div>
                            <p className="text-xs text-slate-500">
                              JSON object passed to the selected wrapper harness. Use `harness: "command"` for command recipes.
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            className="px-2 py-1 text-xs"
                            onClick={() => {
                              setIsFormDirty(true);
                              setSaveStatus(null);
                              setForm((prev) => ({
                                ...prev,
                                wrappedConfigJson: DEFAULT_WRAPPED_CONFIG
                              }));
                            }}
                          >
                            Reset template
                          </Button>
                        </div>
                        <Textarea
                          rows={14}
                          value={form.wrappedConfigJson}
                          onChange={(e) => {
                            setIsFormDirty(true);
                            setSaveStatus(null);
                            setForm((prev) => ({
                              ...prev,
                              wrappedConfigJson: e.target.value
                            }));
                          }}
                          className="font-mono text-xs"
                          placeholder={DEFAULT_WRAPPED_CONFIG}
                        />
                        <div
                          className={`text-xs ${
                            wrappedConfigValidationMessage ? "text-rose-400" : "text-slate-500"
                          }`}
                        >
                          {wrappedConfigValidationMessage ??
                            "Valid JSON. Setup/runtime commands execute on the runner host."}
                        </div>
                      </div>
                    ) : null}
                    {!isWrappedMode ? (
                    <div className="space-y-1">
                      <div className="text-sm text-slate-400">Memory context mode</div>
                      <select
                        value={form.memoryContextMode}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          const mode = e.target.value;
                          setForm((prev) => ({
                            ...prev,
                            memoryContextMode:
                              mode === "FULL_CHANNEL_EVENTS"
                                ? "FULL_CHANNEL_EVENTS"
                                : mode === "OFF"
                                  ? "OFF"
                                  : "PER_CHANNEL_CROSS_CHANNEL"
                          }));
                        }}
                        className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                      >
                        <option value="PER_CHANNEL_CROSS_CHANNEL">
                          PER_CHANNEL_CROSS_CHANNEL
                        </option>
                        <option value="FULL_CHANNEL_EVENTS">FULL_CHANNEL_EVENTS</option>
                        <option value="OFF">OFF</option>
                      </select>
                    </div>
                    ) : null}
                    {!isWrappedMode ? (
                    <label className="flex items-center gap-2 rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={form.emitAuditEvents}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          setForm((prev) => ({
                            ...prev,
                            emitAuditEvents: e.target.checked
                          }));
                        }}
                      />
                      <span>Emit observability/debug audit events for this agent</span>
                    </label>
                    ) : null}
                    <div className="space-y-1">
                      <div className="text-sm text-slate-400">Assigned runner</div>
                      <select
                        value={form.assignedRunnerId}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          setForm((prev) => ({
                            ...prev,
                            assignedRunnerId: e.target.value
                          }));
                        }}
                        className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                      >
                        <option value="">Unassigned</option>
                        {runners.map((runner) => (
                          <option key={runner.id} value={runner.id}>
                            {runner.displayName} ({runner.online ? "online" : "offline"})
                          </option>
                        ))}
                      </select>
                    </div>
                    {!isWrappedMode ? (
                    <div className="space-y-1">
                      <div className="text-sm text-slate-400">LLM call timeout (ms)</div>
                      <Input
                        value={form.llmCallTimeoutMs}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          setForm((prev) => ({ ...prev, llmCallTimeoutMs: e.target.value }));
                        }}
                        placeholder="Leave empty to use system default (10800000)"
                      />
                    </div>
                    ) : null}
                    {!isWrappedMode ? (
                    <div className="space-y-1">
                      <div className="text-sm text-slate-400">
                        Session gap threshold (ms)
                      </div>
                      <Input
                        value={form.contextSessionGapMs}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          setForm((prev) => ({
                            ...prev,
                            contextSessionGapMs: e.target.value,
                          }));
                        }}
                        placeholder="Leave empty to use default (300000)"
                      />
                    </div>
                    ) : null}
                    <div className="space-y-1">
                      <div className="text-sm text-slate-400">Workspace directory</div>
                      <Input
                        value={form.workspacePath}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          setForm((prev) => ({ ...prev, workspacePath: e.target.value }));
                        }}
                        placeholder=".orgops-data/workspaces/agent-name"
                      />
                    </div>
                    {!isWrappedMode ? (
                    <label className="flex items-center gap-2 rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={form.allowOutsideWorkspace}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          setForm((prev) => ({
                            ...prev,
                            allowOutsideWorkspace: e.target.checked
                          }));
                        }}
                      />
                      <span>Allow access outside workspace (full host filesystem)</span>
                    </label>
                    ) : null}
                    {!isWrappedMode ? (
                    <div className="space-y-2">
                      <div className="text-sm text-slate-400">Enabled skills</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {skills.map((skill) => (
                          <div
                            key={skill.path}
                            className="flex items-start gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-2 text-sm text-slate-300"
                          >
                            <div className="space-y-2">
                              <div className="leading-tight">
                                <span className="block text-slate-200">{skill.name}</span>
                                <span className="text-xs text-slate-500">{skill.description}</span>
                              </div>
                              <label className="flex items-center gap-2 text-xs text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={form.enabledSkills.includes(skill.name)}
                                  onChange={() => toggleSkill(skill.name)}
                                  className="mt-0.5"
                                />
                                <span>Enabled</span>
                              </label>
                              <label className="flex items-center gap-2 text-xs text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={form.alwaysPreloadedSkills.includes(skill.name)}
                                  onChange={() => toggleAlwaysPreloadedSkill(skill.name)}
                                  className="mt-0.5"
                                />
                                <span>Always pre-load into context</span>
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    ) : null}
                    {!isWrappedMode ? (
                    <div className="space-y-1">
                      <div className="text-sm text-slate-400">SOUL contents</div>
                      <Textarea
                        rows={12}
                        value={form.soulContents}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          setForm((prev) => ({ ...prev, soulContents: e.target.value }));
                        }}
                        placeholder="System-level guidance and behavior instructions."
                      />
                    </div>
                    ) : null}
                    {isFormDirty && (
                      <div className="text-sm text-amber-300">Unsaved changes.</div>
                    )}
                    {saveStatus && (
                      <div
                        className={`text-sm ${
                          saveStatus.kind === "success" ? "text-emerald-300" : "text-rose-400"
                        }`}
                      >
                        {saveStatus.message}
                      </div>
                    )}
                    {!isCreating && selectedAgent && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          className="bg-amber-900 text-amber-100 hover:bg-amber-800"
                          onClick={async () => {
                            const confirmed = confirm(
                              `Clean workspace for ${selectedAgent.name}? This deletes all files in ${form.workspacePath}.`
                            );
                            if (!confirmed) return;
                            await onCleanupAgentWorkspace(selectedAgent.name);
                            await openWorkspacePath(".");
                          }}
                        >
                          Clean Workspace
                        </Button>
                        <Button
                          variant="secondary"
                          className="bg-rose-900 text-rose-100 hover:bg-rose-800"
                          onClick={handleDeleteAgent}
                          disabled={isDeletingAgent}
                        >
                          {isDeletingAgent ? "Deleting..." : "Delete Agent"}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {activeTab === "skills" && selectedAgent && (
              selectedAgent.id && skillManagement && agentSkillRevision !== null ?
                <AgentSkillsTab
                  agentId={selectedAgent.id}
                  agentRevision={agentSkillRevision}
                  items={agentSkillItems}
                  localEnabled={selectedAgent.enabledSkills ?? []}
                  localPreloaded={selectedAgent.alwaysPreloadedSkills ?? []}
                  management={skillManagement}
                  busy={agentSkillsLoading}
                  onReload={async () => { await loadSelectedAgentSkills(); await onRefreshAgents?.(); }}
                /> : <div className="text-sm text-slate-500">Skill inventory is unavailable until this agent has a canonical id and revision.</div>
            )}

            {activeTab === "events" && (
              <div className="space-y-2 rounded border border-slate-800 bg-slate-950 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm text-slate-300">Agent Events</h3>
                  <Button
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={openEventsTab}
                    disabled={!selectedAgent || eventsLoading}
                  >
                    Refresh
                  </Button>
                </div>
                <div className="max-h-full space-y-2 overflow-auto pr-1 text-sm">
                  {eventsLoading && (
                    <div className="text-sm text-slate-500">Loading events...</div>
                  )}
                  {!eventsLoading &&
                    agentEvents.map((event) => (
                      <button
                        type="button"
                        key={event.id}
                        className={`w-full rounded border-b border-slate-800 px-2 py-2 text-left hover:bg-slate-900/40 ${
                          selectedEventId === event.id ? "bg-slate-900/70" : ""
                        }`}
                        onClick={() => setSelectedEventId(event.id)}
                      >
                        <div className="text-slate-300">{event.type}</div>
                        <div className="text-xs text-slate-500">
                          {event.source} | {formatTimestamp(event.createdAt)}
                        </div>
                      </button>
                    ))}
                  {!eventsLoading && agentEvents.length === 0 && (
                    <div className="text-sm text-slate-500">No events found for this agent.</div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "workspace" && (
              <div className="space-y-3 rounded border border-slate-800 bg-slate-950 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Button
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() => openWorkspacePath(".")}
                    disabled={!selectedAgent || workspaceLoading}
                  >
                    Root
                  </Button>
                  {workspaceSegments.map((segment, index) => {
                    const path = workspaceSegments.slice(0, index + 1).join("/");
                    return (
                      <Button
                        key={path}
                        variant="secondary"
                        className="px-2 py-1 text-xs"
                        onClick={() => openWorkspacePath(path)}
                        disabled={!selectedAgent || workspaceLoading}
                      >
                        {segment}
                      </Button>
                    );
                  })}
                </div>

                {workspaceLoading && (
                  <div className="text-sm text-slate-500">Loading workspace...</div>
                )}

                {!workspaceLoading && workspaceData && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 text-left text-slate-300">
                          <th className="px-2 py-2">Name</th>
                          <th className="px-2 py-2">Kind</th>
                          <th className="px-2 py-2">Size</th>
                          <th className="px-2 py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workspaceData.entries.map((entry) => (
                          <tr
                            key={entry.path}
                            className="cursor-pointer border-b border-slate-900 hover:bg-slate-900/40"
                            onClick={() => handleOpenWorkspaceEntry(entry)}
                          >
                            <td className="px-2 py-2 text-slate-200">{entry.name}</td>
                            <td className="px-2 py-2 text-slate-400">{entry.kind}</td>
                            <td className="whitespace-nowrap px-2 py-2 text-slate-500">
                              {entry.kind === "file" ? (entry.size ?? "-") : "-"}
                            </td>
                            <td className="px-2 py-2 text-slate-300">
                              {entry.kind === "directory"
                                ? "Open"
                                : entry.isTextFile
                                  ? fileLoadingPath === entry.path
                                    ? "Opening..."
                                    : "Preview"
                                  : "Download"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {workspaceData.entries.length === 0 && (
                      <div className="py-6 text-center text-sm text-slate-500">
                        This folder is empty.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {panelError && (
              <div className="rounded border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
                {panelError}
              </div>
            )}
          </div>

          <div
            className={`absolute inset-0 z-10 flex justify-end bg-black/30 transition-opacity ${
              eventDetailsDrawerOpen
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0"
            }`}
            onClick={() => setSelectedEventId(null)}
          >
            <div
              className={`pointer-events-auto flex h-full w-full max-w-2xl flex-col border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-300 ${
                eventDetailsDrawerOpen ? "translate-x-0" : "translate-x-full"
              }`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-100">Event Details</h4>
                  <p className="text-xs text-slate-500">
                    {selectedEvent ? selectedEvent.id : "No event selected"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="px-2 py-1 text-xs"
                  onClick={() => setSelectedEventId(null)}
                >
                  Back
                </Button>
              </div>

              {selectedEvent ? (
                <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4 text-sm">
                  <div className="rounded border border-slate-800 bg-slate-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Type</div>
                    <div className="mt-1 text-slate-200">{selectedEvent.type}</div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Source</div>
                    <div className="mt-1 break-all text-slate-200">{selectedEvent.source}</div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Created</div>
                    <div className="mt-1 text-slate-200">
                      {formatTimestamp(selectedEvent.createdAt)}
                    </div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Status</div>
                    <div className="mt-1 text-slate-200">{selectedEvent.status ?? "N/A"}</div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Channel ID</div>
                    <div className="mt-1 break-all text-slate-200">
                      {selectedEvent.channelId ?? "N/A"}
                    </div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Deliver At
                    </div>
                    <div className="mt-1 text-slate-200">
                      {selectedEvent.deliverAt ? formatTimestamp(selectedEvent.deliverAt) : "N/A"}
                    </div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Payload</div>
                    <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-900 p-2 text-xs text-slate-300">
                      {JSON.stringify(selectedEvent.payload ?? {}, null, 2)}
                    </pre>
                  </div>
                  {selectedEvent.lastError ? (
                    <div className="rounded border border-rose-900/60 bg-rose-950/20 p-3">
                      <div className="text-xs uppercase tracking-wide text-rose-400">
                        Last Error
                      </div>
                      <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-900 p-2 text-xs text-rose-300">
                        {selectedEvent.lastError}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div
            className={`absolute inset-0 z-20 flex justify-end bg-black/35 transition-opacity ${
              crossMemoryDrawerOpen
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0"
            }`}
            onClick={() => setCrossMemoryDrawerOpen(false)}
          >
            <div
              className={`pointer-events-auto flex h-full w-full max-w-3xl flex-col border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-300 ${
                crossMemoryDrawerOpen ? "translate-x-0" : "translate-x-full"
              }`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-100">Cross-Channel Memory</h4>
                  <p className="text-xs text-slate-500">
                    {selectedAgent ? selectedAgent.name : "No agent selected"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    disabled={!selectedAgent || crossMemoryLoading}
                    onClick={() => {
                      if (!selectedAgent) return;
                      void refreshCrossMemory(selectedAgent.name);
                    }}
                  >
                    Refresh
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() => setCrossMemoryDrawerOpen(false)}
                  >
                    Close
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4">
                {crossMemoryLoading ? (
                  <div className="text-sm text-slate-500">Loading cross-channel memory...</div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded border border-slate-800 bg-slate-900 p-3">
                      <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Recent</div>
                      <div className="whitespace-pre-wrap text-sm text-slate-200">
                        {crossMemory?.recent?.trim() || "No recent cross-channel memory yet."}
                      </div>
                      <div className="mt-2 text-[11px] text-slate-500">
                        Updated: {formatTimestamp(crossMemory?.updatedAtRecent)}
                      </div>
                    </div>
                    <div className="rounded border border-slate-800 bg-slate-900 p-3">
                      <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Full</div>
                      <div className="whitespace-pre-wrap text-sm text-slate-200">
                        {crossMemory?.full?.trim() || "No full cross-channel memory yet."}
                      </div>
                      <div className="mt-2 text-[11px] text-slate-500">
                        Updated: {formatTimestamp(crossMemory?.updatedAtFull)}
                      </div>
                    </div>
                  </div>
                )}
                {crossMemoryError ? (
                  <div className="rounded border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
                    {crossMemoryError}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div
            className={`absolute inset-0 z-30 flex justify-end bg-black/35 transition-opacity ${
              systemPromptDrawerOpen
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0"
            }`}
            onClick={() => setSystemPromptDrawerOpen(false)}
          >
            <div
              className={`pointer-events-auto flex h-full w-full max-w-3xl flex-col border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-300 ${
                systemPromptDrawerOpen ? "translate-x-0" : "translate-x-full"
              }`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-100">System Prompt</h4>
                  <p className="text-xs text-slate-500">
                    {selectedAgent ? selectedAgent.name : "New agent"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    disabled={!selectedAgent || systemPromptLoading}
                    onClick={() => {
                      if (!selectedAgent) return;
                      systemPromptCacheRef.current.delete(selectedAgent.name);
                      void openSystemPromptDrawer();
                    }}
                  >
                    Refresh
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() => setSystemPromptDrawerOpen(false)}
                  >
                    Close
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-auto px-4 py-4">
                <div className="text-xs text-slate-500">
                  Read-only prompt captured from the runner during the latest turn.
                </div>
                {systemPromptMeta && (
                  <div className="rounded border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-400">
                    Captured: {formatTimestamp(systemPromptMeta.createdAt)} | Model:{" "}
                    {systemPromptMeta.modelId ?? "unknown"} | Channel:{" "}
                    {systemPromptMeta.channelId ?? "unknown"}
                  </div>
                )}
                {systemPromptLoading ? (
                  <div className="text-sm text-slate-500">Loading composed prompt...</div>
                ) : (
                  <Textarea
                    rows={18}
                    value={systemPromptText}
                    readOnly
                    placeholder="No composed prompt found yet for this agent."
                  />
                )}
                {systemPromptError ? (
                  <div className="rounded border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
                    {systemPromptError}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <aside
        className={`fixed bottom-0 left-0 top-0 z-[60] w-full max-w-3xl border-r border-slate-700 bg-slate-950 shadow-2xl transition-transform duration-300 ${
          openFile ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!openFile}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">{openFile?.name}</h3>
              <p className="text-xs text-slate-500">{openFile?.path}</p>
            </div>
            <Button
              variant="secondary"
              className="px-2 py-1 text-xs"
              onClick={() => setOpenFile(null)}
            >
              Back
            </Button>
          </div>
          <div className="border-b border-slate-800 px-4 py-2 text-xs text-slate-500">
            {openFile ? `${openFile.size} bytes | ${formatTimestamp(openFile.modifiedAt)}` : ""}
          </div>
          <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs text-slate-200">
            {openFile?.content}
          </pre>
        </div>
      </aside>
    </div>
  );
}
