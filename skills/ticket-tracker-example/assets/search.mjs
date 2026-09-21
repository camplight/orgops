#!/usr/bin/env node
// Search verb, built on _lib.mjs's tokenizer.
import { ready, request, tokenizeSearchTerm, cliArgs } from "./_lib.mjs";

const term = cliArgs().join(" ");

const verdict = ready();
if (!verdict.ok) {
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  process.exit(1);
}

if (!term) {
  process.stderr.write("usage: node search.mjs <search term>\n");
  process.exit(2);
}

const { config, credential } = verdict;
const tokens = tokenizeSearchTerm(term);
const result = await request({
  config,
  credential,
  method: "GET",
  path: `/search?project=${encodeURIComponent(config.projectKey)}&q=${encodeURIComponent(tokens.join(" "))}`,
});
process.stdout.write(`${JSON.stringify({ ...result, tokens })}\n`);
process.exit(result.ok ? 0 : 1);
