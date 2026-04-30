import { z } from "zod";
import { getReservedEventTypeError } from "../event-type-guard";
import type { ExecuteContext, ToolDef } from "./types";

const scheduleOptionsSchema = z.object({
  deliverAt: z.number().int().optional(),
  deliverAtIso: z.string().min(1).optional(),
  delayMs: z.number().int().nonnegative().optional(),
  delaySeconds: z.number().int().nonnegative().optional(),
});

const emitSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown().optional(),
  channelId: z.string().min(1).optional(),
  parentEventId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  awaitDeliveryMs: z.number().int().min(1).max(120_000).optional(),
}).merge(scheduleOptionsSchema);

const channelMessagesSchema = z.object({
  channelId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  after: z.number().int().min(0).optional(),
});

const searchSchema = z.object({
  channelId: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  typePrefix: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  sourcePrefix: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  after: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  scheduled: z.boolean().optional(),
  all: z.boolean().optional(),
});

const scheduledListSchema = z.object({
  channelId: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

const scheduledUpdateSchema = z
  .object({
    eventId: z.string().min(1),
    payload: z.unknown().optional(),
    text: z.string().min(1).optional(),
  })
  .merge(scheduleOptionsSchema)
  .superRefine((value, ctx) => {
    if (
      value.deliverAt === undefined &&
      value.deliverAtIso === undefined &&
      value.delayMs === undefined &&
      value.delaySeconds === undefined &&
      value.payload === undefined &&
      value.text === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide at least one update field: deliverAt, deliverAtIso, delayMs, delaySeconds, payload, or text.",
      });
    }
  });

const scheduledDeleteSchema = z.object({
  eventId: z.string().min(1),
});

const agentsSearchSchema = z.object({
  nameContains: z.string().min(1).optional(),
  runtimeState: z
    .enum(["STARTING", "RUNNING", "STOPPED", "CRASHED"])
    .optional(),
  desiredState: z.enum(["RUNNING", "STOPPED"]).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const channelCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const channelUpdateSchema = z.object({
  channelId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
});

const channelDeleteSchema = z.object({
  channelId: z.string().min(1),
});

const channelParticipantsSchema = z.object({
  channelId: z.string().min(1),
});

const channelParticipantAddSchema = z.object({
  channelId: z.string().min(1),
  agentName: z.string().min(1),
});

const channelParticipantRemoveSchema = z.object({
  channelId: z.string().min(1),
  agentName: z.string().min(1),
});

const channelJoinSchema = z.object({
  channelId: z.string().min(1).optional(),
  agentName: z.string().min(1).optional(),
});

const channelLeaveSchema = z.object({
  channelId: z.string().min(1).optional(),
  agentName: z.string().min(1).optional(),
});

const channelsListSchema = z.object({
  kind: z.string().min(1).optional(),
  nameContains: z.string().min(1).optional(),
  participantType: z.string().min(1).optional(),
  participantId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const eventTypesSchema = z.object({
  source: z.string().min(1).optional(),
  typePrefix: z.string().min(1).optional(),
  includeSchema: z.boolean().optional(),
  includeExamples: z.boolean().optional(),
});

const scheduledCreateSchema = z
  .object({
    text: z.string().min(1),
    targetAgentName: z.string().min(1),
    channelId: z.string().min(1).optional(),
  })
  .merge(scheduleOptionsSchema)
  .superRefine((value, ctx) => {
    const keys = [
      value.deliverAt !== undefined ? "deliverAt" : null,
      value.deliverAtIso !== undefined ? "deliverAtIso" : null,
      value.delayMs !== undefined ? "delayMs" : null,
      value.delaySeconds !== undefined ? "delaySeconds" : null,
    ].filter(Boolean);
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide one scheduling field: deliverAt, deliverAtIso, delayMs, or delaySeconds.",
      });
      return;
    }
    if (keys.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide only one scheduling field: deliverAt, deliverAtIso, delayMs, or delaySeconds.",
      });
    }
  });

const scheduleSelfSchema = z
  .object({
    text: z.string().min(1),
    channelId: z.string().min(1).optional(),
  })
  .merge(scheduleOptionsSchema)
  .superRefine((value, ctx) => {
    const keys = [
      value.deliverAt !== undefined ? "deliverAt" : null,
      value.deliverAtIso !== undefined ? "deliverAtIso" : null,
      value.delayMs !== undefined ? "delayMs" : null,
      value.delaySeconds !== undefined ? "delaySeconds" : null,
    ].filter(Boolean);
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide one scheduling field: deliverAt, deliverAtIso, delayMs, or delaySeconds.",
      });
      return;
    }
    if (keys.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide only one scheduling field: deliverAt, deliverAtIso, delayMs, or delaySeconds.",
      });
    }
  });

export const eventsToolDefs: ToolDef[] = [
  [
    "events_emit",
    "Emit a custom event by type to a channel (or current channel). Optional scheduling via deliverAt, deliverAtIso, delayMs, or delaySeconds. Optional awaitDeliveryMs to wait until status leaves PENDING.",
    emitSchema,
  ],
  [
    "events_channel_messages",
    "Get message.created events from a channel.",
    channelMessagesSchema,
  ],
  [
    "events_search",
    "Search events across all visible channels with optional filters (type/source/status/time/order).",
    searchSchema,
  ],
  [
    "events_scheduled_list",
    "List future scheduled events that are still pending, with optional filters.",
    scheduledListSchema,
  ],
  [
    "events_scheduled_update",
    "Update a scheduled event (reschedule and/or update payload text). Requires eventId and at least one update field.",
    scheduledUpdateSchema,
  ],
  [
    "events_scheduled_delete",
    "Delete a future scheduled event by id.",
    scheduledDeleteSchema,
  ],
  [
    "events_agents_search",
    "List/search agents with optional filters by name/runtime/desired state.",
    agentsSearchSchema,
  ],
  [
    "events_channel_create",
    "Create a non-integration channel (GROUP kind only).",
    channelCreateSchema,
  ],
  [
    "events_channel_update",
    "Update channel name/description. Integration channels are not manageable by agents.",
    channelUpdateSchema,
  ],
  [
    "events_channel_delete",
    "Delete a non-integration channel.",
    channelDeleteSchema,
  ],
  [
    "events_channel_participants",
    "List participants in a non-integration channel.",
    channelParticipantsSchema,
  ],
  [
    "events_channel_participant_add",
    "Add an agent participant to a non-integration channel.",
    channelParticipantAddSchema,
  ],
  [
    "events_channel_participant_remove",
    "Remove an agent participant from a non-integration channel.",
    channelParticipantRemoveSchema,
  ],
  [
    "events_channel_join",
    "Join an agent to a channel. Defaults to current channel and current agent when omitted. Membership updates are picked up on the next runner poll cycle.",
    channelJoinSchema,
  ],
  [
    "events_channel_leave",
    "Remove an agent from a channel. Defaults to current channel and current agent when omitted. Membership updates are picked up on the next runner poll cycle.",
    channelLeaveSchema,
  ],
  [
    "events_channels_list",
    "List channels and participants, with optional filters by kind/name/participant.",
    channelsListSchema,
  ],
  [
    "events_event_types",
    "List known event types from core and loaded skills. Compact by default (type/description/source). Set includeSchema/includeExamples when you need full payload shape details.",
    eventTypesSchema,
  ],
  [
    "events_scheduled_create",
    "Schedule an agent trigger event using exactly one of deliverAt, deliverAtIso, delayMs, or delaySeconds. targetAgentName must already be an AGENT participant in the destination channel.",
    scheduledCreateSchema,
  ],
  [
    "events_schedule_self",
    "Schedule an internal delayed trigger for this agent (not a user-visible message) using exactly one of deliverAt, deliverAtIso, delayMs, or delaySeconds. This agent must be an AGENT participant in the destination channel.",
    scheduleSelfSchema,
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

function resolveDeliverAt(input: {
  deliverAt?: number;
  deliverAtIso?: string;
  delayMs?: number;
  delaySeconds?: number;
}): number | undefined {
  const providedKeys = [
    input.deliverAt !== undefined ? "deliverAt" : null,
    input.deliverAtIso !== undefined ? "deliverAtIso" : null,
    input.delayMs !== undefined ? "delayMs" : null,
    input.delaySeconds !== undefined ? "delaySeconds" : null,
  ].filter(Boolean);

  if (providedKeys.length === 0) return undefined;
  if (providedKeys.length > 1) {
    throw new Error(
      "Provide only one scheduling field: deliverAt, deliverAtIso, delayMs, or delaySeconds.",
    );
  }

  if (input.deliverAt !== undefined) return input.deliverAt;
  if (input.deliverAtIso !== undefined) {
    const parsed = Date.parse(input.deliverAtIso);
    if (!Number.isFinite(parsed)) {
      throw new Error(
        `Invalid deliverAtIso value: ${input.deliverAtIso}. Use ISO-8601 format.`,
      );
    }
    return Math.floor(parsed);
  }
  if (input.delayMs !== undefined) return Date.now() + input.delayMs;
  if (input.delaySeconds !== undefined) return Date.now() + input.delaySeconds * 1000;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateEventOrThrow(
  ctx: ExecuteContext,
  eventDraft: {
    type: string;
    payload: unknown;
    source: string;
    channelId?: string;
    parentEventId?: string;
    deliverAt?: number;
    idempotencyKey?: string;
  },
) {
  const validation = ctx.validateEvent?.(eventDraft);
  if (!validation || validation.ok) return;
  const details = validation.issues
    .slice(0, 8)
    .map((issue) => `- [${issue.source}] ${issue.message}`)
    .join("\n");
  throw new Error(
    [
      `Event validation failed for type "${eventDraft.type}".`,
      "Adjust the payload/schema and retry.",
      details,
    ].join("\n"),
  );
}

async function listChannels(
  ctx: ExecuteContext,
): Promise<
  Array<{
    id: string;
    name?: string;
    kind?: string;
    description?: string | null;
    participants?: Array<{ subscriberType?: string; subscriberId?: string }>;
  }>
> {
  const response = await ctx.apiFetch("/api/channels");
  return (await response.json()) as Array<{
    id: string;
    name?: string;
    kind?: string;
    description?: string | null;
    participants?: Array<{ subscriberType?: string; subscriberId?: string }>;
  }>;
}

async function getChannelById(
  ctx: ExecuteContext,
  channelId: string,
): Promise<
  | {
      id: string;
      name?: string;
      kind?: string;
      description?: string | null;
      participants?: Array<{ subscriberType?: string; subscriberId?: string }>;
    }
  | null
> {
  const channels = await listChannels(ctx);
  return channels.find((channel) => channel.id === channelId) ?? null;
}

async function ensureManageableChannel(
  ctx: ExecuteContext,
  channelId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const channel = await getChannelById(ctx, channelId);
  if (!channel) {
    return { ok: false, error: `Unknown channelId: ${channelId}` };
  }
  if (channel.kind === "INTEGRATION_BRIDGE") {
    return {
      ok: false,
      error:
        "Integration bridge channels are managed by integrations and cannot be modified by agent tools.",
    };
  }
  return { ok: true };
}

function isAgentParticipant(
  channel:
    | {
        id: string;
        name?: string;
        kind?: string;
        participants?: Array<{ subscriberType?: string; subscriberId?: string }>;
      }
    | null,
  agentName: string,
): boolean {
  if (!channel) return false;
  return (channel.participants ?? []).some(
    (participant) =>
      String(participant.subscriberType ?? "").toUpperCase() === "AGENT" &&
      participant.subscriberId === agentName,
  );
}

async function ensureAgentParticipantInChannel(
  ctx: ExecuteContext,
  channelId: string,
  agentName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const channel = await getChannelById(ctx, channelId);
  if (!channel) {
    return { ok: false, error: `Unknown channelId: ${channelId}` };
  }
  if (!isAgentParticipant(channel, agentName)) {
    return {
      ok: false,
      error: `Cannot schedule for agent "${agentName}" in channel "${channelId}" because that agent is not an AGENT participant in the channel.`,
    };
  }
  return { ok: true };
}

async function ensurePostingAgentParticipantInChannel(
  ctx: ExecuteContext,
  channelId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const membership = await ensureAgentParticipantInChannel(
    ctx,
    channelId,
    ctx.agent.name,
  );
  if (membership.ok) return membership;
  return {
    ok: false,
    error: `Event validation failed: agent "${ctx.agent.name}" is not an AGENT participant in channel "${channelId}".`,
  };
}

async function waitForEventDeliveryState(
  ctx: ExecuteContext,
  eventId: string,
  timeoutMs: number,
): Promise<{ status: "delivered" | "pending_timeout"; event: Record<string, unknown> }> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  while (true) {
    const response = await ctx.apiFetch(`/api/events/${encodeURIComponent(eventId)}`);
    const event = (await response.json()) as Record<string, unknown>;
    const currentStatus = String(event.status ?? "PENDING");
    if (currentStatus !== "PENDING") {
      return { status: "delivered", event };
    }
    if (Date.now() >= deadline) {
      return { status: "pending_timeout", event };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

export async function execute(
  ctx: ExecuteContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (tool === "events_channel_messages") {
    const parsedResult = parseToolArgs(tool, channelMessagesSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const query = new URLSearchParams();
    query.set("channelId", parsed.channelId);
    query.set("type", "message.created");
    query.set("limit", String(parsed.limit ?? 100));
    if (parsed.after !== undefined) query.set("after", String(parsed.after));
    const response = await ctx.apiFetch(`/api/events?${query.toString()}`);
    const events = (await response.json()) as unknown[];
    return { channelId: parsed.channelId, events };
  }

  if (tool === "events_search") {
    const parsedResult = parseToolArgs(tool, searchSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const knownEventTypes = ctx.listEventTypes?.() ?? [];
    if (parsed.type && !knownEventTypes.some((eventType) => eventType.type === parsed.type)) {
      return {
        error: `Unknown event type: ${parsed.type}. Use events_event_types to inspect available types.`,
      };
    }
    const typePrefix = parsed.typePrefix;
    if (
      typePrefix &&
      !knownEventTypes.some((eventType) => eventType.type.startsWith(typePrefix))
    ) {
      return {
        error: `Unknown event typePrefix: ${typePrefix}. Use events_event_types to inspect valid prefixes.`,
      };
    }
    const query = new URLSearchParams();
    if (parsed.channelId) query.set("channelId", parsed.channelId);
    if (parsed.type) query.set("type", parsed.type);
    if (parsed.typePrefix) query.set("typePrefix", parsed.typePrefix);
    if (parsed.source) query.set("source", parsed.source);
    if (parsed.sourcePrefix) query.set("sourcePrefix", parsed.sourcePrefix);
    if (parsed.status) query.set("status", parsed.status);
    if (parsed.after !== undefined) query.set("after", String(parsed.after));
    if (parsed.limit !== undefined) query.set("limit", String(parsed.limit));
    if (parsed.order) query.set("order", parsed.order);
    if (parsed.scheduled !== undefined) query.set("scheduled", parsed.scheduled ? "1" : "0");
    if (parsed.all !== undefined) query.set("all", parsed.all ? "1" : "0");
    const response = await ctx.apiFetch(`/api/events?${query.toString()}`);
    const events = (await response.json()) as unknown[];
    return { filters: parsed, events };
  }

  if (tool === "events_scheduled_list") {
    const parsedResult = parseToolArgs(tool, scheduledListSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const query = new URLSearchParams();
    query.set("scheduled", "1");
    if (parsed.channelId) query.set("channelId", parsed.channelId);
    if (parsed.type) query.set("type", parsed.type);
    if (parsed.source) query.set("source", parsed.source);
    if (parsed.limit !== undefined) query.set("limit", String(parsed.limit));
    if (parsed.order) query.set("order", parsed.order);
    const response = await ctx.apiFetch(`/api/events?${query.toString()}`);
    const events = (await response.json()) as unknown[];
    return { filters: parsed, events };
  }

  if (tool === "events_scheduled_update") {
    const parsedResult = parseToolArgs(tool, scheduledUpdateSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    let deliverAt: number | undefined;
    try {
      deliverAt = resolveDeliverAt(parsed);
    } catch (error) {
      return { error: String(error) };
    }
    let payload: unknown = parsed.payload;
    let existingEventForValidation: Record<string, unknown> | null = null;
    if (parsed.text !== undefined) {
      if (payload !== undefined) {
        if (!isRecord(payload)) {
          return { error: "payload must be an object when text is provided." };
        }
        payload = { ...payload, text: parsed.text };
      } else {
        const existingResponse = await ctx.apiFetch(
          `/api/events/${encodeURIComponent(parsed.eventId)}`,
        );
        existingEventForValidation = (await existingResponse.json()) as Record<
          string,
          unknown
        >;
        const existingPayload = isRecord(existingEventForValidation.payload)
          ? existingEventForValidation.payload
          : {};
        payload = { ...existingPayload, text: parsed.text };
      }
    }

    if (payload !== undefined) {
      if (!existingEventForValidation) {
        const existingResponse = await ctx.apiFetch(
          `/api/events/${encodeURIComponent(parsed.eventId)}`,
        );
        existingEventForValidation = (await existingResponse.json()) as Record<
          string,
          unknown
        >;
      }
      const existingType = existingEventForValidation.type;
      if (typeof existingType !== "string" || existingType.trim().length === 0) {
        return {
          error: `Unable to validate event ${parsed.eventId}: missing event type on existing record.`,
        };
      }
      const existingSource = existingEventForValidation.source;
      const existingChannelId = existingEventForValidation.channelId;
      const existingParentEventId = existingEventForValidation.parentEventId;
      const existingIdempotencyKey = existingEventForValidation.idempotencyKey;
      try {
        validateEventOrThrow(ctx, {
          type: existingType.trim(),
          payload,
          source:
            typeof existingSource === "string" && existingSource.trim().length > 0
              ? existingSource.trim()
              : `agent:${ctx.agent.name}`,
          ...(typeof existingChannelId === "string" && existingChannelId.trim().length > 0
            ? { channelId: existingChannelId.trim() }
            : {}),
          ...(typeof existingParentEventId === "string" &&
          existingParentEventId.trim().length > 0
            ? { parentEventId: existingParentEventId.trim() }
            : {}),
          ...(deliverAt !== undefined ? { deliverAt } : {}),
          ...(typeof existingIdempotencyKey === "string" &&
          existingIdempotencyKey.trim().length > 0
            ? { idempotencyKey: existingIdempotencyKey.trim() }
            : {}),
        });
      } catch (error) {
        return { error: String(error) };
      }
    }

    const body: Record<string, unknown> = {};
    if (deliverAt !== undefined) body.deliverAt = deliverAt;
    if (payload !== undefined) body.payload = payload;
    const response = await ctx.apiFetch(
      `/api/events/${encodeURIComponent(parsed.eventId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const event = await response.json();
    return { eventId: parsed.eventId, event };
  }

  if (tool === "events_scheduled_delete") {
    const parsedResult = parseToolArgs(tool, scheduledDeleteSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const response = await ctx.apiFetch(
      `/api/events/${encodeURIComponent(parsed.eventId)}`,
      {
        method: "DELETE",
      },
    );
    const result = await response.json();
    return { eventId: parsed.eventId, ...result };
  }

  if (tool === "events_agents_search") {
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

  if (tool === "events_channel_create") {
    const parsedResult = parseToolArgs(tool, channelCreateSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const response = await ctx.apiFetch("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: parsed.name.trim(),
        description: parsed.description ?? "",
        kind: "GROUP",
      }),
    });
    const created = (await response.json()) as { id?: string };
    return { channelId: created.id, created };
  }

  if (tool === "events_channel_update") {
    const parsedResult = parseToolArgs(tool, channelUpdateSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    if (parsed.name === undefined && parsed.description === undefined) {
      return {
        error:
          "No update fields provided. Include at least one of: name, description.",
      };
    }
    const manageable = await ensureManageableChannel(ctx, parsed.channelId);
    if (!manageable.ok) return { error: manageable.error };
    await ctx.apiFetch(`/api/channels/${encodeURIComponent(parsed.channelId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(parsed.name !== undefined ? { name: parsed.name.trim() } : {}),
        ...(parsed.description !== undefined
          ? { description: parsed.description }
          : {}),
      }),
    });
    return { ok: true, channelId: parsed.channelId };
  }

  if (tool === "events_channel_delete") {
    const parsedResult = parseToolArgs(tool, channelDeleteSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const manageable = await ensureManageableChannel(ctx, parsed.channelId);
    if (!manageable.ok) return { error: manageable.error };
    const response = await ctx.apiFetch(
      `/api/channels/${encodeURIComponent(parsed.channelId)}/delete`,
      {
        method: "POST",
      },
    );
    const result = (await response.json()) as { ok?: boolean; deleted?: boolean };
    return { channelId: parsed.channelId, ...result };
  }

  if (tool === "events_channel_participants") {
    const parsedResult = parseToolArgs(tool, channelParticipantsSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const manageable = await ensureManageableChannel(ctx, parsed.channelId);
    if (!manageable.ok) return { error: manageable.error };
    const response = await ctx.apiFetch(
      `/api/channels/${encodeURIComponent(parsed.channelId)}/participants`,
    );
    const participants = (await response.json()) as unknown[];
    return { channelId: parsed.channelId, participants };
  }

  if (tool === "events_channel_participant_add") {
    const parsedResult = parseToolArgs(tool, channelParticipantAddSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const manageable = await ensureManageableChannel(ctx, parsed.channelId);
    if (!manageable.ok) return { error: manageable.error };
    await ctx.apiFetch(`/api/channels/${encodeURIComponent(parsed.channelId)}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subscriberType: "AGENT",
        subscriberId: parsed.agentName,
      }),
    });
    return { ok: true, channelId: parsed.channelId, agentName: parsed.agentName };
  }

  if (tool === "events_channel_participant_remove") {
    const parsedResult = parseToolArgs(tool, channelParticipantRemoveSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const manageable = await ensureManageableChannel(ctx, parsed.channelId);
    if (!manageable.ok) return { error: manageable.error };
    await ctx.apiFetch(`/api/channels/${encodeURIComponent(parsed.channelId)}/unsubscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subscriberType: "AGENT",
        subscriberId: parsed.agentName,
      }),
    });
    return { ok: true, channelId: parsed.channelId, agentName: parsed.agentName };
  }

  if (tool === "events_channel_join") {
    const parsedResult = parseToolArgs(tool, channelJoinSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const targetChannelId = parsed.channelId?.trim() || ctx.channelId;
    if (!targetChannelId) {
      return {
        error:
          "No target channel. Provide channelId or call this tool from a channel-scoped turn.",
      };
    }
    const targetAgentName = parsed.agentName?.trim() || ctx.agent.name;
    const manageable = await ensureManageableChannel(ctx, targetChannelId);
    if (!manageable.ok) return { error: manageable.error };
    await ctx.apiFetch(`/api/channels/${encodeURIComponent(targetChannelId)}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subscriberType: "AGENT",
        subscriberId: targetAgentName,
      }),
    });
    return { ok: true, channelId: targetChannelId, agentName: targetAgentName };
  }

  if (tool === "events_channel_leave") {
    const parsedResult = parseToolArgs(tool, channelLeaveSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const targetChannelId = parsed.channelId?.trim() || ctx.channelId;
    if (!targetChannelId) {
      return {
        error:
          "No target channel. Provide channelId or call this tool from a channel-scoped turn.",
      };
    }
    const targetAgentName = parsed.agentName?.trim() || ctx.agent.name;
    const manageable = await ensureManageableChannel(ctx, targetChannelId);
    if (!manageable.ok) return { error: manageable.error };
    await ctx.apiFetch(`/api/channels/${encodeURIComponent(targetChannelId)}/unsubscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subscriberType: "AGENT",
        subscriberId: targetAgentName,
      }),
    });
    return { ok: true, channelId: targetChannelId, agentName: targetAgentName };
  }

  if (tool === "events_channels_list") {
    const parsedResult = parseToolArgs(tool, channelsListSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const channels = await listChannels(ctx);
    const participantType = parsed.participantType?.toUpperCase();
    const filtered = channels.filter((channel) => {
      if (parsed.kind && channel.kind !== parsed.kind) return false;
      if (parsed.nameContains && !String(channel.name ?? "").includes(parsed.nameContains)) {
        return false;
      }
      if (!participantType && !parsed.participantId) return true;
      const participants = channel.participants ?? [];
      return participants.some((participant) => {
        const typeMatches =
          !participantType ||
          String(participant.subscriberType ?? "").toUpperCase() === participantType;
        const idMatches =
          !parsed.participantId || participant.subscriberId === parsed.participantId;
        return typeMatches && idMatches;
      });
    });
    const limited = parsed.limit ? filtered.slice(0, parsed.limit) : filtered;
    return { channels: limited, totalMatched: filtered.length };
  }

  if (tool === "events_event_types") {
    const parsedResult = parseToolArgs(tool, eventTypesSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    const source = parsed.source?.trim();
    const typePrefix = parsed.typePrefix?.trim();
    const knownEventTypes = ctx.listEventTypes?.({
      ...(source ? { source } : {}),
      ...(typePrefix ? { typePrefix } : {}),
    });
    if (!knownEventTypes) {
      return {
        eventTypes: [],
        totalMatched: 0,
        note: "Event type registry unavailable in this runtime context.",
      };
    }
    const eventTypes = knownEventTypes.map((eventType) => ({
      type: eventType.type,
      description: eventType.description,
      source: eventType.source,
      ...(parsed.includeSchema
        ? {
            schemaKind: eventType.schemaKind,
            schema: eventType.schema,
          }
        : {}),
      ...(parsed.includeExamples ? { payloadExample: eventType.payloadExample } : {}),
    }));
    return {
      eventTypes,
      totalMatched: eventTypes.length,
      filters: parsed,
    };
  }

  if (tool === "events_emit") {
    const parsedResult = parseToolArgs(tool, emitSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    let deliverAt: number | undefined;
    try {
      deliverAt = resolveDeliverAt(parsed);
    } catch (error) {
      return { error: String(error) };
    }
    const defaultChannelId = ctx.channelId;
    const targetChannelId = parsed.channelId?.trim() || defaultChannelId;
    if (!targetChannelId) {
      return {
        error:
          "No target destination. Provide channelId or call from an event with channel context.",
      };
    }
    const postingMembership = await ensurePostingAgentParticipantInChannel(
      ctx,
      targetChannelId,
    );
    if (!postingMembership.ok) {
      return { error: postingMembership.error };
    }
    const eventDraft = {
      type: parsed.type.trim(),
      payload: parsed.payload ?? {},
      source: `agent:${ctx.agent.name}`,
      ...(targetChannelId ? { channelId: targetChannelId } : {}),
      ...(parsed.parentEventId ? { parentEventId: parsed.parentEventId } : {}),
      ...(parsed.idempotencyKey ? { idempotencyKey: parsed.idempotencyKey } : {}),
      ...(deliverAt !== undefined ? { deliverAt } : {}),
    };
    const reservedTypeError = getReservedEventTypeError(eventDraft.type);
    if (reservedTypeError) {
      return { error: reservedTypeError };
    }
    try {
      validateEventOrThrow(ctx, eventDraft);
    } catch (error) {
      return { error: String(error) };
    }
    const response = await ctx.apiFetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(eventDraft),
    });
    const event = (await response.json()) as Record<string, unknown>;
    let delivery:
      | { status: "not_waited" }
      | { status: "delivered"; eventStatus: string }
      | { status: "pending_timeout"; eventStatus: string; timeoutMs: number } = {
      status: "not_waited",
    };
    if (parsed.awaitDeliveryMs) {
      const eventId = String(event.id ?? "");
      if (eventId) {
        const waited = await waitForEventDeliveryState(ctx, eventId, parsed.awaitDeliveryMs);
        const waitedStatus = String(waited.event.status ?? "PENDING");
        if (waited.status === "delivered") {
          delivery = { status: "delivered", eventStatus: waitedStatus };
        } else {
          delivery = {
            status: "pending_timeout",
            eventStatus: waitedStatus,
            timeoutMs: parsed.awaitDeliveryMs,
          };
        }
      }
    }
    return {
      event,
      channelId: targetChannelId,
      delivery,
    };
  }

  if (tool === "events_scheduled_create") {
    const parsedResult = parseToolArgs(tool, scheduledCreateSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    let deliverAt: number | undefined;
    try {
      deliverAt = resolveDeliverAt(parsed);
    } catch (error) {
      return { error: String(error) };
    }
    const channelId = parsed.channelId ?? ctx.channelId;
    if (!channelId) {
      return { error: "No current channelId. Provide channelId explicitly." };
    }
    const targetMembership = await ensureAgentParticipantInChannel(
      ctx,
      channelId,
      parsed.targetAgentName,
    );
    if (!targetMembership.ok) {
      return { error: targetMembership.error };
    }
    const eventDraft = {
      type: "agent.scheduled.trigger",
      source: "system:scheduler",
      channelId,
      payload: {
        text: parsed.text,
        targetAgentName: parsed.targetAgentName,
      },
      ...(deliverAt !== undefined ? { deliverAt } : {}),
    };
    try {
      validateEventOrThrow(ctx, eventDraft);
    } catch (error) {
      return { error: String(error) };
    }
    const response = await ctx.apiFetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(eventDraft),
    });
    const event = await response.json();
    return { channelId, event };
  }

  if (tool === "events_schedule_self") {
    const parsedResult = parseToolArgs(tool, scheduleSelfSchema, args);
    if (!parsedResult.ok) return { error: parsedResult.error };
    const parsed = parsedResult.data;
    let deliverAt: number | undefined;
    try {
      deliverAt = resolveDeliverAt(parsed);
    } catch (error) {
      return { error: String(error) };
    }
    const channelId = parsed.channelId ?? ctx.channelId;
    if (!channelId) {
      return { error: "No current channelId. Provide channelId explicitly." };
    }
    const selfMembership = await ensureAgentParticipantInChannel(
      ctx,
      channelId,
      ctx.agent.name,
    );
    if (!selfMembership.ok) {
      return { error: selfMembership.error };
    }
    const eventDraft = {
      type: "agent.scheduled.trigger",
      source: "system:scheduler",
      channelId,
      payload: {
        text: parsed.text,
        targetAgentName: ctx.agent.name,
      },
      ...(deliverAt !== undefined ? { deliverAt } : {}),
    };
    try {
      validateEventOrThrow(ctx, eventDraft);
    } catch (error) {
      return { error: String(error) };
    }
    const response = await ctx.apiFetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(eventDraft),
    });
    const event = await response.json();
    return { channelId, event };
  }

  return { error: `Unknown events tool: ${tool}` };
}
