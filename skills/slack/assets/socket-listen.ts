import { emitOrgOpsEvent, getAgent, getEnvForAgent, parseArgs } from "./_shared";

// Minimal Slack Socket Mode client (no external deps)
// References:
// - https://api.slack.com/apis/connections/socket
// - apps.connections.open

type OpenResp = { url: string };

type SocketEnvelope = {
  envelope_id: string;
  type: string;
  payload?: any;
  accepts_response_payload?: boolean;
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

async function ackEnvelope(ws: WebSocket, envelopeId: string) {
  ws.send(JSON.stringify({ envelope_id: envelopeId }));
}

function toOrgOpsChannelId(teamId: string, channelId: string) {
  return `slack:${teamId}:${channelId}`;
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

    await emitOrgOpsEvent({
      type: "slack.message.created",
      source: `slack:${teamId}:${agent}`,
      channelId: toOrgOpsChannelId(teamId, channelId),
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

    await emitOrgOpsEvent({
      type: "slack.app_mention",
      source: `slack:${teamId}:${agent}`,
      channelId: toOrgOpsChannelId(teamId, channelId),
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const agent = getAgent(args);

  const appToken = getEnvForAgent(agent, "SLACK_APP_TOKEN");
  const url = await slackOpenSocket(appToken);

  console.log(`Socket Mode connected for agent=${agent}`);

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
        await handleSlackEvent(agent, env.payload);
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

  // keep alive
  setInterval(() => {}, 60_000);
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
