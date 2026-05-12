import { z } from "zod";
import type { ExecuteContext, ToolDef } from "./types";

const agentModeSchema = z.enum(["CLASSIC", "RLM_REPL", "WRAPPED"]);
const desiredStateSchema = z.enum(["RUNNING", "STOPPED"]);
const runtimeStateSchema = z.enum(["STARTING", "RUNNING", "STOPPED", "CRASHED"]);
const memoryContextModeSchema = z.enum([
  "PER_CHANNEL_CROSS_CHANNEL",
  "FULL_CHANNEL_EVENTS",
  "OFF",
]);

const agentsSearchSchema = z.object({
  nameContains: z.string().min(1).optional(),
  runtimeState: runtimeStateSchema.optional(),
  desiredState: desiredStateSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const agentsCreateSchema = z.object({
  name: z.string().min(1),
  icon: z.string().optional(),
  description: z.string().optional(),
  modelId: z.string().min(1).optional(),
  systemInstructions: z.string().optional(),
  soulPath: z.string().min(1).optional(),
  soulContents: z.string().optional(),
  enabledSkills: z.array(z.string()).optional(),
  alwaysPreloadedSkills: z.array(z.string()).optional(),
  workspacePath: z.string().min(1).optional(),
  allowOutsideWorkspace: z.boolean().optional(),
  llmCallTimeoutMs: z.number().int().positive().nullable().optional(),
  classicMaxModelSteps: z.number().int().positive().nullable().optional(),
  contextSessionGapMs: z.number().int().positive().nullable().optional(),
  emitAuditEvents: z.boolean().optional(),
  memoryContextMode: memoryContextModeSchema.optional(),
  mode: agentModeSchema.optional(),
  wrappedConfig: z.record(z.unknown()).optional(),
  assignedRunnerId: z.string().optional(),
  desiredState: desiredStateSchema.optional(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
  joinChannelId: z.string().min(1).optional(),
  joinCurrentChannel: z.boolean().optional(),
});

const agentsUpdateSchema = z
  .object({
    agentName: z.string().min(1),
    icon: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    modelId: z.string().min(1).optional(),
    systemInstructions: z.string().optional(),
    soulPath: z.string().min(1).optional(),
    soulContents: z.string().optional(),
    enabledSkills: z.array(z.string()).optional(),
    alwaysPreloadedSkills: z.array(z.string()).optional(),
    workspacePath: z.string().min(1).optional(),
    allowOutsideWorkspace: z.boolean().optional(),
    llmCallTimeoutMs: z.number().int().positive().nullable().optional(),
    classicMaxModelSteps: z.number().int().positive().nullable().optional(),
    contextSessionGapMs: z.number().int().positive().nullable().optional(),
    emitAuditEvents: z.boolean().optional(),
    memoryContextMode: memoryContextModeSchema.optional(),
    mode: agentModeSchema.optional(),
    wrappedConfig: z.record(z.unknown()).optional(),
    wrappedConfigJson: z.string().min(2).optional(),
    assignedRunnerId: z.string().nullable().optional(),
    desiredState: desiredStateSchema.optional(),
    runtimeState: runtimeStateSchema.optional(),
    visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
  })
  .superRefine((value, ctx) => {
    const updateKeys = Object.keys(value).filter(
      (key) => key !== "agentName" && value[key as keyof typeof value] !== undefined,
    );
    if (updateKeys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one agent field to update.",
      });
    }
    if (value.wrappedConfig !== undefined && value.wrappedConfigJson !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["wrappedConfigJson"],
        message: "Use either wrappedConfig or wrappedConfigJson, not both.",
      });
    }
  });

export const agentsToolDefs: ToolDef[] = [
  [
    "agents_create",
    "Create an OrgOps agent. Defaults workspacePath to .orgops-data/workspaces/<name>, modelId to this agent's model for CLASSIC agents, and assignedRunnerId to this agent's runner when available. Optionally join the new agent to a channel.",
    agentsCreateSchema,
  ],
  [
    "agents_search",
    "List/search agents with optional filters by name/runtime/desired state.",
    agentsSearchSchema,
  ],
  [
    "agents_update",
    "Update an existing OrgOps agent via the agent API. Use wrappedConfig for object input or wrappedConfigJson for a JSON string when patching wrapped runtime config.",
    agentsUpdateSchema,
  ],
];

function formatZodIssues(error: z.ZodError) {
  return error.issues
    .slice(0, 6)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function parseToolArgs<T>(
  tool: string,
  schema: z.ZodType<T>,
  args: Record<string, unknown>,
): { ok: true; data: T } | { ok: false; error: string } {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Invalid arguments for ${tool}: ${formatZodIssues(parsed.error)}`,
    };
  }
  return { ok: true, data: parsed.data };
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseWrappedConfigJson(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("wrappedConfigJson must parse to a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export async function execute(
  ctx: ExecuteContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (tool === "agents_search") {
    const parsedResult = parseToolArgs(tool, agentsSearchSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const response = await ctx.apiFetch("/api/agents");
    const agents = (await response.json()) as Array<{
      name: string;
      runtimeState?: string;
      desiredState?: string;
      modelId?: string;
      description?: string | null;
      enabledSkills?: string[];
      workspacePath?: string;
      lastHeartbeatAt?: number | null;
    }>;
    const nameContains = parsed.nameContains?.toLowerCase();
    const filtered = agents.filter((agent) => {
      if (nameContains && !agent.name.toLowerCase().includes(nameContains)) return false;
      if (parsed.runtimeState && agent.runtimeState !== parsed.runtimeState) return false;
      if (parsed.desiredState && agent.desiredState !== parsed.desiredState) return false;
      return true;
    });
    const limited = parsed.limit ? filtered.slice(0, parsed.limit) : filtered;
    return { agents: limited, totalMatched: filtered.length, filters: parsed };
  }

  if (tool === "agents_update") {
    const parsedResult = parseToolArgs(tool, agentsUpdateSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const agentName = parsed.agentName.trim();
    let wrappedConfigFromJson: Record<string, unknown> | undefined;
    if (parsed.wrappedConfigJson !== undefined) {
      try {
        wrappedConfigFromJson = parseWrappedConfigJson(parsed.wrappedConfigJson);
      } catch (error) {
        return { error: String(error) };
      }
    }

    const updateBody: Record<string, unknown> = {
      ...(parsed.icon !== undefined ? { icon: parsed.icon } : {}),
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      ...(parsed.modelId !== undefined ? { modelId: parsed.modelId.trim() } : {}),
      ...(parsed.systemInstructions !== undefined
        ? { systemInstructions: parsed.systemInstructions }
        : {}),
      ...(parsed.soulPath !== undefined ? { soulPath: parsed.soulPath.trim() } : {}),
      ...(parsed.soulContents !== undefined ? { soulContents: parsed.soulContents } : {}),
      ...(parsed.enabledSkills !== undefined ? { enabledSkills: parsed.enabledSkills } : {}),
      ...(parsed.alwaysPreloadedSkills !== undefined
        ? { alwaysPreloadedSkills: parsed.alwaysPreloadedSkills }
        : {}),
      ...(parsed.workspacePath !== undefined ? { workspacePath: parsed.workspacePath.trim() } : {}),
      ...(parsed.allowOutsideWorkspace !== undefined
        ? { allowOutsideWorkspace: parsed.allowOutsideWorkspace }
        : {}),
      ...(parsed.llmCallTimeoutMs !== undefined
        ? { llmCallTimeoutMs: parsed.llmCallTimeoutMs }
        : {}),
      ...(parsed.classicMaxModelSteps !== undefined
        ? { classicMaxModelSteps: parsed.classicMaxModelSteps }
        : {}),
      ...(parsed.contextSessionGapMs !== undefined
        ? { contextSessionGapMs: parsed.contextSessionGapMs }
        : {}),
      ...(parsed.emitAuditEvents !== undefined ? { emitAuditEvents: parsed.emitAuditEvents } : {}),
      ...(parsed.memoryContextMode !== undefined
        ? { memoryContextMode: parsed.memoryContextMode }
        : {}),
      ...(parsed.mode !== undefined ? { mode: parsed.mode } : {}),
      ...(parsed.wrappedConfig !== undefined ? { wrappedConfig: parsed.wrappedConfig } : {}),
      ...(wrappedConfigFromJson !== undefined ? { wrappedConfig: wrappedConfigFromJson } : {}),
      ...(parsed.assignedRunnerId !== undefined
        ? { assignedRunnerId: trimOptional(parsed.assignedRunnerId ?? undefined) ?? null }
        : {}),
      ...(parsed.desiredState !== undefined ? { desiredState: parsed.desiredState } : {}),
      ...(parsed.runtimeState !== undefined ? { runtimeState: parsed.runtimeState } : {}),
      ...(parsed.visibility !== undefined ? { visibility: parsed.visibility } : {}),
    };

    const response = await ctx.apiFetch(`/api/agents/${encodeURIComponent(agentName)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(updateBody),
    });
    const updated = await parseResponseBody(response);
    return { ok: true, agentName, updated };
  }

  if (tool === "agents_create") {
    const parsedResult = parseToolArgs(tool, agentsCreateSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const name = parsed.name.trim();
    const mode = parsed.mode ?? "CLASSIC";
    const modelId =
      trimOptional(parsed.modelId) ?? (mode === "WRAPPED" ? "wrapped:none" : ctx.agent.modelId);
    const workspacePath =
      trimOptional(parsed.workspacePath) ?? `.orgops-data/workspaces/${name}`;
    const assignedRunnerId =
      parsed.assignedRunnerId !== undefined
        ? trimOptional(parsed.assignedRunnerId) ?? ""
        : ctx.agent.assignedRunnerId ?? "";
    const memoryContextMode =
      parsed.memoryContextMode ?? (mode === "WRAPPED" ? "OFF" : undefined);
    const allowOutsideWorkspace =
      mode === "WRAPPED" ? false : parsed.allowOutsideWorkspace;

    const createBody: Record<string, unknown> = {
      name,
      modelId,
      workspacePath,
      mode,
      assignedRunnerId,
      runtimeState: "STOPPED",
      desiredState: parsed.desiredState ?? "RUNNING",
      ...(parsed.icon !== undefined ? { icon: parsed.icon } : {}),
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      ...(parsed.systemInstructions !== undefined
        ? { systemInstructions: parsed.systemInstructions }
        : {}),
      ...(parsed.soulPath !== undefined ? { soulPath: parsed.soulPath.trim() } : {}),
      ...(parsed.soulContents !== undefined ? { soulContents: parsed.soulContents } : {}),
      ...(parsed.enabledSkills !== undefined ? { enabledSkills: parsed.enabledSkills } : {}),
      ...(parsed.alwaysPreloadedSkills !== undefined
        ? { alwaysPreloadedSkills: parsed.alwaysPreloadedSkills }
        : {}),
      ...(allowOutsideWorkspace !== undefined
        ? { allowOutsideWorkspace }
        : {}),
      ...(parsed.llmCallTimeoutMs !== undefined
        ? { llmCallTimeoutMs: parsed.llmCallTimeoutMs }
        : {}),
      ...(parsed.classicMaxModelSteps !== undefined
        ? { classicMaxModelSteps: parsed.classicMaxModelSteps }
        : {}),
      ...(parsed.contextSessionGapMs !== undefined
        ? { contextSessionGapMs: parsed.contextSessionGapMs }
        : {}),
      ...(parsed.emitAuditEvents !== undefined
        ? { emitAuditEvents: parsed.emitAuditEvents }
        : {}),
      ...(memoryContextMode !== undefined ? { memoryContextMode } : {}),
      ...(parsed.wrappedConfig !== undefined ? { wrappedConfig: parsed.wrappedConfig } : {}),
      ...(parsed.visibility !== undefined ? { visibility: parsed.visibility } : {}),
    };

    const createResponse = await ctx.apiFetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createBody),
    });
    const created = await parseResponseBody(createResponse);

    const joinChannelId =
      trimOptional(parsed.joinChannelId) ??
      (parsed.joinCurrentChannel ? trimOptional(ctx.channelId) : undefined);
    let joinedChannel: { channelId: string; ok: true } | undefined;
    if (joinChannelId) {
      await ctx.apiFetch(`/api/channels/${encodeURIComponent(joinChannelId)}/subscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subscriberType: "AGENT",
          subscriberId: name,
        }),
      });
      joinedChannel = { channelId: joinChannelId, ok: true };
    }

    return {
      ok: true,
      agentName: name,
      workspacePath,
      assignedRunnerId: assignedRunnerId || null,
      mode,
      created,
      ...(joinedChannel ? { joinedChannel } : {}),
    };
  }

  return { error: `Unknown agents tool: ${tool}` };
}
