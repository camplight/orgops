import type { NwaveRun, NwaveRunWave, WaveName } from "./types";

export const __SCAFFOLD__ = true;

/**
 * Port (per brief.md "Architecture Style"): the seven operations named in the Wave Runner /
 * Wave Progress Translator / Run Watchdog component descriptions. Pure orchestration/
 * translation/watchdog logic depends on this interface only — it never calls fetch/apiFetch
 * directly (dependency-cruiser rule "no-nwave-invocation-pure-logic-io" enforces this for
 * wave-progress-translator.ts/run-watchdog.ts/wave-runner.ts at the repo's
 * .dependency-cruiser.cjs). Only HttpRunRepository (http-run-repository.ts) may perform the
 * real HTTP calls.
 */
export interface RunRepositoryPort {
  createRun(input: {
    ticketRef: string;
    channelId: string;
    restatementText: string;
  }): Promise<NwaveRun>;

  confirmRun(input: { runId: string }): Promise<NwaveRun>;

  recordWaveStarted(input: {
    runId: string;
    waveName: WaveName;
    sequence: number;
    processId: string;
  }): Promise<NwaveRunWave>;

  recordWaveCompleted(input: {
    runId: string;
    waveId: string;
    exitCode: number;
  }): Promise<NwaveRunWave>;

  recordWaveFailed(input: {
    runId: string;
    waveId: string;
    exitCode: number | null;
    failureReason: string;
  }): Promise<NwaveRunWave>;

  haltRun(input: { runId: string; reason: string }): Promise<NwaveRun>;

  getRun(input: { runId: string }): Promise<
    (NwaveRun & { waves: NwaveRunWave[] }) | null
  >;
}
