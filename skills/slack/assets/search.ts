import { getAgent, getEnvForAgent, optionalString, parseArgs, requireString, slackApiGet } from "./_shared";

type Resp = { messages: unknown };

async function main() {
  const args = parseArgs(process.argv.slice(2));
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
