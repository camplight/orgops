import { getAgent, getEnvForAgent, optionalString, parseArgs, requireString, slackApiGet } from "./_shared";

type Resp = { messages: unknown[]; has_more?: boolean; response_metadata?: unknown };

async function main() {
  const args = parseArgs(process.argv.slice(2));
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
