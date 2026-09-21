import type { Context, Hono } from "hono";
import { SkillCommandSchema, SkillHistoryQuerySchema, SkillPreflightResultSchema, SkillPreflightSchema, type InventoryActor } from "@orgops/schemas";
import { AgentSkillManagementError, type AgentSkillManagement } from "../unified-skills/management";
import { unifiedSkillsErrorResponse } from "./unified-skills-errors";

const MAX_BODY = 16 * 1024;
function error(c: Context, code: unknown) { const fixed = unifiedSkillsErrorResponse(code); return c.json({ error: fixed.message, code: fixed.code }, fixed.status as never); }
async function strictJson(c: Context): Promise<{ ok: true; value: unknown } | { ok: false; code: "INVALID_REQUEST" | "PAYLOAD_TOO_LARGE" }> {
  if (c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return { ok: false, code: "INVALID_REQUEST" };
  const stream = c.req.raw.body; if (!stream) return { ok: false, code: "INVALID_REQUEST" };
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_BODY) { try { await reader.cancel(); } catch { /* best effort */ } return { ok: false, code: "PAYLOAD_TOO_LARGE" }; } chunks.push(part.value); } }
  catch { return { ok: false, code: "INVALID_REQUEST" }; }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) }; } catch { return { ok: false, code: "INVALID_REQUEST" }; }
}
function fixed(errorValue: unknown): unknown { return errorValue instanceof AgentSkillManagementError ? errorValue.code : errorValue; }
function boundedAgentId(value: string | undefined): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value); }
type Deps = Readonly<{ management: AgentSkillManagement; requireAuth: any; actor: (c: Context) => InventoryActor; preflight?: (agentId: string, selection: unknown, actor: InventoryActor) => unknown }>;

export function registerAgentSkillRoutes(app: Hono<any>, deps: Deps) {
  const fixedAuth = async (c: Context, next: () => Promise<Response | void>) => {
    const result = await deps.requireAuth(c, next);
    if (result instanceof Response && result.status === 401) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    return result;
  };
  const noStore = async (c: Context, next: () => Promise<void>) => { c.header("Cache-Control", "no-store"); await next(); };
  app.use("/api/agents/*/skills", noStore); app.use("/api/agents/*/skills/*", noStore);
  app.patch("/api/agents/:agentId/skills", fixedAuth, async c => {
    if (new URL(c.req.url).search || c.req.raw.body === null) return error(c, "INVALID_REQUEST");
    const body = await strictJson(c); if (!body.ok) return error(c, body.code);
    const parsed = SkillCommandSchema.safeParse(body.value); if (!parsed.success || parsed.data.agentId !== c.req.param("agentId")) return error(c, "INVALID_REQUEST");
    try { return c.json(await deps.management.execute(parsed.data, deps.actor(c))); } catch (value) { return error(c, fixed(value)); }
  });
  app.post("/api/agents/:agentId/skills/preflight", fixedAuth, async c => {
    const agentId = c.req.param("agentId");
    if (new URL(c.req.url).search || !boundedAgentId(agentId)) return error(c, "INVALID_REQUEST");
    const body = await strictJson(c); if (!body.ok) return error(c, body.code);
    const parsed = SkillPreflightSchema.safeParse(body.value); if (!parsed.success || !deps.preflight) return error(c, "INVALID_REQUEST");
    try { return c.json(SkillPreflightResultSchema.parse(await deps.preflight(agentId, parsed.data.selection, deps.actor(c)))); } catch (value) { return error(c, fixed(value)); }
  });
  app.get("/api/agents/:agentId/skills/history", fixedAuth, c => {
    const agentId = c.req.param("agentId");
    if (!boundedAgentId(agentId)) return error(c, "NOT_FOUND");
    if (c.req.raw.body) return error(c, "INVALID_REQUEST");
    const params = new URL(c.req.url).searchParams;
    const allowedKeys = new Set(["kind", "name", "localOrigin", "packageReleaseId"]);
    if ([...params.keys()].some(key => !allowedKeys.has(key)) || [...allowedKeys].some(key => params.getAll(key).length > 1)) return error(c, "INVALID_REQUEST");
    const raw = Object.fromEntries(params.entries());
    const query = SkillHistoryQuerySchema.safeParse(raw);
    if (!query.success) return error(c, "INVALID_REQUEST");
    try { return c.json({ events: deps.management.history(agentId, query.data, deps.actor(c)) }); } catch (value) { return error(c, fixed(value)); }
  });
}
