/**
 * Shared wave-ordering knowledge for the nWave ticket-execution lifecycle (DISCUSS -> DESIGN ->
 * DISTILL -> DELIVER). Both the API container (apps/api/src/routes/nwave-runs.ts, computing the
 * next wave when persisting a completed wave's DB transition) and the Agent Runner container
 * (apps/agent-runner/src/nwave-invocation/wave-runner.ts, computing the next wave to spawn) need
 * this exact sequence. Both containers already depend on @orgops/schemas (see e.g.
 * apps/api/src/routes/events.ts's EventShapeDefinition import), so sharing this small pure fact
 * here — mirroring the precedent already set by packages/schemas/src/run-activity.ts (ADR-0012) —
 * gives the wave sequence exactly one source of truth instead of two hand-kept copies that must
 * be changed in lockstep whenever the wave chain changes.
 */
export type WaveName = "DISCUSS" | "DESIGN" | "DISTILL" | "DELIVER";

export const WAVE_SEQUENCE: readonly WaveName[] = ["DISCUSS", "DESIGN", "DISTILL", "DELIVER"];

export function nextWaveAfter(waveName: WaveName): WaveName | null {
  return WAVE_SEQUENCE[WAVE_SEQUENCE.indexOf(waveName) + 1] ?? null;
}
