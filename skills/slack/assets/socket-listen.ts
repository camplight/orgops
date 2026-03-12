import {
  emitOrgOpsEvent,
  ensureOrgOpsChannelSubscription,
  getAgent,
  getEnvForAgent,
  parseArgs,
  printUsage,
  slackApi,
  wantsHelp,
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

type OrgOpsEvent = {
  id: string;
  type: string;
  source?: string;
  channelId?: string;
  payload?: Record<string, unknown>;
  status?: string;
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

async function orgopsApiFetch(path: string, init?: RequestInit) {
  const apiUrl = process.env.ORGOPS_API_URL ?? "http://localhost:8787";
  const token = process.env.ORGOPS_RUNNER_TOKEN;
  if (!token) throw new Error("Missing ORGOPS_RUNNER_TOKEN");
  const headers = new Headers(init?.headers);
  headers.set("x-orgops-runner-token", token);
  const response = await fetch(`${apiUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OrgOps API ${path} failed: ${response.status} ${text}`);
  }
  return response;
}

type BridgeChannelInfo = {
  id?: string;
  name?: string;
  metadata?: {
    integrationBridge?: {
      provider?: string;
      connection?: string;
      teamId?: string;
      channelId?: string;
      threadTs?: string;
    };
  };
};

async function resolveBridgeTarget(input: {
  channelId: string;
}): Promise<{
  channelId: string;
  threadTs?: string;
  connection?: string;
} | null> {
  const channelsResponse = await orgopsApiFetch("/api/channels");
  const channels = (await channelsResponse.json()) as BridgeChannelInfo[];
  const bridge = channels.find((channel) => channel.id === input.channelId);
  if (!bridge) {
    return null;
  }
  const integrationBridge = bridge.metadata?.integrationBridge;
  if (integrationBridge?.provider === "slack" && integrationBridge.channelId) {
    return {
      channelId: integrationBridge.channelId,
      ...(integrationBridge.threadTs ? { threadTs: integrationBridge.threadTs } : {}),
      ...(integrationBridge.connection
        ? { connection: integrationBridge.connection }
        : {}),
    };
  }
  const fromName = String(bridge.name ?? "");
  const parts = fromName.split(":");
  if (parts.length === 3 && parts[0] === "slack" && parts[2]) {
    return { channelId: parts[2] };
  }
  return null;
}

async function failOrgOpsEvent(eventId: string, error: unknown) {
  await orgopsApiFetch(`/api/events/${encodeURIComponent(eventId)}/fail`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: String(error) }),
  });
}

async function handleOutboundMessageEvent(agent: string, botToken: string, event: OrgOpsEvent) {
  if (event.type !== "message.created") return;
  if (!event.source?.startsWith("agent:")) return;
  if (event.source === `channel:slack:${agent}`) return;
  const eventChannelId = String(event.channelId ?? "").trim();
  if (!eventChannelId) {
    await failOrgOpsEvent(event.id, "message.created missing channelId");
    return;
  }
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const text = String(payload.text ?? "").trim();
  if (!text) return;

  try {
    const target = await resolveBridgeTarget({ channelId: eventChannelId });
    if (!target) return;
    if (target.connection && target.connection !== agent) return;
    const explicitThreadTs =
      typeof payload.threadTs === "string" && payload.threadTs.trim()
        ? payload.threadTs.trim()
        : typeof payload.thread_ts === "string" && payload.thread_ts.trim()
          ? payload.thread_ts.trim()
          : undefined;
    const threadTs = explicitThreadTs ?? target.threadTs;
    const requestBody: Record<string, unknown> = {
      channel: target.channelId,
      text,
    };
    if (threadTs) {
      requestBody.thread_ts = threadTs;
    }
    await slackApi<Record<string, unknown>>(botToken, "chat.postMessage", requestBody);
  } catch (error) {
    await failOrgOpsEvent(event.id, error);
  }
}

async function pollOutboundMessages(agent: string, botToken: string) {
  const query = new URLSearchParams({
    agentName: agent,
    status: "PENDING",
    type: "message.created",
    sourcePrefix: "agent:",
    limit: "20",
  });
  const response = await orgopsApiFetch(`/api/events?${query.toString()}`);
  const events = (await response.json()) as OrgOpsEvent[];
  for (const event of events) {
    await handleOutboundMessageEvent(agent, botToken, event);
  }
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
    metadata: {
      integrationBridge: {
        provider: "slack",
        connection: agent,
        teamId: input.teamId,
        channelId: input.slackChannelId,
      },
    },
  });
  const slackTs = String(input.payload.ts ?? "").trim() || undefined;
  const slackThreadTs = String(input.payload.threadTs ?? "").trim() || undefined;
  const slackUserId = String(input.payload.userId ?? "").trim() || undefined;
  const text = String(input.payload.text ?? "");
  const inboundAction = input.type === "slack.app_mention" ? "app_mention" : "message_created";

  // Generic channel event envelope for connector-agnostic routing.
  await emitOrgOpsEvent({
    type: "channel.event.created",
    source: `channel:slack:${agent}`,
    channelId: canonicalOrgOpsChannelId,
    payload: {
      channel: {
        provider: "slack",
        connection: agent,
        workspaceId: input.teamId,
        spaceId: input.slackChannelId,
        ...(slackThreadTs ? { threadId: slackThreadTs } : {}),
        ...(slackTs ? { messageId: slackTs } : {}),
      },
      event: {
        action: inboundAction,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (wantsHelp(args)) {
    printUsage(`Usage:
  bun run skills/slack/assets/socket-listen.ts -- --agent <agent>

Options:
  --agent  Agent name (uses SLACK_BOT_TOKEN__<agent> and SLACK_APP_TOKEN__<agent>)
  --help   Show this help

Behavior:
  Starts Slack Socket Mode listener:
  - Slack inbound messages/app_mentions -> OrgOps channel.event.created
  - OrgOps outbound message.created (agent source) in slack bridge channels -> Slack chat.postMessage
`);
    return;
  }
  const agent = getAgent(args);

  const botToken = getEnvForAgent(agent, "SLACK_BOT_TOKEN");
  const appToken = getEnvForAgent(agent, "SLACK_APP_TOKEN");
  const identity = await slackAuthTest(botToken);
  const url = await slackOpenSocket(appToken);

  console.log(
    `Socket Mode connected for agent=${agent} as user=${identity.userId}`,
  );

  const ws = new WebSocket(url);
  let outboundPollInFlight = false;

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

  setInterval(async () => {
    if (outboundPollInFlight) return;
    outboundPollInFlight = true;
    try {
      await pollOutboundMessages(agent, botToken);
    } catch (error) {
      console.error("outbound message poll failed", error);
    } finally {
      outboundPollInFlight = false;
    }
  }, 1000);

}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
