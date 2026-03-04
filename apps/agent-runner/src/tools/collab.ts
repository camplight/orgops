import { z } from "zod";
import type { ExecuteContext, ToolDef } from "./types";

const dmSendSchema = z.object({
  agentName: z.string().min(1),
  text: z.string().min(1),
  inReplyTo: z.string().optional(),
  eventType: z.string().optional(),
  parentEventId: z.string().optional(),
});

const dmReplySchema = z.object({
  text: z.string().min(1),
  inReplyTo: z.string().optional(),
  eventType: z.string().optional(),
  parentEventId: z.string().optional(),
});

const channelSendSchema = z.object({
  channelId: z.string().min(1),
  text: z.string().min(1),
  inReplyTo: z.string().optional(),
  eventType: z.string().optional(),
  parentEventId: z.string().optional(),
});

const channelMessagesSchema = z.object({
  channelId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  after: z.number().int().min(0).optional(),
});

export const collabToolDefs: ToolDef[] = [
  [
    "collab_dm_send",
    "Send a direct message to another agent using a direct channel.",
    dmSendSchema,
  ],
  [
    "collab_dm_reply",
    "Reply in the current direct-message channel.",
    dmReplySchema,
  ],
  [
    "collab_channel_send",
    "Send a message to a specific channel.",
    channelSendSchema,
  ],
  [
    "collab_channel_messages",
    "Get message.created events from a channel.",
    channelMessagesSchema,
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
  inReplyTo?: string,
  eventType?: string,
  parentEventId?: string,
) {
  const payload: Record<string, unknown> = { text };
  if (inReplyTo) payload.inReplyTo = inReplyTo;
  if (eventType) payload.eventType = eventType;

  const response = await ctx.apiFetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "message.created",
      source: `agent:${ctx.agent.name}`,
      channelId,
      payload,
      ...(parentEventId ? { parentEventId } : {}),
    }),
  });
  return response.json();
}

function ensureAgentMention(text: string, agentName: string) {
  const mention = `@${agentName}`;
  return text.includes(mention) ? text : `${mention} ${text}`.trim();
}

export async function execute(
  ctx: ExecuteContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (tool === "collab_dm_send") {
    const parsed = dmSendSchema.parse(args);
    const channelId = await ensureDirectChannel(ctx, parsed.agentName);
    const text = ensureAgentMention(parsed.text, parsed.agentName);
    const event = await sendMessage(
      ctx,
      channelId,
      text,
      parsed.inReplyTo,
      parsed.eventType,
      parsed.parentEventId,
    );
    return { channelId, event };
  }

  if (tool === "collab_dm_reply") {
    const parsed = dmReplySchema.parse(args);
    if (!ctx.channelId) {
      return { error: "No current channelId. Use collab_dm_send instead." };
    }
    const event = await sendMessage(
      ctx,
      ctx.channelId,
      parsed.text,
      parsed.inReplyTo,
      parsed.eventType,
      parsed.parentEventId,
    );
    return { channelId: ctx.channelId, event };
  }

  if (tool === "collab_channel_send") {
    const parsed = channelSendSchema.parse(args);
    const event = await sendMessage(
      ctx,
      parsed.channelId,
      parsed.text,
      parsed.inReplyTo,
      parsed.eventType,
      parsed.parentEventId,
    );
    return { channelId: parsed.channelId, event };
  }

  if (tool === "collab_channel_messages") {
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

  throw new Error(`Unknown collaboration tool: ${tool}`);
}
