import type { NwaveRunWave, WaveName } from "./types";

export type ProcessLifecycleEvent = {
  type: "process.started" | "process.output" | "process.exited";
  processId: string;
  exitCode?: number | null;
  createdAt?: number;
};

export type WaveProgressDomainEvent =
  | { type: "nwave.run.wave_started"; runId: string; waveName: WaveName }
  | { type: "nwave.run.wave_completed"; runId: string; waveName: WaveName }
  | { type: "nwave.run.wave_failed"; runId: string; waveName: WaveName; exitCode: number | null };

function findWaveByProcessId(waves: NwaveRunWave[], processId: string): NwaveRunWave | undefined {
  return waves.find((wave) => wave.processId === processId);
}

function toWaveStartedEvent(wave: NwaveRunWave): WaveProgressDomainEvent {
  return { type: "nwave.run.wave_started", runId: wave.runId, waveName: wave.waveName };
}

function toWaveCompletedEvent(wave: NwaveRunWave): WaveProgressDomainEvent {
  return { type: "nwave.run.wave_completed", runId: wave.runId, waveName: wave.waveName };
}

function toWaveFailedEvent(wave: NwaveRunWave, exitCode: number | null): WaveProgressDomainEvent {
  return { type: "nwave.run.wave_failed", runId: wave.runId, waveName: wave.waveName, exitCode };
}

function sortByCreatedAt(events: ProcessLifecycleEvent[]): ProcessLifecycleEvent[] {
  return [...events].sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
}

function deriveEventForLifecycleEvent(
  event: ProcessLifecycleEvent,
  waves: NwaveRunWave[],
): WaveProgressDomainEvent | null {
  const wave = findWaveByProcessId(waves, event.processId);
  if (!wave) return null;
  if (event.type === "process.started") return toWaveStartedEvent(wave);
  if (event.type === "process.exited") {
    const exitCode = event.exitCode ?? null;
    return exitCode === 0 ? toWaveCompletedEvent(wave) : toWaveFailedEvent(wave, exitCode);
  }
  return null;
}

/**
 * Pure-function core (per brief.md "Component Architecture" item 4), mirroring
 * intent-watchdog.ts's `ingestIntentEvents` pattern exactly: takes the event batch and current
 * run/wave state as explicit parameters, returns derived transitions — no direct event-bus
 * subscription. Ingests `process.started`/`process.output`/`process.exited` events for the
 * `processId`s belonging to a run's waves and derives
 * `nwave.run.wave_started`/`wave_completed`/`wave_failed` domain events — US-04's core
 * observable contract (mid-run wave-progress signal). `process.output` never produces a domain
 * event on its own — only `process.started`/`process.exited` are authoritative, so stdout
 * content is never parsed to infer progress.
 */
export function deriveWaveProgressEvents(input: {
  events: ProcessLifecycleEvent[];
  waves: NwaveRunWave[];
}): WaveProgressDomainEvent[] {
  return sortByCreatedAt(input.events)
    .map((event) => deriveEventForLifecycleEvent(event, input.waves))
    .filter((event): event is WaveProgressDomainEvent => event !== null);
}
