import type { TicketRepositoryPort } from "./ticket-repository-port";
import type { ClassificationAuditEntry, Ticket } from "./types";

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type HttpTicketRepositoryDependencies = {
  apiFetch: ApiFetch;
};

async function postJson(apiFetch: ApiFetch, path: string, payload: unknown): Promise<Response> {
  return apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function parseJsonOrThrow<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${context} failed with status ${response.status}: ${body}`);
  }
  return (await response.json()) as T;
}

/**
 * Adapter implementing TicketRepositoryPort against `/api/tickets*` (per brief.md "Architecture
 * Style"), the only module in this track permitted to call apiFetch directly
 * (brief.md Architecture Enforcement: "Pure logic modules ... must not perform fetch/apiFetch
 * calls directly — only the HttpTicketRepository adapter module may").
 */
export function createHttpTicketRepository(
  deps: HttpTicketRepositoryDependencies,
): TicketRepositoryPort {
  const { apiFetch } = deps;

  return {
    createTicket: async (input) => {
      const response = await postJson(apiFetch, "/api/tickets", input);
      return parseJsonOrThrow<Ticket>(response, "createTicket");
    },

    getTicket: async (input) => {
      const response = await apiFetch(`/api/tickets/${input.ticketId}`);
      if (response.status === 404) return null;
      return parseJsonOrThrow<Ticket>(response, "getTicket");
    },

    recordClassification: async (input) => {
      const response = await postJson(apiFetch, `/api/tickets/${input.ticketId}/classification`, {
        result: input.result,
        rationale: input.rationale,
      });
      return parseJsonOrThrow<Ticket>(response, "recordClassification");
    },

    recordClassificationFailure: async (input) => {
      const response = await postJson(
        apiFetch,
        `/api/tickets/${input.ticketId}/classification/failed`,
        { reason: input.reason },
      );
      return parseJsonOrThrow<Ticket>(response, "recordClassificationFailure");
    },

    recordOverride: async (input) => {
      const response = await postJson(apiFetch, `/api/tickets/${input.ticketId}/override`, {
        toResult: input.toResult,
        actorId: input.actorId,
      });
      return parseJsonOrThrow<Ticket>(response, "recordOverride");
    },

    listClassificationHistory: async (input) => {
      const response = await apiFetch(`/api/tickets/${input.ticketId}/classification-history`);
      return parseJsonOrThrow<ClassificationAuditEntry[]>(response, "listClassificationHistory");
    },
  };
}
