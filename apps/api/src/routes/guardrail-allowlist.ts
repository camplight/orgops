import type { Hono } from "hono";
import type { RequestUser } from "./access";

export const __SCAFFOLD__ = true;

type GuardrailAllowlistDeps = {
  orm: unknown;
  jsonResponse: (c: unknown, data: unknown, status?: number) => Response;
  access: {
    canManageTrelloIngestion: (user: RequestUser | undefined) => boolean;
  };
};

/**
 * New per-domain route file owned by multi-source-ingestion-governance (US-12). Per ADR-0010,
 * this is the ENTIRE guardrail_config mechanism: a flat CRUD API over a single global allowlist
 * table — no policy engine, no multi-tier approval chains. RED scaffold only, per Mandate 7.
 */
export function registerGuardrailAllowlistRoutes(app: Hono<any>, _deps: GuardrailAllowlistDeps) {
  app.get("/api/guardrail-allowlist", async () => {
    throw new Error(
      "GET /api/guardrail-allowlist not implemented — must list guardrail_allowlist_entries.",
    );
  });

  app.post("/api/guardrail-allowlist", async () => {
    throw new Error(
      "POST /api/guardrail-allowlist not implemented — must add a path_pattern entry, " +
        "governance-team-only, rejecting unauthorized callers before any write.",
    );
  });

  app.delete("/api/guardrail-allowlist/:id", async () => {
    throw new Error(
      "DELETE /api/guardrail-allowlist/:id not implemented — governance-team-only.",
    );
  });
}
