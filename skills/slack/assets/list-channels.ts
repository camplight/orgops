import { getAgent, getEnvForAgent, optionalString, parseArgs, slackApiGet } from "./_shared";

type Resp = { channels: unknown[]; response_metadata?: unknown };

async function main() {
  const args = parseArgs(process.argv.slice(2));
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
