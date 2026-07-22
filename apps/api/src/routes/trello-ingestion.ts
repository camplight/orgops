import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import type { RequestUser } from "./access";

type TrelloIngestionDeps = {
  orm: OrgOpsDrizzleDb;
  jsonResponse: (c: unknown, data: unknown, status?: number) => Response;
  access: {
    canManageTrelloIngestion: (user: RequestUser | undefined) => boolean;
  };
};

type TrelloIngestionBoardRow = {
  board_id: string;
  trigger_list_ids: string | null;
  default_submitter_human_id: string;
  enabled: number;
  activated_at: number;
  last_polled_at: number | null;
  last_poll_status: string | null;
  last_poll_error: string | null;
};

type TrelloIngestionBoardResponse = {
  boardId: string;
  triggerListIds: string[] | null;
  defaultSubmitterHumanId: string;
  enabled: boolean;
  activatedAt: number;
  lastPolledAt: number | null;
  lastPollStatus: string | null;
  lastPollError: string | null;
};

function parseTriggerListIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((item): item is string => typeof item === "string");
  return ids.length > 0 ? ids : null;
}

function toBoardResponse(row: TrelloIngestionBoardRow): TrelloIngestionBoardResponse {
  return {
    boardId: row.board_id,
    triggerListIds: row.trigger_list_ids ? (JSON.parse(row.trigger_list_ids) as string[]) : null,
    defaultSubmitterHumanId: row.default_submitter_human_id,
    enabled: Boolean(row.enabled),
    activatedAt: row.activated_at,
    lastPolledAt: row.last_polled_at,
    lastPollStatus: row.last_poll_status,
    lastPollError: row.last_poll_error,
  };
}

/**
 * New per-domain route file owned by multi-source-ingestion-governance (US-11). Mirrors the
 * existing access.ts/agents.ts per-domain route convention.
 */
export function registerTrelloIngestionRoutes(app: Hono<any>, deps: TrelloIngestionDeps) {
  const { orm, jsonResponse, access } = deps;

  app.post("/api/trello-ingestion/boards", async (c) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!access.canManageTrelloIngestion(user)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    const body = await c.req.json();
    const boardId = typeof body.boardId === "string" ? body.boardId.trim() : "";
    if (!boardId) return jsonResponse(c, { error: "boardId is required" }, 400);
    const defaultSubmitterHumanId =
      typeof body.defaultSubmitterHumanId === "string" ? body.defaultSubmitterHumanId.trim() : "";
    if (!defaultSubmitterHumanId) {
      return jsonResponse(c, { error: "defaultSubmitterHumanId is required" }, 400);
    }
    const triggerListIds = parseTriggerListIds(body.triggerListIds);
    const now = Date.now();
    orm
      .insert(schema.trelloIngestionBoards)
      .values({
        board_id: boardId,
        trigger_list_ids: triggerListIds ? JSON.stringify(triggerListIds) : null,
        default_submitter_human_id: defaultSubmitterHumanId,
        enabled: 1,
        activated_at: now,
        last_polled_at: null,
        last_poll_status: null,
        last_poll_error: null,
      })
      .run();
    const row = orm
      .select()
      .from(schema.trelloIngestionBoards)
      .where(eq(schema.trelloIngestionBoards.board_id, boardId))
      .get() as TrelloIngestionBoardRow;
    return jsonResponse(c, toBoardResponse(row), 201);
  });

  app.get("/api/trello-ingestion/boards", async (c) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!access.canManageTrelloIngestion(user)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    const rows = orm.select().from(schema.trelloIngestionBoards).all() as TrelloIngestionBoardRow[];
    return jsonResponse(c, rows.map(toBoardResponse));
  });

  app.patch("/api/trello-ingestion/boards/:boardId", async (c) => {
    const user = c.get("user") as RequestUser | undefined;
    if (!access.canManageTrelloIngestion(user)) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    const boardId = c.req.param("boardId");
    const existing = orm
      .select()
      .from(schema.trelloIngestionBoards)
      .where(eq(schema.trelloIngestionBoards.board_id, boardId))
      .get() as TrelloIngestionBoardRow | undefined;
    if (!existing) return jsonResponse(c, { error: "Not found" }, 404);
    const body = await c.req.json();
    const defaultSubmitterHumanId =
      typeof body.defaultSubmitterHumanId === "string" && body.defaultSubmitterHumanId.trim()
        ? body.defaultSubmitterHumanId.trim()
        : existing.default_submitter_human_id;
    const triggerListIds =
      body.triggerListIds !== undefined
        ? parseTriggerListIds(body.triggerListIds)
        : parseTriggerListIds(
            existing.trigger_list_ids ? (JSON.parse(existing.trigger_list_ids) as unknown) : null,
          );
    const enabled = body.enabled !== undefined ? Boolean(body.enabled) : Boolean(existing.enabled);
    orm
      .update(schema.trelloIngestionBoards)
      .set({
        default_submitter_human_id: defaultSubmitterHumanId,
        trigger_list_ids: triggerListIds ? JSON.stringify(triggerListIds) : null,
        enabled: enabled ? 1 : 0,
      })
      .where(eq(schema.trelloIngestionBoards.board_id, boardId))
      .run();
    const row = orm
      .select()
      .from(schema.trelloIngestionBoards)
      .where(eq(schema.trelloIngestionBoards.board_id, boardId))
      .get() as TrelloIngestionBoardRow;
    return jsonResponse(c, toBoardResponse(row), 200);
  });
}
