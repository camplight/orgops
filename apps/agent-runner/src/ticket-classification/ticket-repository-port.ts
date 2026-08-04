import type { ClassificationAuditEntry, ClassificationResult, Ticket } from "./types";

export const __SCAFFOLD__ = true;

/**
 * Port (per brief.md "Architecture Style"): the six operations named in the Classification
 * Orchestrator / Override-Audit Handler component descriptions. Pure orchestration/decision
 * logic depends on this interface only — it never calls fetch/apiFetch directly (mirrors
 * nwave-invocation's RunRepositoryPort seam exactly). Only HttpTicketRepository
 * (http-ticket-repository.ts) may perform the real HTTP calls.
 */
export interface TicketRepositoryPort {
  createTicket(input: {
    title: string;
    description: string | null;
    source: string;
    sourceRef: string | null;
    submitterHumanId: string;
  }): Promise<Ticket>;

  getTicket(input: { ticketId: string }): Promise<Ticket | null>;

  recordClassification(input: {
    ticketId: string;
    result: ClassificationResult;
    rationale: string;
  }): Promise<Ticket>;

  recordClassificationFailure(input: {
    ticketId: string;
    reason: string;
  }): Promise<Ticket>;

  recordOverride(input: {
    ticketId: string;
    toResult: ClassificationResult;
    actorId: string;
  }): Promise<Ticket>;

  listClassificationHistory(input: {
    ticketId: string;
  }): Promise<ClassificationAuditEntry[]>;
}
