import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { CHANNEL_KINDS, CHANNEL_VISIBILITY, schema, type OrgOpsDrizzleDb } from "@orgops/db";
import type { AccessControl, RequestUser } from "./access";
import { createChannelRow, subscribeHumanToChannel } from "./collab";

export const __SCAFFOLD__ = true;

type TicketsDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: unknown, data: unknown, status?: number) => Response;
  access: Pick<AccessControl, "canOverrideClassification">;
  insertEvent: (input: unknown) => unknown;
};

type TicketRow = typeof schema.tickets.$inferSelect;
type TicketClassificationAuditRow = typeof schema.ticketClassificationAudit.$inferSelect;

const NATIVE_FORM_SOURCE = "NATIVE_FORM";
const TICKET_ID_PATTERN = /^TICKET-(\d+)$/;

function notImplemented(label: string) {
  return async () => {
    throw new Error(`${label} not implemented`);
  };
}

function ticketRowToApi(row: TicketRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    source: row.source,
    sourceRef: row.source_ref,
    channelId: row.channel_id,
    submitterHumanId: row.submitter_human_id,
    isLowDetail: Boolean(row.is_low_detail),
    classificationStatus: row.classification_status,
    classificationResult: row.classification_result,
    classificationRationale: row.classification_rationale,
    classificationFailureReason: row.classification_failure_reason,
    classifiedAt: row.classified_at,
    createdAt: row.created_at,
  };
}

function auditRowToApi(row: TicketClassificationAuditRow) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    eventType: row.event_type,
    fromResult: row.from_result,
    toResult: row.to_result,
    rationale: row.rationale,
    actorType: row.actor_type,
    actorId: row.actor_id,
    createdAt: row.created_at,
  };
}

function normalizeTitle(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function normalizeDescription(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSource(input: unknown): string {
  return typeof input === "string" && input.trim() ? input.trim() : NATIVE_FORM_SOURCE;
}

function normalizeOptionalString(input: unknown): string | null {
  return typeof input === "string" && input.trim() ? input.trim() : null;
}

export function computeIsLowDetail(description: string | null): boolean {
  return description === null;
}

function nextTicketId(orm: OrgOpsDrizzleDb): string {
  const rows = orm.select({ id: schema.tickets.id }).from(schema.tickets).all() as Array<{
    id: string;
  }>;
  const highestSequence = rows.reduce((highest, row) => {
    const match = TICKET_ID_PATTERN.exec(row.id);
    if (!match) return highest;
    return Math.max(highest, Number(match[1]));
  }, 0);
  return `TICKET-${highestSequence + 1}`;
}

function findTicketByIdempotencyKey(
  orm: OrgOpsDrizzleDb,
  idempotencyKey: string,
): TicketRow | undefined {
  return orm
    .select()
    .from(schema.tickets)
    .where(eq(schema.tickets.idempotency_key, idempotencyKey))
    .get() as TicketRow | undefined;
}

function getTicketRow(orm: OrgOpsDrizzleDb, ticketId: string): TicketRow | undefined {
  return orm.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId)).get() as
    | TicketRow
    | undefined;
}

/**
 * RED scaffold owned by `ticket-classification` (US-01/US-02/US-03) — see brief.md "Ticket
 * Classification" -> "Component Architecture" ("Ticket Intake") and "Data Model" -> "New API
 * routes". POST /api/tickets, GET /api/tickets/:id and POST /api/tickets/:id/classification are
 * real as of the classification walking skeleton (US-01/US-02 WS-1); every other handler still
 * throws and is implemented behind its own failing acceptance test, one scenario at a time.
 *
 * This supersedes the prior PREREQUISITE-SCAFFOLD version of this file
 * (multi-source-ingestion-governance's DISTILL pass, distill/wave-decisions.md DWD-02) — that
 * track's US-11 Trello-ingestion scenarios already call `POST /api/tickets` expecting exactly
 * the contract this file now specifies in full (idempotency via `(source, source_ref)` per
 * ADR-0009, plus the `source`/`sourceRef`/`submitterHumanId` fields it named as "extension owned
 * by THIS track"). No route path changes for that track's callers.
 */
export function registerTicketsRoutes(app: Hono<any>, deps: TicketsDeps) {
  const { orm, jsonResponse, insertEvent } = deps;

  app.post("/api/tickets", async (c) => {
    const body = await c.req.json().catch(() => ({}));

    const title = normalizeTitle(body.title);
    if (!title) return jsonResponse(c, { error: "Title is required" }, 400);

    const idempotencyKey = normalizeOptionalString(body.idempotencyKey);
    if (idempotencyKey) {
      const existing = findTicketByIdempotencyKey(orm, idempotencyKey);
      if (existing) return jsonResponse(c, ticketRowToApi(existing), 200);
    }

    const user = c.get("user") as RequestUser | undefined;
    const submitterHumanId =
      normalizeOptionalString(body.submitterHumanId) ?? user?.id ?? null;
    if (!submitterHumanId) {
      return jsonResponse(c, { error: "Authenticated human user required" }, 401);
    }

    const description = normalizeDescription(body.description);
    const isLowDetail = computeIsLowDetail(description);
    const source = normalizeSource(body.source);
    const sourceRef = normalizeOptionalString(body.sourceRef);

    const ticketId = nextTicketId(orm);
    const { id: channelId } = createChannelRow(orm, {
      name: `ticket-${ticketId}`,
      description: title,
      visibility: CHANNEL_VISIBILITY.PUBLIC,
      kind: CHANNEL_KINDS.GROUP,
    });
    const submitterUsername =
      user?.username && user.username !== "runner" ? user.username : undefined;
    if (submitterUsername) {
      subscribeHumanToChannel(orm, channelId, submitterUsername);
    }

    const createdAt = Date.now();
    orm
      .insert(schema.tickets)
      .values({
        id: ticketId,
        title,
        description,
        source,
        source_ref: sourceRef,
        channel_id: channelId,
        submitter_human_id: submitterHumanId,
        is_low_detail: isLowDetail ? 1 : 0,
        idempotency_key: idempotencyKey,
        classification_status: "PENDING",
        classification_result: null,
        classification_rationale: null,
        classification_failure_reason: null,
        classified_at: null,
        created_at: createdAt,
      })
      .run();

    insertEvent({
      type: "ticket.created",
      source: "system",
      channelId,
      payload: {
        ticketId,
        title,
        description,
        isLowDetail,
        source,
        sourceRef,
        submitterHumanId,
      },
    });

    const created = getTicketRow(orm, ticketId);
    return jsonResponse(c, ticketRowToApi(created as TicketRow), 201);
  });

  app.get("/api/tickets", (c) => {
    const rows = orm.select().from(schema.tickets).all() as TicketRow[];
    return jsonResponse(c, rows.map(ticketRowToApi));
  });

  app.get("/api/tickets/:id", (c) => {
    const id = c.req.param("id");
    const row = getTicketRow(orm, id);
    if (!row) return jsonResponse(c, { error: "Not found" }, 404);
    return jsonResponse(c, ticketRowToApi(row));
  });

  app.post("/api/tickets/:id/classification", async (c) => {
    const id = c.req.param("id");
    const existing = getTicketRow(orm, id);
    if (!existing) return jsonResponse(c, { error: "Not found" }, 404);

    // Idempotency guard (ADR-0004 at-least-once redelivery): a ticket already CLASSIFIED/FAILED
    // is a no-op response, never a duplicate audit row or duplicate event.
    if (existing.classification_status !== "PENDING") {
      return jsonResponse(c, ticketRowToApi(existing), 200);
    }

    const body = await c.req.json().catch(() => ({}));
    const result = typeof body.result === "string" ? body.result : "";
    const rationale = typeof body.rationale === "string" ? body.rationale : "";
    if (!result || !rationale) {
      return jsonResponse(c, { error: "result and rationale are required" }, 400);
    }

    const classifiedAt = Date.now();
    orm
      .update(schema.tickets)
      .set({
        classification_status: "CLASSIFIED",
        classification_result: result,
        classification_rationale: rationale,
        classified_at: classifiedAt,
      })
      .where(eq(schema.tickets.id, id))
      .run();

    orm
      .insert(schema.ticketClassificationAudit)
      .values({
        id: randomUUID(),
        ticket_id: id,
        event_type: "INITIAL_CLASSIFICATION",
        from_result: null,
        to_result: result,
        rationale,
        actor_type: "SYSTEM",
        actor_id: null,
        created_at: classifiedAt,
      })
      .run();

    insertEvent({
      type: "message.created",
      source: "system",
      channelId: existing.channel_id,
      payload: {
        ticketId: id,
        classificationResult: result,
        classificationRationale: rationale,
      },
    });

    // Observable contract (brief.md "Observable Contract for nwave-invocation-engine"): emitted
    // exactly once per ticket, the first time its effective classification_result becomes
    // DEVELOPMENT_WORK. This route is the single place that decides that gate.
    if (result === "DEVELOPMENT_WORK") {
      insertEvent({
        type: "ticket.classification.confirmed",
        source: "system",
        channelId: existing.channel_id,
        payload: { ticketId: id, channelId: existing.channel_id, rationale },
      });
    }

    const updated = getTicketRow(orm, id);
    return jsonResponse(c, ticketRowToApi(updated as TicketRow), 200);
  });

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

  app.get("/api/tickets/:id/classification-history", (c) => {
    const id = c.req.param("id");
    const rows = orm
      .select()
      .from(schema.ticketClassificationAudit)
      .where(eq(schema.ticketClassificationAudit.ticket_id, id))
      .orderBy(asc(schema.ticketClassificationAudit.created_at))
      .all() as TicketClassificationAuditRow[];
    return jsonResponse(c, rows.map(auditRowToApi));
  });
}
