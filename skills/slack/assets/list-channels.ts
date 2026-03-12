import {
  getAgent,
  getEnvForAgent,
  optionalString,
  parseArgs,
  printUsage,
  slackApiGet,
  wantsHelp,
} from "./_shared";

type Resp = { channels: unknown[]; response_metadata?: unknown };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (wantsHelp(args)) {
    printUsage(`Usage:
  bun run skills/slack/assets/list-channels.ts -- --agent <agent> [--types public_channel,private_channel] [--limit 200] [--cursor <cursor>]

Options:
  --agent   Agent name (uses SLACK_BOT_TOKEN__<agent>)
  --types   Channel types (default: public_channel,private_channel)
  --limit   Page size (default: 200)
  --cursor  Pagination cursor from previous response
  --help    Show this help
`);
    return;
  }
  const agent = getAgent(args);
  const types = optionalString(args, "types") ?? "public_channel,private_channel";
  const limit = optionalString(args, "limit") ?? "200";
  const cursor = optionalString(args, "cursor");

  const botToken = getEnvForAgent(agent, "SLACK_BOT_TOKEN");
  const resp = await slackApiGet<Resp>(botToken, "conversations.list", { types, limit, cursor });
  console.log(JSON.stringify(resp, null, 2));
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
