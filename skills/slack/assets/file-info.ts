import { getAgent, getEnvForAgent, parseArgs, requireString, slackApiGet } from "./_shared";

type SlackFileInfoResponse = {
  ok: true;
  file: {
    id: string;
    name?: string;
    title?: string;
    mimetype?: string;
    filetype?: string;
    size?: number;
    url_private?: string;
    url_private_download?: string;
    permalink?: string;
    permalink_public?: string;
  };
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const agent = getAgent(args);
  const file = requireString(args, "file");

  const botToken = getEnvForAgent(agent, "SLACK_BOT_TOKEN");
  const res = await slackApiGet<SlackFileInfoResponse>(botToken, "files.info", { file });
  console.log(JSON.stringify(res.file, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
