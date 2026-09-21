// fixtures.test-helper.ts -- test-only; never imported by production code
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { CATALOG_SYNC_STAGING_REF, type CatalogGitTransport, type CatalogGitResult } from "./git-fetch";
import type { GitHubDestination } from "./github-destination";

export type FakeGitMode = "ok" | "hang" | "loud" | "fail";
export type FakeGit = { directory: string; executable: string; capture: string; dispose(): Promise<void> };
export async function createFakeGit(mode: FakeGitMode, commit = "0123456789abcdef0123456789abcdef01234567",
  expectedValue0?: string): Promise<FakeGit> {
  const directory = await mkdtemp(join(tmpdir(), "catalog-fake-git-"));
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    const executable = join(directory, "fake-git");
    const capture = join(directory, "capture");
    // Bake every value into the script: the child env is the production constant env (PATH=""),
    // so no CATALOG_GIT_* variable and no external utility is available. POSIX sh builtins only.
    const script = `#!/bin/sh
{
  printf 'argc=%s\\n' "$#"
  for a in "$@"; do printf 'arg=%s\\n' "$a"; done
  printf 'count=%s\\nkey0=%s\\n' "\${GIT_CONFIG_COUNT-unset}" "\${GIT_CONFIG_KEY_0-unset}"
  if [ "\${GIT_CONFIG_VALUE_0+set}" = set ]; then
    if [ "$GIT_CONFIG_VALUE_0" = '${expectedValue0 ?? ""}' ]; then printf 'value0=MATCH\\n'; else printf 'value0=MISMATCH\\n'; fi
  else printf 'value0=ABSENT\\n'; fi
  printf 'allow=%s\\nprompt=%s\\n' "\${GIT_ALLOW_PROTOCOL-unset}" "\${GIT_TERMINAL_PROMPT-unset}"
} >> '${capture}'
case '${mode}' in
  hang) while :; do :; done ;;
  loud) i=0; while [ "$i" -lt 4000 ]; do printf 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\n'; i=$((i+1)); done ;;
  fail) exit 1 ;;
  *) case " $* " in *" rev-parse "*) printf '%s\\n' '${commit}' ;; esac ;;
esac
exit 0
`;
    await writeFile(executable, script, { mode: 0o700 });
    await chmod(executable, 0o700);
    return { directory, executable, capture, dispose };
  } catch (error) { await dispose(); throw error; }
}

/** Real-git local fixture bare repo + a transport double fetching from it (file path, never network). */
export type FixtureRepoFile = { path: string; contents: string };
export type LocalFixtureRepo = {
  directory: string; commit: string; indexPath: string;
  /** Test-only deterministic transport fault switch; production never sees this helper. */
  failure: { enabled: boolean };
  publish(indexJson: string, files?: readonly FixtureRepoFile[]): Promise<string>;
  transport(calls: { fetch: { credential: { username: string; password: string } | undefined }[] }): CatalogGitTransport;
  dispose(): Promise<void>;
};
export async function createLocalFixtureRepo(indexJson: string, gitExecutable = "/usr/bin/git",
  files: readonly FixtureRepoFile[] = []): Promise<LocalFixtureRepo> {
  const directory = await mkdtemp(join(tmpdir(), "catalog-src-repo-"));
  const dispose = () => rm(directory, { recursive: true, force: true });
  const env = { PATH: "", HOME: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "F", GIT_AUTHOR_EMAIL: "f@x.invalid",
    GIT_COMMITTER_NAME: "F", GIT_COMMITTER_EMAIL: "f@x.invalid",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" };
  let lastOut = "";
  const run = (args: string[], cwd: string, input?: Buffer) => new Promise<void>((resolve, reject) => {
    execFile(gitExecutable, args, { cwd, env, timeout: 10000, maxBuffer: 1048576 }, (error, stdout) => {
      if (error) reject(error); else { lastOut = stdout; resolve(); }
    }).stdin?.end(input);
  });
  try {
    const work = join(directory, "work"); await mkdir(work);
    await mkdir(join(work, "catalog"));
    await writeFile(join(work, "catalog", "index.json"), indexJson);
    for (const file of files) {
      const full = join(work, file.path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, file.contents);
    }
    // Deterministic branch name: mirror HEAD and the compose flow both use main.
    await run(["init", "--quiet", "-b", "main"], work);
    await run(["add", "catalog/index.json", ...files.map(file => file.path)], work);
    await run(["commit", "--quiet", "-m", "fixture"], work);
    await run(["rev-parse", "HEAD"], work);
    const commit = lastOut.trim();
    await run(["clone", "--quiet", "--bare", work, join(directory, "remote.git")], directory);
    const remote = join(directory, "remote.git");
    const failure = { enabled: false };
    const publish = async (nextIndexJson: string, nextFiles: readonly FixtureRepoFile[] = files) => {
      await writeFile(join(work, "catalog", "index.json"), nextIndexJson);
      for (const file of nextFiles) {
        const full = join(work, file.path);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, file.contents);
      }
      await run(["add", "catalog/index.json", ...nextFiles.map(file => file.path)], work);
      await run(["commit", "--quiet", "--allow-empty", "-m", "fixture-update"], work);
      await run(["rev-parse", "HEAD"], work);
      const nextCommit = lastOut.trim();
      await run(["push", "--quiet", "--force", join(directory, "remote.git"), "HEAD:refs/heads/main"], work);
      return nextCommit;
    };
    return {
      directory, commit, indexPath: "catalog/index.json", failure, publish, dispose,
      transport(calls): CatalogGitTransport {
        return {
          async fetch(_destination: GitHubDestination, ref: string, mirror: string, credential) {
            calls.fetch.push({ credential });
            if (failure.enabled) return { ok: false as const, issue: { code: "GIT_FAILED" as const } };
            const spec = `+${ref.startsWith("refs/") ? ref : `refs/heads/${ref}`}:${CATALOG_SYNC_STAGING_REF}`;
            // file:// forces the real fetch-pack/upload-pack path so --depth=1 genuinely
            // produces a SHALLOW mirror (the no-network shallow-path proof; parent correction 6).
            const fetchResult = await new Promise<CatalogGitResult<true>>(resolve => {
              execFile(gitExecutable, [`--git-dir=${mirror}`, "fetch", "--no-tags", "--depth=1", `file://${remote}`, spec],
                { env, timeout: 10000, maxBuffer: 65536 },
                error => resolve(error ? { ok: false, issue: { code: "GIT_FAILED" } } : { ok: true, value: true }));
            });
            return fetchResult;
          },
          async resolveRef(mirror, ref) {
            return new Promise(resolve => {
              execFile(gitExecutable, [`--git-dir=${mirror}`, "rev-parse", "--verify", ref],
                { env, timeout: 10000, maxBuffer: 65536 },
                (error, stdout) => resolve(error ? { ok: false, issue: { code: "REF_MISSING" } }
                  : { ok: true, value: stdout.trim() }));
            });
          },
          async updateRef(mirror, ref, next, expected) {
            return new Promise(resolve => {
              execFile(gitExecutable, [`--git-dir=${mirror}`, "update-ref", ref, next,
                expected ?? "0000000000000000000000000000000000000000"],
                { env, timeout: 10000, maxBuffer: 65536 },
                error => resolve(error ? { ok: false, issue: { code: "GIT_FAILED" } } : { ok: true, value: true }));
            });
          },
          async deleteRef(mirror, ref) {
            return new Promise(resolve => {
              execFile(gitExecutable, [`--git-dir=${mirror}`, "update-ref", "-d", ref],
                { env, timeout: 10000, maxBuffer: 65536 },
                error => resolve(error ? { ok: false, issue: { code: "GIT_FAILED" } } : { ok: true, value: true }));
            });
          },
        };
      },
    };
  } catch (error) { await dispose(); throw error; }
}
