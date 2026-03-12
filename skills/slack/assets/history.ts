import {
  getAgent,
  getEnvForAgent,
  optionalString,
  parseArgs,
  printUsage,
  requireString,
  slackApiGet,
  wantsHelp,
} from "./_shared";

type Resp = { messages: unknown[]; has_more?: boolean; response_metadata?: unknown };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (wantsHelp(args)) {
    printUsage(`Usage:
  bun run skills/slack/assets/history.ts -- --agent <agent> --channel <channelId> [--limit 20] [--oldest <ts>] [--latest <ts>]

Options:
  --agent    Agent name (uses SLACK_BOT_TOKEN__<agent>)
  --channel  Slack channel id
  --limit    Max messages (default: 20)
  --oldest   Oldest message ts (inclusive-ish, Slack semantics)
  --latest   Latest message ts
  --help     Show this help
`);
    return;
  }
  const agent = getAgent(args);
  const channel = requireString(args, "channel");
  const limit = optionalString(args, "limit") ?? "20";
  const oldest = optionalString(args, "oldest");
  const latest = optionalString(args, "latest");

  const botToken = getEnvForAgent(agent, "SLACK_BOT_TOKEN");
  const resp = await slackApiGet<Resp>(botToken, "conversations.history", { channel, limit, oldest, latest });
  console.log(JSON.stringify(resp, null, 2));
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
