import {
  getAgent,
  getEnvForAgent,
  optionalString,
  parseArgs,
  printUsage,
  requireString,
  slackApi,
  wantsHelp,
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
  if (wantsHelp(args)) {
    printUsage(`Usage:
  bun run skills/slack/assets/respond-to-event.ts -- --agent <agent> --text "<message>" [--channel <channelId> | --orgops-channel-id slack:<teamId>:<channelId>] [--thread-ts <threadTs> | --event-ts <eventTs>]

Options:
  --agent              Agent name (uses SLACK_BOT_TOKEN__<agent>)
  --text               Message body
  --channel            Slack channel id
  --orgops-channel-id  OrgOps Slack bridge channel name (slack:<teamId>:<channelId>)
  --thread-ts          Explicit thread target
  --event-ts           Use inbound event ts as thread target
  --help               Show this help

Notes:
  Provide either --channel or --orgops-channel-id.
  If neither --thread-ts nor --event-ts is provided, posts a regular channel message.
`);
    return;
  }
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
