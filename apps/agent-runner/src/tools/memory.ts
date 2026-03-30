import { z } from "zod";
import {
  getChannelFullMemoryRecord,
  getChannelRecentMemoryRecord,
  getCrossFullMemoryRecord,
  getCrossRecentMemoryRecord,
  RECENT_MEMORY_WINDOW_MS,
  refreshChannelFullMemory,
  refreshChannelRecentMemory,
  refreshCrossChannelFullMemory,
  refreshCrossChannelRecentMemory,
} from "../context-maintenance";
import type { ExecuteContext, ToolDef } from "./types";

const channelMemorySchema = z.object({
  channelId: z.string().min(1).optional(),
});

const crossMemorySchema = z.object({
  channelIds: z.array(z.string().min(1)).optional(),
});

const channelUpdateSchema = z.object({
  channelId: z.string().min(1).optional(),
  summaryText: z.string(),
  windowStartAt: z.number().int().min(0).optional(),
  lastProcessedAt: z.number().int().min(0).optional(),
  lastProcessedEventId: z.string().min(1).optional(),
  expectedVersion: z.number().int().min(0).optional(),
});

const crossUpdateSchema = z.object({
  channelIds: z.array(z.string().min(1)).optional(),
  summaryText: z.string(),
  windowStartAt: z.number().int().min(0).optional(),
  lastProcessedAt: z.number().int().min(0).optional(),
  lastProcessedEventId: z.string().min(1).optional(),
  expectedVersion: z.number().int().min(0).optional(),
});

type ChannelRecord = {
  id?: string;
  participants?: Array<{ subscriberType?: string; subscriberId?: string }>;
};

export const memoryToolDefs: ToolDef[] = [
  [
    "memory_channel_recent_get",
    "Get recent (short-term) memory summary for one channel. Defaults to current channel.",
    channelMemorySchema,
  ],
  [
    "memory_channel_recent_refresh",
    "Refresh recent (short-term) memory summary for one channel. Defaults to current channel.",
    channelMemorySchema,
  ],
  [
    "memory_channel_full_get",
    "Get full memory summary for one channel. Defaults to current channel.",
    channelMemorySchema,
  ],
  [
    "memory_channel_full_refresh",
    "Refresh full memory summary for one channel. Defaults to current channel.",
    channelMemorySchema,
  ],
  [
    "memory_channel_recent_update",
    "Update recent (short-term) memory summary for one channel. Defaults to current channel.",
    channelUpdateSchema,
  ],
  [
    "memory_channel_full_update",
    "Update full memory summary for one channel. Defaults to current channel.",
    channelUpdateSchema,
  ],
  [
    "memory_cross_recent_get",
    "Get cross-channel recent (short-term) memory summary.",
    crossMemorySchema,
  ],
  [
    "memory_cross_recent_refresh",
    "Refresh cross-channel recent (short-term) memory summary.",
    crossMemorySchema,
  ],
  [
    "memory_cross_full_get",
    "Get cross-channel full memory summary.",
    crossMemorySchema,
  ],
  [
    "memory_cross_full_refresh",
    "Refresh cross-channel full memory summary.",
    crossMemorySchema,
  ],
  [
    "memory_cross_recent_update",
    "Update cross-channel recent (short-term) memory summary.",
    crossUpdateSchema,
  ],
  [
    "memory_cross_full_update",
    "Update cross-channel full memory summary.",
    crossUpdateSchema,
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

function normalizeChannelId(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function listAgentSubscribedChannelIds(ctx: ExecuteContext): Promise<string[]> {
  const response = await ctx.apiFetch("/api/channels");
  const channels = (await response.json()) as ChannelRecord[];
  return channels
    .filter((channel) =>
      (channel.participants ?? []).some(
        (participant) =>
          String(participant.subscriberType ?? "").toUpperCase() === "AGENT" &&
          participant.subscriberId === ctx.agent.name,
      ),
    )
    .map((channel) => normalizeChannelId(channel.id))
    .filter((channelId): channelId is string => Boolean(channelId));
}

function resolveChannelId(
  ctx: ExecuteContext,
  inputChannelId?: string,
): { ok: true; channelId: string } | { ok: false; error: string } {
  const channelId = normalizeChannelId(inputChannelId) ?? normalizeChannelId(ctx.channelId);
  if (!channelId) {
    return {
      ok: false,
      error:
        "No channelId provided and current event has no channel context. Provide channelId explicitly.",
    };
  }
  return { ok: true, channelId };
}

function dedupeChannelIds(channelIds: string[]): string[] {
  return [...new Set(channelIds.map((value) => value.trim()).filter(Boolean))];
}

async function emitMemoryAudit(
  ctx: ExecuteContext,
  type: string,
  payload: Record<string, unknown>,
  channelId?: string,
) {
  await ctx.emitAudit(type, payload, "system:runner:memory:tool");
  await ctx.emitEvent({
    type,
    source: "system:runner:memory:tool",
    status: "DELIVERED",
    ...(channelId ? { channelId } : {}),
    payload,
  });
}

async function resolveCrossChannelIds(
  ctx: ExecuteContext,
  inputChannelIds?: string[],
): Promise<{ ok: true; channelIds: string[] } | { ok: false; error: string }> {
  const explicit = dedupeChannelIds(inputChannelIds ?? []);
  if (explicit.length > 0) {
    return { ok: true, channelIds: explicit };
  }
  const subscribed = dedupeChannelIds(await listAgentSubscribedChannelIds(ctx));
  if (subscribed.length > 0) {
    return { ok: true, channelIds: subscribed };
  }
  return {
    ok: false,
    error:
      "No channelIds provided and no subscribed channels were found for this agent. Provide channelIds explicitly.",
  };
}

type ChannelMemoryMode = "recent" | "full";
type CrossMemoryMode = "recent" | "full";

async function upsertChannelMemoryRecord(
  ctx: ExecuteContext,
  mode: ChannelMemoryMode,
  record: {
    agentName: string;
    channelId: string;
    summaryText: string;
    windowStartAt?: number;
    lastProcessedAt: number;
    lastProcessedEventId?: string;
    expectedVersion?: number;
  },
) {
  const response = await ctx.apiFetch(`/api/memory/channel/${mode}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
  });
  const payload = (await response.json()) as { record?: unknown };
  return payload.record ?? null;
}

async function upsertCrossMemoryRecord(
  ctx: ExecuteContext,
  mode: CrossMemoryMode,
  record: {
    agentName: string;
    summaryText: string;
    windowStartAt?: number;
    lastProcessedAt: number;
    lastProcessedEventId?: string;
    expectedVersion?: number;
  },
) {
  const response = await ctx.apiFetch(`/api/memory/cross/${mode}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
  });
  const payload = (await response.json()) as { record?: unknown };
  return payload.record ?? null;
}

export async function execute(
  ctx: ExecuteContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (tool === "memory_channel_recent_get") {
    const parsedResult = parseToolArgs(tool, channelMemorySchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const resolved = resolveChannelId(ctx, parsedResult.data.channelId);
    if (!resolved.ok) return { error: resolved.error };
    const record = await getChannelRecentMemoryRecord(
      ctx.apiFetch,
      ctx.agent.name,
      resolved.channelId,
    );
    return { mode: "recent", scope: "channel", channelId: resolved.channelId, record };
  }

  if (tool === "memory_channel_recent_refresh") {
    const parsedResult = parseToolArgs(tool, channelMemorySchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const resolved = resolveChannelId(ctx, parsedResult.data.channelId);
    if (!resolved.ok) return { error: resolved.error };
    const record = await refreshChannelRecentMemory({
      agent: ctx.agent,
      channelId: resolved.channelId,
      apiFetch: ctx.apiFetch,
      getEnv: async () => ctx.injectionEnv,
    });
    await emitMemoryAudit(
      ctx,
      "audit.memory.channel.recent.tool_refresh",
      {
        agentName: ctx.agent.name,
        channelId: resolved.channelId,
        updatedAt: record?.updatedAt ?? null,
        summaryChars: record?.summaryText?.length ?? 0,
      },
      resolved.channelId,
    );
    return { mode: "recent", scope: "channel", channelId: resolved.channelId, record };
  }

  if (tool === "memory_channel_full_get") {
    const parsedResult = parseToolArgs(tool, channelMemorySchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const resolved = resolveChannelId(ctx, parsedResult.data.channelId);
    if (!resolved.ok) return { error: resolved.error };
    const record = await getChannelFullMemoryRecord(
      ctx.apiFetch,
      ctx.agent.name,
      resolved.channelId,
    );
    return { mode: "full", scope: "channel", channelId: resolved.channelId, record };
  }

  if (tool === "memory_channel_recent_update") {
    const parsedResult = parseToolArgs(tool, channelUpdateSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const resolved = resolveChannelId(ctx, parsed.channelId);
    if (!resolved.ok) return { error: resolved.error };
    const existing = await getChannelRecentMemoryRecord(
      ctx.apiFetch,
      ctx.agent.name,
      resolved.channelId,
    );
    const now = Date.now();
    const record = await upsertChannelMemoryRecord(ctx, "recent", {
      agentName: ctx.agent.name,
      channelId: resolved.channelId,
      summaryText: parsed.summaryText,
      windowStartAt:
        parsed.windowStartAt ??
        existing?.windowStartAt ??
        Math.max(0, now - RECENT_MEMORY_WINDOW_MS),
      lastProcessedAt:
        parsed.lastProcessedAt ?? existing?.lastProcessedAt ?? Math.max(0, now - 1),
      ...(parsed.lastProcessedEventId
        ? { lastProcessedEventId: parsed.lastProcessedEventId }
        : existing?.lastProcessedEventId
          ? { lastProcessedEventId: existing.lastProcessedEventId }
          : {}),
      ...(parsed.expectedVersion !== undefined
        ? { expectedVersion: parsed.expectedVersion }
        : existing?.version !== undefined
          ? { expectedVersion: existing.version }
          : {}),
    });
    await emitMemoryAudit(
      ctx,
      "audit.memory.channel.recent.tool_update",
      {
        agentName: ctx.agent.name,
        channelId: resolved.channelId,
        summaryChars: parsed.summaryText.length,
        updatedAt: Date.now(),
      },
      resolved.channelId,
    );
    return { mode: "recent", scope: "channel", channelId: resolved.channelId, record };
  }

  if (tool === "memory_channel_full_update") {
    const parsedResult = parseToolArgs(tool, channelUpdateSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const resolved = resolveChannelId(ctx, parsed.channelId);
    if (!resolved.ok) return { error: resolved.error };
    const existing = await getChannelFullMemoryRecord(
      ctx.apiFetch,
      ctx.agent.name,
      resolved.channelId,
    );
    const now = Date.now();
    const record = await upsertChannelMemoryRecord(ctx, "full", {
      agentName: ctx.agent.name,
      channelId: resolved.channelId,
      summaryText: parsed.summaryText,
      lastProcessedAt:
        parsed.lastProcessedAt ?? existing?.lastProcessedAt ?? Math.max(0, now - 1),
      ...(parsed.lastProcessedEventId
        ? { lastProcessedEventId: parsed.lastProcessedEventId }
        : existing?.lastProcessedEventId
          ? { lastProcessedEventId: existing.lastProcessedEventId }
          : {}),
      ...(parsed.expectedVersion !== undefined
        ? { expectedVersion: parsed.expectedVersion }
        : existing?.version !== undefined
          ? { expectedVersion: existing.version }
          : {}),
    });
    await emitMemoryAudit(
      ctx,
      "audit.memory.channel.full.tool_update",
      {
        agentName: ctx.agent.name,
        channelId: resolved.channelId,
        summaryChars: parsed.summaryText.length,
        updatedAt: Date.now(),
      },
      resolved.channelId,
    );
    return { mode: "full", scope: "channel", channelId: resolved.channelId, record };
  }

  if (tool === "memory_channel_full_refresh") {
    const parsedResult = parseToolArgs(tool, channelMemorySchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const resolved = resolveChannelId(ctx, parsedResult.data.channelId);
    if (!resolved.ok) return { error: resolved.error };
    const record = await refreshChannelFullMemory({
      agent: ctx.agent,
      channelId: resolved.channelId,
      apiFetch: ctx.apiFetch,
      getEnv: async () => ctx.injectionEnv,
    });
    await emitMemoryAudit(
      ctx,
      "audit.memory.channel.full.tool_refresh",
      {
        agentName: ctx.agent.name,
        channelId: resolved.channelId,
        updatedAt: record?.updatedAt ?? null,
        summaryChars: record?.summaryText?.length ?? 0,
      },
      resolved.channelId,
    );
    return { mode: "full", scope: "channel", channelId: resolved.channelId, record };
  }

  if (tool === "memory_cross_recent_get") {
    const parsedResult = parseToolArgs(tool, crossMemorySchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const resolved = await resolveCrossChannelIds(ctx, parsedResult.data.channelIds);
    if (!resolved.ok) return { error: resolved.error };
    const record = await getCrossRecentMemoryRecord(ctx.apiFetch, ctx.agent.name);
    return { mode: "recent", scope: "cross", channelIds: resolved.channelIds, record };
  }

  if (tool === "memory_cross_recent_refresh") {
    const parsedResult = parseToolArgs(tool, crossMemorySchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const resolved = await resolveCrossChannelIds(ctx, parsedResult.data.channelIds);
    if (!resolved.ok) return { error: resolved.error };
    const record = await refreshCrossChannelRecentMemory({
      agent: ctx.agent,
      channelIds: resolved.channelIds,
      apiFetch: ctx.apiFetch,
      getEnv: async () => ctx.injectionEnv,
    });
    await emitMemoryAudit(ctx, "audit.memory.cross.recent.tool_refresh", {
      agentName: ctx.agent.name,
      channelCount: resolved.channelIds.length,
      updatedAt: record?.updatedAt ?? null,
      summaryChars: record?.summaryText?.length ?? 0,
    });
    return { mode: "recent", scope: "cross", channelIds: resolved.channelIds, record };
  }

  if (tool === "memory_cross_full_get") {
    const parsedResult = parseToolArgs(tool, crossMemorySchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const resolved = await resolveCrossChannelIds(ctx, parsedResult.data.channelIds);
    if (!resolved.ok) return { error: resolved.error };
    const record = await getCrossFullMemoryRecord(ctx.apiFetch, ctx.agent.name);
    return { mode: "full", scope: "cross", channelIds: resolved.channelIds, record };
  }

  if (tool === "memory_cross_full_refresh") {
    const parsedResult = parseToolArgs(tool, crossMemorySchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const resolved = await resolveCrossChannelIds(ctx, parsedResult.data.channelIds);
    if (!resolved.ok) return { error: resolved.error };
    const record = await refreshCrossChannelFullMemory({
      agent: ctx.agent,
      channelIds: resolved.channelIds,
      apiFetch: ctx.apiFetch,
      getEnv: async () => ctx.injectionEnv,
    });
    await emitMemoryAudit(ctx, "audit.memory.cross.full.tool_refresh", {
      agentName: ctx.agent.name,
      channelCount: resolved.channelIds.length,
      updatedAt: record?.updatedAt ?? null,
      summaryChars: record?.summaryText?.length ?? 0,
    });
    return { mode: "full", scope: "cross", channelIds: resolved.channelIds, record };
  }

  if (tool === "memory_cross_recent_update") {
    const parsedResult = parseToolArgs(tool, crossUpdateSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const resolved = await resolveCrossChannelIds(ctx, parsed.channelIds);
    if (!resolved.ok) return { error: resolved.error };
    const existing = await getCrossRecentMemoryRecord(ctx.apiFetch, ctx.agent.name);
    const now = Date.now();
    const record = await upsertCrossMemoryRecord(ctx, "recent", {
      agentName: ctx.agent.name,
      summaryText: parsed.summaryText,
      windowStartAt:
        parsed.windowStartAt ??
        existing?.windowStartAt ??
        Math.max(0, now - RECENT_MEMORY_WINDOW_MS),
      lastProcessedAt:
        parsed.lastProcessedAt ?? existing?.lastProcessedAt ?? Math.max(0, now - 1),
      ...(parsed.lastProcessedEventId
        ? { lastProcessedEventId: parsed.lastProcessedEventId }
        : existing?.lastProcessedEventId
          ? { lastProcessedEventId: existing.lastProcessedEventId }
          : {}),
      ...(parsed.expectedVersion !== undefined
        ? { expectedVersion: parsed.expectedVersion }
        : existing?.version !== undefined
          ? { expectedVersion: existing.version }
          : {}),
    });
    await emitMemoryAudit(ctx, "audit.memory.cross.recent.tool_update", {
      agentName: ctx.agent.name,
      channelCount: resolved.channelIds.length,
      summaryChars: parsed.summaryText.length,
      updatedAt: Date.now(),
    });
    return { mode: "recent", scope: "cross", channelIds: resolved.channelIds, record };
  }

  if (tool === "memory_cross_full_update") {
    const parsedResult = parseToolArgs(tool, crossUpdateSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const resolved = await resolveCrossChannelIds(ctx, parsed.channelIds);
    if (!resolved.ok) return { error: resolved.error };
    const existing = await getCrossFullMemoryRecord(ctx.apiFetch, ctx.agent.name);
    const now = Date.now();
    const record = await upsertCrossMemoryRecord(ctx, "full", {
      agentName: ctx.agent.name,
      summaryText: parsed.summaryText,
      lastProcessedAt:
        parsed.lastProcessedAt ?? existing?.lastProcessedAt ?? Math.max(0, now - 1),
      ...(parsed.lastProcessedEventId
        ? { lastProcessedEventId: parsed.lastProcessedEventId }
        : existing?.lastProcessedEventId
          ? { lastProcessedEventId: existing.lastProcessedEventId }
          : {}),
      ...(parsed.expectedVersion !== undefined
        ? { expectedVersion: parsed.expectedVersion }
        : existing?.version !== undefined
          ? { expectedVersion: existing.version }
          : {}),
    });
    await emitMemoryAudit(ctx, "audit.memory.cross.full.tool_update", {
      agentName: ctx.agent.name,
      channelCount: resolved.channelIds.length,
      summaryChars: parsed.summaryText.length,
      updatedAt: Date.now(),
    });
    return { mode: "full", scope: "cross", channelIds: resolved.channelIds, record };
  }

  return { error: `Unknown memory tool: ${tool}` };
}
