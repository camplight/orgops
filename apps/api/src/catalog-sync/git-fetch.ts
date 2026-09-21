import { spawn } from "node:child_process";
import type { GitHubDestination } from "./github-destination";

export const CATALOG_SYNC_GIT_LIMITS = Object.freeze({
  fetchMs: 60000, commandMs: 10000,
  stdoutBytes: 65536, stderrBytes: 65536,
  mirrorPathBytes: 4096, configBytes: 4096, packDirectoryEntries: 512,
} as const);
export const CATALOG_SYNC_STAGING_REF = "refs/orgops-sync/staging";
export const CATALOG_SYNC_CURRENT_REF = "refs/orgops-sync/current";
export type CatalogGitFailure = {
  code: "GIT_UNAVAILABLE" | "GIT_FAILED" | "GIT_TIMEOUT" | "GIT_LIMIT_EXCEEDED" | "GIT_PROTOCOL_ERROR" | "REF_MISSING";
};
export type CatalogGitResult<T> = { ok: true; value: T } | { ok: false; issue: CatalogGitFailure };
export type CatalogGitCredential = { username: string; password: string };

// Constant child environment: no inherited config, proxies, helpers or prompt paths.
const environment = Object.freeze({
  PATH: "", HOME: "/dev/null", XDG_CONFIG_HOME: "/dev/null", LC_ALL: "C", LANG: "C",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "https", GIT_OPTIONAL_LOCKS: "0", GIT_ATTR_NOSYSTEM: "1",
});
function fetchEnvironment(credential: CatalogGitCredential | undefined): Record<string, string> {
  if (!credential) return { ...environment };
  // The ONLY place the plaintext secret exists: an ephemeral child-process env value.
  // Never argv, never a URL, never a written/persisted file, never a log/error.
  const header = `Authorization: Basic ${Buffer.from(`${credential.username}:${credential.password}`, "utf8").toString("base64")}`;
  return { ...environment,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: header };
}

export type CatalogGitTransport = {
  fetch(destination: GitHubDestination, ref: string, mirror: string,
    credential: CatalogGitCredential | undefined): Promise<CatalogGitResult<true>>;
  resolveRef(mirror: string, ref: string): Promise<CatalogGitResult<string>>;
  updateRef(mirror: string, ref: string, commit: string, expected: string | null): Promise<CatalogGitResult<true>>;
  deleteRef(mirror: string, ref: string): Promise<CatalogGitResult<true>>;
};

const ZERO_COMMIT = "0000000000000000000000000000000000000000";
const COMMIT_LINE = /^([0-9a-f]{40})\n?$/;
const REAP_MS = 5000; // bounded post-kill close-observation allowance; never authorizes more work

type RunOptions = { env: Record<string, string>; timeoutMs: number };
function run(executable: string, args: readonly string[], cwd: string, options: RunOptions): Promise<CatalogGitResult<Buffer>> {
  return new Promise(resolve => {
    let selected: CatalogGitFailure | undefined;
    let stdoutBytes = 0, stderrBytes = 0;
    const out: Buffer[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reapTimer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(executable, args, { cwd, shell: false, detached: true,
      stdio: ["ignore", "pipe", "pipe"], env: options.env });
    const settle = (result: CatalogGitResult<Buffer>) => {
      if (timer) clearTimeout(timer);
      if (reapTimer) clearTimeout(reapTimer);
      resolve(result);
    };
    const kill = () => { if (child.pid !== undefined) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already reaped */ } } };
    // Selection only kills and records the FIRST failure; settlement NEVER happens here.
    const select = (code: CatalogGitFailure["code"]) => {
      if (selected) return;
      selected = { code };
      if (timer) clearTimeout(timer);
      kill();
      // Bounded reap allowance: if close is not observed after SIGKILL, settle with the
      // selected failure and destroy local pipes; no unref, no background work, no retry.
      reapTimer = setTimeout(() => {
        child.stdout.destroy(); child.stderr.destroy();
        settle({ ok: false, issue: selected! });
      }, REAP_MS);
    };
    timer = setTimeout(() => select("GIT_TIMEOUT"), options.timeoutMs);
    child.on("error", error => select((error as NodeJS.ErrnoException).code === "ENOENT" ? "GIT_UNAVAILABLE" : "GIT_FAILED"));
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > CATALOG_SYNC_GIT_LIMITS.stdoutBytes) { select("GIT_LIMIT_EXCEEDED"); return; }
      out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length; // counted then discarded; never returned or logged
      if (stderrBytes > CATALOG_SYNC_GIT_LIMITS.stderrBytes) select("GIT_LIMIT_EXCEEDED");
    });
    child.on("close", (code, signal) => {
      // The ONLY settlement point for the normal path: the owned child's close has been
      // observed (awaited POSIX-group ownership; kill on timeout/limit/error led here).
      if (selected) { settle({ ok: false, issue: selected }); return; }
      if (code !== 0 || signal !== null) { settle({ ok: false, issue: { code: "GIT_FAILED" } }); return; }
      settle({ ok: true, value: Buffer.concat(out) });
    });
  });
}

const argvPrefix = (mirror: string) => ["--no-pager", "--no-optional-locks", `--git-dir=${mirror}`,
  "-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", "-c", "maintenance.auto=false", "-c", "gc.auto=0"];

export function createCatalogGitTransport(executable: string): CatalogGitTransport {
  return {
    async fetch(destination, ref, mirror, credential) {
      const sourceRef = ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
      const result = await run(executable, [...argvPrefix(mirror), "-c", "http.followRedirects=false",
        "fetch", "--no-tags", "--depth=1", destination.fetchUrl, `+${sourceRef}:${CATALOG_SYNC_STAGING_REF}`],
        mirror, { env: fetchEnvironment(credential), timeoutMs: CATALOG_SYNC_GIT_LIMITS.fetchMs });
      return result.ok ? { ok: true, value: true } : { ok: false, issue: result.issue };
    },
    async resolveRef(mirror, ref) {
      const result = await run(executable, [...argvPrefix(mirror), "rev-parse", "--verify", ref],
        mirror, { env: { ...environment }, timeoutMs: CATALOG_SYNC_GIT_LIMITS.commandMs });
      // A plain nonzero exit is a missing ref; transport-level bounds failures stay themselves.
      if (!result.ok) return { ok: false, issue: result.issue.code === "GIT_FAILED" ? { code: "REF_MISSING" } : result.issue };
      const trimmed = result.value.toString("utf8").trim();
      if (!COMMIT_LINE.test(trimmed)) return { ok: false, issue: { code: "GIT_PROTOCOL_ERROR" } };
      return { ok: true, value: trimmed };
    },
    async updateRef(mirror, ref, commit, expected) {
      const result = await run(executable, [...argvPrefix(mirror), "update-ref", ref, commit, expected ?? ZERO_COMMIT],
        mirror, { env: { ...environment }, timeoutMs: CATALOG_SYNC_GIT_LIMITS.commandMs });
      return result.ok ? { ok: true, value: true } : { ok: false, issue: result.issue };
    },
    async deleteRef(mirror, ref) {
      const result = await run(executable, [...argvPrefix(mirror), "update-ref", "-d", ref],
        mirror, { env: { ...environment }, timeoutMs: CATALOG_SYNC_GIT_LIMITS.commandMs });
      return result.ok ? { ok: true, value: true } : { ok: false, issue: result.issue };
    },
  };
}
