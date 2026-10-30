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

const agentsCopySchema = z.object({
  sourceAgentName: z.string().min(1),
  name: z.string().min(1),
  assignedRunnerId: z.string().nullable().optional(),
  workspacePath: z.string().min(1).optional(),
  desiredState: desiredStateSchema.optional(),
  copyChannelMemberships: z.boolean().optional(),
  federationInstanceId: z.string().min(1).optional(),
});

const agentsMoveSchema = z
  .object({
    agentName: z.string().min(1),
    assignedRunnerId: z.string().nullable().optional(),
    federationInstanceId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.federationInstanceId) return;
    if (value.assignedRunnerId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assignedRunnerId"],
        message: "assignedRunnerId is required for a local move; use null to unassign.",
      });
    }
  });

const publicationAuthTypeSchema = z.enum(["PUBLIC", "PASSWORD"]);

const agentsPublishWorkspaceSchema = z.object({
  agentName: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  publicPath: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  title: z.string().optional(),
  enabled: z.boolean().optional(),
  authType: publicationAuthTypeSchema.optional(),
  password: z.string().optional(),
});

const agentsUnpublishWorkspaceSchema = z.object({
  publicationId: z.string().min(1).optional(),
  agentName: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  publicPath: z.string().min(1).optional(),
});

const agentsListPublicationsSchema = z.object({
  agentName: z.string().min(1).optional(),
});

const agentsCreateIntegrationKeySchema = z.object({
  agentName: z.string().min(1).optional(),
  name: z.string().min(1),
});

const agentsCreateSchema = z.object({
  name: z.string().min(1),
  icon: z.string().optional(),
  description: z.string().optional(),
  modelId: z.string().min(1).optional(),
  soulContents: z.string().optional(),
  enabledSkills: z.array(z.string()).optional(),
  alwaysPreloadedSkills: z.array(z.string()).optional(),
  additionalSkillRoots: z.array(z.string()).optional(),
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
  allowOwnerHumanSecrets: z.boolean().optional(),
  ownerHumanId: z.string().min(1).nullable().optional(),
  joinChannelId: z.string().min(1).optional(),
  joinCurrentChannel: z.boolean().optional(),
});

const agentsUpdateSchema = z
  .object({
    agentName: z.string().min(1),
    icon: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    modelId: z.string().min(1).optional(),
    soulContents: z.string().optional(),
    enabledSkills: z.array(z.string()).optional(),
    alwaysPreloadedSkills: z.array(z.string()).optional(),
    additionalSkillRoots: z.array(z.string()).optional(),
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
    allowOwnerHumanSecrets: z.boolean().optional(),
    ownerHumanId: z.string().min(1).nullable().optional(),
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
    "agents_copy",
    "Copy an agent, including enabled skills, agent-local skills, private secrets that are not already public secrets, workspace files, and channel plus cross-channel memory. Pass federationInstanceId to copy onto a federated peer.",
    agentsCopySchema,
  ],
  [
    "agents_move",
    "Move an agent to another local runner, or pass federationInstanceId to move it to a federated peer with its skills, private secrets, workspace files, and memory. Running processes are stopped. Local moves keep the workspace path. Use assignedRunnerId null to unassign.",
    agentsMoveSchema,
  ],
  [
    "agents_publish_workspace",
    "Publish an agent workspace subfolder at a public URL path such as /agents/<agentName>/<subfolder>/. Re-running with the same publicPath updates that publication. Serving mode is selected automatically from runner/API placement.",
    agentsPublishWorkspaceSchema,
  ],
  [
    "agents_unpublish_workspace",
    "Delete a workspace publication by publicationId, or by agentName plus publicPath/slug. Defaults agentName to the current agent when omitted.",
    agentsUnpublishWorkspaceSchema,
  ],
  [
    "agents_list_publications",
    "List workspace publications for an agent. Defaults to the current agent when agentName is omitted.",
    agentsListPublicationsSchema,
  ],
  [
    "agents_create_integration_key",
    "Create an integration API key for an agent. Defaults agentName to the current agent. The returned org_sk token is shown once. When sharing it in a message.created event, put the token in payload.sensitive.plaintext and keep payload.text as a non-secret preview.",
    agentsCreateIntegrationKeySchema,
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

function normalizePublicPathInput(value: string) {
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
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

  if (tool === "agents_copy") {
    const parsedResult = parseToolArgs(tool, agentsCopySchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const sourceAgentName = parsed.sourceAgentName.trim();
    const name = parsed.name.trim();
    const body: Record<string, unknown> = {
      name,
      ...(parsed.assignedRunnerId !== undefined
        ? { assignedRunnerId: trimOptional(parsed.assignedRunnerId ?? undefined) ?? null }
        : {}),
      ...(parsed.workspacePath !== undefined ? { workspacePath: parsed.workspacePath.trim() } : {}),
      ...(parsed.desiredState !== undefined ? { desiredState: parsed.desiredState } : {}),
      ...(parsed.copyChannelMemberships !== undefined
        ? { copyChannelMemberships: parsed.copyChannelMemberships }
        : {}),
      ...(parsed.federationInstanceId !== undefined
        ? { federationInstanceId: parsed.federationInstanceId.trim() }
        : {}),
    };
    const response = await ctx.apiFetch(
      `/api/agents/${encodeURIComponent(sourceAgentName)}/copy`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const copied = await parseResponseBody(response);
    return { ok: true, sourceAgentName, agentName: name, copied };
  }

  if (tool === "agents_move") {
    const parsedResult = parseToolArgs(tool, agentsMoveSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const agentName = parsed.agentName.trim();
    const response = await ctx.apiFetch(
      `/api/agents/${encodeURIComponent(agentName)}/move`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(parsed.assignedRunnerId !== undefined
            ? { assignedRunnerId: trimOptional(parsed.assignedRunnerId ?? undefined) ?? null }
            : {}),
          ...(parsed.federationInstanceId !== undefined
            ? { federationInstanceId: parsed.federationInstanceId.trim() }
            : {}),
          ...(parsed.name !== undefined ? { name: parsed.name.trim() } : {}),
        }),
      },
    );
    const moved = await parseResponseBody(response);
    return { ok: true, agentName, moved };
  }

  if (tool === "agents_list_publications") {
    const parsedResult = parseToolArgs(tool, agentsListPublicationsSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const agentName = trimOptional(parsedResult.data.agentName) ?? ctx.agent.name;
    const response = await ctx.apiFetch(
      `/api/agents/${encodeURIComponent(agentName)}/publications`,
      {
        headers: { "x-orgops-agent-name": ctx.agent.name },
      },
    );
    const publications = await parseResponseBody(response);
    return { ok: true, agentName, publications };
  }

  if (tool === "agents_publish_workspace") {
    const parsedResult = parseToolArgs(tool, agentsPublishWorkspaceSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const agentName = trimOptional(parsed.agentName) ?? ctx.agent.name;
    const publicPath = normalizePublicPathInput(
      trimOptional(parsed.publicPath) ?? `/agents/${agentName}/site/`,
    );
    const slug = trimOptional(parsed.slug)?.toLowerCase();
    const listResponse = await ctx.apiFetch(
      `/api/agents/${encodeURIComponent(agentName)}/publications`,
      {
        headers: { "x-orgops-agent-name": ctx.agent.name },
      },
    );
    const existingList = (await parseResponseBody(listResponse)) as Array<{
      id?: string;
      slug?: string;
      publicPath?: string;
    }>;
    const existing = Array.isArray(existingList)
      ? existingList.find(
          (publication) =>
            publication.publicPath === publicPath || (slug && publication.slug === slug),
        )
      : undefined;
    const body: Record<string, unknown> = {
      ...(slug ? { slug } : {}),
      publicPath,
      sourcePath: trimOptional(parsed.sourcePath) ?? "dist",
      ...(parsed.title !== undefined ? { title: parsed.title } : {}),
      ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
      ...(parsed.authType !== undefined ? { authType: parsed.authType } : {}),
      ...(parsed.password !== undefined ? { password: parsed.password } : {}),
    };
    const response = existing?.id
      ? await ctx.apiFetch(`/api/workspace-publications/${encodeURIComponent(existing.id)}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-orgops-agent-name": ctx.agent.name,
          },
          body: JSON.stringify(body),
        })
      : await ctx.apiFetch(`/api/agents/${encodeURIComponent(agentName)}/publications`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-orgops-agent-name": ctx.agent.name,
          },
          body: JSON.stringify(body),
        });
    const publication = await parseResponseBody(response);
    return { ok: true, agentName, publicPath, publication };
  }

  if (tool === "agents_unpublish_workspace") {
    const parsedResult = parseToolArgs(tool, agentsUnpublishWorkspaceSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    let publicationId = trimOptional(parsed.publicationId);
    const agentName = trimOptional(parsed.agentName) ?? ctx.agent.name;
    if (!publicationId) {
      const slug = trimOptional(parsed.slug);
      const publicPath = trimOptional(parsed.publicPath);
      if (!slug && !publicPath) return { error: "Provide publicationId, publicPath, or slug." };
      const listResponse = await ctx.apiFetch(
        `/api/agents/${encodeURIComponent(agentName)}/publications`,
        {
          headers: { "x-orgops-agent-name": ctx.agent.name },
        },
      );
      const existingList = (await parseResponseBody(listResponse)) as Array<{
        id?: string;
        slug?: string;
        publicPath?: string;
      }>;
      publicationId = Array.isArray(existingList)
        ? existingList.find(
            (publication) =>
              (publicPath && publication.publicPath === publicPath) ||
              (slug && publication.slug === slug.toLowerCase()),
          )?.id
        : undefined;
      if (!publicationId) return { ok: true, agentName, deleted: false, reason: "Publication not found" };
    }
    const response = await ctx.apiFetch(
      `/api/workspace-publications/${encodeURIComponent(publicationId)}`,
      {
        method: "DELETE",
        headers: { "x-orgops-agent-name": ctx.agent.name },
      },
    );
    const deleted = await parseResponseBody(response);
    return { ok: true, agentName, publicationId, deleted };
  }

  if (tool === "agents_create_integration_key") {
    const parsedResult = parseToolArgs(tool, agentsCreateIntegrationKeySchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const agentName = trimOptional(parsed.agentName) ?? ctx.agent.name;
    const response = await ctx.apiFetch("/api/integration-keys", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orgops-agent-name": ctx.agent.name,
      },
      body: JSON.stringify({
        name: parsed.name.trim(),
        agentName,
      }),
    });
    const created = await parseResponseBody(response);
    return { ok: true, agentName, key: created };
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
      ...(parsed.soulContents !== undefined ? { soulContents: parsed.soulContents } : {}),
      ...(parsed.enabledSkills !== undefined ? { enabledSkills: parsed.enabledSkills } : {}),
      ...(parsed.alwaysPreloadedSkills !== undefined
        ? { alwaysPreloadedSkills: parsed.alwaysPreloadedSkills }
        : {}),
      ...(parsed.additionalSkillRoots !== undefined
        ? { additionalSkillRoots: parsed.additionalSkillRoots }
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
      ...(parsed.allowOwnerHumanSecrets !== undefined
        ? { allowOwnerHumanSecrets: parsed.allowOwnerHumanSecrets }
        : {}),
      ...(parsed.ownerHumanId !== undefined ? { ownerHumanId: parsed.ownerHumanId } : {}),
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
      ...(parsed.soulContents !== undefined ? { soulContents: parsed.soulContents } : {}),
      ...(parsed.enabledSkills !== undefined ? { enabledSkills: parsed.enabledSkills } : {}),
      ...(parsed.alwaysPreloadedSkills !== undefined
        ? { alwaysPreloadedSkills: parsed.alwaysPreloadedSkills }
        : {}),
      ...(parsed.additionalSkillRoots !== undefined
        ? { additionalSkillRoots: parsed.additionalSkillRoots }
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
      ...(parsed.allowOwnerHumanSecrets !== undefined
        ? { allowOwnerHumanSecrets: parsed.allowOwnerHumanSecrets }
        : {}),
      ...(parsed.ownerHumanId !== undefined ? { ownerHumanId: parsed.ownerHumanId } : {}),
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
