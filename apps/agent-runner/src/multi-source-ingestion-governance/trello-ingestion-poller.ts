import type { GovernanceRepositoryPort } from "./governance-repository-port";
import type { TrelloIngestionPort } from "./trello-ingestion-port";

export const __SCAFFOLD__ = true;

export type TrelloIngestionBoardConfig = {
  boardId: string;
  triggerListIds?: string[];
  defaultSubmitterHumanId: string;
  isFirstPollForBoard: boolean;
};

export type TrelloIngestionPollerDependencies = {
  listBoards: () => Promise<TrelloIngestionBoardConfig[]>;
  trelloPort: TrelloIngestionPort;
  governanceRepository: GovernanceRepositoryPort;
};

/**
 * The exported driving-port function for US-11's interval-scheduled poller — acceptance tests
 * call this directly (mirroring how maintenance-loop.ts's runAgentMaintenancePass is the
 * testable unit inside createMaintenanceLoop's schedule/awaitInFlight shape).
 *
 * Real implementation must (ADR-0008): call trelloPort.listCards, compare against
 * trello_ingestion_seen_cards, ingest genuinely new cards (skipping the board's first-ever
 * poll — baseline snapshot), and on trelloPort failure call
 * governanceRepository.recordBoardPollResult({status: "FAILED"}) WITHOUT touching seen_cards so
 * no card is ever structurally lost to a missed cycle.
 */
export async function runBoardPollCycle(
  _deps: TrelloIngestionPollerDependencies,
  board: TrelloIngestionBoardConfig,
): Promise<void> {
  throw new Error(
    `runBoardPollCycle not implemented for board "${board.boardId}" — must snapshot-diff the ` +
      "board's cards against trello_ingestion_seen_cards, ingest genuinely new cards via " +
      "GovernanceRepositoryPort.createIngestedTicket, and never lose a card across a failed " +
      "poll cycle (US-11 AC1/AC2/AC3).",
  );
}

export function createTrelloIngestionPoller(deps: TrelloIngestionPollerDependencies) {
  const pollInFlightByBoard = new Map<string, Promise<void>>();

  async function runAllBoardsPollPass(): Promise<void> {
    const boards = await deps.listBoards();
    for (const board of boards) {
      if (pollInFlightByBoard.has(board.boardId)) continue;
      const task = runBoardPollCycle(deps, board)
        .catch((error) => {
          console.warn(`trello ingestion poll failed for board ${board.boardId}`, error);
        })
        .finally(() => {
          pollInFlightByBoard.delete(board.boardId);
        });
      pollInFlightByBoard.set(board.boardId, task);
    }
  }

  function schedule(): void {
    void runAllBoardsPollPass();
  }

  async function awaitInFlight(): Promise<void> {
    if (pollInFlightByBoard.size === 0) return;
    await Promise.allSettled([...pollInFlightByBoard.values()]);
  }

  return {
    schedule,
    awaitInFlight,
    runAllBoardsPollPass,
    runBoardPollCycle: (board: TrelloIngestionBoardConfig) => runBoardPollCycle(deps, board),
  };
}
