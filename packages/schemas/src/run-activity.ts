export const __SCAFFOLD__ = true;

export type RunActivityInput = {
  lastOutputAt: number;
  currentWaveStatus: string;
  nowMs: number;
  staleThresholdMs: number;
};

export type RunActivityResult = {
  isStale: boolean;
};

/**
 * Prerequisite scaffold owned by the `progress-trust-ux` track (US-05's ActivityIndicator).
 * Not yet delivered anywhere in this codebase. Created here, at the exact path
 * `.dependency-cruiser.cjs` already names, only so `multi-source-ingestion-governance`'s
 * Stuck-Run Detector (US-13, ADR-0012) can import the one shared pure staleness function
 * rather than reimplementing it locally. Real implementation is out of scope for this DISTILL
 * pass and for the multi-source-ingestion-governance track generally.
 */
export function deriveRunActivity(_input: RunActivityInput): RunActivityResult {
  throw new Error(
    "deriveRunActivity not implemented — prerequisite scaffold owned by the progress-trust-ux " +
      "track. Real implementation must compare (nowMs - lastOutputAt) against staleThresholdMs " +
      "for the run's currentWaveStatus and return { isStale }.",
  );
}
