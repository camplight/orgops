import type { SkillInventoryItem, SkillRef } from "@orgops/schemas";
import type { InventoryFiltersInput, Result, UnifiedSkillApi, UnifiedSkillError } from "./api";

export type SkillSelectionRef = { kind: "LOCAL"; name: string; localOrigin: "BUILT_IN" | "WORKSPACE" } | { kind: "CATALOG"; packageReleaseId: string };
export type SkillSelection = { skill: SkillSelectionRef | null; agentId: string | null };
export type UnifiedSkillState = {
  busy: boolean;
  filters: { query: string; origin: "ALL" | "LOCAL" | "CATALOG"; availability: "ALL" | "INSTALLED" | "AVAILABLE" };
  items: SkillInventoryItem[];
  lastGoodItems: SkillInventoryItem[];
  selectedItem: SkillInventoryItem | null;
  selection: SkillSelection;
  agentRevision: number | null;
  error: UnifiedSkillError | null;
  status: string;
};
export type UnifiedSkillControllerDeps = { api: Pick<UnifiedSkillApi, "list" | "listForAgent"> };
export type UnifiedSkillActions = ReturnType<typeof createUnifiedSkillController>;
const initialFilters = { query: "", origin: "ALL" as const, availability: "ALL" as const };
const fixedError = (error: UnifiedSkillError): UnifiedSkillError => ({ code: error.code, message: error.message });
function windowObject(): Window | null { return typeof window === "undefined" ? null : window; }
function refFromUrl(url: URL): SkillSelectionRef | null {
  const kind = url.searchParams.get("skillKind");
  if (kind === "LOCAL") {
    const name = url.searchParams.get("name"); const localOrigin = url.searchParams.get("localOrigin");
    return name && (localOrigin === "BUILT_IN" || localOrigin === "WORKSPACE") ? { kind: "LOCAL", name, localOrigin } : null;
  }
  if (kind === "CATALOG") {
    const packageReleaseId = url.searchParams.get("packageReleaseId");
    return packageReleaseId ? { kind: "CATALOG", packageReleaseId } : null;
  }
  return null;
}
export function readSelectionFromUrl(): SkillSelection {
  const current = windowObject();
  if (!current) return { skill: null, agentId: null };
  const url = new URL(current.location.href);
  const skill = refFromUrl(url);
  const agentId = url.searchParams.get("agentId");
  return { skill, agentId: agentId && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(agentId) ? agentId : null };
}
function sameRef(left: SkillRef | SkillSelectionRef | null, right: SkillRef | SkillSelectionRef | null): boolean {
  if (!left || !right || left.kind !== right.kind) return left === right;
  if (left.kind === "LOCAL" && right.kind === "LOCAL") return left.name === right.name && left.localOrigin === right.localOrigin;
  return left.kind === "CATALOG" && right.kind === "CATALOG" && left.packageReleaseId === right.packageReleaseId;
}
function itemRef(item: SkillInventoryItem): SkillRef { return item.ref; }
function isTransient(error: UnifiedSkillError) { return error.code === "NETWORK" || error.code === "STORAGE_FAILURE"; }

export function createUnifiedSkillController(deps: UnifiedSkillControllerDeps) {
  let state: UnifiedSkillState = { busy: false, filters: initialFilters, items: [], lastGoodItems: [], selectedItem: null, selection: readSelectionFromUrl(), agentRevision: null, error: null, status: "" };
  let principalKey: string | null = null;
  let abortController = new AbortController();
  let requestGeneration = 0;
  const listeners = new Set<() => void>();
  const popStateListener = () => syncFromUrl();
  const publish = (patch: Partial<UnifiedSkillState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const selectedItem = (items: SkillInventoryItem[], selection = state.selection) => items.find(item => sameRef(itemRef(item), selection.skill)) ?? null;
  const operation = () => { abortController.abort(); abortController = new AbortController(); requestGeneration += 1; return { signal: abortController.signal, generation: requestGeneration }; };
  async function load(filters: InventoryFiltersInput) {
    publish({ busy: true, filters: { ...state.filters, ...filters }, error: null });
    const operationState = operation();
    const selectionAtStart = state.selection;
    const result: Result<{ items: SkillInventoryItem[]; agentRevision?: number }> = selectionAtStart.agentId
      ? await deps.api.listForAgent(selectionAtStart.agentId, filters, operationState.signal)
      : await deps.api.list(filters, operationState.signal);
    if (operationState.signal.aborted || operationState.generation !== requestGeneration) return state;
    if (result.ok) {
      const nextSelection = state.selection.skill && result.value.items.some(item => sameRef(item.ref, state.selection.skill)) ? state.selection : { ...state.selection, skill: null };
      publish({ busy: false, items: result.value.items, lastGoodItems: result.value.items, agentRevision: result.value.agentRevision ?? null, selection: nextSelection, selectedItem: result.value.items.find(item => sameRef(item.ref, nextSelection.skill)) ?? null, error: null, status: `${result.value.items.length} skills loaded.` });
    } else if (result.error.code === "FORBIDDEN" || result.error.code === "NOT_FOUND") {
      publish({ busy: false, items: [], lastGoodItems: [], selectedItem: null, selection: { skill: null, agentId: null }, agentRevision: null, error: fixedError(result.error), status: result.error.message });
      clearUrlSelection();
    } else {
      publish({ busy: false, items: isTransient(result.error) ? state.lastGoodItems : [], selectedItem: isTransient(result.error) ? selectedItem(state.lastGoodItems) : null, error: fixedError(result.error), status: result.error.message });
    }
    return state;
  }
  function setFilters(filters: Partial<UnifiedSkillState["filters"]>) { publish({ filters: { ...state.filters, ...filters } }); }
  function setPrincipal(next: string) {
    if (principalKey === next) return;
    const hadPrincipal = principalKey !== null;
    principalKey = next;
    abortController.abort(); requestGeneration += 1; abortController = new AbortController();
    if (hadPrincipal) { clearUrlSelection(); publish({ items: [], lastGoodItems: [], selectedItem: null, selection: { skill: null, agentId: null }, agentRevision: null, error: null, status: "" }); }
  }
  function select(ref: SkillRef) {
    const current = windowObject(); if (!current) return;
    const url = new URL(current.location.href); url.searchParams.set("screen", "skills"); url.searchParams.set("skillKind", ref.kind);
    if (ref.kind === "LOCAL") { url.searchParams.set("name", ref.name); url.searchParams.set("localOrigin", ref.localOrigin); url.searchParams.delete("packageReleaseId"); }
    else { url.searchParams.set("packageReleaseId", ref.packageReleaseId); url.searchParams.delete("name"); url.searchParams.delete("localOrigin"); }
    current.history.pushState({}, "", url); const selection = readSelectionFromUrl(); publish({ selection, selectedItem: selectedItem(state.items, selection) });
  }
  async function setAgentId(agentId: string | null) {
    const current = windowObject(); if (!current) return state;
    const url = new URL(current.location.href); if (agentId) url.searchParams.set("agentId", agentId); else url.searchParams.delete("agentId"); current.history.pushState({}, "", url);
    const selection = readSelectionFromUrl(); abortController.abort(); requestGeneration += 1; publish({ selection, selectedItem: null, agentRevision: null });
    return load(state.filters);
  }
  function clearUrlSelection() {
    const current = windowObject(); if (!current) return; const url = new URL(current.location.href);
    for (const key of ["skillKind", "name", "localOrigin", "packageReleaseId", "agentId"]) url.searchParams.delete(key);
    current.history.replaceState({}, "", url);
  }
  function syncFromUrl() {
    const selection = readSelectionFromUrl();
    const agentChanged = selection.agentId !== state.selection.agentId;
    if (agentChanged) {
      abortController.abort(); requestGeneration += 1;
      publish({ selection, selectedItem: null, agentRevision: null });
      void load(state.filters);
      return;
    }
    publish({ selection, selectedItem: selectedItem(state.items, selection) });
  }
  function applyUnauthorizedSelection() { clearUrlSelection(); publish({ selection: { skill: null, agentId: null }, selectedItem: null, agentRevision: null }); }
  return {
    snapshot: () => state,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) windowObject()?.addEventListener("popstate", popStateListener);
      return () => { listeners.delete(listener); if (listeners.size === 0) windowObject()?.removeEventListener("popstate", popStateListener); };
    },
    load,
    setFilters,
    setPrincipal,
    select,
    setAgentId,
    applyUnauthorizedSelection,
    cancelPending() { abortController.abort(); requestGeneration += 1; },
    dispose() { abortController.abort(); requestGeneration += 1; listeners.clear(); windowObject()?.removeEventListener("popstate", popStateListener); state = { ...state, busy: false, items: [], lastGoodItems: [], selectedItem: null, selection: readSelectionFromUrl(), agentRevision: null }; },
  };
}
