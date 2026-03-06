import { z } from "zod";
import type { ExecuteContext, ToolDef } from "./types";

const scheduleOptionsSchema = z.object({
  deliverAt: z.number().int().optional(),
  deliverAtIso: z.string().min(1).optional(),
  delayMs: z.number().int().nonnegative().optional(),
  delaySeconds: z.number().int().nonnegative().optional(),
});

const dmSendSchema = z.object({
  agentName: z.string().min(1),
  text: z.string().min(1),
}).merge(scheduleOptionsSchema);

const dmReplySchema = z.object({
  text: z.string().min(1),
}).merge(scheduleOptionsSchema);

const channelSendSchema = z.object({
  channelId: z.string().min(1),
  text: z.string().min(1),
}).merge(scheduleOptionsSchema);

const emitSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown().optional(),
  channelId: z.string().min(1).optional(),
  parentEventId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
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

const channelsListSchema = z.object({
  kind: z.string().min(1).optional(),
  nameContains: z.string().min(1).optional(),
  participantType: z.string().min(1).optional(),
  participantId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).optional(),
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
    "events_dm_send",
    "Send a direct message to another agent. Optional scheduling via deliverAt, deliverAtIso, delayMs, or delaySeconds.",
    dmSendSchema,
  ],
  [
    "events_dm_reply",
    "Reply in the current direct-message channel. Optional scheduling via deliverAt, deliverAtIso, delayMs, or delaySeconds.",
    dmReplySchema,
  ],
  [
    "events_channel_send",
    "Send a message event to a specific channel. Optional scheduling via deliverAt, deliverAtIso, delayMs, or delaySeconds.",
    channelSendSchema,
  ],
  [
    "events_emit",
    "Emit a custom event by type to a channel (or current channel). Optional scheduling via deliverAt, deliverAtIso, delayMs, or delaySeconds.",
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
    "events_channels_list",
    "List channels and participants, with optional filters by kind/name/participant.",
    channelsListSchema,
  ],
  [
    "events_schedule_self",
    "Schedule an internal delayed trigger for this agent (not a user-visible message) using exactly one of deliverAt, deliverAtIso, delayMs, or delaySeconds.",
    scheduleSelfSchema,
  ],
];

async function ensureDirectChannel(
  ctx: ExecuteContext,
  targetAgentName: string,
): Promise<string> {
  const response = await ctx.apiFetch("/api/channels/direct/agent-agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      leftAgentName: ctx.agent.name,
      rightAgentName: targetAgentName,
    }),
  });
  const body = (await response.json()) as { id: string };
  return body.id;
}

async function sendMessage(
  ctx: ExecuteContext,
  channelId: string,
  text: string,
  deliverAt?: number,
) {
  const response = await ctx.apiFetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "message.created",
      source: `agent:${ctx.agent.name}`,
      channelId,
      payload: {
        text,
      },
      ...(deliverAt !== undefined ? { deliverAt } : {}),
    }),
  });
  return response.json();
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

function ensureAgentMention(text: string, agentName: string) {
  const mention = `@${agentName}`;
  return text.includes(mention) ? text : `${mention} ${text}`.trim();
}

function agentNameFromSource(source: string | undefined): string | null {
  if (!source?.startsWith("agent:")) return null;
  const name = source.slice("agent:".length).trim();
  return name || null;
}

export async function execute(
  ctx: ExecuteContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (tool === "events_dm_send") {
    const parsed = dmSendSchema.parse(args);
    const deliverAt = resolveDeliverAt(parsed);
    const channelId = await ensureDirectChannel(ctx, parsed.agentName);
    const text = ensureAgentMention(parsed.text, parsed.agentName);
    const event = await sendMessage(
      ctx,
      channelId,
      text,
      deliverAt,
    );
    return { channelId, event };
  }

  if (tool === "events_dm_reply") {
    const parsed = dmReplySchema.parse(args);
    const deliverAt = resolveDeliverAt(parsed);
    if (!ctx.channelId) {
      return { error: "No current channelId. Use events_dm_send instead." };
    }
    const triggerAgent = agentNameFromSource(ctx.triggerEvent.source);
    const text =
      triggerAgent && triggerAgent !== ctx.agent.name
        ? ensureAgentMention(parsed.text, triggerAgent)
        : parsed.text;
    const event = await sendMessage(
      ctx,
      ctx.channelId,
      text,
      deliverAt,
    );
    return { channelId: ctx.channelId, event };
  }

  if (tool === "events_channel_send") {
    const parsed = channelSendSchema.parse(args);
    const deliverAt = resolveDeliverAt(parsed);
    const triggerAgent = agentNameFromSource(ctx.triggerEvent.source);
    const channelId = parsed.channelId;
    const text =
      channelId === ctx.channelId &&
      triggerAgent &&
      triggerAgent !== ctx.agent.name
        ? ensureAgentMention(parsed.text, triggerAgent)
        : parsed.text;
    const event = await sendMessage(
      ctx,
      channelId,
      text,
      deliverAt,
    );
    return { channelId, event };
  }

  if (tool === "events_channel_messages") {
    const parsed = channelMessagesSchema.parse(args);
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
    const parsed = searchSchema.parse(args);
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

  if (tool === "events_channels_list") {
    const parsed = channelsListSchema.parse(args);
    const response = await ctx.apiFetch("/api/channels");
    const channels = (await response.json()) as Array<{
      id: string;
      name?: string;
      kind?: string;
      participants?: Array<{ subscriberType?: string; subscriberId?: string }>;
    }>;
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

  if (tool === "events_emit") {
    const parsed = emitSchema.parse(args);
    const deliverAt = resolveDeliverAt(parsed);
    const defaultChannelId = ctx.channelId;
    const targetChannelId = parsed.channelId?.trim() || defaultChannelId;
    if (!targetChannelId) {
      return {
        error:
          "No target destination. Provide channelId or call from an event with channel context.",
      };
    }
    const response = await ctx.apiFetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: parsed.type.trim(),
        payload: parsed.payload ?? {},
        source: `agent:${ctx.agent.name}`,
        ...(targetChannelId ? { channelId: targetChannelId } : {}),
        ...(parsed.parentEventId ? { parentEventId: parsed.parentEventId } : {}),
        ...(parsed.idempotencyKey ? { idempotencyKey: parsed.idempotencyKey } : {}),
        ...(deliverAt !== undefined ? { deliverAt } : {}),
      }),
    });
    const event = await response.json();
    return {
      event,
      channelId: targetChannelId,
    };
  }

  if (tool === "events_schedule_self") {
    const parsed = scheduleSelfSchema.parse(args);
    const deliverAt = resolveDeliverAt(parsed);
    const channelId = parsed.channelId ?? ctx.channelId;
    if (!channelId) {
      return { error: "No current channelId. Provide channelId explicitly." };
    }
    const response = await ctx.apiFetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "agent.scheduled.trigger",
        source: "system:scheduler",
        channelId,
        payload: {
          text: parsed.text,
          targetAgentName: ctx.agent.name,
        },
        ...(deliverAt !== undefined ? { deliverAt } : {}),
      }),
    });
    const event = await response.json();
    return { channelId, event };
  }

  throw new Error(`Unknown events tool: ${tool}`);
}
