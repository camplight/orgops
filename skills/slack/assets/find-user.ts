import {
  getAgent,
  getEnvForAgent,
  optionalString,
  parseArgs,
  printUsage,
  slackApiGet,
  wantsHelp,
} from "./_shared";

type SlackUser = {
  id: string;
  name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: {
    display_name?: string;
    display_name_normalized?: string;
    real_name?: string;
    real_name_normalized?: string;
  };
};

type UsersListResponse = {
  ok: true;
  members: SlackUser[];
  response_metadata?: { next_cursor?: string };
};

function norm(s: string) {
  return s.trim().toLowerCase();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (wantsHelp(args)) {
    printUsage(`Usage:
  bun run skills/slack/assets/find-user.ts -- --agent <agent> (--username <handle> | --display-name "<name>" | --query "<text>") [--limit 200]

Options:
  --agent         Agent name (uses SLACK_BOT_TOKEN__<agent>)
  --username      Exact Slack handle match
  --display-name  Exact display name match
  --query         Fuzzy search across common name/display fields
  --limit         users.list page size (default: 200, max: 200)
  --help          Show this help
`);
    return;
  }
  const agent = getAgent(args);
  const username = optionalString(args, "username");
  const displayName = optionalString(args, "display-name");
  const query = optionalString(args, "query");
  const limitStr = optionalString(args, "limit");
  const limit = limitStr ? Number(limitStr) : 200;

  if (!username && !displayName && !query) {
    throw new Error("Provide one of: --username <handle> | --display-name <name> | --query <text>");
  }

  const botToken = getEnvForAgent(agent, "SLACK_BOT_TOKEN");

  let cursor: string | undefined = undefined;
  const matches: SlackUser[] = [];

  // Slack users.list max limit is 200
  const pageLimit = Math.min(200, Math.max(1, Number.isFinite(limit) ? limit : 200));

  while (true) {
    const res = await slackApiGet<UsersListResponse>(botToken, "users.list", {
      limit: String(pageLimit),
      cursor
    });

    for (const u of res.members ?? []) {
      if (u.deleted) continue;
      if (u.is_bot) continue;

      const fields = [
        u.name,
        u.profile?.display_name,
        u.profile?.display_name_normalized,
        u.profile?.real_name,
        u.profile?.real_name_normalized
      ].filter(Boolean) as string[];

      const nfields = fields.map(norm);

      const ok =
        (username ? nfields.includes(norm(username)) : false) ||
        (displayName ? nfields.includes(norm(displayName)) : false) ||
        (query ? nfields.some((f) => f.includes(norm(query))) : false);

      if (ok) matches.push(u);
    }

    cursor = res.response_metadata?.next_cursor;
    if (!cursor) break;
  }

  // If --username was provided, prefer exact username match
  let out = matches;
  if (username) {
    const u = norm(username);
    const exact = matches.filter((m) => norm(m.name ?? "") === u);
    if (exact.length) out = exact;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        count: out.length,
        matches: out.map((u) => ({
          id: u.id,
          name: u.name,
          display_name: u.profile?.display_name,
          real_name: u.profile?.real_name
        }))
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(String(err?.stack ?? err));
  process.exit(1);
});
