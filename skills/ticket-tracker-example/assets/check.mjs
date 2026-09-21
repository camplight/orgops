#!/usr/bin/env node
// Readiness-check verb: same "one JSON verdict, exit 0 iff ready" convention
// as upstream's `gcli/assets/ensure.ts` and `skills/secrets`' own
// credential-presence check. Never attempts a network call.
import { ready } from "./_lib.mjs";

const verdict = ready();
process.stdout.write(`${JSON.stringify(verdict)}\n`);
process.exit(verdict.ok ? 0 : 1);
