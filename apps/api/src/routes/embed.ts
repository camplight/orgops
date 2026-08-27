import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import {
  CHANNEL_KINDS,
  CHANNEL_VISIBILITY,
  schema,
} from "@orgops/db";
import {
  findActiveIntegrationKey,
  parseBearerToken,
  touchIntegrationKeyLastUsed,
  type IntegrationKeyRow,
} from "../integration-auth";

type EmbedDeps = {
  orm: any;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  insertEvent: (input: any) => any;
};

type EmbedConversationRow = {
  id: string;
  channel_id: string;
  agent_name: string;
  integration_key_id: string;
  idempotency_key: string | null;
  metadata_json: string | null;
  created_at: number;
  archived_at: number | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function toConversationApi(row: EmbedConversationRow) {
  return {
    id: row.id,
    object: "conversation",
    agent: row.agent_name,
    metadata: parseMetadata(row.metadata_json),
    created_at: Math.floor(row.created_at / 1000),
  };
}

function extractUserText(messages: unknown): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: unknown; content?: unknown };
    if (message?.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const parts = content
        .map((part) => {
          if (typeof part === "string") return part;
          if (
            part &&
            typeof part === "object" &&
            (part as { type?: unknown }).type === "text" &&
            typeof (part as { text?: unknown }).text === "string"
          ) {
            return (part as { text: string }).text;
          }
          return "";
        })
        .join("");
      if (parts.trim()) return parts.trim();
    }
  }
  return null;
}

function eventPayloadText(payloadJson: string): string {
  try {
    const payload = JSON.parse(payloadJson) as { text?: unknown };
    return typeof payload.text === "string" ? payload.text : "";
  } catch {
    return "";
  }
}

function requireEmbedKey(
  c: any,
  orm: any,
): { key: IntegrationKeyRow } | { error: Response } {
  const token = parseBearerToken(c.req.header("authorization"));
  if (!token) {
    return { error: c.json({ error: "Unauthorized" }, 401) };
  }
  const key = findActiveIntegrationKey(orm, token);
  if (!key) {
    return { error: c.json({ error: "Unauthorized" }, 401) };
  }
  touchIntegrationKeyLastUsed(orm, key.id);
  return { key };
}

function findOwnedConversation(
  orm: any,
  keyId: string,
  conversationId: string,
): EmbedConversationRow | undefined {
  return orm
    .select()
    .from(schema.embedConversations)
    .where(
      and(
        eq(schema.embedConversations.id, conversationId),
        eq(schema.embedConversations.integration_key_id, keyId),
      ),
    )
    .get() as EmbedConversationRow | undefined;
}

function embedTurnTimeoutMs() {
  const raw = Number(process.env.ORGOPS_EMBED_TURN_TIMEOUT_MS ?? 180000);
  return Number.isFinite(raw) && raw > 0 ? raw : 180000;
}

export function registerEmbedRoutes(app: Hono<any>, deps: EmbedDeps) {
  const { orm, jsonResponse, insertEvent } = deps;

  app.post("/v1/conversations", async (c) => {
    const auth = requireEmbedKey(c, orm);
    if ("error" in auth) return auth.error;
    const body = await c.req.json().catch(() => ({}));
    const idempotencyKey =
      typeof body.idempotency_key === "string" && body.idempotency_key.trim()
        ? body.idempotency_key.trim()
        : null;
    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : {};

    if (idempotencyKey) {
      const existing = orm
        .select()
        .from(schema.embedConversations)
        .where(
          and(
            eq(schema.embedConversations.integration_key_id, auth.key.id),
            eq(schema.embedConversations.idempotency_key, idempotencyKey),
          ),
        )
        .get() as EmbedConversationRow | undefined;
      if (existing) return jsonResponse(c, toConversationApi(existing));
    }

    const agent = orm
      .select({ name: schema.agents.name })
      .from(schema.agents)
      .where(eq(schema.agents.name, auth.key.agent_name))
      .get() as { name: string } | undefined;
    if (!agent) return jsonResponse(c, { error: "Agent not found" }, 404);

    const now = Date.now();
    const conversationId = `conv_${randomUUID()}`;
    const channelId = randomUUID();
    orm.insert(schema.channels).values({
      id: channelId,
      name: `embed:${conversationId}`,
      description: null,
      metadata_json: JSON.stringify({
        conversationId,
        integrationKeyId: auth.key.id,
        ...metadata,
      }),
      visibility: CHANNEL_VISIBILITY.PRIVATE,
      owner_human_id: auth.key.created_by_human_id,
      kind: CHANNEL_KINDS.INTEGRATION_BRIDGE,
      direct_participant_key: null,
      created_at: now,
      archived_at: null,
    }).run();
    orm
      .insert(schema.channelSubscriptions)
      .values({
        channel_id: channelId,
        subscriber_type: "AGENT",
        subscriber_id: auth.key.agent_name,
      })
      .onConflictDoNothing()
      .run();
    const row: EmbedConversationRow = {
      id: conversationId,
      channel_id: channelId,
      agent_name: auth.key.agent_name,
      integration_key_id: auth.key.id,
      idempotency_key: idempotencyKey,
      metadata_json: JSON.stringify(metadata),
      created_at: now,
      archived_at: null,
    };
    orm.insert(schema.embedConversations).values(row).run();
    return jsonResponse(c, toConversationApi(row), 201);
  });

  app.get("/v1/conversations/:id", (c) => {
    const auth = requireEmbedKey(c, orm);
    if ("error" in auth) return auth.error;
    const row = findOwnedConversation(orm, auth.key.id, c.req.param("id"));
    if (!row) return jsonResponse(c, { error: "Conversation not found" }, 404);
    return jsonResponse(c, toConversationApi(row));
  });

  app.post("/v1/chat/completions", async (c) => {
    const auth = requireEmbedKey(c, orm);
    if ("error" in auth) return auth.error;
    const body = await c.req.json().catch(() => ({}));
    const conversationId =
      (typeof body.conversation === "string" && body.conversation.trim()) ||
      (typeof c.req.header("x-orgops-conversation") === "string" &&
        c.req.header("x-orgops-conversation")?.trim()) ||
      "";
    if (!conversationId) {
      return jsonResponse(c, { error: "conversation is required" }, 400);
    }
    const conversation = findOwnedConversation(orm, auth.key.id, conversationId);
    if (!conversation || conversation.archived_at) {
      return jsonResponse(c, { error: "Conversation not found" }, 404);
    }
    if (typeof body.model === "string" && body.model.trim() && body.model.trim() !== conversation.agent_name) {
      return jsonResponse(
        c,
        { error: `model must be ${conversation.agent_name}` },
        400,
      );
    }
    const text = extractUserText(body.messages);
    if (!text) {
      return jsonResponse(c, { error: "messages must include a user message" }, 400);
    }

    const trigger = insertEvent({
      type: "message.created",
      source: `integration:${auth.key.name}`,
      channelId: conversation.channel_id,
      payload: { text },
    });

    const deadline = Date.now() + embedTurnTimeoutMs();
    const agentSource = `agent:${conversation.agent_name}`;
    let assistantText = "";
    let foundReply = false;
    while (Date.now() < deadline) {
      const failed = orm
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.channel_id, conversation.channel_id),
            eq(schema.events.type, "agent.turn.failed"),
            eq(schema.events.source, agentSource),
            gt(schema.events.created_at, trigger.created_at),
          ),
        )
        .get() as { payload_json?: string } | undefined;
      if (failed) {
        const errorText = eventPayloadText(failed.payload_json ?? "") || "Agent turn failed";
        return jsonResponse(c, { error: errorText }, 502);
      }
      const reply = orm
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.channel_id, conversation.channel_id),
            eq(schema.events.type, "message.created"),
            eq(schema.events.source, agentSource),
            gt(schema.events.created_at, trigger.created_at),
          ),
        )
        .get() as { payload_json?: string } | undefined;
      if (reply) {
        assistantText = eventPayloadText(reply.payload_json ?? "");
        foundReply = true;
        break;
      }
      await sleep(50);
    }
    if (!foundReply) {
      return jsonResponse(c, { error: "Agent turn timed out" }, 504);
    }

    const completionId = `chatcmpl_${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    if (body.stream === true) {
      const chunk = {
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model: conversation.agent_name,
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: assistantText },
            finish_reason: null,
          },
        ],
      };
      const done = {
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model: conversation.agent_name,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      };
      const sse = `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(done)}\n\ndata: [DONE]\n\n`;
      return new Response(sse, {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
      });
    }

    return jsonResponse(c, {
      id: completionId,
      object: "chat.completion",
      created,
      model: conversation.agent_name,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: assistantText },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  });
}
