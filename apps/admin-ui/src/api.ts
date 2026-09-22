import { apiUrl } from "./config";
import { createUnifiedSkillApi } from "./unified-skills/api";
import {
  AgentProvisioningReceiptSchema,
  AgentStartReadinessSchema,
  ProvisionAgentSchema,
  ProvisioningTemplateOptionsSchema,
  type AgentProvisioningReceipt,
  type AgentStartReadiness,
  type ProvisionAgentHttpInput,
  type ProvisioningTemplateOptions,
} from "@orgops/schemas";

const API_HEADERS = { "content-type": "application/json" };

export type ProvisioningErrorCode =
  | "INVALID_REQUEST"
  | "FORBIDDEN"
  | "GRANT_REQUIRED"
  | "INSTALLATION_REQUIRED"
  | "REQUIREMENTS_UNSATISFIED"
  | "REVISION_CONFLICT"
  | "STORAGE_FAILURE"
  | "NETWORK"
  | "PROTOCOL";

const provisioningMessages: Record<ProvisioningErrorCode, string> = {
  INVALID_REQUEST: "The agent setup could not be confirmed.",
  FORBIDDEN: "You no longer have permission to create agents.",
  GRANT_REQUIRED: "A current catalog grant is required before this template can be used.",
  INSTALLATION_REQUIRED: "This catalog release must be installed before the agent can be created.",
  REQUIREMENTS_UNSATISFIED: "Required bindings are missing; review the setup and try again.",
  REVISION_CONFLICT: "The selected catalog data changed; reload the setup before trying again.",
  STORAGE_FAILURE: "The agent could not be saved. No agent was created.",
  NETWORK: "The agent setup could not be confirmed because the server is unavailable.",
  PROTOCOL: "The server returned an unexpected agent setup response."
};

export class ProvisioningRequestError extends Error {
  readonly code: ProvisioningErrorCode;
  constructor(code: ProvisioningErrorCode) {
    super(provisioningMessages[code]);
    this.name = "ProvisioningRequestError";
    this.code = code;
  }
}

function provisioningCode(value: unknown, response: Response): ProvisioningErrorCode {
  const candidate = typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as { code?: unknown }).code
    : undefined;
  if (typeof candidate === "string" && candidate in provisioningMessages) return candidate as ProvisioningErrorCode;
  if (response.status === 401 || response.status === 403) return "FORBIDDEN";
  if (response.status >= 500) return "STORAGE_FAILURE";
  return "PROTOCOL";
}

async function strictJson<T>(response: Response, schema: { parse(value: unknown): T }): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ProvisioningRequestError(provisioningCode(payload, response));
  try {
    return schema.parse(payload);
  } catch {
    throw new ProvisioningRequestError("PROTOCOL");
  }
}

export async function getProvisioningTemplateOptions(signal?: AbortSignal): Promise<ProvisioningTemplateOptions> {
  try {
    const response = await fetch(apiUrl("/api/agents/template-options"), {
      method: "GET", credentials: "include", cache: "no-store", signal
    });
    return await strictJson(response, ProvisioningTemplateOptionsSchema);
  } catch (error) {
    if (error instanceof ProvisioningRequestError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ProvisioningRequestError("NETWORK");
  }
}

export async function provisionAgent(input: ProvisionAgentHttpInput, signal?: AbortSignal): Promise<AgentProvisioningReceipt> {
  const command = ProvisionAgentSchema.parse(input);
  try {
    const response = await fetch(apiUrl("/api/agents/provision"), {
      method: "POST", credentials: "include", cache: "no-store", headers: API_HEADERS, signal,
      body: JSON.stringify(command)
    });
    return await strictJson(response, AgentProvisioningReceiptSchema);
  } catch (error) {
    if (error instanceof ProvisioningRequestError) throw error;
    throw new ProvisioningRequestError("NETWORK");
  }
}

export const provision = provisionAgent;

export async function getAgentStartReadiness(name: string, signal?: AbortSignal): Promise<AgentStartReadiness> {
  try {
    const response = await fetch(apiUrl(`/api/agents/${encodeURIComponent(name)}/start-readiness`), { method: "GET", credentials: "include", cache: "no-store", signal });
    return await strictJson(response, AgentStartReadinessSchema);
  } catch (error) {
    if (error instanceof ProvisioningRequestError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ProvisioningRequestError("NETWORK");
  }
}

export async function getSkillInventory(signal?: AbortSignal) {
  const result = await createUnifiedSkillApi().list({ query: "", origin: "ALL", availability: "ALL" }, signal);
  if (!result.ok) throw new ProvisioningRequestError(result.error.code === "FORBIDDEN" ? "FORBIDDEN" : result.error.code === "STORAGE_FAILURE" ? "STORAGE_FAILURE" : "PROTOCOL");
  return result.value.items;
}

export async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(apiUrl(path), { credentials: "include", ...init });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res;
}

export async function apiJson<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  return (await res.json()) as T;
}

export function getApiHeaders() {
  return API_HEADERS;
}

export { createUnifiedSkillApi } from "./unified-skills/api";
export type { UnifiedSkillApi } from "./unified-skills/api";
