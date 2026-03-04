import { z } from "zod";
import type { ExecuteContext, ToolDef } from "./types";

const dmSendSchema = z.object({
  agentName: z.string().min(1),
  text: z.string().min(1),
  deliverAt: z.number().int().optional(),
});

const dmReplySchema = z.object({
  text: z.string().min(1),
  deliverAt: z.number().int().optional(),
});

const channelSendSchema = z.object({
  channelId: z.string().min(1),
  text: z.string().min(1),
  deliverAt: z.number().int().optional(),
});

const channelMessagesSchema = z.object({
  channelId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  after: z.number().int().min(0).optional(),
});

const scheduleSelfSchema = z.object({
  text: z.string().min(1),
  deliverAt: z.number().int(),
  channelId: z.string().min(1).optional(),
});

export const eventsToolDefs: ToolDef[] = [
  [
    "events_dm_send",
    "Send a direct message to another agent using a direct channel.",
    dmSendSchema,
  ],
  [
    "events_dm_reply",
    "Reply in the current direct-message channel.",
    dmReplySchema,
  ],
  [
    "events_channel_send",
    "Send a message event to a specific channel.",
    channelSendSchema,
  ],
  [
    "events_channel_messages",
    "Get message.created events from a channel.",
    channelMessagesSchema,
  ],
  [
    "events_schedule_self",
    "Schedule a delayed message for this agent in the current (or specified) channel.",
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
      ...(deliverAt ? { deliverAt } : {}),
    }),
  });
  return response.json();
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
      parsed.deliverAt,
    );
    return { channelId, event };
  }

  if (tool === "events_dm_reply") {
    const parsed = dmReplySchema.parse(args);
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
      parsed.deliverAt,
    );
    return { channelId: ctx.channelId, event };
  }

  if (tool === "events_channel_send") {
    const parsed = channelSendSchema.parse(args);
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
      parsed.deliverAt,
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
    const channelId = parsed.channelId ?? ctx.channelId;
    if (!channelId) {
      return { error: "No current channelId. Provide channelId explicitly." };
    }
    const originChannelId = resolveOriginChannelId(ctx);
    const originAgentName = resolveOriginAgentName(ctx);
    const event = await sendMessage(
      ctx,
      channelId,
      parsed.text,
      originChannelId,
      originAgentName,
      parsed.deliverAt,
    );
    return { channelId, event };
  }

  throw new Error(`Unknown events tool: ${tool}`);
}
