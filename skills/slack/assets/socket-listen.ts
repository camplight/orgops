import {
  emitOrgOpsEvent,
  ensureOrgOpsChannelSubscription,
  getAgent,
  getEnvForAgent,
  parseArgs,
  slackApi,
} from "./_shared";

// Minimal Slack Socket Mode client (no external deps)
// References:
// - https://api.slack.com/apis/connections/socket
// - apps.connections.open

type OpenResp = { url: string };
type AuthTestResp = { user_id?: string; bot_id?: string };

type SocketEnvelope = {
  envelope_id: string;
  type: string;
  payload?: any;
  accepts_response_payload?: boolean;
};

type SlackIdentity = {
  userId: string;
  botId?: string;
};

type OrgOpsEventRow = {
  id: string;
  type: string;
  source: string;
  channelId?: string;
  payload?: Record<string, unknown>;
  createdAt?: number;
};

type OrgOpsChannelRow = {
  id?: string;
  name?: string;
};

async function slackOpenSocket(appToken: string): Promise<string> {
  const res = await fetch("https://slack.com/api/apps.connections.open", {
    method: "POST",
    headers: {
      authorization: `Bearer ${appToken}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "",
  });
  const json = (await res.json()) as any;
  if (!json?.ok) throw new Error(`apps.connections.open failed: ${json?.error ?? "unknown"}`);
  return (json as OpenResp).url;
}

async function slackAuthTest(botToken: string): Promise<SlackIdentity> {
  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: {
      authorization: `Bearer ${botToken}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "",
  });
  const json = (await res.json()) as any;
  if (!json?.ok) {
    throw new Error(`auth.test failed: ${json?.error ?? "unknown"}`);
  }
  const userId = String((json as AuthTestResp).user_id ?? "").trim();
  const botIdRaw = String((json as AuthTestResp).bot_id ?? "").trim();
  if (!userId) {
    throw new Error("auth.test returned empty user_id");
  }
  return { userId, ...(botIdRaw ? { botId: botIdRaw } : {}) };
}

async function ackEnvelope(ws: WebSocket, envelopeId: string) {
  ws.send(JSON.stringify({ envelope_id: envelopeId }));
}

function toOrgOpsChannelId(teamId: string, channelId: string) {
  return `slack:${teamId}:${channelId}`;
}

function parseOrgOpsSlackChannelId(orgopsChannelId: string) {
  const parts = orgopsChannelId.split(":");
  if (parts.length !== 3 || parts[0] !== "slack") return null;
  return {
    teamId: parts[1] ?? "",
    channelId: parts[2] ?? "",
  };
}

async function emitSlackEventToOrgOps(
  agent: string,
  input: {
    type: "slack.message.created" | "slack.app_mention";
    teamId: string;
    slackChannelId: string;
    payload: Record<string, unknown>;
  },
) {
  const orgopsChannelId = toOrgOpsChannelId(input.teamId, input.slackChannelId);
  const canonicalOrgOpsChannelId = await ensureOrgOpsChannelSubscription({
    channelId: orgopsChannelId,
    agentName: agent,
  });
  const slackTs = String(input.payload.ts ?? "").trim() || undefined;
  const slackThreadTs = String(input.payload.threadTs ?? "").trim() || undefined;
  const slackUserId = String(input.payload.userId ?? "").trim() || undefined;
  const text = String(input.payload.text ?? "");
  const inboundAction = input.type === "slack.app_mention" ? "app_mention" : "message_created";

  // Provider-agnostic integration envelope for future connectors (Slack/Discord/Telegram/etc).
  await emitOrgOpsEvent({
    type: "integration.event.inbound",
    source: `integration:slack:${agent}`,
    channelId: canonicalOrgOpsChannelId,
    payload: {
      provider: "slack",
      connection: agent,
      action: inboundAction,
      target: {
        workspaceId: input.teamId,
        spaceId: input.slackChannelId,
        ...(slackThreadTs ? { threadId: slackThreadTs } : {}),
        ...(slackTs ? { messageId: slackTs } : {}),
      },
      actor: {
        ...(slackUserId ? { externalUserId: slackUserId } : {}),
      },
      text,
      data: input.payload,
    },
  });
}

async function handleSlackEvent(agent: string, event: any) {
  const teamId = String(event?.team_id ?? event?.team ?? "");
  const inner = event?.event;
  if (!teamId || !inner) return;

  if (inner.type === "message") {
    // Ignore bot messages to avoid loops
    if (inner.subtype === "bot_message" || inner.bot_id) return;

    const channelId = String(inner.channel ?? "");
    const userId = String(inner.user ?? "");
    const text = String(inner.text ?? "");
    const ts = String(inner.ts ?? "");
    const threadTs = inner.thread_ts ? String(inner.thread_ts) : undefined;

    if (!channelId || !userId || !ts) return;

    await emitSlackEventToOrgOps(agent, {
      type: "slack.message.created",
      teamId,
      slackChannelId: channelId,
      payload: {
        teamId,
        channelId,
        channelType: inner.channel_type ?? undefined,
        userId,
        text,
        ts,
        threadTs,
        raw: inner,
      },
    });
    return;
  }

  if (inner.type === "app_mention") {
    const channelId = String(inner.channel ?? "");
    const userId = String(inner.user ?? "");
    const text = String(inner.text ?? "");
    const ts = String(inner.ts ?? "");
    const threadTs = inner.thread_ts ? String(inner.thread_ts) : undefined;

    if (!channelId || !userId || !ts) return;

    await emitSlackEventToOrgOps(agent, {
      type: "slack.app_mention",
      teamId,
      slackChannelId: channelId,
      payload: {
        teamId,
        channelId,
        userId,
        text,
        ts,
        threadTs,
        raw: inner,
      },
    });
    return;
  }
}

function messageMentionsSelf(inner: any, selfUserId: string) {
  const text = String(inner?.text ?? "");
  if (!text) return false;
  return text.includes(`<@${selfUserId}>`);
}

async function handleSlackEventWithIdentity(
  agent: string,
  identity: SlackIdentity,
  event: any,
) {
  const teamId = String(event?.team_id ?? event?.team ?? "");
  const inner = event?.event;
  if (!teamId || !inner) return;

  if (inner.type === "message") {
    const isBotMessage = inner.subtype === "bot_message" || Boolean(inner.bot_id);
    const senderUserId = String(inner.user ?? "").trim();
    const senderBotId = String(inner.bot_id ?? "").trim();
    const isSelfMessage =
      senderUserId === identity.userId ||
      Boolean(identity.botId) && senderBotId === identity.botId;

    if (isSelfMessage) return;
    if (isBotMessage && !messageMentionsSelf(inner, identity.userId)) return;

    const channelId = String(inner.channel ?? "");
    const text = String(inner.text ?? "");
    const ts = String(inner.ts ?? "");
    const threadTs = inner.thread_ts ? String(inner.thread_ts) : undefined;
    const userId = senderUserId || senderBotId;

    if (!channelId || !userId || !ts) return;

    await emitSlackEventToOrgOps(agent, {
      type: "slack.message.created",
      teamId,
      slackChannelId: channelId,
      payload: {
        teamId,
        channelId,
        channelType: inner.channel_type ?? undefined,
        userId,
        text,
        ts,
        threadTs,
        raw: inner,
      },
    });
    return;
  }

  return handleSlackEvent(agent, event);
}

async function listRecentIntegrationCommands(
  after: number,
): Promise<OrgOpsEventRow[]> {
  const apiUrl = process.env.ORGOPS_API_URL ?? "http://localhost:8787";
  const token = process.env.ORGOPS_RUNNER_TOKEN;
  if (!token) throw new Error("Missing ORGOPS_RUNNER_TOKEN");

  const query = new URLSearchParams();
  query.set("type", "integration.command.requested");
  query.set("order", "asc");
  query.set("after", String(after));
  query.set("limit", "200");

  const res = await fetch(`${apiUrl}/api/events?${query.toString()}`, {
    headers: { "x-orgops-runner-token": token },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to list integration command events: ${res.status} ${text}`,
    );
  }
  return (await res.json()) as OrgOpsEventRow[];
}

async function resolveSlackChannelFromOrgOpsChannelId(
  orgopsChannelId: string,
  cache: Map<string, { teamId: string; channelId: string } | null>,
) {
  const direct = parseOrgOpsSlackChannelId(orgopsChannelId);
  if (direct) {
    cache.set(orgopsChannelId, direct);
    return direct;
  }

  if (cache.has(orgopsChannelId)) {
    return cache.get(orgopsChannelId) ?? null;
  }

  const apiUrl = process.env.ORGOPS_API_URL ?? "http://localhost:8787";
  const token = process.env.ORGOPS_RUNNER_TOKEN;
  if (!token) throw new Error("Missing ORGOPS_RUNNER_TOKEN");

  const res = await fetch(`${apiUrl}/api/channels`, {
    headers: { "x-orgops-runner-token": token },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to list orgops channels: ${res.status} ${text}`);
  }
  const channels = (await res.json()) as OrgOpsChannelRow[];
  const match = channels.find((channel) => channel.id === orgopsChannelId);
  const parsed = match?.name ? parseOrgOpsSlackChannelId(String(match.name)) : null;
  cache.set(orgopsChannelId, parsed);
  return parsed;
}

async function bridgeOrgOpsMessagesToSlack(
  agent: string,
  botToken: string,
  cursor: { afterCreatedAt: number },
  channelCache: Map<string, { teamId: string; channelId: string } | null>,
) {
  const events = (await listRecentIntegrationCommands(cursor.afterCreatedAt)).sort(
    (left, right) => Number(left.createdAt ?? 0) - Number(right.createdAt ?? 0),
  );
  if (events.length === 0) return;

  let maxCreatedAt = cursor.afterCreatedAt;
  for (const event of events) {
    const createdAt = Number(event.createdAt ?? 0);
    if (Number.isFinite(createdAt) && createdAt > maxCreatedAt) {
      maxCreatedAt = createdAt;
    }

    if (event.type === "integration.command.requested") {
      const provider = String(event.payload?.provider ?? "").trim().toLowerCase();
      if (provider !== "slack") continue;
      const connection = String(event.payload?.connection ?? "").trim();
      if (connection && connection !== agent) continue;
      if (!connection && event.source !== `agent:${agent}`) continue;
      const requestChannelId = String(event.channelId ?? "").trim();
      if (!requestChannelId) continue;

      const action = String(event.payload?.action ?? "").trim();
      const target = event.payload?.target as Record<string, unknown> | undefined;
      const targetSpaceId = String(target?.spaceId ?? "").trim();
      const targetThreadId = String(target?.threadId ?? "").trim();
      const payloadData = event.payload?.payload as Record<string, unknown> | undefined;
      const text = String(payloadData?.text ?? event.payload?.text ?? "").trim();
      if (!text) {
        await emitOrgOpsEvent({
          type: "integration.command.failed",
          source: `integration:slack:${agent}`,
          channelId: requestChannelId,
          payload: {
            provider: "slack",
            connection: agent,
            requestEventId: event.id,
            action,
            error: "Missing text payload",
          },
        });
        continue;
      }

      const channelId = String(event.channelId ?? "");
      const mappedTarget = channelId
        ? await resolveSlackChannelFromOrgOpsChannelId(channelId, channelCache)
        : null;
      const resolvedSpaceId = targetSpaceId || mappedTarget?.channelId || "";
      if (!resolvedSpaceId) {
        await emitOrgOpsEvent({
          type: "integration.command.failed",
          source: `integration:slack:${agent}`,
          channelId: requestChannelId,
          payload: {
            provider: "slack",
            connection: agent,
            requestEventId: event.id,
            action,
            error: "Unable to resolve Slack channel target",
          },
        });
        continue;
      }

      const postBody: Record<string, unknown> = {
        channel: resolvedSpaceId,
        text,
      };
      if (targetThreadId) {
        postBody.thread_ts = targetThreadId;
      } else {
        const payloadThreadTs = String(payloadData?.threadTs ?? "").trim();
        if (payloadThreadTs) postBody.thread_ts = payloadThreadTs;
      }

      if (action !== "post_message" && action !== "chat.postMessage") {
        await emitOrgOpsEvent({
          type: "integration.command.failed",
          source: `integration:slack:${agent}`,
          channelId: requestChannelId,
          payload: {
            provider: "slack",
            connection: agent,
            requestEventId: event.id,
            action,
            error: `Unsupported action: ${action}`,
          },
        });
        continue;
      }

      try {
        const response = await slackApi<{ ts?: string; channel?: string }>(
          botToken,
          "chat.postMessage",
          postBody,
        );
        await emitOrgOpsEvent({
          type: "integration.command.succeeded",
          source: `integration:slack:${agent}`,
          channelId: requestChannelId,
          payload: {
            provider: "slack",
            connection: agent,
            requestEventId: event.id,
            action,
            target: {
              ...(response.channel ? { spaceId: response.channel } : { spaceId: resolvedSpaceId }),
              ...(response.ts ? { messageId: response.ts } : {}),
              ...(typeof postBody.thread_ts === "string"
                ? { threadId: String(postBody.thread_ts) }
                : {}),
            },
          },
        });
      } catch (error) {
        await emitOrgOpsEvent({
          type: "integration.command.failed",
          source: `integration:slack:${agent}`,
          channelId: requestChannelId,
          payload: {
            provider: "slack",
            connection: agent,
            requestEventId: event.id,
            action,
            error: String(error),
          },
        });
      }
    }
  }

  cursor.afterCreatedAt = maxCreatedAt;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const agent = getAgent(args);

  const botToken = getEnvForAgent(agent, "SLACK_BOT_TOKEN");
  const appToken = getEnvForAgent(agent, "SLACK_APP_TOKEN");
  const identity = await slackAuthTest(botToken);
  const url = await slackOpenSocket(appToken);
  const bridgeCursor = { afterCreatedAt: Date.now() };
  const orgopsToSlackChannelCache = new Map<
    string,
    { teamId: string; channelId: string } | null
  >();

  console.log(
    `Socket Mode connected for agent=${agent} as user=${identity.userId}`,
  );

  const ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    console.log("ws open");
  });

  ws.addEventListener("message", async (msg) => {
    try {
      const data = typeof msg.data === "string" ? msg.data : Buffer.from(msg.data as any).toString("utf-8");
      const env = JSON.parse(data) as SocketEnvelope;
      if (!env?.envelope_id) return;

      // Always ack quickly
      await ackEnvelope(ws, env.envelope_id);

      if (env.type === "events_api") {
        await handleSlackEventWithIdentity(agent, identity, env.payload);
      }
    } catch (err) {
      console.error("socket message handling error", err);
    }
  });

  ws.addEventListener("close", () => {
    console.error("ws closed");
    process.exit(2);
  });

  ws.addEventListener("error", (e) => {
    console.error("ws error", e);
  });

  setInterval(() => {
    bridgeOrgOpsMessagesToSlack(
      agent,
      botToken,
      bridgeCursor,
      orgopsToSlackChannelCache,
    ).catch((err) => {
      console.error("orgops->slack bridge error", err);
    });
  }, 1500);
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
