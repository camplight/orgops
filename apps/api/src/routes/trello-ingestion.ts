import type { Hono } from "hono";
import type { RequestUser } from "./access";

export const __SCAFFOLD__ = true;

type TrelloIngestionDeps = {
  orm: unknown;
  jsonResponse: (c: unknown, data: unknown, status?: number) => Response;
  access: {
    canManageTrelloIngestion: (user: RequestUser | undefined) => boolean;
  };
};

/**
 * New per-domain route file owned by multi-source-ingestion-governance (US-11). Mirrors the
 * existing access.ts/agents.ts per-domain route convention. RED scaffold only, per Mandate 7 —
 * every handler throws rather than implementing real board-registration/polling-observability
 * logic (DELIVER-wave, driven one scenario at a time by the acceptance tests this DISTILL pass
 * writes).
 */
export function registerTrelloIngestionRoutes(app: Hono<any>, _deps: TrelloIngestionDeps) {
  app.post("/api/trello-ingestion/boards", async () => {
    throw new Error(
      "POST /api/trello-ingestion/boards not implemented — must register a board (boardId, " +
        "optional triggerListIds, defaultSubmitterHumanId) into trello_ingestion_boards, " +
        "governance-team-only (canManageTrelloIngestion), rejecting unauthorized callers " +
        "before any write.",
    );
  });

  app.get("/api/trello-ingestion/boards", async () => {
    throw new Error(
      "GET /api/trello-ingestion/boards not implemented — must list configured boards " +
        "including lastPolledAt/lastPollStatus/lastPollError as the queryable sync-failure " +
        "observability surface (US-11 domain example 3).",
    );
  });

  app.patch("/api/trello-ingestion/boards/:boardId", async () => {
    throw new Error(
      "PATCH /api/trello-ingestion/boards/:boardId not implemented — must enable/disable or " +
        "update board config, governance-team-only.",
    );
  });
}
