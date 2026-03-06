import {
  getAgent,
  getEnvForAgent,
  optionalString,
  parseArgs,
  requireString,
  slackApi,
} from "./_shared";

type Resp = { channel: string; ts: string; message: unknown };

function parseOrgOpsSlackChannelId(orgopsChannelId: string) {
  const parts = orgopsChannelId.split(":");
  if (parts.length !== 3 || parts[0] !== "slack") {
    throw new Error(
      `Invalid --orgops-channel-id (${orgopsChannelId}). Expected format slack:<teamId>:<channelId>.`,
    );
  }
  return { teamId: parts[1]!, channelId: parts[2]! };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const agent = getAgent(args);
  const text = requireString(args, "text");

  const orgopsChannelId = optionalString(args, "orgops-channel-id");
  const channel = optionalString(args, "channel");
  const threadTs = optionalString(args, "thread-ts");
  const eventTs = optionalString(args, "event-ts");

  let resolvedChannel = channel;
  if (!resolvedChannel && orgopsChannelId) {
    const parsed = parseOrgOpsSlackChannelId(orgopsChannelId);
    resolvedChannel = parsed.channelId;
  }
  if (!resolvedChannel) {
    throw new Error("Provide --channel or --orgops-channel-id");
  }

  const resolvedThreadTs = threadTs ?? eventTs;
  const botToken = getEnvForAgent(agent, "SLACK_BOT_TOKEN");
  const body: Record<string, unknown> = { channel: resolvedChannel, text };
  if (resolvedThreadTs) body.thread_ts = resolvedThreadTs;

  const resp = await slackApi<Resp>(botToken, "chat.postMessage", body);
  console.log(JSON.stringify(resp, null, 2));
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
