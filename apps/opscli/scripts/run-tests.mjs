import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const extra = process.argv.slice(2);
const testDir = join(dirname(fileURLToPath(import.meta.url)), "..", "test");
const files =
  extra.length > 0
    ? extra
    : readdirSync(testDir)
        .filter((name) => /\.test\.(mjs|ts)$/.test(name))
        .map((name) => join(testDir, name))
        .sort();

if (files.length === 0) {
  console.error("No opscli tests found.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
