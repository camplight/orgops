import type { Hono } from "hono";

export const __SCAFFOLD__ = true;

type TicketsDeps = {
  orm: unknown;
  jsonResponse: (c: unknown, data: unknown, status?: number) => Response;
};

/**
 * PREREQUISITE SCAFFOLD, not owned by multi-source-ingestion-governance. `tickets` and
 * `POST /api/tickets` are the `ticket-classification` track's US-01/ADR-0004 contract; that
 * track has not reached DELIVER in this codebase yet, so this route does not exist anywhere
 * either. This minimal scaffold exists only so multi-source-ingestion-governance's US-11
 * acceptance tests (Trello ingestion calling the *same* `POST /api/tickets` endpoint the
 * native form uses, per this track's own DESIGN "Resolution of the Blocking Trello/Tickets
 * Dependency") can exercise a real HTTP driving port end-to-end, instead of importing nothing.
 *
 * Extension owned by THIS track (per brief.md "Data Model"): optional `source`/`sourceRef`/
 * `submitterHumanId` fields on the request body, used only when `source !== "NATIVE_FORM"`.
 * No production logic is implemented here — ticket-classification owns the real behavior.
 */
export function registerTicketsRoutes(app: Hono<any>, _deps: TicketsDeps) {
  app.post("/api/tickets", async () => {
    throw new Error(
      "POST /api/tickets not implemented — prerequisite scaffold. Real implementation " +
        "(ticket-classification track) must create a tickets row, honor the unique index on " +
        "(source, source_ref) by returning the existing ticket (200) on a duplicate insert " +
        "instead of a second row (US-11 AC2/AC5), and emit ticket.created.",
    );
  });
}
