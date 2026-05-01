import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import { inspect } from "node:util";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createRequire } from "node:module";
import * as tar from "tar";
import { generate, type LlmMessage } from "@orgops/llm";
import { createJsRuntimeSession, type JsRuntimeSession } from "@orgops/js-runtime";

type ShellResult = {
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
};

type SessionRunHooks = {
  appendObservation: (type: string, payload: Record<string, unknown>) => void;
  requestUserInput: (promptText: string) => Promise<string>;
  reportProgress?: (type: string, payload: Record<string, unknown>) => void;
  getAbortSignal?: () => AbortSignal | undefined;
};

type RlmSession = {
  runtime: JsRuntimeSession;
  context: Record<string, unknown>;
  reservedKeys: Set<string>;
  memory: SessionMemory;
  exited: boolean;
  exitCode: number;
  turnDone: boolean;
  runHooks: SessionRunHooks | null;
};

type SessionMemory = {
  summary: string;
  history: LlmMessage[];
};

class TaskInterruptedError extends Error {
  constructor(message = "Task interrupted by user.") {
    super(message);
    this.name = "TaskInterruptedError";
  }
}

const DEFAULT_OPENAI_MODEL_ID = "openai:gpt-5.2";
const DEFAULT_ANTHROPIC_MODEL_ID = "anthropic:claude-3-5-sonnet-latest";
const MAX_STEPS = Number(process.env.ORGOPS_OPSCLI_MAX_STEPS ?? 20);
const COMMAND_TIMEOUT_MS = Number(process.env.ORGOPS_OPSCLI_COMMAND_TIMEOUT_MS ?? 120_000);
const EVAL_TIMEOUT_MS = Number(process.env.ORGOPS_OPSCLI_EVAL_TIMEOUT_MS ?? 30_000);
const EVAL_CALLBACK_TIMEOUT_MS = Number(
  process.env.ORGOPS_OPSCLI_EVAL_CALLBACK_TIMEOUT_MS ?? 8_000
);
const MAX_OUTPUT_CHARS = 12_000;
const MAX_INPUT_CHARS = 12_000;
const MAX_CONTEXT_CHARS = Number(process.env.ORGOPS_OPSCLI_MAX_CONTEXT_CHARS ?? 100_000);
const MAX_SUMMARY_CHARS = Number(process.env.ORGOPS_OPSCLI_MAX_SUMMARY_CHARS ?? 14_000);
const SUMMARY_CHUNK_MESSAGES = Number(process.env.ORGOPS_OPSCLI_SUMMARY_CHUNK_MESSAGES ?? 8);
const MIN_RECENT_MESSAGES = Number(process.env.ORGOPS_OPSCLI_MIN_RECENT_MESSAGES ?? 12);
const MAX_SYSTEM_DOC_CHARS = Number(
  process.env.ORGOPS_OPSCLI_MAX_SYSTEM_DOC_CHARS ?? 40_000
);
const DEBUG_REPL_TRACE =
  process.env.ORGOPS_OPSCLI_DEBUG === "1" ||
  process.env.ORGOPS_OPSCLI_DEBUG?.toLowerCase() === "true";
const PROGRESS_ENABLED = (() => {
  const raw = process.env.ORGOPS_OPSCLI_PROGRESS?.trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "off", "no"].includes(raw);
})();
const SPINNER_ENABLED = (() => {
  const raw = process.env.ORGOPS_OPSCLI_SPINNER?.trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "off", "no"].includes(raw);
})();
const SESSION_LOG_PATH = resolve(
  process.cwd(),
  process.env.ORGOPS_OPSCLI_LOG_PATH ?? ".opscli-output.log"
);
const DOUBLE_SIGINT_WINDOW_MS = Number(process.env.ORGOPS_OPSCLI_DOUBLE_SIGINT_MS ?? 1200);
const ANSI_ENABLED = stdout.isTTY && process.env.NO_COLOR !== "1";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

type UiRole = "user" | "agent" | "opscli" | "error" | "muted";

function stylize(text: string, color: keyof typeof ANSI, bold = false) {
  if (!ANSI_ENABLED) return text;
  const weight = bold ? ANSI.bold : "";
  return `${weight}${ANSI[color]}${text}${ANSI.reset}`;
}

function rolePrefix(role: UiRole) {
  if (role === "user") return stylize("You>", "cyan", true);
  if (role === "agent") return stylize("Agent>", "magenta", true);
  if (role === "error") return stylize("Error>", "red", true);
  if (role === "muted") return stylize("OpsCLI>", "gray", true);
  return stylize("OpsCLI>", "yellow", true);
}

function writeRoleMessage(
  role: UiRole,
  text: string,
  options?: { leadingNewline?: boolean; toStderr?: boolean }
) {
  const prefix = rolePrefix(role);
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const [firstLine = "", ...rest] = lines;
  const rendered = [`${prefix} ${firstLine}`, ...rest].join("\n");
  const output = `${options?.leadingNewline ? "\n" : ""}${rendered}\n`;
  if (options?.toStderr) {
    process.stderr.write(output);
    return;
  }
  stdout.write(output);
}

function reportProgress(message: string, options?: { leadingNewline?: boolean }) {
  if (!PROGRESS_ENABLED) return;
  writeRoleMessage("muted", `progress: ${message}`, options);
}

function renderObservationProgress(type: string, payload: Record<string, unknown>) {
  if (!PROGRESS_ENABLED) return;
  if (type === "opscli.repl.shell.start") {
    const command = typeof payload.command === "string" ? payload.command : "";
    const short = truncateText(command.replace(/\s+/g, " ").trim(), 180).text;
    reportProgress(`shell start: ${short}`);
    return;
  }
  if (type === "opscli.repl.shell.done") {
    const command = typeof payload.command === "string" ? payload.command : "";
    const short = truncateText(command.replace(/\s+/g, " ").trim(), 120).text;
    const exitCode =
      typeof payload.exitCode === "number" && Number.isFinite(payload.exitCode)
        ? payload.exitCode
        : "unknown";
    const aborted = payload.aborted === true;
    const durationMs =
      typeof payload.durationMs === "number" && Number.isFinite(payload.durationMs)
        ? payload.durationMs
        : 0;
    reportProgress(
      `shell done: exit=${exitCode} aborted=${aborted ? "yes" : "no"} duration=${durationMs}ms command=${short}`
    );
    return;
  }
  if (type === "opscli.stdin.input") {
    const question =
      typeof payload.question === "string" ? payload.question : "Awaiting user input";
    reportProgress(`agent requested input: ${question}`);
    return;
  }
  if (type === "opscli.repl.finish") {
    reportProgress("agent called finish()");
    return;
  }
  if (type === "opscli.repl.exit") {
    const code =
      typeof payload.code === "number" && Number.isFinite(payload.code)
        ? payload.code
        : 0;
    reportProgress(`agent called exit(${code})`);
  }
}

function getModelId() {
  const configured = process.env.ORGOPS_OPSCLI_MODEL?.trim();
  return configured || DEFAULT_OPENAI_MODEL_ID;
}

function appendSessionLog(message: string) {
  const timestamp = new Date().toISOString();
  try {
    appendFileSync(SESSION_LOG_PATH, `[${timestamp}] ${message}\n`, "utf-8");
  } catch {
    // Keep OpsCLI resilient even if log writes fail.
  }
}

function resetSessionLog() {
  const header = [
    `[${new Date().toISOString()}] OrgOps OpsCLI session started`,
    `cwd=${process.cwd()}`,
    `model=${getModelId()}`,
    `debug=${DEBUG_REPL_TRACE ? "1" : "0"}`,
    "",
  ].join("\n");
  writeFileSync(SESSION_LOG_PATH, header, "utf-8");
}
const BUNDLED_ROOT_DIR_NAME = "orgops";
const ROOT_ENV_FILE = ".env";
const EXTRACTED_ROOT_ENV_KEY = "ORGOPS_EXTRACTED_ROOT";
const DEFAULT_API_URL = "http://localhost:8787";
const DEFAULT_RUNNER_TOKEN = "dev-runner-token";
const RUNTIME_DIR = (() => {
  try {
    return __dirname;
  } catch {
    return process.cwd();
  }
})();
const SEA_ASSET_CACHE_DIR = resolve(tmpdir(), "orgops-opscli-sea-assets");
const seaAssetFileCache = new Map<string, string>();
const defaultRuntimeRequire = createRequire(
  resolve(process.cwd(), "__orgops_opscli_default_require__.cjs")
);
const runtimeRequire = (() => {
  try {
    return createRequire(resolve(process.cwd(), "__orgops_opscli_require__.cjs"));
  } catch {
    return null;
  }
})();

function parseSimpleEnv(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIdx = trimmed.indexOf("=");
    if (equalsIdx <= 0) continue;
    const key = trimmed.slice(0, equalsIdx).trim();
    const value = trimmed.slice(equalsIdx + 1).trim();
    const unquoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value;
    result[key] = unquoted;
  }
  return result;
}

function loadDotEnvIntoProcess(envPath: string) {
  if (!existsSync(envPath)) return;
  const parsed = parseSimpleEnv(readFileSync(envPath, "utf-8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

function writeMergedEnvFile(envPath: string, patch: Record<string, string>) {
  const existing = existsSync(envPath)
    ? parseSimpleEnv(readFileSync(envPath, "utf-8"))
    : {};
  const next: Record<string, string> = { ...existing, ...patch };
  const lines = [
    "# Generated by OrgOps OpsCLI",
    ...Object.entries(next).map(([key, value]) => `${key}=${value}`),
  ];
  writeFileSync(envPath, `${lines.join("\n")}\n`, "utf-8");
}

function getOpsCliEnvPath() {
  return join(process.cwd(), ROOT_ENV_FILE);
}

type ModelProvider = "openai" | "anthropic";

type CliOptions = {
  goal: string | null;
  help: boolean;
};

function parseCliArgs(argv: string[]): CliOptions {
  const args = [...argv];
  let goal: string | null = null;
  let help = false;
  while (args.length > 0) {
    const token = args.shift() ?? "";
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (token === "--goal" || token === "-g") {
      const value = args.shift();
      if (!value) {
        throw new Error(`Missing value for ${token}. Usage: --goal "your instruction"`);
      }
      goal = value;
      continue;
    }
    throw new Error(`Unknown argument: ${token}. Use --help for usage.`);
  }
  return { goal, help };
}

function printCliHelp() {
  const lines = [
    "OrgOps OpsCLI",
    "",
    "Usage:",
    "  opscli-macos [--goal \"instruction\"]",
    "",
    "Options:",
    "  -g, --goal <text>    Run one autonomous goal and exit",
    "  -h, --help           Show help",
  ];
  stdout.write(`${lines.join("\n")}\n`);
}

function normalizeProvider(provider: string): ModelProvider | null {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "openai") return "openai";
  if (normalized === "anthropic" || normalized === "claude") return "anthropic";
  return null;
}

function getModelProvider(modelId: string): ModelProvider {
  const [provider] = modelId.split(":");
  return normalizeProvider(provider ?? "") ?? "openai";
}

function getProviderLabel(provider: ModelProvider) {
  return provider === "openai" ? "OpenAI" : "Claude (Anthropic)";
}

function getProviderApiKeyEnvKey(provider: ModelProvider) {
  return provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
}

function getDefaultModelIdForProvider(provider: ModelProvider) {
  return provider === "openai" ? DEFAULT_OPENAI_MODEL_ID : DEFAULT_ANTHROPIC_MODEL_ID;
}

function getAlternateProvider(provider: ModelProvider): ModelProvider {
  return provider === "openai" ? "anthropic" : "openai";
}

function throwIfInterrupted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new TaskInterruptedError();
  }
}

function createInterruptPromise(signal?: AbortSignal) {
  if (!signal) return null;
  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new TaskInterruptedError());
      return;
    }
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new TaskInterruptedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; message?: string };
  return (
    candidate.name === "AbortError" ||
    candidate.name === "TaskInterruptedError" ||
    candidate.message?.toLowerCase().includes("aborted") === true
  );
}

function resolveDefaultExtractedRootPath() {
  const configured = process.env[EXTRACTED_ROOT_ENV_KEY]?.trim();
  if (configured) return resolve(configured);
  return resolve(process.cwd(), BUNDLED_ROOT_DIR_NAME);
}

function rememberExtractedRoot(extractedRoot: string) {
  const normalized = resolve(extractedRoot);
  process.env[EXTRACTED_ROOT_ENV_KEY] = normalized;
  writeMergedEnvFile(getOpsCliEnvPath(), {
    [EXTRACTED_ROOT_ENV_KEY]: normalized,
  });
}

function getRuntimeAssetPath(fileName: string) {
  const candidates = [
    join(RUNTIME_DIR, "assets", fileName),
    resolve(process.cwd(), "apps/opscli/assets", fileName),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

type SeaModule = {
  isSea: () => boolean;
  getAsset: (key: string, encoding?: string) => ArrayBuffer | string;
};

function getSeaModule(): SeaModule | null {
  try {
    if (!runtimeRequire) return null;
    const sea = runtimeRequire("node:sea") as SeaModule;
    return typeof sea.isSea === "function" && typeof sea.getAsset === "function" ? sea : null;
  } catch {
    return null;
  }
}

function loadBundledAssetText(fileName: string) {
  const sea = getSeaModule();
  if (sea?.isSea()) {
    try {
      const value = sea.getAsset(fileName, "utf8");
      if (typeof value === "string") return value;
    } catch {
      // Fall back to file-system lookup when running unpackaged.
    }
  }
  const assetPath = getRuntimeAssetPath(fileName);
  if (!existsSync(assetPath)) return "";
  return readFileSync(assetPath, "utf-8");
}

function ensureBundledAssetFile(fileName: string) {
  const fileAssetPath = getRuntimeAssetPath(fileName);
  if (existsSync(fileAssetPath)) return fileAssetPath;

  const cached = seaAssetFileCache.get(fileName);
  if (cached && existsSync(cached)) return cached;

  const sea = getSeaModule();
  if (!sea?.isSea()) return fileAssetPath;

  const raw = sea.getAsset(fileName);
  if (!(raw instanceof ArrayBuffer)) {
    throw new Error(`Bundled SEA asset ${fileName} has unexpected type.`);
  }
  mkdirSync(SEA_ASSET_CACHE_DIR, { recursive: true });
  const outPath = join(SEA_ASSET_CACHE_DIR, fileName);
  writeFileSync(outPath, Buffer.from(raw));
  seaAssetFileCache.set(fileName, outPath);
  return outPath;
}

function loadBundledDocsText() {
  const docs = loadBundledAssetText("orgops-system-docs.md").trim();
  if (!docs) return "";
  return truncateText(docs, MAX_SYSTEM_DOC_CHARS).text;
}

function loadBuildTimestamp() {
  try {
    const raw = loadBundledAssetText("opscli-build-info.json");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as { builtAt?: string };
    return typeof parsed.builtAt === "string" && parsed.builtAt.trim()
      ? parsed.builtAt
      : null;
  } catch {
    return null;
  }
}

function getBundledArchivePath() {
  return ensureBundledAssetFile("orgops-bundle.tar.gz");
}

async function extractBundledOrgOps(options?: {
  targetDir?: string;
  force?: boolean;
}) {
  const archivePath = getBundledArchivePath();
  if (!existsSync(archivePath)) {
    throw new Error(
      "Bundled OrgOps archive not found. Use a release-built opscli binary."
    );
  }
  const defaultExtractedRoot = resolveDefaultExtractedRootPath();
  const targetDir = resolve(options?.targetDir ?? dirname(defaultExtractedRoot));
  mkdirSync(targetDir, { recursive: true });
  const extractedRoot = join(targetDir, BUNDLED_ROOT_DIR_NAME);
  const shouldExtract = options?.force || !existsSync(extractedRoot);
  if (shouldExtract) {
    await tar.x({ file: archivePath, cwd: targetDir });
  }
  rememberExtractedRoot(extractedRoot);
  return extractedRoot;
}

type SetupComponent = "api" | "runner" | "ui";

function sanitizeSetupComponents(raw?: string[]) {
  const normalized = new Set<SetupComponent>();
  for (const entry of raw ?? []) {
    const value = entry.trim().toLowerCase();
    if (value === "api" || value === "runner" || value === "ui") {
      normalized.add(value);
    }
  }
  return normalized.size > 0
    ? Array.from(normalized)
    : (["api", "runner", "ui"] as SetupComponent[]);
}

function resolveWorkspaceForComponent(component: SetupComponent) {
  if (component === "api") return "@orgops/api";
  if (component === "runner") return "@orgops/agent-runner";
  return "@orgops/ui";
}

function buildSuggestedRunCommands(components: SetupComponent[]) {
  const commands: string[] = [];
  for (const component of components) {
    if (component === "api") {
      commands.push("npm run --workspace @orgops/api start");
    } else if (component === "runner") {
      commands.push("npm run --workspace @orgops/agent-runner start");
    } else if (component === "ui") {
      commands.push("npm run --workspace @orgops/ui preview");
    }
  }
  return commands;
}

async function setupBundledOrgOps(options?: {
  targetDir?: string;
  components?: string[];
  forceExtract?: boolean;
  installDependencies?: boolean;
  buildUi?: boolean;
}) {
  const extractedRoot = await extractBundledOrgOps({
    targetDir: options?.targetDir,
    force: options?.forceExtract,
  });
  const components = sanitizeSetupComponents(options?.components);
  const installDependencies = options?.installDependencies !== false;
  const buildUi = options?.buildUi !== false;
  const envPath = join(extractedRoot, ROOT_ENV_FILE);
  const existingEnv = existsSync(envPath)
    ? parseSimpleEnv(readFileSync(envPath, "utf-8"))
    : {};
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
  writeMergedEnvFile(envPath, {
    OPENAI_API_KEY: openAiApiKey || existingEnv.OPENAI_API_KEY || "",
    ANTHROPIC_API_KEY: anthropicApiKey || existingEnv.ANTHROPIC_API_KEY || "",
    ORGOPS_MASTER_KEY:
      existingEnv.ORGOPS_MASTER_KEY || randomBytes(32).toString("base64"),
    ORGOPS_RUNNER_TOKEN:
      existingEnv.ORGOPS_RUNNER_TOKEN ||
      process.env.ORGOPS_RUNNER_TOKEN ||
      DEFAULT_RUNNER_TOKEN,
    ORGOPS_API_URL:
      existingEnv.ORGOPS_API_URL || process.env.ORGOPS_API_URL || DEFAULT_API_URL,
  });

  const steps: Array<Record<string, unknown>> = [];
  if (installDependencies) {
    const installResult = await runShell("npm ci", 30 * 60_000, undefined, extractedRoot);
    steps.push({
      step: "npm ci",
      exitCode: installResult.exitCode,
      timedOut: installResult.timedOut,
      durationMs: installResult.durationMs,
      stderr: truncateText(installResult.stderr, 4000).text,
      stdout: truncateText(installResult.stdout, 4000).text,
    });
    if (installResult.exitCode !== 0 || installResult.timedOut) {
      return {
        ok: false,
        extractedRoot,
        components,
        steps,
        message: "Dependency install failed.",
      };
    }
  }

  for (const component of components) {
    const workspace = resolveWorkspaceForComponent(component);
    if (component !== "ui" || !buildUi) {
      steps.push({
        step: `prepared ${workspace}`,
        exitCode: 0,
        timedOut: false,
        durationMs: 0,
      });
      continue;
    }
    const command = `npm run --workspace ${workspace} build`;
    const result = await runShell(command, 10 * 60_000, undefined, extractedRoot);
    steps.push({
      step: command,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      stderr: truncateText(result.stderr, 4000).text,
      stdout: truncateText(result.stdout, 4000).text,
    });
    if (result.exitCode !== 0 || result.timedOut) {
      return {
        ok: false,
        extractedRoot,
        components,
        steps,
        message: `Setup failed while preparing ${component}.`,
      };
    }
  }

  return {
    ok: true,
    extractedRoot,
    components,
    envPath,
    suggestedRunCommands: buildSuggestedRunCommands(components),
    steps,
  };
}

function extractCode(input: string): string {
  const text = input.trim();
  if (!text) return "";
  const fenced = text.match(
    /```(?:repl|js|javascript|ts|typescript)?\s*([\s\S]*?)\s*```/i
  );
  return fenced?.[1] ? fenced[1].trim() : text;
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`,
    truncated: true,
  };
}

function mergeShellOutput(stdoutText: string, stderrText: string) {
  const stdoutChunk = stdoutText.trim();
  const stderrChunk = stderrText.trim();
  if (stdoutChunk && stderrChunk) {
    const separator = stdoutText.endsWith("\n") ? "" : "\n";
    return `${stdoutText}${separator}${stderrText}`;
  }
  return stdoutChunk ? stdoutText : stderrText;
}

type SpinnerControls = {
  stop: (doneLabel?: string) => void;
};

let stopActiveSpinner: (() => void) | null = null;

function forceStopSpinner() {
  stopActiveSpinner?.();
  stopActiveSpinner = null;
}

function startSpinner(label: string): SpinnerControls {
  if (DEBUG_REPL_TRACE || !stdout.isTTY || !SPINNER_ENABLED) {
    return { stop: () => {} };
  }
  const frames = ["-", "\\", "|", "/"];
  let frameIndex = 0;
  let interval: NodeJS.Timeout | null = null;
  let hasRendered = false;
  const render = () => {
    const frame = frames[frameIndex % frames.length];
    frameIndex += 1;
    hasRendered = true;
    stdout.write(`\r${rolePrefix("muted")} ${label} ${frame}`);
  };
  const delay = setTimeout(() => {
    render();
    interval = setInterval(render, 100);
  }, 200);
  const stop = (doneLabel?: string) => {
    clearTimeout(delay);
    if (interval) clearInterval(interval);
    if (!hasRendered) return;
    const finalLabel = doneLabel ? `${doneLabel}   ` : `${label} done.   `;
    stdout.write(`\r${rolePrefix("muted")} ${finalLabel}\n`);
  };
  stopActiveSpinner = () => stop();
  return {
    stop: (doneLabel?: string) => {
      stop(doneLabel);
      if (stopActiveSpinner) stopActiveSpinner = null;
    },
  };
}

function createPromptValue(goal: string) {
  const text = goal;
  return {
    text,
    trim: () => text.trim(),
    toLowerCase: () => text.toLowerCase(),
    toString: () => text,
    valueOf: () => text,
    [Symbol.toPrimitive]: () => text,
  };
}

function formatValue(value: unknown): string {
  try {
    return inspect(value, {
      depth: 4,
      maxArrayLength: 100,
      maxStringLength: 8_000,
      breakLength: 120,
      compact: false,
    });
  } catch {
    return String(value);
  }
}

function formatPrintArg(value: unknown): string {
  if (typeof value === "string") return value;
  return formatValue(value);
}

function messageContentToText(content: LlmMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : "[image]"))
    .join("\n");
}

function estimateMessageChars(messages: LlmMessage[]) {
  return messages.reduce((acc, message) => acc + messageContentToText(message.content).length, 0);
}

function summarizeMessages(messages: LlmMessage[]) {
  return messages
    .map((message, index) => {
      const oneLine = messageContentToText(message.content).replace(/\s+/g, " ").trim();
      const clipped = truncateText(oneLine, 240).text.replace(/\n/g, " ");
      return `${index + 1}. ${message.role}: ${clipped}`;
    })
    .join("\n");
}

function appendToSummary(previousSummary: string, addition: string) {
  const merged = previousSummary ? `${previousSummary}\n${addition}` : addition;
  if (merged.length <= MAX_SUMMARY_CHARS) return merged;
  return merged.slice(merged.length - MAX_SUMMARY_CHARS);
}

function enforceMemoryBudget(memory: SessionMemory) {
  while (
    estimateMessageChars(memory.history) + memory.summary.length > MAX_CONTEXT_CHARS &&
    memory.history.length > MIN_RECENT_MESSAGES
  ) {
    const removableCount = Math.max(
      1,
      Math.min(SUMMARY_CHUNK_MESSAGES, memory.history.length - MIN_RECENT_MESSAGES)
    );
    const removed = memory.history.splice(0, removableCount);
    memory.summary = appendToSummary(memory.summary, summarizeMessages(removed));
  }
}

function appendHistoryMessage(memory: SessionMemory, message: LlmMessage) {
  const clipped = truncateText(messageContentToText(message.content), MAX_OUTPUT_CHARS);
  memory.history.push({ role: message.role, content: clipped.text });
  enforceMemoryBudget(memory);
}

async function runShell(
  command: string,
  timeoutMs: number,
  abortSignal?: AbortSignal,
  cwd?: string
): Promise<ShellResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child =
      process.platform === "win32"
        ? spawn(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
            {
              cwd: cwd ?? process.cwd(),
              env: process.env,
            }
          )
        : spawn(command, {
            cwd: cwd ?? process.cwd(),
            env: process.env,
            shell: true,
          });
    let out = "";
    let err = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (abortSignal && abortHandler) {
        abortSignal.removeEventListener("abort", abortHandler);
      }
      resolve({
        exitCode,
        timedOut,
        aborted,
        stdout: out,
        stderr: err,
        durationMs: Date.now() - startedAt,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
    }, timeoutMs);
    const abortHandler = () => {
      aborted = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
    };
    if (abortSignal) {
      if (abortSignal.aborted) {
        abortHandler();
      } else {
        abortSignal.addEventListener("abort", abortHandler, { once: true });
      }
    }
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
      if (out.length > MAX_OUTPUT_CHARS) out = out.slice(-MAX_OUTPUT_CHARS);
    });
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
      if (err.length > MAX_OUTPUT_CHARS) err = err.slice(-MAX_OUTPUT_CHARS);
    });
    child.on("close", (exitCode) => finish(exitCode));
  });
}

function buildSystemPrompt() {
  const docsText = loadBundledDocsText();
  const hostPlatform = process.platform;
  const sections = [
    "You are OrgOps OpsCLI, a recursive maintenance agent for this host.",
    "You are controlling a self-contained OrgOps release bundle.",
    `Host platform: ${hostPlatform}.`,
    "Execution runs in a persistent Node.js vm context (not node:repl).",
    "Read and use global `prompt` before acting.",
    "global `prompt` is string-like and also supports `prompt.text`.",
    "Return exactly ONE JavaScript snippet each turn.",
    "Do NOT return JSON and do NOT wrap in markdown fences.",
    "Module loading is available via `require(...)` and `await import(...)`.",
    "Prefer built-in tools (`shell`, `extractOrgOps`, `setupOrgOps`) before importing modules.",
    "Use shell(command) to execute host commands.",
    "shell(command) accepts exactly one string argument. Do NOT pass callbacks or extra args.",
    "shell(command) is async and returns command output as a string (stdout + stderr when present).",
    "Always use `await shell(...)`.",
    "shell(command) throws on timeout or non-zero exit; use try/catch when needed.",
    "If host platform is win32, prefer PowerShell commands/syntax over Bash.",
    "If host platform is win32, use Windows-compatible commands and avoid bash-only tools/features.",
    "Use print(...args) to write output to stdout.",
    "Use input(question) to ask the user for stdin input.",
    "input(question) is async. Always use `await input(...)`.",
    "Use finish() to end the current turn and return control to the next `You>` prompt.",
    "Use exit(code) to finish and request process termination.",
    "Use extractOrgOps(options?) to extract bundled OrgOps source to disk.",
    "Use setupOrgOps(options?) to extract + install deps + configure selected components.",
    "extractOrgOps(...) and setupOrgOps(...) are async. Always call them with `await`.",
    "When extracting, always store the awaited path: `const extractedRoot = await extractOrgOps();` and reuse that path for later commands.",
    "If user asks to refresh/re-extract/update bundle contents, call `await extractOrgOps({ force: true })`.",
    "Use getBundledDocs() when you need OrgOps architecture/deployment details.",
    "Default extraction location is `./orgops` in current working directory.",
    "Remember and reuse extracted path from `.env` key `ORGOPS_EXTRACTED_ROOT` on next sessions.",
    "Do not choose custom extraction paths unless the user explicitly requests another location.",
    "Before setup/start actions, verify prerequisites with shell: check `node -v` and `npm -v`.",
    "If Node.js or npm is missing, install them automatically using shell and continue.",
    "Use platform-appropriate installers: macOS (Homebrew), Linux (apt/yum/dnf), Windows (winget/choco if available).",
    "When user asks to start/stop OrgOps components, prefer PM2 under the hood for process management.",
    "If PM2 is missing, install it automatically (`npm install -g pm2`) before managing services.",
    "PM2 works on macOS, Linux, and Windows; use it consistently across platforms.",
    "Always run OrgOps workspace commands from extracted root (e.g. `cd \"<extractedRoot>\" && npm run ...`).",
    "For long-running services (api/ui/runner), do NOT start with plain `npm run ...` via shell because it blocks the REPL loop.",
    "Use PM2 start/stop/restart/logs/status commands for service lifecycle instead of foreground npm starts.",
    "When starting npm-based services with PM2, wrap the full command string: `pm2 start \"npm run --workspace @orgops/api dev\" --name orgops-api`.",
    "Example PM2 starts: `pm2 start \"npm run --workspace @orgops/agent-runner dev\" --name orgops-runner` and `pm2 start \"npm run --workspace @orgops/ui dev -- --host 0.0.0.0 --port 5173\" --name orgops-ui`.",
    "After PM2 starts services, verify with `pm2 status` and print URLs/health checks.",
    "For keep-running-after-restart, use PM2 persistence commands (`pm2 save` + `pm2 startup`) and report any manual step output.",
    "Use stable PM2 names: `orgops-api`, `orgops-runner`, `orgops-ui` for start/stop/restart/log/status operations.",
    "State can be persisted across turns using global variables.",
    "For conversational/chat responses, print your reply and call finish().",
    "Do NOT force a goal-execution workflow when the user is just chatting.",
    "Prefer asking follow-up questions via print(...) + finish() rather than input(...), unless immediate same-turn input is truly required.",
    "When global `prompt` is non-empty, it already contains the user's goal. Do NOT call input(question) just to ask what the goal is.",
    "If prompt is empty, ask for goal using input(question).",
  ];
  if (docsText) {
    sections.push(`Bundled OrgOps docs (truncated):\n${docsText}`);
  }
  return sections.join("\n");
}

function createSession(): RlmSession {
  const runtime = createJsRuntimeSession();
  const context = runtime.context;
  Object.assign(context, {
    console,
    process,
    Buffer,
    require: runtimeRequire ?? defaultRuntimeRequire,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  const session: RlmSession = {
    runtime,
    context,
    reservedKeys: new Set(Object.keys(context)),
    memory: { summary: "", history: [] },
    exited: false,
    exitCode: 0,
    turnDone: false,
    runHooks: null,
  };
  const appendObservation = (type: string, payload: Record<string, unknown>) => {
    session.runHooks?.appendObservation(type, payload);
    session.runHooks?.reportProgress?.(type, payload);
  };
  Object.assign(context, {
    shell: (command: string) => {
      return (async () => {
        const signal = session.runHooks?.getAbortSignal?.();
        throwIfInterrupted(signal);
        appendObservation("opscli.repl.shell.start", { command });
        const result = await runShell(command, COMMAND_TIMEOUT_MS, signal);
        appendSessionLog(
          `shell command=${JSON.stringify(command)} exit=${result.exitCode} timeout=${result.timedOut} aborted=${result.aborted} durationMs=${result.durationMs}`
        );
        if (result.stdout.trim()) {
          appendSessionLog(`shell stdout=${JSON.stringify(truncateText(result.stdout, 4000).text)}`);
        }
        if (result.stderr.trim()) {
          appendSessionLog(`shell stderr=${JSON.stringify(truncateText(result.stderr, 4000).text)}`);
        }
        appendObservation("opscli.repl.shell", {
          command,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          aborted: result.aborted,
          stdout: truncateText(result.stdout, 4_000).text,
          stderr: truncateText(result.stderr, 4_000).text,
          durationMs: result.durationMs,
        });
        appendObservation("opscli.repl.shell.done", {
          command,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          aborted: result.aborted,
          durationMs: result.durationMs,
        });
        if (result.aborted || signal?.aborted) {
          throw new TaskInterruptedError();
        }
        if (result.timedOut) {
          throw new Error(
            `Command timed out after ${COMMAND_TIMEOUT_MS}ms: ${command}\n${truncateText(
              result.stderr || result.stdout,
              2_000
            ).text}`
          );
        }
        if (result.exitCode !== 0) {
          throw new Error(
            `Command failed (exit ${result.exitCode}): ${command}\n${truncateText(
              result.stderr || result.stdout,
              2_000
            ).text}`
          );
        }
        return mergeShellOutput(result.stdout, result.stderr);
      })();
    },
    print: (...args: unknown[]) => {
      const text = args.map((arg) => formatPrintArg(arg)).join(" ");
      writeRoleMessage("agent", text, { leadingNewline: true });
      appendSessionLog(`print ${JSON.stringify(text)}`);
      appendObservation("opscli.repl.print", { text });
      return text;
    },
    input: async (question?: string) => {
      const promptText =
        typeof question === "string" && question.trim()
          ? question.trim()
          : "Please provide input";
      const answer = await session.runHooks?.requestUserInput(promptText);
      const value = answer ?? "";
      appendSessionLog(
        `input question=${JSON.stringify(promptText)} answer=${JSON.stringify(value)}`
      );
      appendObservation("opscli.stdin.input", {
        question: promptText,
        answer: value,
      });
      return value;
    },
    exit: (code?: number) => {
      const normalizedCode =
        typeof code === "number" && Number.isFinite(code) ? Math.floor(code) : 0;
      session.exited = true;
      session.exitCode = normalizedCode;
      appendObservation("opscli.repl.exit", { code: normalizedCode });
      return normalizedCode;
    },
    finish: () => {
      session.turnDone = true;
      appendObservation("opscli.repl.finish", {});
      return "Turn finished.";
    },
    clear: () => {
      const ctx = session.context;
      for (const key of Object.keys(ctx)) {
        if (session.reservedKeys.has(key)) continue;
        delete ctx[key];
      }
      return "Context cleared.";
    },
    help: () =>
      "Use prompt, shell(command), print(...args), input(question), finish(), exit(code), clear(), extractOrgOps(options?), setupOrgOps(options?), getBundledDocs(), and global state.",
    getBundledDocs: () => loadBundledDocsText(),
    extractOrgOps: async (options?: { targetDir?: string; force?: boolean }) =>
      extractBundledOrgOps(options),
    setupOrgOps: async (options?: {
      targetDir?: string;
      components?: string[];
      forceExtract?: boolean;
      installDependencies?: boolean;
      buildUi?: boolean;
    }) => setupBundledOrgOps(options),
  });
  session.reservedKeys.add("prompt");
  session.reservedKeys.add("shell");
  session.reservedKeys.add("print");
  session.reservedKeys.add("input");
  session.reservedKeys.add("finish");
  session.reservedKeys.add("exit");
  session.reservedKeys.add("clear");
  session.reservedKeys.add("help");
  session.reservedKeys.add("getBundledDocs");
  session.reservedKeys.add("extractOrgOps");
  session.reservedKeys.add("setupOrgOps");
  return session;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function evaluateInput(
  session: RlmSession,
  code: string,
  abortSignal?: AbortSignal
): Promise<string> {
  throwIfInterrupted(abortSignal);
  let scriptValue: unknown;
  try {
    scriptValue = await session.runtime.evaluate(code, {
      filename: "opscli-repl",
      bootstrapTimeoutMs: EVAL_CALLBACK_TIMEOUT_MS,
    });
  } catch (error) {
    const message = String(error);
    if (message.includes("Script execution timed out")) {
      const preview = truncateText(code.replace(/\s+/g, " ").trim(), 240).text;
      throw new Error(
        `Snippet bootstrap timed out after ${EVAL_CALLBACK_TIMEOUT_MS}ms before execution started. ` +
          `This usually means the snippet is too complex or stuck in synchronous setup.\n` +
          `Snippet preview: ${preview}\n` +
          `Retry with a simpler snippet and explicit early checkpoints (for example print("ckpt")).`
      );
    }
    throw error;
  }
  const value =
    scriptValue && typeof (scriptValue as Promise<unknown>).then === "function"
      ? await (async () => {
          const evaluation = withTimeout(scriptValue as Promise<unknown>, EVAL_TIMEOUT_MS);
          const interrupted = createInterruptPromise(abortSignal);
          if (!interrupted) return evaluation;
          return Promise.race([evaluation, interrupted]);
        })()
      : scriptValue;
  return truncateText(formatValue(value), MAX_OUTPUT_CHARS).text;
}

async function runAutonomousTask(
  goal: string,
  session: RlmSession,
  memory: SessionMemory,
  requestUserInput: (promptText: string) => Promise<string>,
  abortSignal?: AbortSignal
): Promise<{ requestedExit: boolean; exitCode: number }> {
  session.exited = false;
  session.exitCode = 0;
  session.turnDone = false;
  session.context.prompt = createPromptValue(goal);
  appendHistoryMessage(memory, {
    role: "user",
    content: JSON.stringify(
      {
        type: "opscli.prompt",
        text: truncateText(goal, MAX_INPUT_CHARS).text,
        isEmpty: goal.trim().length === 0,
        host: {
          platform: process.platform,
          arch: process.arch,
          hostname: hostname(),
          cwd: process.cwd(),
        },
        promptReplPath: "globalThis.prompt",
      },
      null,
      2
    ),
  });

  session.runHooks = {
    appendObservation: (type, payload) => {
      appendHistoryMessage(memory, {
        role: "user",
        content: JSON.stringify({ type, ...payload }, null, 2),
      });
    },
    requestUserInput,
    reportProgress: (type, payload) => renderObservationProgress(type, payload),
    getAbortSignal: () => abortSignal,
  };

  const modelId = getModelId();
  for (let step = 1; step <= MAX_STEPS; step += 1) {
    throwIfInterrupted(abortSignal);
    reportProgress(`step ${step}/${MAX_STEPS}: preparing model input`, {
      leadingNewline: step === 1,
    });
    const modelMessages: LlmMessage[] = [{ role: "system", content: buildSystemPrompt() }];
    if (memory.summary.trim()) {
      modelMessages.push({
        role: "system",
        content: `Session rolling summary:\n${memory.summary}`,
      });
    }
    modelMessages.push(...memory.history);
    modelMessages.push({
      role: "user",
      content: JSON.stringify(
        {
          type: "opscli.repl.next_input.requested",
          step,
          promptAvailableInRepl: true,
          promptReplPath: "globalThis.prompt",
        },
        null,
        2
      ),
    });

    let result: Awaited<ReturnType<typeof generate>>;
    try {
      reportProgress(`step ${step}/${MAX_STEPS}: waiting for model reply`);
      const thinkingSpinner = startSpinner("Thinking");
      result = await generate(modelId, modelMessages, {
        maxSteps: 1,
        abortSignal,
      }).finally(() => thinkingSpinner.stop("Thought ready."));
      reportProgress(`step ${step}/${MAX_STEPS}: model reply received`);
    } catch (error) {
      if (error instanceof TaskInterruptedError || isAbortError(error)) {
        appendSessionLog(`step=${step} interrupted during thinking`);
        forceStopSpinner();
        writeRoleMessage("opscli", "Interrupted current run. You can now ask follow-ups or retry.", {
          leadingNewline: true,
        });
        session.runHooks = null;
        return { requestedExit: false, exitCode: 0 };
      }
      throw error;
    }
    const modelText = result.text ?? "";
    const code = extractCode(modelText);
    appendSessionLog(
      `step=${step} modelRaw=${JSON.stringify(truncateText(modelText, 4000).text)}`
    );
    if (!code.trim()) {
      appendHistoryMessage(memory, { role: "assistant", content: modelText });
      appendHistoryMessage(memory, {
        role: "user",
        content: "Your last reply was empty. Return one non-empty JavaScript snippet.",
      });
      continue;
    }

    const truncatedInput = truncateText(code, MAX_INPUT_CHARS);
    appendSessionLog(`step=${step} code=${JSON.stringify(truncatedInput.text)}`);
    if (DEBUG_REPL_TRACE) {
      console.log(`\nopscli[js:${step}] ${truncatedInput.text}`);
    }
    appendHistoryMessage(memory, { role: "assistant", content: code });

    try {
      reportProgress(`step ${step}/${MAX_STEPS}: running REPL plan`);
      const executeSpinner = startSpinner("Running plan");
      const outputText = await evaluateInput(session, code, abortSignal).finally(() =>
        executeSpinner.stop("Plan run complete.")
      );
      reportProgress(`step ${step}/${MAX_STEPS}: REPL plan finished`);
      appendSessionLog(`step=${step} result=${JSON.stringify(outputText)}`);
      if (DEBUG_REPL_TRACE) {
        console.log(`result:\n${outputText}`);
      }
      appendHistoryMessage(memory, {
        role: "user",
        content: JSON.stringify(
          {
            type: "opscli.repl.output",
            step,
            output: outputText,
          },
          null,
          2
        ),
      });
    } catch (error) {
      if (error instanceof TaskInterruptedError || isAbortError(error)) {
        appendSessionLog(`step=${step} interrupted`);
        forceStopSpinner();
        writeRoleMessage("opscli", "Interrupted current run. You can now ask follow-ups or retry.", {
          leadingNewline: true,
        });
        session.runHooks = null;
        return { requestedExit: false, exitCode: 0 };
      }
      const outputText = truncateText(String(error), MAX_OUTPUT_CHARS).text;
      appendSessionLog(`step=${step} error=${JSON.stringify(outputText)}`);
      if (DEBUG_REPL_TRACE) {
        console.log(`error:\n${outputText}`);
      } else {
        writeRoleMessage("error", `Step failed: ${truncateText(outputText, 500).text}`, {
          leadingNewline: true,
          toStderr: true,
        });
      }
      appendHistoryMessage(memory, {
        role: "user",
        content: JSON.stringify(
          {
            type: "opscli.repl.error",
            step,
            error: outputText,
          },
          null,
          2
        ),
      });
    }

    if (session.exited) {
      forceStopSpinner();
      writeRoleMessage("opscli", `agent requested exit(${session.exitCode}).`, {
        leadingNewline: true,
      });
      session.runHooks = null;
      return { requestedExit: true, exitCode: session.exitCode };
    }

    if (session.turnDone) {
      forceStopSpinner();
      session.runHooks = null;
      return { requestedExit: false, exitCode: 0 };
    }
  }

  session.runHooks = null;
  forceStopSpinner();
  writeRoleMessage("opscli", `Stopped after ${MAX_STEPS} steps without exit(code).`, {
    leadingNewline: true,
  });
  return { requestedExit: false, exitCode: 0 };
}

async function askProviderChoice(
  rl: ReturnType<typeof createInterface>
): Promise<ModelProvider> {
  while (true) {
    const answer = (
      await rl.question(
        "No model API key found. Choose provider: [1] OpenAI, [2] Claude (Anthropic): "
      )
    )
      .trim()
      .toLowerCase();
    if (answer === "1" || answer === "openai") return "openai";
    if (
      answer === "2" ||
      answer === "claude" ||
      answer === "anthropic" ||
      answer === "claude (anthropic)"
    ) {
      return "anthropic";
    }
    console.log("Please choose 1 (OpenAI) or 2 (Claude/Anthropic).");
  }
}

async function ensureModelCredentials(
  rl: ReturnType<typeof createInterface>,
  rootEnvPath: string
) {
  let modelId = getModelId();
  let provider = getModelProvider(modelId);
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY?.trim());
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const hasAnyKey = hasOpenAiKey || hasAnthropicKey;

  if (!hasAnyKey) {
    provider = await askProviderChoice(rl);
    modelId = getDefaultModelIdForProvider(provider);
    process.env.ORGOPS_OPSCLI_MODEL = modelId;
    writeMergedEnvFile(rootEnvPath, { ORGOPS_OPSCLI_MODEL: modelId });
    console.log(`Using model: ${modelId}`);
  }

  let requiredApiKeyEnv = getProviderApiKeyEnvKey(provider);
  if (!process.env[requiredApiKeyEnv]?.trim()) {
    const alternateProvider = getAlternateProvider(provider);
    const alternateApiKeyEnv = getProviderApiKeyEnvKey(alternateProvider);
    if (process.env[alternateApiKeyEnv]?.trim()) {
      const switchAnswer = (
        await rl.question(
          `Current model uses ${getProviderLabel(provider)} but ${requiredApiKeyEnv} is missing.\nSwitch model to ${getProviderLabel(alternateProvider)} to use existing ${alternateApiKeyEnv}? [Y/n]: `
        )
      )
        .trim()
        .toLowerCase();
      if (!switchAnswer || switchAnswer === "y" || switchAnswer === "yes") {
        provider = alternateProvider;
        modelId = getDefaultModelIdForProvider(provider);
        process.env.ORGOPS_OPSCLI_MODEL = modelId;
        writeMergedEnvFile(rootEnvPath, { ORGOPS_OPSCLI_MODEL: modelId });
        console.log(`Using model: ${modelId}`);
        requiredApiKeyEnv = getProviderApiKeyEnvKey(provider);
      }
    }
  }

  if (!process.env[requiredApiKeyEnv]?.trim()) {
    const label = getProviderLabel(provider);
    const answer = (
      await rl.question(`${requiredApiKeyEnv} not found for ${label}. Enter key: `)
    ).trim();
    if (!answer) {
      console.error(`${requiredApiKeyEnv} is required for ${label}.`);
      return false;
    }
    process.env[requiredApiKeyEnv] = answer;
    writeMergedEnvFile(rootEnvPath, { [requiredApiKeyEnv]: answer });
    console.log(`Saved ${requiredApiKeyEnv} to ${rootEnvPath}`);
  }
  return true;
}

async function main() {
  let cli: CliOptions;
  try {
    cli = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    writeRoleMessage("error", String(error), { toStderr: true });
    process.exitCode = 1;
    return;
  }
  if (cli.help) {
    printCliHelp();
    return;
  }
  const rootEnvPath = getOpsCliEnvPath();
  loadDotEnvIntoProcess(rootEnvPath);
  resetSessionLog();
  appendSessionLog("main initialized");
  writeRoleMessage("opscli", "OrgOps OpsCLI ready.");
  const buildTimestamp = loadBuildTimestamp();
  if (buildTimestamp) {
    writeRoleMessage("opscli", `Build timestamp (UTC): ${buildTimestamp}`);
  }
  writeRoleMessage("opscli", `OpsCLI session log: ${SESSION_LOG_PATH}`);
  let rl = createInterface({ input: stdin, output: stdout });
  const hasCredentials = await ensureModelCredentials(rl, rootEnvPath);
  if (!hasCredentials) {
    rl.close();
    process.exitCode = 1;
    return;
  }
  const session = createSession();
  if (!cli.goal) {
    writeRoleMessage("opscli", "Type a maintenance goal (can be empty), or 'exit' to quit.");
  } else {
    writeRoleMessage("opscli", "Running one-shot goal from CLI argument.");
  }
  let activeTaskAbortController: AbortController | null = null;
  let lastSigintAt = 0;
  const onSigint = () => {
    const now = Date.now();
    const isDoubleSigint = now - lastSigintAt <= DOUBLE_SIGINT_WINDOW_MS;
    lastSigintAt = now;
    if (isDoubleSigint) {
      appendSessionLog("sigint received twice: exiting process");
      if (activeTaskAbortController && !activeTaskAbortController.signal.aborted) {
        activeTaskAbortController.abort();
      }
      forceStopSpinner();
      writeRoleMessage("opscli", "Second Ctrl+C detected. Exiting OpsCLI.", {
        leadingNewline: true,
      });
      process.exit(130);
    }
    if (activeTaskAbortController && !activeTaskAbortController.signal.aborted) {
      appendSessionLog("sigint received: interrupting active run");
      activeTaskAbortController.abort();
      forceStopSpinner();
      writeRoleMessage(
        "opscli",
        "Interrupt requested. Stopping current run... (press Ctrl+C again quickly to exit)",
        {
          leadingNewline: true,
        }
      );
      return;
    }
    forceStopSpinner();
    writeRoleMessage(
      "opscli",
      "No active run to interrupt. Press Ctrl+C again quickly to exit (or type 'exit').",
      {
        leadingNewline: true,
      }
    );
  };
  rl.on("SIGINT", onSigint);
  try {
    if (cli.goal) {
      activeTaskAbortController = new AbortController();
      const result = await runAutonomousTask(
        cli.goal,
        session,
        session.memory,
        async (promptText) => {
          writeRoleMessage("agent", `${promptText}`, { leadingNewline: true });
          return rl.question(`${rolePrefix("user")} `);
        },
        activeTaskAbortController.signal
      );
      activeTaskAbortController = null;
      if (result.requestedExit) {
        process.exitCode = result.exitCode;
      }
      return;
    }
    while (true) {
      let input = "";
      try {
        input = await rl.question(`\n${rolePrefix("user")} `);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code === "ERR_USE_AFTER_CLOSE") {
          appendSessionLog("readline closed unexpectedly; recreating prompt");
          rl.close();
          rl = createInterface({ input: stdin, output: stdout });
          rl.on("SIGINT", onSigint);
          writeRoleMessage("opscli", "Prompt recovered after interrupt.", {
            leadingNewline: true,
          });
          continue;
        }
        throw error;
      }
      const normalized = input.trim().toLowerCase();
      if (normalized === "exit" || normalized === "quit") break;
      try {
        activeTaskAbortController = new AbortController();
        const result = await runAutonomousTask(
          input,
          session,
          session.memory,
          async (promptText) => {
            writeRoleMessage("agent", `${promptText}`, { leadingNewline: true });
            return rl.question(`${rolePrefix("user")} `);
          },
          activeTaskAbortController.signal
        );
        activeTaskAbortController = null;
        if (result.requestedExit) {
          process.exitCode = result.exitCode;
          break;
        }
      } catch (error) {
        activeTaskAbortController = null;
        if (error instanceof TaskInterruptedError || isAbortError(error)) {
          writeRoleMessage("opscli", "Interrupted current run. You can now ask follow-ups or retry.", {
            leadingNewline: true,
          });
          continue;
        }
        const text = truncateText(String(error), MAX_OUTPUT_CHARS).text;
        writeRoleMessage("error", `Task failed: ${text}`, {
          leadingNewline: true,
          toStderr: true,
        });
        writeRoleMessage(
          "muted",
          "You can switch models with ORGOPS_OPSCLI_MODEL, e.g. `openai:gpt-4o-mini` or `anthropic:claude-3-5-sonnet-latest`.",
          { toStderr: true }
        );
      }
    }
  } finally {
    rl.off("SIGINT", onSigint);
    session.runHooks = null;
    session.runtime.close();
    rl.close();
  }
}

void main().catch((error) => {
  const text = truncateText(String(error), MAX_OUTPUT_CHARS).text;
  writeRoleMessage("error", `Fatal startup error: ${text}`, { toStderr: true });
  process.exitCode = 1;
});
