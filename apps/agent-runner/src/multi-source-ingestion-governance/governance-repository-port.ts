import type {
  FollowOnRunCycleReason,
  GuardrailEvaluation,
  IngestedTicket,
} from "./types";

export const __SCAFFOLD__ = true;

export type RunCycleHistoryEntry = {
  runId: string;
  outcome: string;
  failureReason?: string;
};

/**
 * Port (per brief.md "Architecture Style"): pure orchestration/gating logic (Guardrail
 * Evaluator, Governance Approval Handler, Failure/Recovery Advisor, Stuck-Run Detector, Trello
 * Ingestion Poller) never calls fetch directly — only HttpGovernanceRepository may.
 */
export interface GovernanceRepositoryPort {
  findTicketBySourceRef(input: {
    source: string;
    sourceRef: string;
  }): Promise<IngestedTicket | null>;

  createIngestedTicket(input: {
    title: string;
    description: string;
    source: "TRELLO";
    sourceRef: string;
    submitterHumanId: string;
  }): Promise<IngestedTicket>;

  recordBoardPollResult(input: {
    boardId: string;
    status: "OK" | "FAILED";
    error?: string;
  }): Promise<void>;

  evaluateGuardrail(input: {
    runId: string;
    changedFilePaths?: string[];
  }): Promise<GuardrailEvaluation>;

  recordGuardrailHold(input: { runId: string; reason: string }): Promise<void>;

  recordGovernanceSignoff(input: { runId: string; actorId: string }): Promise<void>;

  recordApproval(input: { runId: string; actorId: string }): Promise<void>;

  recordChangesRequested(input: { runId: string; note: string }): Promise<void>;

  createFollowOnRun(input: {
    ticketRef: string;
    previousRunId: string;
    cycleReason: FollowOnRunCycleReason;
    seedContext: string;
  }): Promise<{ id: string }>;

  recordRetryExhausted(input: { runId: string }): Promise<void>;

  recordEscalation(input: { runId: string }): Promise<void>;

  getRunCycleHistory(input: { runId: string }): Promise<RunCycleHistoryEntry[]>;
}
