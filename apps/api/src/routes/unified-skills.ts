import type { Hono } from "hono";
import { InventoryFiltersSchema, type InventoryActor, type UnifiedSkillInventory } from "@orgops/schemas";
import { unifiedSkillsErrorResponse } from "./unified-skills-errors";

type Middleware = (c: any, next: any) => Promise<Response | void> | Response | void;
type UnifiedSkillRouteDeps = {
  inventory: UnifiedSkillInventory;
  requireAuth: any;
  actor: (c: any) => InventoryActor;
};

function error(c: any, code: unknown) {
  const fixed = unifiedSkillsErrorResponse(code);
  return c.json({ error: fixed.message, code: fixed.code }, fixed.status);
}
function parseQuery(url: string) {
  const params = new URL(url).searchParams;
  const allowed = new Set(["agentId", "q", "origin", "availability"]);
  for (const key of params.keys()) if (!allowed.has(key)) return undefined;
  const one = (key: string): string | null | undefined => {
    const values = params.getAll(key);
    return values.length > 1 ? undefined : values.length === 0 ? null : values[0];
  };
  const agentId = one("agentId");
  const query = one("q");
  const origin = one("origin");
  const availability = one("availability");
  if (agentId === undefined || query === undefined || origin === undefined || availability === undefined) return undefined;
  const filters = InventoryFiltersSchema.safeParse({ ...(query !== null ? { query } : {}), ...(origin !== null ? { origin } : {}), ...(availability !== null ? { availability } : {}) });
  if (agentId === "") return undefined;
  return filters.success ? { agentId, filters: filters.data } : undefined;
}
function boundedAgentId(value: string): string | undefined {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value) ? value : undefined;
}

export function registerUnifiedSkillRoutes(app: Hono<any>, deps: UnifiedSkillRouteDeps) {
  const fixedAuth = async (c: any, next: any) => {
    const result = await deps.requireAuth(c, next);
    if (result instanceof Response && result.status === 401) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    return result;
  };
  const noStore = async (c: any, next: any): Promise<void> => { c.header("Cache-Control", "no-store"); await next(); };
  app.use("/api/skills/inventory", noStore);
  app.use("/api/skills/*", noStore);
  app.use("/api/agents/*/skills", noStore);
  app.use("/api/agents/*/skills*", noStore);

  app.get("/api/skills/inventory", fixedAuth, async c => {
    const parsed = parseQuery(c.req.url);
    if (!parsed) return error(c, "INVALID_REQUEST");
    try {
      if (((c as any).get("user") as any)?.username === "runner") return error(c, "FORBIDDEN");
      const actor = deps.actor(c);
      if (parsed.agentId !== null) return c.json(await deps.inventory.listForAgent(actor, parsed.agentId, parsed.filters));
      return c.json({ items: await deps.inventory.list(actor, parsed.filters) });
    } catch (errorValue) { return error(c, errorValue); }
  });

  app.get("/api/agents/:agentId/skills", fixedAuth, async c => {
    if (new URL(c.req.url).search || c.req.raw.body) return error(c, "INVALID_REQUEST");
    const agentId = boundedAgentId(c.req.param("agentId"));
    if (!agentId) return error(c, "NOT_FOUND");
    try {
      if (((c as any).get("user") as any)?.username === "runner") return error(c, "FORBIDDEN");
      return c.json(await deps.inventory.listForAgent(deps.actor(c), agentId, { origin: "ALL", availability: "ALL" }));
    }
    catch (errorValue) { return error(c, errorValue); }
  });

}
