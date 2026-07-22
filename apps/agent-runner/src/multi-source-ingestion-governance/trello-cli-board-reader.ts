import type { TrelloIngestionPort } from "./trello-ingestion-port";
import type { TrelloCardSnapshot } from "./types";

export const __SCAFFOLD__ = true;

export type TrelloCliBoardReaderDependencies = {
  projectRoot: string;
  timeoutMs?: number;
};

/**
 * Adapter (ADR-0008). The ONLY module in multi-source-ingestion-governance permitted to import
 * node:child_process or invoke the trello-cli skill script (enforced by
 * .dependency-cruiser.cjs's "only-trello-cli-board-reader-may-shell-out-to-trello" rule).
 *
 * Peer-review-mandated contract (DESIGN wave-decisions.md remediation item 1): listCards must
 * reject/throw on every CLI failure mode (non-zero exit, spawn error, timeout) — never resolve
 * with a misleadingly-empty list. Real invocation must be asynchronous (child_process.spawn,
 * never spawnSync) so a Trello network round trip never blocks agent-runner's long-lived event
 * loop.
 */
export function createTrelloCliBoardReader(
  deps: TrelloCliBoardReaderDependencies,
): TrelloIngestionPort {
  return {
    async listCards(input: { boardId: string }): Promise<TrelloCardSnapshot[]> {
      throw new Error(
        `TrelloCliBoardReader.listCards not implemented for board "${input.boardId}" ` +
          `(projectRoot=${deps.projectRoot}, timeoutMs=${deps.timeoutMs ?? "default"}). Real ` +
          "implementation must asynchronously spawn (child_process.spawn, never spawnSync) the " +
          "trello-cli skill's underlying CLI, and must reject/throw on every CLI failure mode " +
          "rather than resolve with an empty list.",
      );
    },
  };
}
