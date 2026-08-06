import { deriveRunActivity } from "@orgops/schemas";

export const __SCAFFOLD__ = true;

// Referenced (not yet invoked in the throwing scaffold body below) to satisfy ADR-0012's
// dependency-cruiser rule: this module must import the shared Run Activity Deriver rather than
// reimplementing staleness computation locally. DELIVER wave wires the real call.
void deriveRunActivity;

export type RunningRunSnapshot = {
  runId: string;
  lastOutputAt: number;
  currentWaveStatus: string;
  waveSequence: number;
  alreadyFlagged: boolean;
};

export type StuckRunScanAction = "FLAG" | "CLEAR" | "NONE";

export type StuckRunScanResult = {
  runId: string;
  action: StuckRunScanAction;
};

export type StuckRunDetectorDependencies = {
  listRunningRuns: () => Promise<RunningRunSnapshot[]>;
  staleThresholdMsForRun: (run: RunningRunSnapshot) => number;
};

/**
 * The exported driving-port function for US-13's interval-scheduled stuck-run scan — acceptance
 * tests call this directly (mirrors maintenance-loop.ts's testable-unit shape).
 *
 * Real implementation must call the shared Run Activity Deriver (packages/schemas/src/
 * run-activity.ts) with { lastOutputAt, currentWaveStatus, nowMs, staleThresholdMs } — the
 * identical pure function progress-trust-ux's ActivityIndicator already calls, never a second
 * "stuck" definition (ADR-0012). Posts a flag once per stale episode (via
 * nwave_run_stuck_flags), auto-clears when activity resumes.
 */
export function scanRunForStaleness(
  run: RunningRunSnapshot,
  nowMs: number,
  staleThresholdMs: number,
): StuckRunScanResult {
  throw new Error(
    `scanRunForStaleness not implemented for run "${run.runId}" (nowMs=${nowMs}, ` +
      `staleThresholdMs=${staleThresholdMs}) — must call the shared Run Activity Deriver, post ` +
      "a stuck flag once per stale episode, and auto-clear when activity resumes (US-13 AC4).",
  );
}

export function createStuckRunDetector(deps: StuckRunDetectorDependencies) {
  let scanInFlight: Promise<void> | null = null;

  async function runScanPass(): Promise<void> {
    const runs = await deps.listRunningRuns();
    for (const run of runs) {
      try {
        scanRunForStaleness(run, Date.now(), deps.staleThresholdMsForRun(run));
      } catch (error) {
        console.warn(`stuck-run scan failed for run ${run.runId}`, error);
      }
    }
  }

  function schedule(): void {
    if (scanInFlight) return;
    scanInFlight = runScanPass().finally(() => {
      scanInFlight = null;
    });
  }

  async function awaitInFlight(): Promise<void> {
    if (scanInFlight) await scanInFlight;
  }

  return { schedule, awaitInFlight, runScanPass };
}
