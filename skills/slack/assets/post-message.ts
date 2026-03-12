import {
  getAgent,
  getEnvForAgent,
  parseArgs,
  printUsage,
  requireString,
  slackApi,
  wantsHelp,
} from "./_shared";

type Resp = { channel: string; ts: string; message: unknown };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (wantsHelp(args)) {
    printUsage(`Usage:
  bun run skills/slack/assets/post-message.ts -- --agent <agent> --channel <channelId> --text "<message>"

Options:
  --agent     Agent name (uses SLACK_BOT_TOKEN__<agent>)
  --channel   Slack channel id (e.g. C123..., D123...)
  --text      Message body
  --help      Show this help
`);
    return;
  }
  const agent = getAgent(args);
  const channel = requireString(args, "channel");
  const text = requireString(args, "text");

  const botToken = getEnvForAgent(agent, "SLACK_BOT_TOKEN");
  const resp = await slackApi<Resp>(botToken, "chat.postMessage", { channel, text });
  console.log(JSON.stringify(resp, null, 2));
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
