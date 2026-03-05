import { z } from "zod";
import type { ExecuteContext, ToolDef } from "./types";

const scheduleOptionsSchema = z.object({
  deliverAt: z.number().int().optional(),
  deliverAtIso: z.string().min(1).optional(),
  delayMs: z.number().int().positive().optional(),
  delaySeconds: z.number().int().positive().optional(),
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

const channelMessagesSchema = z.object({
  channelId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  after: z.number().int().min(0).optional(),
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
    "events_channel_messages",
    "Get message.created events from a channel.",
    channelMessagesSchema,
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
  originChannelId?: string,
  originAgentName?: string,
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
        ...(originChannelId ? { originChannelId } : {}),
        ...(originAgentName ? { originAgentName } : {}),
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

function resolveOriginChannelId(ctx: ExecuteContext): string | undefined {
  const fromPayload =
    typeof ctx.triggerEvent.payload?.originChannelId === "string"
      ? ctx.triggerEvent.payload.originChannelId.trim()
      : "";
  if (fromPayload) return fromPayload;
  return ctx.triggerEvent.channelId;
}

function resolveOriginAgentName(ctx: ExecuteContext): string | undefined {
  const fromPayload =
    typeof ctx.triggerEvent.payload?.originAgentName === "string"
      ? ctx.triggerEvent.payload.originAgentName.trim()
      : "";
  if (fromPayload) return fromPayload;
  return ctx.agent.name;
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
    const originChannelId = resolveOriginChannelId(ctx);
    const originAgentName = resolveOriginAgentName(ctx);
    const event = await sendMessage(
      ctx,
      channelId,
      text,
      originChannelId,
      originAgentName,
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
    const originChannelId = resolveOriginChannelId(ctx);
    const originAgentName = resolveOriginAgentName(ctx);
    const event = await sendMessage(
      ctx,
      ctx.channelId,
      text,
      originChannelId,
      originAgentName,
      deliverAt,
    );
    return { channelId: ctx.channelId, event };
  }

  if (tool === "events_channel_send") {
    const parsed = channelSendSchema.parse(args);
    const deliverAt = resolveDeliverAt(parsed);
    const triggerAgent = agentNameFromSource(ctx.triggerEvent.source);
    const originChannelId = resolveOriginChannelId(ctx);
    const originAgentName = resolveOriginAgentName(ctx);
    const channelId =
      parsed.channelId === originChannelId &&
      originAgentName &&
      ctx.agent.name !== originAgentName
        ? (ctx.channelId ?? parsed.channelId)
        : parsed.channelId;
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
      originChannelId,
      originAgentName,
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
