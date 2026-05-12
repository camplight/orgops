import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { asRecord, readPositiveInt, readString, readStringEnv } from "./config";
import { emitWrapperEvent } from "./events";
import type {
  NormalizedWrappedConfig,
  WrapperCommandConfig,
  WrapperHarness,
  WrapperHarnessTurnInput,
  WrapperSourceConfig,
} from "./types";

type NormalizedCommand = {
  command: string;
  cwd?: string;
  timeoutMs: number;
  env: Record<string, string>;
  parse?: "text" | "json-payloads";
};

type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

type NormalizedSidecar = NormalizedCommand & {
  name: string;
  checkCommand?: NormalizedCommand;
  restart: boolean;
  restartDelayMs: number;
};

type SidecarEntry = {
  proc: ChildProcess;
  stopping: boolean;
  restartTimer?: NodeJS.Timeout;
  stdout: string;
  stderr: string;
  processId?: string;
  seq: number;
};

const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_SIDECAR_RESTART_DELAY_MS = 2_000;
const sidecars = new Map<string, SidecarEntry>();

function normalizeCommand(
  config: WrapperCommandConfig | undefined,
  fallbackCwd: string,
  fallbackTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
): NormalizedCommand | null {
  const command = readString(config?.command);
  if (!command) return null;
  const parse = readString(config?.parse);
  return {
    command,
    cwd: readString(config?.cwd) ?? fallbackCwd,
    timeoutMs: readPositiveInt(config?.timeoutMs, fallbackTimeoutMs),
    env: readStringEnv(config?.env),
    parse: parse === "json-payloads" ? "json-payloads" : parse === "text" ? "text" : undefined,
  };
}

function normalizeSidecar(
  config: Record<string, unknown>,
  index: number,
  fallbackCwd: string,
): NormalizedSidecar | null {
  const command = normalizeCommand(config, fallbackCwd);
  if (!command) return null;
  const checkCommandValue = readString(config.checkCommand);
  const checkCommand = checkCommandValue
    ? normalizeCommand({ ...config, command: checkCommandValue }, fallbackCwd, 60_000)
    : undefined;
  return {
    ...command,
    name: readString(config.name) ?? `sidecar-${index + 1}`,
    checkCommand: checkCommand ?? undefined,
    restart: config.restart === false ? false : true,
    restartDelayMs: readPositiveInt(config.restartDelayMs, DEFAULT_SIDECAR_RESTART_DELAY_MS),
  };
}

function shellForPlatform() {
  if (process.platform === "win32") {
    return { command: process.env.COMSPEC ?? "cmd.exe", args: ["/d", "/s", "/c"] };
  }
  return { command: process.env.SHELL ?? "/bin/sh", args: ["-lc"] };
}

async function runCommand(
  commandConfig: NormalizedCommand,
  env: Record<string, string>,
): Promise<CommandResult> {
  const shell = shellForPlatform();
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(shell.command, [...shell.args, commandConfig.command], {
      cwd: commandConfig.cwd,
      env: {
        ...process.env,
        ...env,
        ...commandConfig.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(`Wrapped command timed out after ${commandConfig.timeoutMs}ms`));
    }, commandConfig.timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 1_000_000) stdout = stdout.slice(-1_000_000);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on("exit", (exitCode) => {
      clearTimeout(timeout);
      resolvePromise({ exitCode, stdout, stderr });
    });
  });
}

function sidecarKey(agentName: string, sidecar: NormalizedSidecar) {
  return `${agentName}:${sidecar.name}:${sidecar.cwd ?? ""}:${sidecar.command}`;
}

async function ensureSidecarStarted(
  ctx: {
    api: {
      apiFetch?: (path: string, init?: RequestInit) => Promise<Response>;
      emitEvent: (event: unknown) => Promise<void>;
    };
  },
  agentName: string,
  config: Pick<NormalizedWrappedConfig, "kind">,
  sidecar: NormalizedSidecar,
  env: Record<string, string>,
) {
  const key = sidecarKey(agentName, sidecar);
  const existing = sidecars.get(key);
  if (existing && !existing.stopping && existing.proc.exitCode === null && !existing.proc.killed) {
    return;
  }
  if (sidecar.checkCommand) {
    const check = await runCommand(sidecar.checkCommand, env);
    if (check.exitCode === 0) {
      await ctx.api.emitEvent({
        type: "wrapper.sidecar.skipped",
        source: "system:runner:wrapper",
        payload: {
          targetAgentName: agentName,
          kind: config.kind,
          name: sidecar.name,
          reason: "check-command-passed",
        },
      });
      return;
    }
  }

  const shell = shellForPlatform();
  const child = spawn(shell.command, [...shell.args, sidecar.command], {
    cwd: sidecar.cwd,
    env: {
      ...process.env,
      ...env,
      ...sidecar.env,
      ORGOPS_WRAPPED_SIDECAR_NAME: sidecar.name,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const entry: SidecarEntry = {
    proc: child,
    stopping: false,
    stdout: "",
    stderr: "",
    seq: 0,
  };
  sidecars.set(key, entry);
  if (ctx.api.apiFetch) {
    entry.processId = randomUUID();
    await ctx.api.apiFetch("/api/processes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: entry.processId,
        agentName,
        cmd: sidecar.command,
        cwd: sidecar.cwd,
        pid: child.pid,
        state: "RUNNING",
        startedAt: Date.now(),
        executionMode: "ASYNC",
      }),
    });
  }
  await ctx.api.emitEvent({
    type: "wrapper.sidecar.started",
    source: "system:runner:wrapper",
    payload: {
      targetAgentName: agentName,
      kind: config.kind,
      name: sidecar.name,
      command: sidecar.command,
      cwd: sidecar.cwd,
      pid: child.pid,
      processId: entry.processId,
      restart: sidecar.restart,
    },
  });
  const recordOutput = (stream: "STDOUT" | "STDERR", chunk: Buffer | string) => {
    if (!ctx.api.apiFetch || !entry.processId) return;
    entry.seq += 1;
    void ctx.api.apiFetch(`/api/processes/${entry.processId}/output`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: randomUUID(),
        seq: entry.seq,
        stream,
        text: String(chunk),
        ts: Date.now(),
        source: "system:runner:wrapper",
      }),
    }).catch(() => {
      // The process row may have been removed during agent deletion.
    });
  };
  child.stdout?.on("data", (chunk) => {
    entry.stdout += String(chunk);
    if (entry.stdout.length > 20_000) entry.stdout = entry.stdout.slice(-20_000);
    recordOutput("STDOUT", chunk);
  });
  child.stderr?.on("data", (chunk) => {
    entry.stderr += String(chunk);
    if (entry.stderr.length > 20_000) entry.stderr = entry.stderr.slice(-20_000);
    recordOutput("STDERR", chunk);
  });
  child.on("error", (error) => {
    if (sidecars.get(key) === entry) sidecars.delete(key);
    void ctx.api.emitEvent({
      type: "wrapper.sidecar.failed",
      source: "system:runner:wrapper",
      payload: {
        targetAgentName: agentName,
        kind: config.kind,
        name: sidecar.name,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  });
  child.on("exit", (exitCode, signal) => {
    if (sidecars.get(key) !== entry) return;
    if (ctx.api.apiFetch && entry.processId) {
      void ctx.api.apiFetch(`/api/processes/${entry.processId}/exit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          exitCode,
          state: signal ? "TERMINATED" : "EXITED",
          endedAt: Date.now(),
          source: "system:runner:wrapper",
        }),
      }).catch(() => {
        // The process row may have been removed during agent deletion.
      });
    }
    void ctx.api.emitEvent({
      type: "wrapper.sidecar.exited",
      source: "system:runner:wrapper",
      payload: {
        targetAgentName: agentName,
        kind: config.kind,
        name: sidecar.name,
        exitCode,
        signal,
        stopped: entry.stopping,
        stdout: entry.stdout.slice(-4000),
        stderr: entry.stderr.slice(-4000),
      },
    });
    if (!entry.stopping && sidecar.restart) {
      entry.restartTimer = setTimeout(() => {
        if (sidecars.get(key) !== entry || entry.stopping) return;
        sidecars.delete(key);
        void ensureSidecarStarted(ctx, agentName, config, sidecar, env);
      }, sidecar.restartDelayMs);
    } else {
      sidecars.delete(key);
    }
  });
}

export async function stopWrappedAgentSidecars(agentName: string) {
  let stopped = 0;
  for (const [key, entry] of sidecars) {
    if (!key.startsWith(`${agentName}:`)) continue;
    entry.stopping = true;
    if (entry.restartTimer) clearTimeout(entry.restartTimer);
    sidecars.delete(key);
    if (entry.proc.exitCode === null && !entry.proc.killed) {
      entry.proc.kill("SIGTERM");
      stopped += 1;
    }
  }
  return stopped;
}

export async function stopAllWrappedSidecars() {
  let stopped = 0;
  for (const entry of sidecars.values()) {
    entry.stopping = true;
    if (entry.restartTimer) clearTimeout(entry.restartTimer);
    if (entry.proc.exitCode === null && !entry.proc.killed) {
      entry.proc.kill("SIGTERM");
      stopped += 1;
    }
  }
  sidecars.clear();
  return { stopped };
}

function safeSourceDirName(repo: string) {
  return repo.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "source";
}

export function sourceCheckoutPath(
  workspacePath: string,
  source: WrapperSourceConfig | undefined,
) {
  const explicit = readString(source?.path);
  if (explicit) return explicit.startsWith("/") ? explicit : resolve(workspacePath, explicit);
  const repo = readString(source?.repo);
  if (!repo) return undefined;
  return join(workspacePath, "wrapped-sources", safeSourceDirName(repo));
}

function githubCloneUrl(repo: string) {
  if (repo.startsWith("http://") || repo.startsWith("https://") || repo.startsWith("git@")) {
    return repo;
  }
  return `https://github.com/${repo}.git`;
}

async function ensureSourceCheckout(
  workspacePath: string,
  config: NormalizedWrappedConfig,
  baseEnv: Record<string, string>,
) {
  const source = config.source;
  const sourceType = readString(source?.type);
  const repo = readString(source?.repo);
  if (sourceType !== "github" || !repo) return undefined;
  const targetDir = sourceCheckoutPath(workspacePath, source);
  if (!targetDir) return undefined;
  mkdirSync(resolve(targetDir, ".."), { recursive: true });
  const ref = readString(source?.ref);
  if (!existsSync(targetDir)) {
    const cloneCommand = [
      "git clone",
      ref ? `--branch ${JSON.stringify(ref)}` : "",
      "--depth 1",
      JSON.stringify(githubCloneUrl(repo)),
      JSON.stringify(targetDir),
    ]
      .filter(Boolean)
      .join(" ");
    const result = await runCommand(
      {
        command: cloneCommand,
        cwd: workspacePath,
        timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
        env: {},
      },
      baseEnv,
    );
    if (result.exitCode !== 0) {
      throw new Error(`Source checkout failed: ${result.stderr || result.stdout}`.slice(0, 1000));
    }
  } else if (source?.updateOnStart === true) {
    const updateCommand = ref
      ? `git fetch --depth 1 origin ${JSON.stringify(ref)} && git checkout FETCH_HEAD`
      : "git pull --ff-only";
    const result = await runCommand(
      {
        command: updateCommand,
        cwd: targetDir,
        timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
        env: {},
      },
      baseEnv,
    );
    if (result.exitCode !== 0) {
      throw new Error(`Source update failed: ${result.stderr || result.stdout}`.slice(0, 1000));
    }
  }
  return targetDir;
}

function extractPayloadTexts(value: unknown): string {
  const record = asRecord(value);
  const payloads = Array.isArray(record.payloads) ? record.payloads : [];
  return payloads
    .map((payload) => asRecord(payload).text)
    .filter((text): text is string => typeof text === "string" && text.trim().length > 0)
    .join("\n\n")
    .trim();
}

function extractPayloadTextsFromJsonOutput(output: string): string {
  const trimmed = output.trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart < 0) return "";
  for (let i = jsonStart; i >= 0 && i < trimmed.length; i = trimmed.indexOf("{", i + 1)) {
    if (i < 0) break;
    try {
      const parsed = JSON.parse(trimmed.slice(i));
      const text = extractPayloadTexts(parsed);
      if (text) return text;
    } catch {
      // Try the next JSON-looking offset.
    }
  }
  return "";
}

export function parseWrappedRuntimeOutput(
  stdout: string,
  stderr: string,
  parseMode?: "text" | "json-payloads",
) {
  const combined = `${stdout}\n${stderr}`.trim();
  if (!combined) return "";
  if (parseMode === "text") return stdout.trim() || combined;
  const stdoutText = extractPayloadTextsFromJsonOutput(stdout);
  if (stdoutText) return stdoutText;
  const combinedText = extractPayloadTextsFromJsonOutput(combined);
  if (combinedText) return combinedText;
  return stdout.trim() || combined;
}

export const commandWrapperHarness: WrapperHarness = {
  name: "command",
  canHandle: (config) => config.harness === "command" || config.harness === "cli",
  ensureReady: async ({ ctx, agent, config }) => {
    const secretsEnv = await ctx.api.getPackageSecretsEnv(agent.name);
    const baseEnv: Record<string, string> = {
      ...secretsEnv,
      ORGOPS_PROJECT_ROOT: ctx.projectRoot,
      ORGOPS_WRAPPED_AGENT_NAME: agent.name,
      ORGOPS_WRAPPED_KIND: config.kind,
      ORGOPS_WRAPPED_WORKSPACE_PATH: agent.workspacePath,
    };
    const sourceDir = await ensureSourceCheckout(agent.workspacePath, config, baseEnv);
    if (sourceDir) baseEnv.ORGOPS_WRAPPED_SOURCE_DIR = sourceDir;
    const setupCwd = sourceDir ?? agent.workspacePath;
    const checkCommand = normalizeCommand(
      config.setup?.checkCommand
        ? { ...config.setup, command: config.setup.checkCommand }
        : undefined,
      setupCwd,
      60_000,
    );
    if (checkCommand) {
      const check = await runCommand(checkCommand, baseEnv);
      if (check.exitCode === 0) {
        await emitWrapperEvent(ctx, agent, "wrapper.setup.skipped", {
          kind: config.kind,
          harness: commandWrapperHarness.name,
          reason: "check-command-passed",
        });
      } else {
        const setupCommand = normalizeCommand(config.setup, setupCwd);
        if (setupCommand) {
          await emitWrapperEvent(ctx, agent, "wrapper.setup.started", {
            kind: config.kind,
            harness: commandWrapperHarness.name,
            command: setupCommand.command,
          });
          const result = await runCommand(setupCommand, baseEnv);
          if (result.exitCode !== 0) {
            await emitWrapperEvent(ctx, agent, "wrapper.setup.failed", {
              kind: config.kind,
              harness: commandWrapperHarness.name,
              exitCode: result.exitCode,
              cwd: setupCommand.cwd,
              command: setupCommand.command,
              stderr: result.stderr.slice(-4000),
              stdout: result.stdout.slice(-4000),
            });
            throw new Error(
              `Wrapped setup failed for ${agent.name} (cwd=${setupCommand.cwd}, command=${JSON.stringify(
                setupCommand.command,
              )}): ${result.stderr || result.stdout}`,
            );
          }
          await emitWrapperEvent(ctx, agent, "wrapper.setup.completed", {
            kind: config.kind,
            harness: commandWrapperHarness.name,
            stdout: result.stdout.slice(-4000),
          });
        }
      }
    } else {
      const setupCommand = normalizeCommand(config.setup, setupCwd);
      if (!setupCommand) {
        await emitWrapperEvent(ctx, agent, "wrapper.setup.skipped", {
          kind: config.kind,
          harness: commandWrapperHarness.name,
          reason: "no-setup-command",
        });
      } else {
        await emitWrapperEvent(ctx, agent, "wrapper.setup.started", {
          kind: config.kind,
          harness: commandWrapperHarness.name,
          command: setupCommand.command,
        });
        const result = await runCommand(setupCommand, baseEnv);
        if (result.exitCode !== 0) {
          await emitWrapperEvent(ctx, agent, "wrapper.setup.failed", {
            kind: config.kind,
            harness: commandWrapperHarness.name,
            exitCode: result.exitCode,
            cwd: setupCommand.cwd,
            command: setupCommand.command,
            stderr: result.stderr.slice(-4000),
            stdout: result.stdout.slice(-4000),
          });
          throw new Error(
            `Wrapped setup failed for ${agent.name} (cwd=${setupCommand.cwd}, command=${JSON.stringify(
              setupCommand.command,
            )}): ${result.stderr || result.stdout}`,
          );
        }
        await emitWrapperEvent(ctx, agent, "wrapper.setup.completed", {
          kind: config.kind,
          harness: commandWrapperHarness.name,
          stdout: result.stdout.slice(-4000),
        });
      }
    }
    for (let index = 0; index < config.sidecars.length; index += 1) {
      const sidecar = normalizeSidecar(asRecord(config.sidecars[index]), index, setupCwd);
      if (!sidecar) continue;
      await ensureSidecarStarted(ctx, agent.name, config, sidecar, baseEnv);
    }
  },
  runTurn: async (input: WrapperHarnessTurnInput) => {
    const { ctx, agent, config, channelId, triggerEvent, message, sessionId } = input;
    const sourceDir = sourceCheckoutPath(agent.workspacePath, config.source);
    const runtimeCwd = sourceDir && existsSync(sourceDir) ? sourceDir : agent.workspacePath;
    const runtime = normalizeCommand(config.runtime, runtimeCwd);
    if (!runtime) {
      throw new Error(`Wrapped agent ${agent.name} is missing wrappedConfig.runtime.command.`);
    }
    const secretsEnv = await ctx.api.getPackageSecretsEnv(agent.name, channelId);
    const result = await runCommand(runtime, {
      ...secretsEnv,
      ORGOPS_PROJECT_ROOT: ctx.projectRoot,
      ORGOPS_WRAPPED_AGENT_NAME: agent.name,
      ORGOPS_WRAPPED_KIND: config.kind,
      ORGOPS_WRAPPED_WORKSPACE_PATH: agent.workspacePath,
      ORGOPS_WRAPPED_CHANNEL_ID: channelId,
      ORGOPS_WRAPPED_SESSION_ID: sessionId,
      ORGOPS_WRAPPED_MESSAGE: message,
      ORGOPS_WRAPPED_TRIGGER_EVENT_ID: triggerEvent.id,
      ...(sourceDir ? { ORGOPS_WRAPPED_SOURCE_DIR: sourceDir } : {}),
    });
    if (result.exitCode !== 0) {
      throw Object.assign(
        new Error(`Wrapped runtime failed for ${agent.name}: ${result.stderr || result.stdout}`),
        {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        },
      );
    }
    return {
      text: parseWrappedRuntimeOutput(result.stdout, result.stderr, runtime.parse),
      raw: {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      },
    };
  },
};
