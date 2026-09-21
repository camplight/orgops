#!/usr/bin/env node
// Create-issue verb.
import { ready, request, cliArgs } from "./_lib.mjs";

const [summary] = cliArgs();

const verdict = ready();
if (!verdict.ok) {
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  process.exit(1);
}

if (!summary) {
  process.stderr.write("usage: node create.mjs <summary>\n");
  process.exit(2);
}

const { config, credential } = verdict;
const result = await request({
  config,
  credential,
  method: "POST",
  path: "/issue",
  body: { project: config.projectKey, summary },
});
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(result.ok ? 0 : 1);
