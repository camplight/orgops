import type { Hono } from "hono";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { eq } from "drizzle-orm";
import type { EventBus } from "@orgops/event-bus";

type AgentsDeps = {
  orm: OrgOpsDrizzleDb;
  bus: EventBus<any>;
  PROJECT_ROOT: string;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  parseStringArraySafe: (input: string | null | undefined) => string[];
  getDefaultSoulPath: (agentName: string) => string;
  resolveWorkspacePath: (workspacePath: string) => string;
  loadSoulContents: (path: string | null | undefined) => string;
  writeSoulContents: (path: string, contents: string) => void;
  insertEvent: (input: any) => any;
};

export function registerAgentsRoutes(app: Hono<any>, deps: AgentsDeps) {
  const {
    orm,
    bus,
    PROJECT_ROOT,
    jsonResponse,
    parseStringArraySafe,
    getDefaultSoulPath,
    resolveWorkspacePath,
    loadSoulContents,
    writeSoulContents,
    insertEvent
  } = deps;

  app.get("/api/agents", (c) => {
    const rows = orm.select().from(schema.agents).all() as any[];
    return jsonResponse(
      c,
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        icon: row.icon,
        description: row.description,
        modelId: row.model_id,
        systemInstructions: row.system_instructions,
        soulPath: row.soul_path,
        soulContents: loadSoulContents(row.soul_path),
        enabledSkills: parseStringArraySafe(row.enabled_skills_json),
        workspacePath: row.workspace_path,
        desiredState: row.desired_state,
        runtimeState: row.runtime_state,
        lastHeartbeatAt: row.last_heartbeat_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    );
  });

  app.post("/api/agents", async (c) => {
    const body = await c.req.json();
    const id = randomUUID();
    const now = Date.now();
    const soulPath =
      typeof body.soulPath === "string" && body.soulPath.trim()
        ? body.soulPath.trim()
        : getDefaultSoulPath(body.name);
    const workspacePath = resolveWorkspacePath(String(body.workspacePath ?? ""));
    if (!workspacePath.trim()) {
      return jsonResponse(c, { error: "workspacePath is required" }, 400);
    }
    const soulContents = typeof body.soulContents === "string" ? body.soulContents : "";
    writeSoulContents(soulPath, soulContents);
    const enabledSkills = Array.isArray(body.enabledSkills)
      ? body.enabledSkills.filter((item: unknown): item is string => typeof item === "string")
      : [];
    orm
      .insert(schema.agents)
      .values({
        id,
        name: body.name,
        icon: body.icon ?? null,
        description: body.description ?? null,
        model_id: body.modelId,
        system_instructions: body.systemInstructions ?? "",
        soul_path: soulPath,
        workspace_path: workspacePath,
        enabled_skills_json: JSON.stringify(enabledSkills),
        desired_state: body.desiredState ?? "RUNNING",
        runtime_state: body.runtimeState ?? "STOPPED",
        created_at: now,
        updated_at: now
      })
      .run();
    return jsonResponse(c, { id }, 201);
  });

  app.get("/api/agents/:name", (c) => {
    const name = c.req.param("name");
    const row = orm.select().from(schema.agents).where(eq(schema.agents.name, name)).get() as any;
    if (!row) return jsonResponse(c, { error: "Not found" }, 404);
    return jsonResponse(c, {
      id: row.id,
      name: row.name,
      icon: row.icon,
      description: row.description,
      modelId: row.model_id,
      systemInstructions: row.system_instructions,
      soulPath: row.soul_path,
      soulContents: loadSoulContents(row.soul_path),
      enabledSkills: parseStringArraySafe(row.enabled_skills_json),
      workspacePath: row.workspace_path,
      desiredState: row.desired_state,
      runtimeState: row.runtime_state,
      lastHeartbeatAt: row.last_heartbeat_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  });

  app.patch("/api/agents/:name", async (c) => {
    const name = c.req.param("name");
    const body = await c.req.json();
    const existing = orm.select().from(schema.agents).where(eq(schema.agents.name, name)).get() as any;
    if (!existing) return jsonResponse(c, { error: "Not found" }, 404);
    const soulPath =
      typeof body.soulPath === "string" && body.soulPath.trim()
        ? body.soulPath.trim()
        : (existing.soul_path as string);
    const workspacePath =
      body.workspacePath !== undefined
        ? resolveWorkspacePath(String(body.workspacePath))
        : (existing.workspace_path as string);
    if (typeof body.soulContents === "string") {
      writeSoulContents(soulPath, body.soulContents);
    }
    const enabledSkillsJson = Array.isArray(body.enabledSkills)
      ? JSON.stringify(body.enabledSkills.filter((item: unknown): item is string => typeof item === "string"))
      : null;
    orm
      .update(schema.agents)
      .set({
        icon: body.icon ?? existing.icon,
        description: body.description ?? existing.description,
        model_id: body.modelId ?? existing.model_id,
        system_instructions: body.systemInstructions ?? existing.system_instructions,
        soul_path: soulPath ?? existing.soul_path,
        workspace_path: workspacePath,
        enabled_skills_json: enabledSkillsJson ?? existing.enabled_skills_json,
        desired_state: body.desiredState ?? existing.desired_state,
        runtime_state: body.runtimeState ?? existing.runtime_state,
        last_heartbeat_at: body.lastHeartbeatAt ?? existing.last_heartbeat_at,
        updated_at: Date.now()
      })
      .where(eq(schema.agents.name, name))
      .run();
    if (body.runtimeState) {
      bus.publish("org:agentStatus", {
        type: "agent_status",
        topic: "org:agentStatus",
        data: { agentName: name, runtimeState: body.runtimeState }
      });
    }
    return jsonResponse(c, { ok: true });
  });

  app.post("/api/agents/:name/:action", (c) => {
    const name = c.req.param("name");
    const action = c.req.param("action");
    if (!["start", "stop", "restart", "reload-skills", "cleanup-workspace"].includes(action)) {
      return jsonResponse(c, { error: "Invalid action" }, 400);
    }
    if (action === "cleanup-workspace") {
      const agent = orm
        .select({ workspace_path: schema.agents.workspace_path })
        .from(schema.agents)
        .where(eq(schema.agents.name, name))
        .get() as { workspace_path: string } | undefined;
      if (!agent) return jsonResponse(c, { error: "Not found" }, 404);

      const workspacePath = agent.workspace_path;
      if (!workspacePath || !workspacePath.trim()) {
        return jsonResponse(c, { error: "Workspace path is not configured" }, 400);
      }

      const resolvedWorkspacePath = resolveWorkspacePath(workspacePath);
      if (resolvedWorkspacePath === resolve("/") || resolvedWorkspacePath === resolve(PROJECT_ROOT)) {
        return jsonResponse(c, { error: "Refusing to clean unsafe workspace path" }, 400);
      }

      rmSync(resolvedWorkspacePath, { recursive: true, force: true });
      mkdirSync(resolvedWorkspacePath, { recursive: true });
      insertEvent({
        type: "audit.workspace.cleaned",
        payload: { agentName: name, workspacePath: resolvedWorkspacePath },
        source: "system"
      });
      return jsonResponse(c, { ok: true });
    }
    const desiredState = action === "stop" ? "STOPPED" : "RUNNING";
    const runtimeState = action === "stop" ? "STOPPED" : action === "start" || action === "restart" ? "STARTING" : null;
    orm
      .update(schema.agents)
      .set({
        desired_state: desiredState,
        runtime_state: runtimeState ?? undefined,
        updated_at: Date.now()
      })
      .where(eq(schema.agents.name, name))
      .run();
    if (runtimeState) {
      bus.publish("org:agentStatus", {
        type: "agent_status",
        topic: "org:agentStatus",
        data: { agentName: name, runtimeState }
      });
    }
    insertEvent({
      type: `agent.control.${action}`,
      payload: { agentName: name },
      source: "system"
    });
    return jsonResponse(c, { ok: true });
  });
}
