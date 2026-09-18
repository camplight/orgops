import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runAgentTurn } from "./lib/agent";
import { SESSION_LOG_PATH, DOUBLE_SIGINT_WINDOW_MS } from "./lib/config";
import { loadBuildTimestamp, loadBundledDocsText } from "./lib/bundle";
import {
  ensureModelCredentials,
  getModelId,
  getOpsCliEnvPath,
  loadDotEnvIntoProcess,
} from "./lib/env";
import { appendSessionLog, resetSessionLog } from "./lib/logger";
import type { CliOptions, SessionMemory } from "./lib/types";
import { TaskInterruptedError } from "./lib/types";
import { forceStopSpinner, rolePrefix, writeRoleMessage } from "./lib/ui";
import { toDisplayError } from "./lib/utils";
import { runInstall } from "./lib/install";
import { getAdminUiStatus, startAndOpenAdminUi, stopAdminUi } from "./lib/admin-ui";
import { ensurePrerequisites } from "./lib/prereqs";
import { getUserStackStatus, startUserStack, stopUserStack } from "./lib/user-stack";

type ParsedCommand =
  | { name: "help" }
  | { name: "chat"; options: CliOptions }
  | {
      name: "install";
      options: {
        installDir?: string;
        repoUrl?: string;
        repoRef?: string;
        registerService: boolean;
        createShortcut: boolean;
      };
    }
  | {
      name: "admin-open";
      options: { installDir?: string };
    }
  | {
      name: "admin-stop";
      options: { installDir?: string };
    }
  | {
      name: "admin-status";
      options: { installDir?: string };
    }
  | {
      name: "start";
      options: { installDir?: string; openBrowser: boolean };
    }
  | {
      name: "stop";
      options: { installDir?: string };
    }
  | {
      name: "status";
      options: { installDir?: string };
    }
  | { name: "doctor" };

function parseChatArgs(argv: string[]): CliOptions {
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
      if (!value) throw new Error(`Missing value for ${token}. Usage: --goal "your instruction"`);
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
    "  opscli chat [--goal \"instruction\"]",
    "  opscli install [--dir <path>] [--repo <url>] [--ref <git-ref>] [--register-service] [--create-shortcut]",
    "  opscli start [--dir <path>] [--no-open]",
    "  opscli stop [--dir <path>]",
    "  opscli status [--dir <path>]",
    "  opscli admin open [--dir <path>]",
    "  opscli admin stop [--dir <path>]",
    "  opscli admin status [--dir <path>]",
    "  opscli doctor",
    "",
    "Options:",
    "  -g, --goal <text>    Chat: run one autonomous goal and exit",
    "  --dir <path>         Install/admin: OrgOps install directory (default: ./orgops)",
    "  --repo <url>         Install: git repository URL",
    "  --ref <git-ref>      Install: git branch/tag/ref (default: main)",
    "  --register-service   Install: register auto-start service at login",
    "  --create-shortcut    Install: create desktop shortcut for User UI",
    "  --no-open            Start: do not open User UI in browser",
    "  -h, --help           Show help",
  ];
  stdout.write(`${lines.join("\n")}\n`);
}

function parseGlobalArgs(argv: string[]): ParsedCommand {
  const [first = "help", second = "", ...rest] = argv;
  if (first === "--help" || first === "-h" || first === "help") return { name: "help" };
  if (first === "doctor") return { name: "doctor" };
  if (first === "start") {
    let installDir: string | undefined;
    let openBrowser = true;
    const args = [second, ...rest].filter(Boolean);
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      if (token === "--no-open") {
        openBrowser = false;
        continue;
      }
      throw new Error(`Unknown argument for start: ${token}`);
    }
    return { name: "start", options: { installDir, openBrowser } };
  }
  if (first === "stop") {
    let installDir: string | undefined;
    const args = [second, ...rest].filter(Boolean);
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      throw new Error(`Unknown argument for stop: ${token}`);
    }
    return { name: "stop", options: { installDir } };
  }
  if (first === "status") {
    let installDir: string | undefined;
    const args = [second, ...rest].filter(Boolean);
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      throw new Error(`Unknown argument for status: ${token}`);
    }
    return { name: "status", options: { installDir } };
  }
  if (first === "admin" && second === "open") {
    let installDir: string | undefined;
    const args = [...rest];
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      throw new Error(`Unknown argument for admin open: ${token}`);
    }
    return { name: "admin-open", options: { installDir } };
  }
  if (first === "admin" && second === "stop") {
    let installDir: string | undefined;
    const args = [...rest];
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      throw new Error(`Unknown argument for admin stop: ${token}`);
    }
    return { name: "admin-stop", options: { installDir } };
  }
  if (first === "admin" && second === "status") {
    let installDir: string | undefined;
    const args = [...rest];
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      throw new Error(`Unknown argument for admin status: ${token}`);
    }
    return { name: "admin-status", options: { installDir } };
  }
  if (first === "install") {
    const args = [second, ...rest].filter(Boolean);
    let installDir: string | undefined;
    let repoUrl: string | undefined;
    let repoRef: string | undefined;
    let registerService = false;
    let createShortcut = false;
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      if (token === "--repo") {
        repoUrl = args.shift();
        if (!repoUrl) throw new Error("Missing value for --repo.");
        continue;
      }
      if (token === "--ref") {
        repoRef = args.shift();
        if (!repoRef) throw new Error("Missing value for --ref.");
        continue;
      }
      if (token === "--register-service") {
        registerService = true;
        continue;
      }
      if (token === "--create-shortcut") {
        createShortcut = true;
        continue;
      }
      throw new Error(`Unknown argument for install: ${token}`);
    }
    return {
      name: "install",
      options: {
        installDir,
        repoUrl,
        repoRef,
        registerService,
        createShortcut,
      },
    };
  }
  if (first === "chat") {
    const options = parseChatArgs([second, ...rest].filter(Boolean));
    if (options.help) return { name: "help" };
    return { name: "chat", options };
  }
  if (first === "--goal" || first === "-g") {
    return { name: "chat", options: parseChatArgs(argv) };
  }
  if (!first.trim()) return { name: "help" };
  throw new Error(`Unknown command: ${first}`);
}

async function runChat(cli: CliOptions) {
  try {
    const rootEnvPath = getOpsCliEnvPath();
    loadDotEnvIntoProcess(rootEnvPath);
    resetSessionLog(getModelId());
    appendSessionLog("chat initialized");

    writeRoleMessage("opscli", "OrgOps OpsCLI chat ready.");
    const buildTimestamp = loadBuildTimestamp();
    if (buildTimestamp) writeRoleMessage("opscli", `Build timestamp (UTC): ${buildTimestamp}`);
    writeRoleMessage("opscli", `OpsCLI session log: ${SESSION_LOG_PATH}`);

    let rl = createInterface({ input: stdin, output: stdout });
    const hasCredentials = await ensureModelCredentials({
      ask: (prompt) => rl.question(prompt),
      rootEnvPath,
    });
    if (!hasCredentials) {
      rl.close();
      process.exitCode = 1;
      return;
    }

    const docsText = loadBundledDocsText();
    const memory: SessionMemory = { summary: "", history: [] };
    if (!cli.goal) writeRoleMessage("opscli", "Type a goal (can be empty), or 'exit' to quit.");
    else writeRoleMessage("opscli", "Running one-shot goal from CLI argument.");

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
        writeRoleMessage("opscli", "Second Ctrl+C detected. Exiting OpsCLI.", { leadingNewline: true });
        process.exit(130);
      }
      if (activeTaskAbortController && !activeTaskAbortController.signal.aborted) {
        appendSessionLog("sigint received: interrupting active run");
        activeTaskAbortController.abort();
        forceStopSpinner();
        writeRoleMessage(
          "opscli",
          "Interrupt requested. Stopping current run... (press Ctrl+C again quickly to exit)",
          { leadingNewline: true }
        );
        return;
      }
      forceStopSpinner();
      writeRoleMessage(
        "opscli",
        "No active run to interrupt. Press Ctrl+C again quickly to exit (or type 'exit').",
        { leadingNewline: true }
      );
    };

    rl.on("SIGINT", onSigint);
    try {
      const askPasswordInput = async (question: string) => {
        writeRoleMessage("opscli", `${question} (input hidden)`, { leadingNewline: true });
        const mutableRl = rl as unknown as {
          _writeToOutput?: (text: string) => void;
        };
        const originalWrite = mutableRl._writeToOutput;
        mutableRl._writeToOutput = () => {};
        try {
          return await rl.question(`${rolePrefix("user")} `);
        } finally {
          mutableRl._writeToOutput = originalWrite;
          stdout.write("\n");
        }
      };

      const executePrompt = async (promptText: string) => {
        activeTaskAbortController = new AbortController();
        const result = await runAgentTurn({
          modelId: getModelId(),
          docsText,
          promptText,
          memory,
          requestPasswordInput: askPasswordInput,
          abortSignal: activeTaskAbortController.signal,
        });
        activeTaskAbortController = null;
        return result;
      };

      if (cli.goal) {
        const result = await executePrompt(cli.goal);
        if (result.requestedExit) process.exitCode = result.exitCode;
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
            writeRoleMessage("opscli", "Prompt recovered after interrupt.", { leadingNewline: true });
            continue;
          }
          throw error;
        }

        const normalized = input.trim().toLowerCase();
        if (normalized === "exit" || normalized === "quit") break;

        try {
          const result = await executePrompt(input);
          if (result.requestedExit) {
            process.exitCode = result.exitCode;
            break;
          }
        } catch (error) {
          activeTaskAbortController = null;
          if (error instanceof TaskInterruptedError) {
            writeRoleMessage("opscli", "Interrupted current run. You can now ask follow-ups or retry.", {
              leadingNewline: true,
            });
            continue;
          }
          writeRoleMessage("error", `Task failed: ${toDisplayError(error)}`, {
            leadingNewline: true,
            toStderr: true,
          });
        }
      }
    } finally {
      rl.off("SIGINT", onSigint);
      rl.close();
    }
  } catch (error) {
    writeRoleMessage("error", `Chat failed: ${toDisplayError(error)}`, { toStderr: true });
    process.exitCode = 1;
  }
}

function printDoctor() {
  const check = ensurePrerequisites();
  if (check.ok) {
    writeRoleMessage("opscli", "Doctor check: all prerequisites available (node, npm, git).");
    return;
  }
  for (const result of check.results) {
    writeRoleMessage(
      "opscli",
      `${result.name}: ${result.ok ? "ok" : "missing"}${result.output ? ` (${result.output})` : ""}`
    );
  }
  writeRoleMessage("error", check.hint || "Missing prerequisites.", { toStderr: true });
  process.exitCode = 1;
}

async function main() {
  let parsed: ParsedCommand;
  try {
    parsed = parseGlobalArgs(process.argv.slice(2));
  } catch (error) {
    writeRoleMessage("error", String(error), { toStderr: true });
    printCliHelp();
    process.exitCode = 1;
    return;
  }

  if (parsed.name === "help") {
    printCliHelp();
    return;
  }

  if (parsed.name === "doctor") {
    printDoctor();
    return;
  }

  if (parsed.name === "install") {
    try {
      writeRoleMessage("opscli", "Running deterministic OrgOps install.");
      const result = runInstall(parsed.options);
      writeRoleMessage("opscli", `Install complete at ${result.installDir}.`);
      if (result.serviceRegistered) writeRoleMessage("opscli", result.serviceMessage || "Service registered.");
      if (result.shortcutPath) writeRoleMessage("opscli", `Created shortcut: ${result.shortcutPath}`);
      writeRoleMessage("opscli", `User UI URL: ${result.userUiUrl}`);
    } catch (error) {
      writeRoleMessage("error", `Install failed: ${toDisplayError(error)}`, { toStderr: true });
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "start") {
    try {
      writeRoleMessage("opscli", "Starting OrgOps user stack.");
      const result = await startUserStack(parsed.options);
      writeRoleMessage(
        "opscli",
        result.alreadyRunning
          ? `User stack already running. ${parsed.options.openBrowser ? `Opened ${result.url}` : `URL: ${result.url}`}`
          : `User stack started from ${result.installDir}. ${parsed.options.openBrowser ? `Opened ${result.url}` : `URL: ${result.url}`}`
      );
    } catch (error) {
      writeRoleMessage("error", `Start failed: ${toDisplayError(error)}`, { toStderr: true });
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "stop") {
    try {
      writeRoleMessage("opscli", "Stopping OrgOps user stack.");
      const result = stopUserStack(parsed.options);
      const stopText = result.stopped
        ? `Stopped user stack process (pid ${result.pid}) for ${result.installDir}.`
        : (result.message ?? "User stack is not running.");
      writeRoleMessage(
        "opscli",
        stopText
      );
    } catch (error) {
      writeRoleMessage("error", `Stop failed: ${toDisplayError(error)}`, { toStderr: true });
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "status") {
    try {
      const status = await getUserStackStatus(parsed.options);
      writeRoleMessage("opscli", `Install dir: ${status.installDir}`);
      writeRoleMessage("opscli", `Running: ${status.running ? "yes" : "no"}`);
      writeRoleMessage("opscli", `UI reachable: ${status.uiReachable ? "yes" : "no"} (${status.userUiUrl})`);
      writeRoleMessage(
        "opscli",
        `Runtime PID: ${status.runtimePid !== null ? String(status.runtimePid) : "none"}`
      );
      writeRoleMessage(
        "opscli",
        `Autostart service registered: ${status.serviceRegistered ? "yes" : "no"}`
      );
    } catch (error) {
      writeRoleMessage("error", `Status failed: ${toDisplayError(error)}`, { toStderr: true });
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "admin-open") {
    try {
      writeRoleMessage("opscli", "Starting Admin UI and opening browser.");
      const result = await startAndOpenAdminUi(parsed.options.installDir);
      writeRoleMessage(
        "opscli",
        result.alreadyRunning
          ? `Admin UI already running. Opened ${result.url}`
          : `Admin UI started from ${result.installDir}. Opened ${result.url}`
      );
    } catch (error) {
      writeRoleMessage("error", `Admin UI command failed: ${toDisplayError(error)}`, { toStderr: true });
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "admin-stop") {
    try {
      writeRoleMessage("opscli", "Stopping Admin UI.");
      const result = stopAdminUi(parsed.options.installDir);
      writeRoleMessage(
        "opscli",
        result.stopped
          ? `Stopped Admin UI process (pid ${result.pid}) for ${result.installDir}.`
          : (result.message ?? "Admin UI is not running.")
      );
    } catch (error) {
      writeRoleMessage("error", `Admin stop failed: ${toDisplayError(error)}`, { toStderr: true });
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "admin-status") {
    try {
      const status = await getAdminUiStatus(parsed.options.installDir);
      writeRoleMessage("opscli", `Install dir: ${status.installDir}`);
      writeRoleMessage("opscli", `Running: ${status.running ? "yes" : "no"}`);
      writeRoleMessage("opscli", `UI reachable: ${status.uiReachable ? "yes" : "no"} (${status.url})`);
      writeRoleMessage(
        "opscli",
        `Runtime PID: ${status.runtimePid !== null ? String(status.runtimePid) : "none"}`
      );
    } catch (error) {
      writeRoleMessage("error", `Admin status failed: ${toDisplayError(error)}`, { toStderr: true });
      process.exitCode = 1;
    }
    return;
  }

  await runChat(parsed.options);
}

void main().catch((error) => {
  writeRoleMessage("error", `Fatal startup error: ${toDisplayError(error)}`, { toStderr: true });
  process.exitCode = 1;
});
