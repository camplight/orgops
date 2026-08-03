import type { WaveName, WaveStatus } from "./types";

export type WatchedWave = {
  runId: string;
  waveId: string;
  waveName: WaveName;
  status: WaveStatus;
  lastOutputAt: number | null;
};

export type StaleWaveFlag = {
  runId: string;
  waveId: string;
  waveName: WaveName;
};

function isWaveStale(wave: WatchedWave, nowMs: number, idleTimeoutMs: number): boolean {
  if (wave.status !== "RUNNING") return false;
  if (wave.lastOutputAt === null) return false;
  return nowMs - wave.lastOutputAt > idleTimeoutMs;
}

function toStaleWaveFlag(wave: WatchedWave): StaleWaveFlag {
  return { runId: wave.runId, waveId: wave.waveId, waveName: wave.waveName };
}

/**
 * Pure-function core (per brief.md "Component Architecture" item 5), directly modeled on
 * intent-watchdog.ts's `ingestIntentEvents`/`collectDueIntentTimeouts` pair. Tracks per-wave
 * idle timeouts using the same `last_output_at`-style staleness signal already computed by
 * `GET /api/processes` (`output_count`/`last_output_at` aggregation in
 * apps/api/src/routes/runtime.ts). Returns the waves whose process has produced no output for
 * longer than `idleTimeoutMs` — the caller (Run Watchdog's imperative shell) is responsible for
 * calling `shell_stop` and `RunRepositoryPort.haltRun` for each flagged wave, and for emitting
 * the "no progress detected" channel message referencing the stable `run_id` (never leaving a
 * stalled run looking active).
 */
export function collectStaleWaves(input: {
  waves: WatchedWave[];
  nowMs: number;
  idleTimeoutMs: number;
}): StaleWaveFlag[] {
  return input.waves
    .filter((wave) => isWaveStale(wave, input.nowMs, input.idleTimeoutMs))
    .map(toStaleWaveFlag);
}
