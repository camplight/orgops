#!/usr/bin/env node
// Read-issue verb.
import { ready, request, cliArgs } from "./_lib.mjs";

const [issueKey] = cliArgs();

const verdict = ready();
if (!verdict.ok) {
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  process.exit(1);
}

if (!issueKey) {
  process.stderr.write("usage: node get-issue.mjs <issue-key>\n");
  process.exit(2);
}

const { config, credential } = verdict;
const result = await request({
  config,
  credential,
  method: "GET",
  path: `/issue/${encodeURIComponent(issueKey)}`,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(result.ok ? 0 : 1);
