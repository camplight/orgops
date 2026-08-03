import type { RunRepositoryPort } from "./run-repository-port";
import type { NwaveRun, NwaveRunWave, WaveName } from "./types";

export const __SCAFFOLD__ = true;

/**
 * Injected capability matching the existing `shell_start` tool primitive's contract
 * (apps/agent-runner/src/tools/shell.ts) — never imported directly as `node:child_process`
 * here (dependency-cruiser rule "no-nwave-invocation-pure-logic-io" forbids it). Chosen
 * mechanism per ADR-0001: the async process primitive, not the WRAPPED command harness.
 */
export type ShellStart = (input: {
  cmd: string;
  cwd: string;
  env?: Record<string, string>;
}) => Promise<{ processId: string }>;

export type BuildWaveCommand = (input: { ticketRef: string; waveName: WaveName }) => string;

export type WaveRunnerDependencies = {
  runRepository: RunRepositoryPort;
  shellStart: ShellStart;
  buildWaveCommand: BuildWaveCommand;
};

/**
 * On confirmation: calls `RunRepositoryPort.createRun` (assigning the stable `run_id`
 * immediately, before the first wave process is spawned, so a start-failure notice can still
 * reference it — US-04 AC4/AC5 together), then invokes `shellStart` with the headless nWave CLI
 * command for the first wave (DISCUSS, per ADR-0002). On a `shellStart` spawn failure, must mark
 * the run `START_FAILED` via `RunRepositoryPort` and never emit any wave-progress event — the
 * single worst outcome this design must prevent (brief.md "Failure/Timeout Handling", top
 * quality-attribute priority).
 */
export async function triggerRunForConfirmedIntent(
  input: {
    ticketRef: string;
    channelId: string;
    confirmedRestatementText: string;
  },
  deps: WaveRunnerDependencies,
): Promise<NwaveRun> {
  throw new Error(
    `triggerRunForConfirmedIntent not implemented for ${input.ticketRef} — must call ` +
      `runRepository.createRun then confirmRun (assigning the stable run_id before spawning ` +
      `the first wave process), then shellStart the headless nWave CLI command for DISCUSS. ` +
      `On shellStart failure, must mark the run START_FAILED and never emit any wave-progress ` +
      `event (US-04 AC5).`,
  );
}

/**
 * On a wave process's clean exit (exitCode 0), advances to the next wave in
 * `WAVE_SEQUENCE` per ADR-0002, spawning its process via `shellStart`. On DELIVER's clean exit,
 * marks the run `COMPLETED` and returns null (no next wave). On a non-zero exit, marks the
 * wave/run `FAILED` and stops the chain — never silently proceeds (US-04 AC5).
 */
export async function advanceToNextWave(
  input: { runId: string; completedWaveName: WaveName; exitCode: number },
  deps: WaveRunnerDependencies,
): Promise<NwaveRunWave | null> {
  throw new Error(
    `advanceToNextWave not implemented for run ${input.runId} (completed wave ` +
      `${input.completedWaveName}, exitCode ${input.exitCode}) — must chain to the next wave ` +
      `on a clean exit, mark the run COMPLETED after DELIVER's clean exit, or mark the ` +
      `wave/run FAILED and stop the chain on a non-zero exit (US-04 AC5, ADR-0002).`,
  );
}
