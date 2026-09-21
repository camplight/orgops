#!/usr/bin/env node
// Comment/transition verb.
import { ready, request, cliArgs } from "./_lib.mjs";

const [issueKey, comment] = cliArgs();

const verdict = ready();
if (!verdict.ok) {
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  process.exit(1);
}

if (!issueKey || !comment) {
  process.stderr.write("usage: node update.mjs <issue-key> <comment>\n");
  process.exit(2);
}

const { config, credential } = verdict;
const result = await request({
  config,
  credential,
  method: "POST",
  path: `/issue/${encodeURIComponent(issueKey)}/comment`,
  body: { body: comment },
});
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(result.ok ? 0 : 1);
