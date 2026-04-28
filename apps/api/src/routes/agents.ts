import type { Hono } from "hono";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync
} from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { desc, eq, isNull, or } from "drizzle-orm";
import type { EventBus } from "@orgops/event-bus";

type AgentsDeps = {
  orm: OrgOpsDrizzleDb;
  bus: EventBus<any>;
  PROJECT_ROOT: string;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  parseStringArraySafe: (input: string | null | undefined) => string[];
  getDefaultSoulPath: (agentName: string) => string;
  resolveWorkspacePath: (workspacePath: string) => string;
  insertEvent: (input: any) => any;
};

const AGENT_MEMORY_CONTEXT_MODES = new Set([
  "PER_CHANNEL_CROSS_CHANNEL",
  "FULL_CHANNEL_EVENTS",
  "OFF",
] as const);

export function registerAgentsRoutes(app: Hono<any>, deps: AgentsDeps) {
  const {
    orm,
    bus,
    PROJECT_ROOT,
    jsonResponse,
    parseStringArraySafe,
    getDefaultSoulPath,
    resolveWorkspacePath,
    insertEvent
  } = deps;
  const publishDashboardRefresh = (reason: string, meta?: Record<string, unknown>) => {
    bus.publish("org:dashboard", {
      type: "dashboard_refresh",
      topic: "org:dashboard",
      data: {
        reason,
        ...(meta ?? {})
      }
    });
  };
  const TEXT_EXTENSIONS = new Set([
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".xml",
    ".csv",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".swift",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".sh",
    ".bash",
    ".zsh",
    ".env",
    ".ini",
    ".toml",
    ".sql",
    ".css",
    ".scss",
    ".html",
    ".htm",
    ".log"
  ]);

  function toPosixPath(pathValue: string) {
    return pathValue.split(sep).join("/");
  }

  function isWithinDirectory(targetPath: string, basePath: string) {
    if (targetPath === basePath) return true;
    return targetPath.startsWith(`${basePath}${sep}`);
  }

  function resolveAgentWorkspacePath(agentName: string) {
    const row = orm
      .select({
        workspacePath: schema.agents.workspace_path
      })
      .from(schema.agents)
      .where(eq(schema.agents.name, agentName))
      .get() as { workspacePath: string } | undefined;
    if (!row) {
      return { error: "Not found", status: 404 as const };
    }
    const workspacePath = resolveWorkspacePath(row.workspacePath ?? "");
    if (!workspacePath.trim()) {
      return { error: "Workspace path is not configured", status: 400 as const };
    }
    return { workspacePath };
  }

  function resolveSafeWorkspaceTarget(
    workspacePath: string,
    relativePathInput: string | null
  ) {
    const relativePathValue = (relativePathInput ?? "").trim();
    const targetPath = resolve(
      workspacePath,
      relativePathValue ? relativePathValue : "."
    );
    if (!isWithinDirectory(targetPath, workspacePath)) {
      return { error: "Invalid workspace path", status: 400 as const };
    }
    return {
      targetPath,
      relativePath: toPosixPath(relative(workspacePath, targetPath))
    };
  }

  function canPreviewAsText(pathValue: string) {
    const extension = extname(pathValue).toLowerCase();
    if (TEXT_EXTENSIONS.has(extension)) {
      return true;
    }
    const fileName = basename(pathValue).toLowerCase();
    if (fileName === "dockerfile" || fileName === "makefile") {
      return true;
    }
    return false;
  }

  function isTextBuffer(buffer: Buffer) {
    const sample = buffer.subarray(0, 4096);
    for (const byte of sample) {
      if (byte === 0) return false;
    }
    return true;
  }

  function parseOptionalPositiveInt(
    value: unknown
  ): { ok: true; value: number | null } | { ok: false; error: string } {
    if (value === undefined) return { ok: true, value: null };
    if (value === null) return { ok: true, value: null };
    if (typeof value === "string" && !value.trim()) return { ok: true, value: null };
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { ok: false, error: "must be a positive integer when provided" };
    }
    return { ok: true, value: Math.floor(parsed) };
  }

  function parseMemoryContextMode(
    value: unknown,
    fallback: string
  ): { ok: true; value: string } | { ok: false; error: string } {
    if (value === undefined || value === null) {
      return { ok: true, value: fallback };
    }
    const normalized = String(value).trim().toUpperCase();
    if (AGENT_MEMORY_CONTEXT_MODES.has(normalized as any)) {
      return { ok: true, value: normalized };
    }
    return {
      ok: false,
      error:
        "memoryContextMode must be one of PER_CHANNEL_CROSS_CHANNEL, FULL_CHANNEL_EVENTS, OFF"
    };
  }

  function parseJsonRecordSafe(input: string | null | undefined): Record<string, unknown> | null {
    if (!input) return null;
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  app.get("/api/agents", (c) => {
    const url = new URL(c.req.url);
    const assignedRunnerId = (url.searchParams.get("assignedRunnerId") ?? "").trim();
    const includeUnassigned = url.searchParams.get("includeUnassigned") === "1";
    const rows = assignedRunnerId
      ? (orm
          .select()
          .from(schema.agents)
          .where(
            includeUnassigned
              ? or(
                  eq(schema.agents.assigned_runner_id, assignedRunnerId),
                  isNull(schema.agents.assigned_runner_id),
                )
              : eq(schema.agents.assigned_runner_id, assignedRunnerId),
          )
          .all() as any[])
      : (orm.select().from(schema.agents).all() as any[]);
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
        soulContents: row.soul_contents ?? "",
        enabledSkills: parseStringArraySafe(row.enabled_skills_json),
        alwaysPreloadedSkills: parseStringArraySafe(row.always_preloaded_skills_json),
        workspacePath: row.workspace_path,
        allowOutsideWorkspace: Boolean(row.allow_outside_workspace),
        llmCallTimeoutMs: row.llm_call_timeout_ms ?? null,
        classicMaxModelSteps: row.classic_max_model_steps ?? null,
        contextSessionGapMs: row.context_session_gap_ms ?? null,
        emitAuditEvents: Boolean(row.emit_audit_events ?? 1),
        memoryContextMode: row.memory_context_mode ?? "PER_CHANNEL_CROSS_CHANNEL",
        mode: row.mode ?? "CLASSIC",
        assignedRunnerId: row.assigned_runner_id ?? null,
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
    const assignedRunnerId =
      typeof body.assignedRunnerId === "string" && body.assignedRunnerId.trim()
        ? body.assignedRunnerId.trim()
        : null;
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
    const enabledSkills: string[] = Array.isArray(body.enabledSkills)
      ? body.enabledSkills.filter((item: unknown): item is string => typeof item === "string")
      : [];
    const alwaysPreloadedSkills: string[] = Array.isArray(body.alwaysPreloadedSkills)
      ? body.alwaysPreloadedSkills.filter(
          (item: unknown): item is string => typeof item === "string"
        )
      : [];
    const alwaysPreloadedSkillsSet = new Set(alwaysPreloadedSkills);
    const sanitizedAlwaysPreloadedSkills = enabledSkills.filter((name: string) =>
      alwaysPreloadedSkillsSet.has(name)
    );
    const allowOutsideWorkspace = Boolean(body.allowOutsideWorkspace);
    const llmCallTimeoutParsed = parseOptionalPositiveInt(body.llmCallTimeoutMs);
    if (!llmCallTimeoutParsed.ok) {
      return jsonResponse(c, { error: `llmCallTimeoutMs ${llmCallTimeoutParsed.error}` }, 400);
    }
    const classicMaxModelStepsParsed = parseOptionalPositiveInt(body.classicMaxModelSteps);
    if (!classicMaxModelStepsParsed.ok) {
      return jsonResponse(
        c,
        { error: `classicMaxModelSteps ${classicMaxModelStepsParsed.error}` },
        400
      );
    }
    const contextSessionGapParsed = parseOptionalPositiveInt(body.contextSessionGapMs);
    if (!contextSessionGapParsed.ok) {
      return jsonResponse(
        c,
        { error: `contextSessionGapMs ${contextSessionGapParsed.error}` },
        400
      );
    }
    const memoryContextModeParsed = parseMemoryContextMode(
      body.memoryContextMode,
      "PER_CHANNEL_CROSS_CHANNEL"
    );
    if (!memoryContextModeParsed.ok) {
      return jsonResponse(c, { error: memoryContextModeParsed.error }, 400);
    }
    const emitAuditEvents =
      body.emitAuditEvents === undefined ? true : Boolean(body.emitAuditEvents);
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
        soul_contents: soulContents,
        workspace_path: workspacePath,
        allow_outside_workspace: allowOutsideWorkspace ? 1 : 0,
        llm_call_timeout_ms: llmCallTimeoutParsed.value,
        classic_max_model_steps: classicMaxModelStepsParsed.value,
        context_session_gap_ms: contextSessionGapParsed.value,
        emit_audit_events: emitAuditEvents ? 1 : 0,
        memory_context_mode: memoryContextModeParsed.value,
        mode:
          typeof body.mode === "string" && body.mode.trim()
            ? body.mode.trim()
            : "CLASSIC",
        assigned_runner_id: assignedRunnerId,
        enabled_skills_json: JSON.stringify(enabledSkills),
        always_preloaded_skills_json: JSON.stringify(sanitizedAlwaysPreloadedSkills),
        desired_state: body.desiredState ?? "RUNNING",
        runtime_state: body.runtimeState ?? "STOPPED",
        created_at: now,
        updated_at: now
      })
      .run();
    publishDashboardRefresh("agent.created", { agentName: body.name });
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
      soulContents: row.soul_contents ?? "",
      enabledSkills: parseStringArraySafe(row.enabled_skills_json),
      alwaysPreloadedSkills: parseStringArraySafe(row.always_preloaded_skills_json),
      workspacePath: row.workspace_path,
      allowOutsideWorkspace: Boolean(row.allow_outside_workspace),
      llmCallTimeoutMs: row.llm_call_timeout_ms ?? null,
      classicMaxModelSteps: row.classic_max_model_steps ?? null,
      contextSessionGapMs: row.context_session_gap_ms ?? null,
      emitAuditEvents: Boolean(row.emit_audit_events ?? 1),
      memoryContextMode: row.memory_context_mode ?? "PER_CHANNEL_CROSS_CHANNEL",
      mode: row.mode ?? "CLASSIC",
      assignedRunnerId: row.assigned_runner_id ?? null,
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
    const enabledSkillsJson = Array.isArray(body.enabledSkills)
      ? JSON.stringify(body.enabledSkills.filter((item: unknown): item is string => typeof item === "string"))
      : null;
    const resolvedEnabledSkills = enabledSkillsJson
      ? parseStringArraySafe(enabledSkillsJson)
      : parseStringArraySafe(existing.enabled_skills_json);
    const alwaysPreloadedSkillsJson = Array.isArray(body.alwaysPreloadedSkills)
      ? JSON.stringify(
          body.alwaysPreloadedSkills.filter((item: unknown): item is string => typeof item === "string")
        )
      : null;
    const alwaysPreloadedSkills = alwaysPreloadedSkillsJson
      ? parseStringArraySafe(alwaysPreloadedSkillsJson)
      : parseStringArraySafe(existing.always_preloaded_skills_json);
    const alwaysPreloadedSkillSet = new Set(alwaysPreloadedSkills);
    const sanitizedAlwaysPreloadedSkillsJson = JSON.stringify(
      resolvedEnabledSkills.filter((name) => alwaysPreloadedSkillSet.has(name))
    );
    const allowOutsideWorkspace =
      body.allowOutsideWorkspace !== undefined
        ? (body.allowOutsideWorkspace ? 1 : 0)
        : null;
    const llmCallTimeoutParsed =
      body.llmCallTimeoutMs !== undefined
        ? parseOptionalPositiveInt(body.llmCallTimeoutMs)
        : null;
    if (llmCallTimeoutParsed && !llmCallTimeoutParsed.ok) {
      return jsonResponse(c, { error: `llmCallTimeoutMs ${llmCallTimeoutParsed.error}` }, 400);
    }
    const classicMaxModelStepsParsed =
      body.classicMaxModelSteps !== undefined
        ? parseOptionalPositiveInt(body.classicMaxModelSteps)
        : null;
    if (classicMaxModelStepsParsed && !classicMaxModelStepsParsed.ok) {
      return jsonResponse(
        c,
        { error: `classicMaxModelSteps ${classicMaxModelStepsParsed.error}` },
        400
      );
    }
    const contextSessionGapParsed =
      body.contextSessionGapMs !== undefined
        ? parseOptionalPositiveInt(body.contextSessionGapMs)
        : null;
    if (contextSessionGapParsed && !contextSessionGapParsed.ok) {
      return jsonResponse(
        c,
        { error: `contextSessionGapMs ${contextSessionGapParsed.error}` },
        400
      );
    }
    const memoryContextModeParsed =
      body.memoryContextMode !== undefined
        ? parseMemoryContextMode(
            body.memoryContextMode,
            existing.memory_context_mode ?? "PER_CHANNEL_CROSS_CHANNEL"
          )
        : null;
    if (memoryContextModeParsed && !memoryContextModeParsed.ok) {
      return jsonResponse(c, { error: memoryContextModeParsed.error }, 400);
    }
    const emitAuditEvents =
      body.emitAuditEvents !== undefined ? (body.emitAuditEvents ? 1 : 0) : null;
    const assignedRunnerId =
      body.assignedRunnerId !== undefined
        ? typeof body.assignedRunnerId === "string" && body.assignedRunnerId.trim()
          ? body.assignedRunnerId.trim()
          : null
        : undefined;
    orm
      .update(schema.agents)
      .set({
        icon: body.icon ?? existing.icon,
        description: body.description ?? existing.description,
        model_id: body.modelId ?? existing.model_id,
        system_instructions: body.systemInstructions ?? existing.system_instructions,
        soul_path: soulPath ?? existing.soul_path,
        soul_contents:
          typeof body.soulContents === "string"
            ? body.soulContents
            : existing.soul_contents,
        workspace_path: workspacePath,
        allow_outside_workspace:
          allowOutsideWorkspace ?? existing.allow_outside_workspace,
        llm_call_timeout_ms:
          llmCallTimeoutParsed ? llmCallTimeoutParsed.value : existing.llm_call_timeout_ms,
        classic_max_model_steps:
          classicMaxModelStepsParsed
            ? classicMaxModelStepsParsed.value
            : existing.classic_max_model_steps,
        context_session_gap_ms:
          contextSessionGapParsed
            ? contextSessionGapParsed.value
            : existing.context_session_gap_ms,
        emit_audit_events: emitAuditEvents ?? existing.emit_audit_events,
        memory_context_mode:
          memoryContextModeParsed
            ? memoryContextModeParsed.value
            : existing.memory_context_mode,
        mode:
          typeof body.mode === "string" && body.mode.trim()
            ? body.mode.trim()
            : existing.mode,
        assigned_runner_id:
          assignedRunnerId !== undefined
            ? assignedRunnerId
            : existing.assigned_runner_id,
        enabled_skills_json: enabledSkillsJson ?? existing.enabled_skills_json,
        always_preloaded_skills_json: sanitizedAlwaysPreloadedSkillsJson,
        desired_state: body.desiredState ?? existing.desired_state,
        runtime_state: body.runtimeState ?? existing.runtime_state,
        last_heartbeat_at: body.lastHeartbeatAt ?? existing.last_heartbeat_at,
        updated_at: Date.now()
      })
      .where(eq(schema.agents.name, name))
      .run();
    publishDashboardRefresh("agent.updated", { agentName: name });
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
    publishDashboardRefresh(`agent.control.${action}`, { agentName: name });
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

  app.get("/api/agents/:name/debug/system-prompt", (c) => {
    const name = c.req.param("name");
    const promptEvents = orm
      .select({
        id: schema.events.id,
        channelId: schema.events.channel_id,
        createdAt: schema.events.created_at,
        payloadJson: schema.events.payload_json
      })
      .from(schema.events)
      .where(eq(schema.events.type, "telemetry.prompt.composed"))
      .orderBy(desc(schema.events.created_at))
      .limit(5000)
      .all() as Array<{
      id: string;
      channelId?: string | null;
      createdAt: number;
      payloadJson: string;
    }>;
    const matching = promptEvents.find((event) => {
      const payload = parseJsonRecordSafe(event.payloadJson);
      return payload?.agentName === name;
    });
    if (!matching) {
      return jsonResponse(c, {
        found: false,
        error:
          "No composed prompt found yet for this agent. Wait for the agent to process at least one event."
      });
    }
    const payload = parseJsonRecordSafe(matching.payloadJson) ?? {};
    const messagesRaw = Array.isArray(payload.messages) ? payload.messages : [];
    const messages = messagesRaw
      .map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
        const record = entry as Record<string, unknown>;
        return {
          role: typeof record.role === "string" ? record.role : "unknown",
          content: typeof record.content === "string" ? record.content : ""
        };
      })
      .filter((entry): entry is { role: string; content: string } => Boolean(entry));
    const promptText = messages
      .map((message, index) => `--- ${index + 1}. ${message.role.toUpperCase()} ---\n${message.content}`)
      .join("\n\n");
    return jsonResponse(c, {
      found: true,
      eventId: matching.id,
      createdAt: matching.createdAt,
      channelId: matching.channelId ?? null,
      modelId: typeof payload.modelId === "string" ? payload.modelId : null,
      triggerEventId:
        typeof payload.triggerEventId === "string" ? payload.triggerEventId : null,
      promptText,
      messages
    });
  });

  app.get("/api/agents/:name/workspace", (c) => {
    const name = c.req.param("name");
    const workspaceResult = resolveAgentWorkspacePath(name);
    if ("error" in workspaceResult) {
      return jsonResponse(c, { error: workspaceResult.error }, workspaceResult.status);
    }
    const workspacePath = workspaceResult.workspacePath;
    mkdirSync(workspacePath, { recursive: true });

    const url = new URL(c.req.url);
    const relativePathInput = url.searchParams.get("path");
    const resolvedTarget = resolveSafeWorkspaceTarget(workspacePath, relativePathInput);
    if ("error" in resolvedTarget) {
      return jsonResponse(c, { error: resolvedTarget.error }, resolvedTarget.status);
    }

    const stat = statSync(resolvedTarget.targetPath, { throwIfNoEntry: false });
    if (!stat) {
      return jsonResponse(c, { error: "Path not found" }, 404);
    }
    if (!stat.isDirectory()) {
      return jsonResponse(c, { error: "Path is not a directory" }, 400);
    }

    const entries = readdirSync(resolvedTarget.targetPath, { withFileTypes: true })
      .map((entry) => {
        const absolutePath = resolve(resolvedTarget.targetPath, entry.name);
        const entryStat = statSync(absolutePath, { throwIfNoEntry: false });
        const relativePath = toPosixPath(relative(workspacePath, absolutePath));
        const extension = entry.isDirectory() ? "" : extname(entry.name).toLowerCase();
        const isTextFile = !entry.isDirectory() && canPreviewAsText(entry.name);
        return {
          name: entry.name,
          path: relativePath,
          kind: entry.isDirectory() ? "directory" : "file",
          extension,
          size: entryStat?.size ?? null,
          modifiedAt: entryStat?.mtimeMs ?? null,
          isTextFile
        };
      })
      .sort((left, right) => {
        if (left.kind === right.kind) {
          return left.name.localeCompare(right.name);
        }
        return left.kind === "directory" ? -1 : 1;
      });

    return jsonResponse(c, {
      workspacePath,
      path: resolvedTarget.relativePath === "" ? "." : resolvedTarget.relativePath,
      entries
    });
  });

  app.get("/api/agents/:name/workspace/file", (c) => {
    const name = c.req.param("name");
    const workspaceResult = resolveAgentWorkspacePath(name);
    if ("error" in workspaceResult) {
      return jsonResponse(c, { error: workspaceResult.error }, workspaceResult.status);
    }
    const workspacePath = workspaceResult.workspacePath;
    const url = new URL(c.req.url);
    const relativePathInput = url.searchParams.get("path");
    if (!relativePathInput?.trim()) {
      return jsonResponse(c, { error: "path query parameter is required" }, 400);
    }

    const resolvedTarget = resolveSafeWorkspaceTarget(workspacePath, relativePathInput);
    if ("error" in resolvedTarget) {
      return jsonResponse(c, { error: resolvedTarget.error }, resolvedTarget.status);
    }
    const stat = statSync(resolvedTarget.targetPath, { throwIfNoEntry: false });
    if (!stat) {
      return jsonResponse(c, { error: "Path not found" }, 404);
    }
    if (!stat.isFile()) {
      return jsonResponse(c, { error: "Path is not a file" }, 400);
    }

    const bytes = readFileSync(resolvedTarget.targetPath);
    if (!canPreviewAsText(resolvedTarget.targetPath) || !isTextBuffer(bytes)) {
      return jsonResponse(c, { error: "File is binary and cannot be previewed" }, 415);
    }

    return jsonResponse(c, {
      path: resolvedTarget.relativePath,
      name: basename(resolvedTarget.targetPath),
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      content: bytes.toString("utf-8")
    });
  });

  app.get("/api/agents/:name/workspace/download", (c) => {
    const name = c.req.param("name");
    const workspaceResult = resolveAgentWorkspacePath(name);
    if ("error" in workspaceResult) {
      return jsonResponse(c, { error: workspaceResult.error }, workspaceResult.status);
    }
    const workspacePath = workspaceResult.workspacePath;
    const url = new URL(c.req.url);
    const relativePathInput = url.searchParams.get("path");
    if (!relativePathInput?.trim()) {
      return jsonResponse(c, { error: "path query parameter is required" }, 400);
    }

    const resolvedTarget = resolveSafeWorkspaceTarget(workspacePath, relativePathInput);
    if ("error" in resolvedTarget) {
      return jsonResponse(c, { error: resolvedTarget.error }, resolvedTarget.status);
    }
    const stat = statSync(resolvedTarget.targetPath, { throwIfNoEntry: false });
    if (!stat) {
      return jsonResponse(c, { error: "Path not found" }, 404);
    }
    if (!stat.isFile()) {
      return jsonResponse(c, { error: "Path is not a file" }, 400);
    }

    const bytes = readFileSync(resolvedTarget.targetPath);
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${basename(resolvedTarget.targetPath)}"`
      }
    });
  });
}
