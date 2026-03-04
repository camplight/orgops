import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const scriptPath = join(import.meta.dir, "run.py");
if (!existsSync(scriptPath)) {
  console.error("Missing run.py");
  process.exit(1);
}

const task = Bun.argv.slice(2).join(" ").trim() || process.env.BROWSER_USE_TASK;
if (!task) {
  console.error("Usage: bun run run.ts <task> or set BROWSER_USE_TASK");
  process.exit(1);
}

const result = spawnSync("python3", [scriptPath, task], { stdio: "inherit" });
process.exit(result.status ?? 0);
