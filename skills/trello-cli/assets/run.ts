import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error(
    "Usage: node --import tsx skills/trello-cli/assets/run.ts -- <trello-cli-args...>",
  );
  process.exit(1);
}

// Use npx to keep execution portable across hosts/runners.
const res = spawnSync("npx", ["-y", "@trello-cli/cli", ...args], {
  stdio: "inherit",
  env: process.env,
});

if (typeof res.status === "number") {
  process.exit(res.status);
}

process.exit(1);
