import { getAgent, getEnvForAgent, parseArgs, requireString, slackApi } from "./_shared";

type Resp = { channel: string; ts: string; message: unknown };

async function main() {
  const args = parseArgs(process.argv.slice(2));
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
