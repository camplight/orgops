// Domain types owned by the ticket-classification track (US-01/US-02/US-03).
// See docs/product/architecture/brief.md "Ticket Classification" -> "Data Model" and
// "Component Architecture". Mirrors the naming/shape convention already used by
// apps/agent-runner/src/nwave-invocation/types.ts (the sibling track's own types file).

export type ClassificationStatus = "PENDING" | "CLASSIFIED" | "FAILED";

export type ClassificationResult = "DEVELOPMENT_WORK" | "NOT_DEVELOPMENT_WORK" | "LOW_CONFIDENCE";

export type Ticket = {
  id: string;
  title: string;
  description: string | null;
  source: string;
  sourceRef: string | null;
  channelId: string;
  submitterHumanId: string;
  isLowDetail: boolean;
  classificationStatus: ClassificationStatus;
  classificationResult: ClassificationResult | null;
  classificationRationale: string | null;
  classificationFailureReason: string | null;
  classifiedAt: number | null;
  createdAt: number;
};

export type ClassificationAuditEntry = {
  id: string;
  ticketId: string;
  eventType: "INITIAL_CLASSIFICATION" | "OVERRIDE" | "CLASSIFICATION_FAILED";
  fromResult: ClassificationResult | null;
  toResult: ClassificationResult | null;
  rationale: string | null;
  actorType: "SYSTEM" | "HUMAN";
  actorId: string | null;
  createdAt: number;
};

/**
 * Observable contract per brief.md "Observable Contract for nwave-invocation-engine": emitted
 * exactly once per ticket, the first time its effective classification_result becomes
 * DEVELOPMENT_WORK (whether from the initial Classifier decision or from a later override).
 * Structurally identical to nwave-invocation's own `TicketClassificationConfirmedPayload` —
 * defined independently here (not cross-imported) because the two modules must not import each
 * other (dependency-cruiser rule "no-ticket-classification-into-nwave-invocation-or-wrapper-
 * harness" / brief.md Architecture Enforcement); the shared contract is the *event on the bus*,
 * not a shared TypeScript type.
 */
export type TicketClassificationConfirmedPayload = {
  ticketId: string;
  channelId: string;
  rationale: string;
};
