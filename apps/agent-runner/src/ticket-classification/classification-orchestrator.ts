import type { TicketRepositoryPort } from "./ticket-repository-port";
import type { ClassificationDecision, TicketContentInput } from "./classifier";
import type { Ticket } from "./types";

export type ClassifyFn = (input: TicketContentInput) => Promise<ClassificationDecision>;

export type ClassificationOrchestratorDependencies = {
  repository: TicketRepositoryPort;
  classify: ClassifyFn;
};

function describeClassificationFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Classification Orchestrator (per brief.md "Component Architecture"): consumes `ticket.created`
 * — represented here as an explicit `{ ticketId, ticketTitle, ticketDescription, isLowDetail }`
 * input, mirroring apps/agent-runner/src/nwave-invocation/wave-runner.ts's
 * `triggerRunForConfirmedIntent` shape (an explicit-input driving-port function, not a direct
 * event-bus subscription — this is what keeps it unit-testable with synthetic inputs).
 *
 * Idempotency guard (ADR-0004 at-least-once redelivery, brief.md Failure/Timeout table): before
 * invoking the Classifier, checks the ticket's current `classificationStatus` via the port; a
 * ticket already CLASSIFIED or FAILED is a no-op, preventing duplicate audit rows, duplicate
 * channel messages, and duplicate `ticket.classification.confirmed` emissions on redelivery.
 *
 * On success: records the classification via `recordClassification` (the API route gates
 * `ticket.classification.confirmed` — this function never decides that itself, keeping the
 * gating rule in exactly one place per brief.md's "Observable Contract" section).
 *
 * On failure (a rejected `classify()` call, whether from a real LLM error/timeout or an
 * unparseable/out-of-enum response — both are indistinguishable at this boundary, per
 * classifier.ts's `parseClassificationResponse`): records the failure via
 * `recordClassificationFailure`, never silently leaving the ticket PENDING (US-02 AC4).
 */
export async function classifyTicketIfPending(
  input: { ticketId: string; ticketTitle: string; ticketDescription: string | null; isLowDetail: boolean },
  deps: ClassificationOrchestratorDependencies,
): Promise<Ticket | null> {
  const existing = await deps.repository.getTicket({ ticketId: input.ticketId });
  if (!existing) return null;
  if (existing.classificationStatus !== "PENDING") return existing;

  try {
    const decision = await deps.classify({
      ticketTitle: input.ticketTitle,
      ticketDescription: input.ticketDescription,
      isLowDetail: input.isLowDetail,
    });
    return await deps.repository.recordClassification({
      ticketId: input.ticketId,
      result: decision.result,
      rationale: decision.rationale,
    });
  } catch (error) {
    return deps.repository.recordClassificationFailure({
      ticketId: input.ticketId,
      reason: describeClassificationFailure(error),
    });
  }
}
