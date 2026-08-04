import type { Hono } from "hono";
import type { AccessControl } from "./access";

export const __SCAFFOLD__ = true;

type TicketsDeps = {
  orm: unknown;
  jsonResponse: (c: unknown, data: unknown, status?: number) => Response;
  access: Pick<AccessControl, "canOverrideClassification">;
  insertEvent: (input: unknown) => unknown;
};

function notImplemented(label: string) {
  return async () => {
    throw new Error(`${label} not implemented`);
  };
}

/**
 * RED scaffold owned by `ticket-classification` (US-01/US-02/US-03) — see brief.md "Ticket
 * Classification" -> "Component Architecture" ("Ticket Intake") and "Data Model" -> "New API
 * routes". Every handler throws; DELIVER wave implements each one behind its own failing
 * acceptance test, one scenario at a time (Mandate 5), mirroring exactly how
 * apps/api/src/routes/nwave-runs.ts's own base routes were scaffolded before that track's
 * DELIVER wave made them real.
 *
 * This supersedes the prior PREREQUISITE-SCAFFOLD version of this file
 * (multi-source-ingestion-governance's DISTILL pass, distill/wave-decisions.md DWD-02) — that
 * track's US-11 Trello-ingestion scenarios already call `POST /api/tickets` expecting exactly
 * the contract this file now specifies in full (idempotency via `(source, source_ref)` per
 * ADR-0009, plus the `source`/`sourceRef`/`submitterHumanId` fields it named as "extension owned
 * by THIS track"). No route path changes for that track's callers.
 */
export function registerTicketsRoutes(app: Hono<any>, _deps: TicketsDeps) {
  app.post(
    "/api/tickets",
    notImplemented(
      "POST /api/tickets — creates a tickets row (id format TICKET-{n}, a monotonically " +
        "increasing integer sequence per brief.md Data Model), computes is_low_detail from a " +
        "blank/near-empty description (US-01 AC3), creates a ticket-scoped channel and " +
        "subscribes the submitter by reusing the existing POST /api/channels insert-plus-" +
        "subscribe logic (not duplicating channel infrastructure), then emits ticket.created " +
        "(source-agnostic per ADR-0004) via insertEvent. Idempotent two ways: (a) a supplied " +
        "idempotencyKey checked against the unique index on tickets.idempotency_key returns the " +
        "existing ticket (200) instead of inserting twice (US-01 AC4); (b) for source !== " +
        "NATIVE_FORM, the unique index on (source, source_ref) gives the same guarantee for " +
        "redelivered ingestion polls (ADR-0009). Rejects a request with no title (400).",
    ),
  );

  app.get(
    "/api/tickets",
    notImplemented(
      "GET /api/tickets — the authenticated submitter's ticket dashboard list (US-01 AC5).",
    ),
  );

  app.get(
    "/api/tickets/:id",
    notImplemented(
      "GET /api/tickets/:id — ticket plus current classification state (classification_status/" +
        "classification_result/classification_rationale), the read path US-03 AC1's " +
        '"classification result and rationale are visible in the ticket channel" and this ' +
        "track's own acceptance tests both depend on.",
    ),
  );

  app.post(
    "/api/tickets/:id/classification",
    notImplemented(
      "POST /api/tickets/:id/classification — called by HttpTicketRepository once the " +
        "Classifier returns a result. Sets classification_status=CLASSIFIED and " +
        "classification_result/classification_rationale, appends a ticket_classification_audit " +
        "row (event_type=INITIAL_CLASSIFICATION, actor_type=SYSTEM), posts a message.created " +
        "channel message with the result + rationale (+ a routing suggestion when " +
        "result=NOT_DEVELOPMENT_WORK, US-03 AC2), and — only if result===DEVELOPMENT_WORK — " +
        "emits ticket.classification.confirmed (US-02 AC5's structural gate: LOW_CONFIDENCE and " +
        "NOT_DEVELOPMENT_WORK never emit this event, this is the one and only place that " +
        "decides). Idempotent: a ticket already CLASSIFIED/FAILED is a no-op response, never a " +
        "duplicate audit row or duplicate event (ADR-0004 at-least-once redelivery guard).",
    ),
  );

  app.post(
    "/api/tickets/:id/classification/failed",
    notImplemented(
      "POST /api/tickets/:id/classification/failed — called by HttpTicketRepository when the " +
        "Classifier's generate() call errors, times out, or returns an unparseable/out-of-enum " +
        "response (all three treated identically, never silently coerced into a valid result). " +
        "Sets classification_status=FAILED and classification_failure_reason, appends a " +
        "ticket_classification_audit row (event_type=CLASSIFICATION_FAILED, actor_type=SYSTEM), " +
        "posts a channel message naming the failure and what happens next — never silent " +
        "(US-02 AC4).",
    ),
  );

  app.post(
    "/api/tickets/:id/override",
    notImplemented(
      "POST /api/tickets/:id/override — validates access.canOverrideClassification(user, " +
        "ticket) server-side before any write (submitter match or governance-team membership, " +
        "US-03 Technical Notes); unauthorized attempts are rejected with no audit row written. " +
        "Idempotency guard for redelivered override actions (brief.md Failure/Timeout table): " +
        "compares the requested toResult against tickets.classification_result BEFORE writing — " +
        "if they already match, the action is a no-op (no new audit row, no duplicate event). " +
        "On an authorized, state-changing override: updates tickets.classification_result, " +
        "appends a ticket_classification_audit row (event_type=OVERRIDE, from_result/to_result/" +
        "actor_type=HUMAN/actor_id populated — US-03 AC4's who/when/from/to), posts a channel " +
        "message confirming the change, and — only if toResult===DEVELOPMENT_WORK — emits " +
        "ticket.classification.confirmed, mirroring the classification route's identical gating " +
        "rule so the downstream contract has exactly one emission rule regardless of path.",
    ),
  );

  app.get(
    "/api/tickets/:id/classification-history",
    notImplemented(
      "GET /api/tickets/:id/classification-history — full ticket_classification_audit trail " +
        "for governance review (US-03 AC4), ordered by created_at.",
    ),
  );
}
