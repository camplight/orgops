import { apiUrl } from "../config";
import {
  AgentSkillInventorySchema,
  InventoryFiltersSchema,
  SkillInventoryItemSchema,
  SkillCommandSchema,
  SkillDeploymentEventSchema,
  SkillPreflightResultSchema,
  type AgentSkillInventory,
  type InventoryFilters,
  type SkillCommand,
  type SkillHistoryQuery,
  type SkillInventoryItem,
  type SkillPreflightResult,
} from "@orgops/schemas";

export type InventoryFiltersInput = Partial<InventoryFilters>;
export type InventoryErrorCode = "INVALID_REQUEST" | "PAYLOAD_TOO_LARGE" | "FORBIDDEN" | "NOT_FOUND" | "REVISION_CONFLICT" | "STATE_CONFLICT" | "GRANT_REQUIRED" | "INSTALLATION_REQUIRED" | "REQUIREMENTS_UNSATISFIED" | "SOURCE_UNAVAILABLE" | "DEPLOYMENT_SUPERSEDED" | "STORAGE_FAILURE" | "NETWORK" | "PROTOCOL";
export type UnifiedSkillError = { code: InventoryErrorCode; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; error: UnifiedSkillError };
export type SkillDeploymentEvent = {
  eventId: string;
  operation: "ADD" | "ASSIGN" | "ENABLE" | "DISABLE" | "REMOVE" | "SET_PRELOAD";
  state: "REQUESTED" | "DEPLOYING" | "STABLE" | "FAILED" | "SUPERSEDED";
  desiredGeneration: string;
  effectiveGeneration: string | null;
  failureCode: "DEPLOYMENT_SUPERSEDED" | "INSPECTION_FAILED" | "STORAGE_FAILURE" | null;
  revision: number;
  createdAt: number;
};
export type SkillMutationResult = {
  ref: Record<string, unknown>;
  desired: "ENABLED" | "DISABLED" | "ABSENT";
  effective: "ENABLED" | "DISABLED";
  preload: boolean;
  deployment: "STABLE" | "REQUESTED" | "DEPLOYING" | "FAILED";
  revision: number;
  agentRevision: number;
  deploymentId?: string;
};
export type UnifiedSkillApi = {
  list(filters: InventoryFiltersInput, signal?: AbortSignal): Promise<Result<{ items: SkillInventoryItem[] }>>;
  listForAgent(agentId: string, filters: InventoryFiltersInput, signal?: AbortSignal): Promise<Result<{ items: SkillInventoryItem[]; agentRevision: number }>>;
  execute(command: SkillCommand, signal?: AbortSignal): Promise<Result<SkillMutationResult>>;
  history(agentId: string, query: SkillHistoryQuery, signal?: AbortSignal): Promise<Result<SkillDeploymentEvent[]>>;
  preflight(agentId: string, selection: unknown, signal?: AbortSignal): Promise<Result<SkillPreflightResult>>;
};

const messages: Record<InventoryErrorCode, string> = {
  INVALID_REQUEST: "Invalid Skills request.", PAYLOAD_TOO_LARGE: "The Skills request is too large.", FORBIDDEN: "Administrator access is required.", NOT_FOUND: "Skill inventory was not found.", REVISION_CONFLICT: "Skills changed; reload before using this inventory.", STATE_CONFLICT: "This Skills action conflicts with current state.", GRANT_REQUIRED: "A current grant is required.", INSTALLATION_REQUIRED: "Available after installation.", REQUIREMENTS_UNSATISFIED: "Skill requirements are not satisfied.", SOURCE_UNAVAILABLE: "The skill source is unavailable.", DEPLOYMENT_SUPERSEDED: "Skill deployment was superseded.", STORAGE_FAILURE: "Skills storage failed.", NETWORK: "The Skills request could not be confirmed.", PROTOCOL: "The Skills response could not be confirmed.",
};
const serverCodes = new Set(Object.keys(messages));
function record(value: unknown): Record<string, unknown> | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function protocol(): never { throw new Error("protocol"); }
function decodeInventory(body: unknown): { items: SkillInventoryItem[] } {
  const value = record(body);
  if (!value || Object.keys(value).length !== 1 || !Array.isArray(value.items)) return protocol();
  try { return { items: value.items.map(item => SkillInventoryItemSchema.parse(item)) }; } catch { return protocol(); }
}
function decodeAgentInventory(body: unknown): AgentSkillInventory {
  try { return AgentSkillInventorySchema.parse(body); } catch { return protocol(); }
}
function query(filters: InventoryFiltersInput, agentId?: string): string {
  const parsed = InventoryFiltersSchema.parse(filters);
  const params = new URLSearchParams();
  if (agentId) params.set("agentId", agentId);
  params.set("q", parsed.query ?? "");
  params.set("origin", parsed.origin);
  params.set("availability", parsed.availability);
  return `?${params.toString()}`;
}
function decodeMutation(body: unknown): SkillMutationResult {
  const value = record(body);
  if (!value || (value.desired !== "ENABLED" && value.desired !== "DISABLED" && value.desired !== "ABSENT") || (value.effective !== "ENABLED" && value.effective !== "DISABLED") || typeof value.preload !== "boolean" || !["STABLE", "REQUESTED", "DEPLOYING", "FAILED"].includes(String(value.deployment)) || typeof value.revision !== "number" || typeof value.agentRevision !== "number" || !record(value.ref)) return protocol();
  return { ref: value.ref as Record<string, unknown>, desired: value.desired, effective: value.effective, preload: value.preload, deployment: value.deployment as SkillMutationResult["deployment"], revision: value.revision, agentRevision: value.agentRevision, ...(typeof value.deploymentId === "string" ? { deploymentId: value.deploymentId } : {}) };
}
function decodeHistory(body: unknown): SkillDeploymentEvent[] {
  const value = record(body);
  if (!value || !Array.isArray(value.events) || value.events.length > 100) return protocol();
  try { return value.events.map(event => SkillDeploymentEventSchema.parse(event)); } catch { return protocol(); }
}
function errorCode(response: Response, payload: unknown): InventoryErrorCode {
  const candidate = record(payload)?.error;
  if (typeof candidate === "string" && serverCodes.has(candidate)) return candidate as InventoryErrorCode;
  if (response.status === 401 || response.status === 403) return "FORBIDDEN";
  if (response.status === 404) return "NOT_FOUND";
  if (response.status === 413) return "PAYLOAD_TOO_LARGE";
  return "PROTOCOL";
}

export function createUnifiedSkillApi(fetchImpl: typeof fetch = fetch): UnifiedSkillApi {
  async function request<T>(path: string, decode: (body: unknown) => T, signal?: AbortSignal, init?: RequestInit): Promise<Result<T>> {
    try {
      const response = await fetchImpl(apiUrl(path), { method: "GET", credentials: "include", cache: "no-store", signal, ...init });
      const payload = await response.json().catch(() => null);
      if (!response.ok) { const code = errorCode(response, payload); return { ok: false, error: { code, message: messages[code] } }; }
      return { ok: true, value: decode(payload) };
    } catch (error) {
      const code: InventoryErrorCode = error instanceof Error && error.message === "protocol" ? "PROTOCOL" : "NETWORK";
      return { ok: false, error: { code, message: messages[code] } };
    }
  }
  return {
    list: (filters, signal) => request(`/api/skills/inventory${query(filters)}`, decodeInventory, signal),
    listForAgent: (agentId, filters, signal) => request(`/api/skills/inventory${query(filters, agentId)}`, value => { const parsed = decodeAgentInventory(value); return { items: [...parsed.items], agentRevision: parsed.agentRevision }; }, signal),
    execute: (command, signal) => {
      const parsed = SkillCommandSchema.parse(command);
      return request(`/api/agents/${encodeURIComponent(parsed.agentId)}/skills`, decodeMutation, signal, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed) });
    },
    history: (agentId, historyQuery, signal) => request(`/api/agents/${encodeURIComponent(agentId)}/skills/history?${new URLSearchParams(historyQuery as unknown as Record<string, string>).toString()}`, decodeHistory, signal),
    preflight: (agentId, selection, signal) => request(`/api/agents/${encodeURIComponent(agentId)}/skills/preflight`, value => { try { return SkillPreflightResultSchema.parse(value); } catch { return protocol(); } }, signal, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ selection }) }),
  };
}
