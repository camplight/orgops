import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_API_URL, DEFAULT_RUNNER_TOKEN, ROOT_ENV_FILE } from "./config";
import { parseSimpleEnv, writeMergedEnvFile } from "./env";

export type RunnerBootstrapOptions = {
  runnerApiUrl?: string;
  runnerToken?: string;
  runnerName?: string;
  runnerInviteUrl?: string;
};

type RunnerInviteResponse = {
  ok?: boolean;
  bootstrap?: {
    apiBaseUrl?: string;
    runnerToken?: string;
    runnerName?: string | null;
  };
};

export type RunnerBootstrapConfig = {
  apiUrl: string;
  runnerToken: string;
  runnerName?: string;
};

function normalizeUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

async function fetchInviteConfig(inviteUrl: string): Promise<RunnerBootstrapConfig> {
  const target = inviteUrl.trim();
  if (!target) throw new Error("runner invite URL is empty");
  const response = await fetch(target);
  if (!response.ok) {
    throw new Error(`runner invite request failed: ${response.status}`);
  }
  const payload = (await response.json()) as RunnerInviteResponse;
  const apiUrl = normalizeUrl(payload.bootstrap?.apiBaseUrl);
  const runnerToken = (payload.bootstrap?.runnerToken ?? "").trim();
  const runnerName = (payload.bootstrap?.runnerName ?? "").trim();
  if (!apiUrl || !runnerToken) {
    throw new Error("runner invite payload is missing apiBaseUrl or runnerToken");
  }
  return { apiUrl, runnerToken, runnerName: runnerName || undefined };
}

export async function resolveRunnerBootstrap(
  options: RunnerBootstrapOptions
): Promise<RunnerBootstrapConfig> {
  if (options.runnerInviteUrl?.trim()) {
    const fromInvite = await fetchInviteConfig(options.runnerInviteUrl);
    return {
      apiUrl: normalizeUrl(options.runnerApiUrl) || fromInvite.apiUrl,
      runnerToken: (options.runnerToken ?? "").trim() || fromInvite.runnerToken,
      runnerName: (options.runnerName ?? "").trim() || fromInvite.runnerName,
    };
  }
  return {
    apiUrl: normalizeUrl(options.runnerApiUrl) || DEFAULT_API_URL,
    runnerToken: (options.runnerToken ?? "").trim() || DEFAULT_RUNNER_TOKEN,
    runnerName: (options.runnerName ?? "").trim() || undefined,
  };
}

export function writeRunnerEnvConfig(installDir: string, config: RunnerBootstrapConfig) {
  const envPath = resolve(installDir, ROOT_ENV_FILE);
  const patch: Record<string, string> = {
    ORGOPS_API_URL: config.apiUrl,
    ORGOPS_RUNNER_TOKEN: config.runnerToken,
  };
  if (config.runnerName) patch.ORGOPS_RUNNER_NAME = config.runnerName;
  writeMergedEnvFile(envPath, patch);
}

export function readRunnerEnvConfig(installDir: string): RunnerBootstrapConfig | null {
  const envPath = resolve(installDir, ROOT_ENV_FILE);
  if (!existsSync(envPath)) return null;
  const parsed = parseSimpleEnv(readFileSync(envPath, "utf-8"));
  const apiUrl = normalizeUrl(parsed.ORGOPS_API_URL);
  const runnerToken = (parsed.ORGOPS_RUNNER_TOKEN ?? "").trim();
  const runnerName = (parsed.ORGOPS_RUNNER_NAME ?? "").trim();
  if (!apiUrl || !runnerToken) return null;
  return { apiUrl, runnerToken, runnerName: runnerName || undefined };
}

