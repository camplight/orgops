import type { RunRepositoryPort } from "./run-repository-port";
import type { NwaveRun, NwaveRunWave } from "./types";

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type HttpRunRepositoryDependencies = {
  apiFetch: ApiFetch;
};

async function postJson(apiFetch: ApiFetch, path: string, payload: unknown): Promise<Response> {
  return apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function parseJsonOrThrow<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${context} failed with status ${response.status}: ${body}`);
  }
  return (await response.json()) as T;
}

/**
 * Adapter implementing RunRepositoryPort against `/api/nwave-runs*` (per brief.md
 * "Architecture Style"), the only module in this track permitted to call apiFetch directly
 * (dependency-cruiser rule "no-nwave-invocation-pure-logic-io").
 */
export function createHttpRunRepository(deps: HttpRunRepositoryDependencies): RunRepositoryPort {
  const { apiFetch } = deps;

  return {
    createRun: async (input) => {
      const response = await postJson(apiFetch, "/api/nwave-runs", input);
      return parseJsonOrThrow<NwaveRun>(response, "createRun");
    },

    confirmRun: async (input) => {
      const response = await postJson(apiFetch, `/api/nwave-runs/${input.runId}/confirm`, {});
      return parseJsonOrThrow<NwaveRun>(response, "confirmRun");
    },

    recordWaveStarted: async (input) => {
      const response = await postJson(apiFetch, `/api/nwave-runs/${input.runId}/waves`, {
        waveName: input.waveName,
        sequence: input.sequence,
        processId: input.processId,
      });
      return parseJsonOrThrow<NwaveRunWave>(response, "recordWaveStarted");
    },

    recordWaveCompleted: async (input) => {
      const response = await postJson(
        apiFetch,
        `/api/nwave-runs/${input.runId}/waves/${input.waveId}/complete`,
        { exitCode: input.exitCode },
      );
      return parseJsonOrThrow<NwaveRunWave>(response, "recordWaveCompleted");
    },

    recordWaveFailed: async (input) => {
      const response = await postJson(
        apiFetch,
        `/api/nwave-runs/${input.runId}/waves/${input.waveId}/complete`,
        { exitCode: input.exitCode, failureReason: input.failureReason },
      );
      return parseJsonOrThrow<NwaveRunWave>(response, "recordWaveFailed");
    },

    haltRun: async (input) => {
      const response = await postJson(apiFetch, `/api/nwave-runs/${input.runId}/halt`, {
        reason: input.reason,
      });
      return parseJsonOrThrow<NwaveRun>(response, "haltRun");
    },

    getRun: async (input) => {
      const response = await apiFetch(`/api/nwave-runs/${input.runId}`);
      if (response.status === 404) return null;
      return parseJsonOrThrow<NwaveRun & { waves: NwaveRunWave[] }>(response, "getRun");
    },
  };
}
