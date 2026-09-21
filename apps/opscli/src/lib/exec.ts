import { spawnSync } from "node:child_process";

export function npmCommandForHost() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function runChecked(command: string, args: string[], cwd?: string) {
  const result = spawnSync(command, args, {
    cwd: cwd ?? process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}
