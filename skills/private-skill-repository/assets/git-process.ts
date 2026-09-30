import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const OUTPUT_LIMIT = 64 * 1024;
const DEFAULT_TIMEOUT = 30_000;

type Spawned = {
  stdout?: { on(event: string, listener: (...args: any[]) => void): unknown };
  stderr?: { on(event: string, listener: (...args: any[]) => void): unknown };
  on(event: string, listener: (...args: any[]) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
};

export type GitResult = {
  ok: boolean;
  code: "GIT_FAILED" | "AUTH_FAILED" | "GIT_TIMEOUT" | "GIT_OUTPUT_LIMIT" | undefined;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
};

export type GitRunner = {
  run(args: string[], options?: { cwd?: string; timeoutMs?: number }): Promise<GitResult>;
};

export type GitRunnerDependencies = {
  env?: NodeJS.ProcessEnv;
  spawnImpl?: (command: string, args: string[], options: Record<string, unknown>) => Spawned;
  mkdtempImpl?: (prefix: string) => Promise<string>;
  rmImpl?: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
  writeFileImpl?: (path: string, data: string, options: { mode: number }) => Promise<void>;
  chmodImpl?: (path: string, mode: number) => Promise<void>;
};

function redact(value: string, secrets: string[]): string {
  let output = value;
  for (const secret of secrets.filter(Boolean)) output = output.split(secret).join("[REDACTED]");
  return output.length > OUTPUT_LIMIT ? output.slice(0, OUTPUT_LIMIT) : output;
}

function failure(code: GitResult["code"], stdout = "", stderr = "", secrets: string[] = []): GitResult {
  return { ok: false, code, stdout: redact(stdout, secrets), stderr: redact(stderr, secrets) };
}

export function createGitRunner(deps: GitRunnerDependencies = {}): GitRunner {
  const environment = { ...process.env, ...(deps.env ?? {}) };
  const spawnImpl = deps.spawnImpl ?? ((command, args, options) => spawn(command, args, options as any) as unknown as Spawned);
  const mkdtempImpl = deps.mkdtempImpl ?? ((prefix) => mkdtemp(prefix));
  const rmImpl = deps.rmImpl ?? ((path, options) => rm(path, options));
  const writeFileImpl = deps.writeFileImpl ?? ((path, data, options) => writeFile(path, data, options));
  const chmodImpl = deps.chmodImpl ?? ((path, mode) => chmod(path, mode));
  const token = environment.PRIVATE_SKILLS_GIT_TOKEN ?? "";
  const username = environment.PRIVATE_SKILLS_GIT_USERNAME ?? "x-access-token";
  const secrets = [token, username];

  return {
    async run(args, options = {}) {
      let askpassDir: string | undefined;
      let askpassPath: string | undefined;
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      let child: Spawned | undefined;
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
      const cleanup = async () => {
        if (timer) clearTimeout(timer);
        if (askpassDir) {
          try { await rmImpl(askpassDir, { recursive: true, force: true }); } catch { /* bounded cleanup */ }
        }
      };
      try {
        const childEnv: NodeJS.ProcessEnv = { ...environment, GIT_TERMINAL_PROMPT: "0" };
        if (token) {
          askpassDir = await mkdtempImpl(join(tmpdir(), "orgops-git-"));
          askpassPath = join(askpassDir, "askpass.sh");
          const script = "#!/bin/sh\ncase \"$1\" in\n  *[Uu]sername*) printf '%s\\n' \"$PRIVATE_SKILLS_GIT_USERNAME\" ;;\n  *) printf '%s\\n' \"$PRIVATE_SKILLS_GIT_TOKEN\" ;;\nesac\n";
          await writeFileImpl(askpassPath, script, { mode: 0o700 });
          await chmodImpl(askpassPath, 0o700);
          secrets.push(askpassDir, askpassPath);
          childEnv.GIT_ASKPASS = askpassPath;
          childEnv.PRIVATE_SKILLS_GIT_TOKEN = token;
          childEnv.PRIVATE_SKILLS_GIT_USERNAME = username;
        }
        child = spawnImpl("git", [...args], { cwd: options.cwd, env: childEnv, shell: false });
        return await new Promise<GitResult>((resolve) => {
          const finish = (result: GitResult) => {
            if (settled) return;
            settled = true;
            void cleanup().finally(() => resolve({ ...result, stdout: redact(result.stdout, secrets), stderr: redact(result.stderr, secrets) }));
          };
          const append = (target: "stdout" | "stderr", chunk: Buffer | string) => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            const current = target === "stdout" ? Buffer.byteLength(stdout) : Buffer.byteLength(stderr);
            const remaining = OUTPUT_LIMIT - current;
            if (remaining <= 0) {
              try { child?.kill("SIGKILL"); } catch { /* bounded */ }
              finish(failure("GIT_FAILED", stdout, stderr, secrets));
              return;
            }
            const bounded = bytes.length > remaining ? bytes.subarray(0, remaining) : bytes;
            const value = bounded.toString();
            if (target === "stdout") stdout += value; else stderr += value;
            if (bytes.length > remaining) {
              try { child?.kill("SIGKILL"); } catch { /* bounded */ }
              finish(failure("GIT_FAILED", stdout, stderr, secrets));
            }
          };
          child?.stdout?.on("data", (chunk) => append("stdout", chunk));
          child?.stderr?.on("data", (chunk) => append("stderr", chunk));
          child?.on("error", () => finish(failure("GIT_FAILED", stdout, stderr, secrets)));
          child?.on("close", (code, signal) => {
            if (settled) return;
            if (code === 0 && !signal) finish({ ok: true, code: undefined, stdout: redact(stdout, secrets), stderr: redact(stderr, secrets), exitCode: code });
            else {
              const auth = /authentication failed|could not read (?:username|password)|permission denied|access denied|unauthori[sz]ed|forbidden|terminal prompts disabled|no such device or address|\b401\b|\b403\b/i.test(stderr);
              finish(failure(auth ? "AUTH_FAILED" : "GIT_FAILED", stdout, stderr, secrets));
            }
          });
          timer = setTimeout(() => {
            try { child?.kill("SIGKILL"); } catch { /* bounded */ }
            finish(failure("GIT_TIMEOUT", stdout, stderr, secrets));
          }, timeoutMs);
        });
      } catch {
        await cleanup();
        return failure("GIT_FAILED", stdout, stderr, secrets);
      }
    },
  };
}
