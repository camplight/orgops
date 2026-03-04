import { getAgent, getEnvForAgent, parseArgs, requireString, slackApiGet } from "./_shared";

type Resp = { user: unknown };

async function main() {
  const args = parseArgs(process.argv.slice(2));
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
