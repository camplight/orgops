import type { RunRepositoryPort } from "./run-repository-port";

export const __SCAFFOLD__ = true;

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type HttpRunRepositoryDependencies = {
  apiFetch: ApiFetch;
};

function notImplemented(method: string, deps: HttpRunRepositoryDependencies): never {
  throw new Error(
    `HttpRunRepository.${method} not implemented — must call the real HTTP contract ` +
      `(/api/nwave-runs*, per brief.md "Data Model" -> "New API routes") via apiFetch ` +
      `(configured: ${Boolean(deps.apiFetch)}), never fetch directly.`,
  );
}

/**
 * Adapter implementing RunRepositoryPort against `/api/nwave-runs*` (per brief.md
 * "Architecture Style"). RED scaffold only — every method throws; DELIVER wave implements each
 * one behind its own failing acceptance test, one scenario at a time (Mandate 5).
 */
export function createHttpRunRepository(deps: HttpRunRepositoryDependencies): RunRepositoryPort {
  return {
    createRun: async () => notImplemented("createRun", deps),
    confirmRun: async () => notImplemented("confirmRun", deps),
    recordWaveStarted: async () => notImplemented("recordWaveStarted", deps),
    recordWaveCompleted: async () => notImplemented("recordWaveCompleted", deps),
    recordWaveFailed: async () => notImplemented("recordWaveFailed", deps),
    haltRun: async () => notImplemented("haltRun", deps),
    getRun: async () => notImplemented("getRun", deps),
  };
}
