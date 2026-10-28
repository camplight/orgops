import { spawnSync, type SpawnSyncOptions } from "node:child_process";

export function npmCommandForHost() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function quoteWindowsArg(value: string) {
  if (!/[\s"]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function usesWindowsShell(command: string) {
  return process.platform === "win32" && (/\.(cmd|bat)$/i.test(command) || /^(npm|npx)$/i.test(command));
}

function spawnCommand(command: string, args: string[], extra: SpawnSyncOptions) {
  const shell = usesWindowsShell(command);
  return spawnSync(command, shell ? args.map(quoteWindowsArg) : args, {
    ...extra,
    shell,
  });
}

export function commandAvailable(command: string, args: string[] = ["--version"]) {
  const result = spawnCommand(command, args, {
    stdio: "ignore",
    env: process.env,
  });
  return result.status === 0;
}

export function capture(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
) {
  return spawnCommand(command, args, {
    cwd: options?.cwd ?? process.cwd(),
    encoding: "utf-8",
    env: options?.env ?? process.env,
  });
}

export function runChecked(
  command: string,
  args: string[],
  cwdOrOptions?: string | { cwd?: string; env?: NodeJS.ProcessEnv }
) {
  const cwd = typeof cwdOrOptions === "string" ? cwdOrOptions : cwdOrOptions?.cwd;
  const env = typeof cwdOrOptions === "string" ? process.env : cwdOrOptions?.env ?? process.env;
  const result = spawnCommand(command, args, {
    cwd: cwd ?? process.cwd(),
    encoding: "utf-8",
    stdio: ["ignore", "inherit", "pipe"],
    env,
  });
  if (result.status !== 0) {
    const detail = typeof result.stderr === "string" && result.stderr.trim() ? `: ${result.stderr.trim()}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}${detail}`);
  }
}
