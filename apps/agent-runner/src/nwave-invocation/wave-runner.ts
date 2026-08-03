import type { RunRepositoryPort } from "./run-repository-port";
import { WAVE_SEQUENCE } from "./types";
import type { NwaveRun, NwaveRunWave, WaveName } from "./types";

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

const FIRST_WAVE_NAME: WaveName = WAVE_SEQUENCE[0];
const FIRST_WAVE_SEQUENCE = 1;

function waveSequenceNumber(waveName: WaveName): number {
  return WAVE_SEQUENCE.indexOf(waveName) + 1;
}

function nextWaveAfter(waveName: WaveName): WaveName | null {
  return WAVE_SEQUENCE[WAVE_SEQUENCE.indexOf(waveName) + 1] ?? null;
}

async function startWaveProcess(
  input: { ticketRef: string; waveName: WaveName },
  deps: WaveRunnerDependencies,
): Promise<{ processId: string }> {
  const cmd = deps.buildWaveCommand(input);
  return deps.shellStart({ cmd, cwd: process.cwd() });
}

function describeSpawnFailure(waveName: WaveName, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Could not start ${waveName}: the execution environment is unavailable (${message})`;
}

/**
 * On confirmation: calls `RunRepositoryPort.createRun` (assigning the stable `run_id`
 * immediately, before the first wave process is spawned, so a start-failure notice can still
 * reference it — US-04 AC4/AC5 together), then invokes `shellStart` with the headless nWave CLI
 * command for the first wave (DISCUSS, per ADR-0002). On a `shellStart` spawn failure, the run
 * is still sitting in `STARTING` (confirmed, but no wave has ever been recorded) — the run is
 * marked `START_FAILED` via `RunRepositoryPort.haltRun` (the only generic terminate-with-reason
 * operation the port exposes; the `/halt` route recognizes a `STARTING` run with no wave ever
 * started as "never got underway" and marks it `START_FAILED` rather than `HALTED`). Because
 * `recordWaveStarted` is never called on this path, no wave row is ever created and no
 * wave-progress event is ever emitted (US-04 AC5) — Maria is told clearly the run could not
 * start, never shown false progress.
 */
export async function triggerRunForConfirmedIntent(
  input: {
    ticketRef: string;
    channelId: string;
    confirmedRestatementText: string;
  },
  deps: WaveRunnerDependencies,
): Promise<NwaveRun> {
  const created = await deps.runRepository.createRun({
    ticketRef: input.ticketRef,
    channelId: input.channelId,
    restatementText: input.confirmedRestatementText,
  });

  const confirmed = await deps.runRepository.confirmRun({ runId: created.id });

  let startedProcessId: string;
  try {
    ({ processId: startedProcessId } = await startWaveProcess(
      { ticketRef: input.ticketRef, waveName: FIRST_WAVE_NAME },
      deps,
    ));
  } catch (error) {
    return deps.runRepository.haltRun({
      runId: confirmed.id,
      reason: describeSpawnFailure(FIRST_WAVE_NAME, error),
    });
  }

  await deps.runRepository.recordWaveStarted({
    runId: confirmed.id,
    waveName: FIRST_WAVE_NAME,
    sequence: FIRST_WAVE_SEQUENCE,
    processId: startedProcessId,
  });

  return confirmed;
}

function findRunningWave(
  waves: NwaveRunWave[],
  waveName: WaveName,
): NwaveRunWave | undefined {
  return waves.find((wave) => wave.waveName === waveName && wave.status === "RUNNING");
}

/**
 * On a wave process's clean exit (exitCode 0), records the completed wave via
 * `RunRepositoryPort.recordWaveCompleted` (this also advances the run to the next wave, or
 * marks it COMPLETED if this was DELIVER — see the `/complete` route's own bookkeeping), then
 * advances to the next wave in `WAVE_SEQUENCE` per ADR-0002, spawning its process via
 * `shellStart`. On DELIVER's clean exit, there is no next wave, so no further wave is started
 * (returns null) and the run has already been marked COMPLETED by `recordWaveCompleted`. On a
 * non-zero exit, records the wave/run as FAILED via `recordWaveFailed` and the chain stops —
 * no next wave is started (returns null), never silently proceeding (US-04 AC5). If the named
 * wave cannot be found in a RUNNING state for this run (e.g. a stale/duplicate notification for
 * a run that has already moved on), nothing is recorded and null is returned.
 */
export async function advanceToNextWave(
  input: { runId: string; completedWaveName: WaveName; exitCode: number },
  deps: WaveRunnerDependencies,
): Promise<NwaveRunWave | null> {
  const run = await deps.runRepository.getRun({ runId: input.runId });
  if (!run) {
    return null;
  }

  const completedWave = findRunningWave(run.waves, input.completedWaveName);
  if (!completedWave) {
    return null;
  }

  if (input.exitCode !== 0) {
    await deps.runRepository.recordWaveFailed({
      runId: input.runId,
      waveId: completedWave.id,
      exitCode: input.exitCode,
      failureReason: `${input.completedWaveName} exited with code ${input.exitCode}`,
    });
    return null;
  }

  await deps.runRepository.recordWaveCompleted({
    runId: input.runId,
    waveId: completedWave.id,
    exitCode: input.exitCode,
  });

  const nextWaveName = nextWaveAfter(input.completedWaveName);
  if (nextWaveName === null) {
    return null;
  }

  const { processId } = await startWaveProcess(
    { ticketRef: run.ticketRef, waveName: nextWaveName },
    deps,
  );

  return deps.runRepository.recordWaveStarted({
    runId: input.runId,
    waveName: nextWaveName,
    sequence: waveSequenceNumber(nextWaveName),
    processId,
  });
}
