import {
  getAgent,
  getEnvForAgent,
  parseArgs,
  printUsage,
  requireString,
  slackApi,
  wantsHelp,
} from "./_shared";

type Resp = { channel: { id: string } };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (wantsHelp(args)) {
    printUsage(`Usage:
  bun run skills/slack/assets/open-dm.ts -- --agent <agent> --user <userId>

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
  const resp = await slackApi<Resp>(botToken, "conversations.open", { users: user, return_im: true });
  console.log(JSON.stringify(resp, null, 2));
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
