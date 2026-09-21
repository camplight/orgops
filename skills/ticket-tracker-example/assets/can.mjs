#!/usr/bin/env node
// Authority/permission-check verb: reports whether the configured adapter's
// action catalogue includes the requested action, without performing the
// action itself. Config/credential are still checked first, so this verb
// never reaches the catalogue check with a half-resolved adapter.
import { ready, ACTION_CATALOGUE } from "./_lib.mjs";

const [action] = process.argv.slice(2);

const verdict = ready();
if (!verdict.ok) {
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  process.exit(1);
}

if (!action) {
  process.stderr.write("usage: node can.mjs <action>\n");
  process.exit(2);
}

const known = Object.prototype.hasOwnProperty.call(ACTION_CATALOGUE, action);
const result = {
  ok: known,
  action,
  description: known ? ACTION_CATALOGUE[action] : null,
  reason: known ? null : `"${action}" is not in this adapter's action catalogue`,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(result.ok ? 0 : 1);
