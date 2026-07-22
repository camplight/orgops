import type { TrelloCardSnapshot } from "./types";

export const __SCAFFOLD__ = true;

/**
 * Port (per brief.md "Architecture Style"): pure orchestration logic (the Trello Ingestion
 * Poller) never shells out directly — it depends on this interface only.
 */
export interface TrelloIngestionPort {
  listCards(input: { boardId: string }): Promise<TrelloCardSnapshot[]>;
}
