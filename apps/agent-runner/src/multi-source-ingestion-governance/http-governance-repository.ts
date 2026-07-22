import type { GovernanceRepositoryPort } from "./governance-repository-port";

export const __SCAFFOLD__ = true;

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type HttpGovernanceRepositoryDependencies = {
  apiFetch: ApiFetch;
};

function notImplemented(method: string, deps: HttpGovernanceRepositoryDependencies): never {
  throw new Error(
    `HttpGovernanceRepository.${method} not implemented — must call the real HTTP contract ` +
      `(/api/tickets, /api/trello-ingestion/*, /api/guardrail-allowlist, /api/nwave-runs/*) via ` +
      `apiFetch (configured: ${Boolean(deps.apiFetch)}), never fetch directly.`,
  );
}

/**
 * Adapter implementing GovernanceRepositoryPort against the shared HTTP contract (per brief.md
 * "Architecture Style"). RED scaffold only — every method throws; DELIVER wave implements each
 * one behind its own failing acceptance test.
 */
export function createHttpGovernanceRepository(
  deps: HttpGovernanceRepositoryDependencies,
): GovernanceRepositoryPort {
  return {
    findTicketBySourceRef: async () => notImplemented("findTicketBySourceRef", deps),
    createIngestedTicket: async () => notImplemented("createIngestedTicket", deps),
    recordBoardPollResult: async () => notImplemented("recordBoardPollResult", deps),
    evaluateGuardrail: async () => notImplemented("evaluateGuardrail", deps),
    recordGuardrailHold: async () => notImplemented("recordGuardrailHold", deps),
    recordGovernanceSignoff: async () => notImplemented("recordGovernanceSignoff", deps),
    recordApproval: async () => notImplemented("recordApproval", deps),
    recordChangesRequested: async () => notImplemented("recordChangesRequested", deps),
    createFollowOnRun: async () => notImplemented("createFollowOnRun", deps),
    recordRetryExhausted: async () => notImplemented("recordRetryExhausted", deps),
    recordEscalation: async () => notImplemented("recordEscalation", deps),
    getRunCycleHistory: async () => notImplemented("getRunCycleHistory", deps),
  };
}
