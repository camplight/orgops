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
  bun run skills/slack/assets/reply.ts -- --agent <agent> --channel <channelId> --thread-ts <threadTs> --text "<message>"

Options:
  --agent      Agent name (uses SLACK_BOT_TOKEN__<agent>)
  --channel    Slack channel id
  --thread-ts  Parent thread timestamp
  --text       Reply body
  --help       Show this help
`);
    return;
  }
  const agent = getAgent(args);
  const channel = requireString(args, "channel");
  const thread_ts = requireString(args, "thread-ts");
  const text = requireString(args, "text");

  const botToken = getEnvForAgent(agent, "SLACK_BOT_TOKEN");
  const resp = await slackApi<Resp>(botToken, "chat.postMessage", { channel, text, thread_ts });
  console.log(JSON.stringify(resp, null, 2));
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
