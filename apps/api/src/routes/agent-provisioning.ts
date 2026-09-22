import type { Context, Hono, MiddlewareHandler } from "hono";
import { ProvisionAgentSchema, ProvisioningTemplateOptionsSchema, type InventoryActor } from "@orgops/schemas";
import { AgentProvisioningError, type AgentProvisioning } from "../unified-skills/provisioning";
import { unifiedSkillsErrorResponse } from "./unified-skills-errors";

const MAX_BODY = 16 * 1024;

type StrictBody<T> = { ok: true; value: T } | { ok: false; code: "INVALID_REQUEST" | "PAYLOAD_TOO_LARGE" };
async function readStrictBody<T>(c: Context, schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } }): Promise<StrictBody<T>> {
  if (c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return { ok: false, code: "INVALID_REQUEST" };
  if (!c.req.raw.body) return { ok: false, code: "INVALID_REQUEST" };
  const reader = c.req.raw.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > MAX_BODY) { await reader.cancel().catch(() => undefined); return { ok: false, code: "PAYLOAD_TOO_LARGE" }; } chunks.push(next.value); } } catch { return { ok: false, code: "INVALID_REQUEST" }; }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let input: unknown; try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return { ok: false, code: "INVALID_REQUEST" }; }
  const parsed = schema.safeParse(input); return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: "INVALID_REQUEST" };
}
function error(c: Context, code: unknown) { const fixed = unifiedSkillsErrorResponse(code); return c.json({ error: fixed.message, code: fixed.code }, fixed.status as never); }
function actor(c: Context<any>): InventoryActor | undefined {
  const user = c.get("user") as { id?: string; username?: string } | undefined;
  if (!user?.id || user.username === "runner") return undefined;
  return { kind: user.username === "admin" ? "HUMAN_ADMIN" : "AUTHENTICATED_HUMAN", id: user.id };
}

export type AgentProvisioningRouteDeps = Readonly<{ requireAuth: MiddlewareHandler; provisioning: AgentProvisioning; resolveActor?: (c: Context) => InventoryActor | undefined }>;
export function registerAgentProvisioningRoutes(app: Hono<any>, deps: AgentProvisioningRouteDeps) {
  const fixedAuth: MiddlewareHandler = async (c, next) => {
    const result = await deps.requireAuth(c, next);
    if (result instanceof Response && result.status === 401) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    return result;
  };
  const noStore: MiddlewareHandler = async (c, next) => { c.header("Cache-Control", "no-store"); await next(); };
  app.use("/api/agents/provision", noStore);
  app.use("/api/agents/template-options", noStore);
  app.post("/api/agents/provision", fixedAuth, async c => {
    if (new URL(c.req.url).search) return error(c, "INVALID_REQUEST");
    const body = await readStrictBody(c, ProvisionAgentSchema); if (!body.ok) return error(c, body.code);
    const principal = deps.resolveActor?.(c) ?? actor(c); if (!principal) return error(c, "FORBIDDEN");
    try { return c.json(await deps.provisioning.create(deps.provisioning.toAgentCreation(body.value, principal), principal), 201); }
    catch (caught) { return error(c, caught instanceof AgentProvisioningError ? caught.code : "STORAGE_FAILURE"); }
  });
  app.get("/api/agents/template-options", fixedAuth, async c => {
    if (new URL(c.req.url).search || c.req.raw.body) return error(c, "INVALID_REQUEST");
    const principal = deps.resolveActor?.(c) ?? actor(c); if (!principal) return error(c, "FORBIDDEN");
    try { return c.json(ProvisioningTemplateOptionsSchema.parse(await deps.provisioning.templateOptions(principal))); } catch { return error(c, "STORAGE_FAILURE"); }
  });
}
