import { execSync } from "node:child_process";
import os from "node:os";

export function withTvlyPath(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const next = { ...env };
  const home = os.homedir();

  const candidates = [
    // Common user-level Python bin dirs on macOS/Linux
    `${home}/Library/Python/3.12/bin`,
    `${home}/Library/Python/3.11/bin`,
    `${home}/Library/Python/3.10/bin`,
    `${home}/.local/bin`,
    `${home}/bin`,
  ];

  const existing = (next.PATH ?? "").split(":").filter(Boolean);
  const merged = [...candidates, ...existing]
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(":");

  next.PATH = merged;
  return next;
}

export function hasTvly(): boolean {
  try {
    execSync("command -v tvly", { stdio: "ignore", env: withTvlyPath() });
    return true;
  } catch {
    return false;
  }
}

export function ensureTvlyInstalled(): { installed: boolean; version?: string } {
  if (!hasTvly()) {
    // Tavily official installer
    execSync("curl -fsSL https://cli.tavily.com/install.sh | bash", {
      stdio: "inherit",
      env: withTvlyPath(),
    });
  }

  const version = execSync("tvly --version", {
    encoding: "utf8",
    env: withTvlyPath(),
  }).trim();

  return { installed: true, version };
}

export function requireApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.TAVILY_API_KEY;
  if (!key) {
    throw new Error(
      "Missing TAVILY_API_KEY env var. Set OrgOps secret package 'tavily' key 'TAVILY_API_KEY' so it is injected as env."
    );
  }
  return key;
}

export function runTvly(args: string[], opts?: { json?: boolean; env?: NodeJS.ProcessEnv }): string {
  const env = withTvlyPath(opts?.env ?? process.env);
  // If caller wants to rely on env auth, ensure key exists early for clearer errors.
  requireApiKey(env);

  const cmd = `tvly ${args.map((a) => JSON.stringify(a)).join(" ")}`;
  return execSync(cmd, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
}
