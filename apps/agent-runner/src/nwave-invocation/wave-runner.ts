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

/**
 * On confirmation: calls `RunRepositoryPort.createRun` (assigning the stable `run_id`
 * immediately, before the first wave process is spawned, so a start-failure notice can still
 * reference it — US-04 AC4/AC5 together), then invokes `shellStart` with the headless nWave CLI
 * command for the first wave (DISCUSS, per ADR-0002). On a `shellStart` spawn failure, must mark
 * the run `START_FAILED` via `RunRepositoryPort` and never emit any wave-progress event (US-04
 * AC5) — that failure path is covered by a subsequent step's own failing acceptance scenario.
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

  const { processId } = await startWaveProcess(
    { ticketRef: input.ticketRef, waveName: FIRST_WAVE_NAME },
    deps,
  );

  await deps.runRepository.recordWaveStarted({
    runId: confirmed.id,
    waveName: FIRST_WAVE_NAME,
    sequence: FIRST_WAVE_SEQUENCE,
    processId,
  });

  return confirmed;
}

/**
 * On a wave process's clean exit (exitCode 0), advances to the next wave in
 * `WAVE_SEQUENCE` per ADR-0002, spawning its process via `shellStart`. On DELIVER's clean exit,
 * there is no next wave, so no further wave is started (returns null). On a non-zero exit, the
 * chain stops and no next wave is started (returns null) — never silently proceeds (US-04 AC5).
 */
export async function advanceToNextWave(
  input: { runId: string; completedWaveName: WaveName; exitCode: number },
  deps: WaveRunnerDependencies,
): Promise<NwaveRunWave | null> {
  if (input.exitCode !== 0) {
    return null;
  }

  const nextWaveName = nextWaveAfter(input.completedWaveName);
  if (nextWaveName === null) {
    return null;
  }

  const run = await deps.runRepository.getRun({ runId: input.runId });
  if (!run) {
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
