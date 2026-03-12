import {
  getAgent,
  getEnvForAgent,
  parseArgs,
  printUsage,
  requireString,
  slackApiGet,
  wantsHelp,
} from "./_shared";

type Resp = { user: unknown };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (wantsHelp(args)) {
    printUsage(`Usage:
  bun run skills/slack/assets/user-info.ts -- --agent <agent> --user <userId>

Options:
  --agent  Agent name (uses SLACK_BOT_TOKEN__<agent>)
  --user   Slack user id (e.g. U123...)
  --help   Show this help
`);
    return;
  }
  const agent = getAgent(args);
  const user = requireString(args, "user");

  const botToken = getEnvForAgent(agent, "SLACK_BOT_TOKEN");
  const resp = await slackApiGet<Resp>(botToken, "users.info", { user });
  console.log(JSON.stringify(resp, null, 2));
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
