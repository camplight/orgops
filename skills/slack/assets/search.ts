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

type Resp = { messages: unknown };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (wantsHelp(args)) {
    printUsage(`Usage:
  bun run skills/slack/assets/search.ts -- --agent <agent> --query "<search query>" [--count 20]

Options:
  --agent  Agent name (uses SLACK_BOT_TOKEN__<agent>)
  --query  Slack search query
  --count  Maximum results (default: 20)
  --help   Show this help
`);
    return;
  }
  const agent = getAgent(args);
  const query = requireString(args, "query");
  const count = optionalString(args, "count") ?? "20";

  const botToken = getEnvForAgent(agent, "SLACK_BOT_TOKEN");
  const resp = await slackApiGet<Resp>(botToken, "search.messages", { query, count });
  console.log(JSON.stringify(resp, null, 2));
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
