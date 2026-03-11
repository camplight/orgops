import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  ensureOrgOpsChannelSubscription,
  emitOrgOpsEvent,
  getAgent,
  getEnvForAgent,
  optionalString,
  parseArgs,
  requireString,
  slackApiGet,
} from "./_shared";

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

function safeExtFromMime(mime?: string) {
  if (!mime) return "";
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/gif") return ".gif";
  if (mime === "application/pdf") return ".pdf";
  if (mime === "text/plain") return ".txt";
  return "";
}

async function downloadToFile(input: { url: string; botToken: string; outPath: string }) {
  const res = await fetch(input.url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${input.botToken}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to download slack file: ${res.status} ${text}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(input.outPath, buf);
  return { size: buf.byteLength };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const agent = getAgent(args);

  const fileId = requireString(args, "file");
  const outDir = optionalString(args, "out-dir") ?? "/tmp/orgops-slack-files";
  const orgopsChannelId = optionalString(args, "orgops-channel-id");
  const teamId = optionalString(args, "team-id");
  const slackChannelId = optionalString(args, "channel-id");

  const botToken = getEnvForAgent(agent, "SLACK_BOT_TOKEN");

  const info = await slackApiGet<SlackFileInfoResponse>(botToken, "files.info", { file: fileId });
  const file = info.file;
  const url = file.url_private_download ?? file.url_private;
  if (!url) throw new Error("Slack file missing url_private(_download)");

  await fs.mkdir(outDir, { recursive: true });

  const ext = safeExtFromMime(file.mimetype) || (file.name ? path.extname(file.name) : "");
  const rand = crypto.randomBytes(6).toString("hex");
  const outPath = path.join(outDir, `${file.id}-${rand}${ext}`);

  const dl = await downloadToFile({ url, botToken, outPath });

  // Optionally emit an event so other agents can consume the stable path.
  if (orgopsChannelId || (teamId && slackChannelId)) {
    const canonicalChannelId = await ensureOrgOpsChannelSubscription({
      channelId: orgopsChannelId,
      agentName: agent,
      teamId: teamId,
      slackChannelId: slackChannelId,
    });

    await emitOrgOpsEvent({
      type: "slack.file.fetched",
      source: `skill:slack:${agent}`,
      channelId: canonicalChannelId,
      payload: {
        fileId: file.id,
        path: outPath,
        mime: file.mimetype ?? null,
        size: file.size ?? dl.size,
        name: file.name ?? null,
        title: file.title ?? null,
        url_private_download: file.url_private_download ?? null,
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        fileId: file.id,
        path: outPath,
        mime: file.mimetype,
        size: file.size ?? dl.size,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
