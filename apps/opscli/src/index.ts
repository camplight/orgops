import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runAgentTurn } from "./agent";
import { SESSION_LOG_PATH, DOUBLE_SIGINT_WINDOW_MS } from "./config";
import { loadBuildTimestamp, loadBundledDocsText } from "./bundle";
import {
  ensureModelCredentials,
  getModelId,
  getOpsCliEnvPath,
  loadDotEnvIntoProcess,
} from "./env";
import { appendSessionLog, resetSessionLog } from "./logger";
import type { CliOptions, SessionMemory } from "./types";
import { TaskInterruptedError } from "./types";
import { forceStopSpinner, rolePrefix, writeRoleMessage } from "./ui";
import { toDisplayError } from "./utils";

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
    "  opscli-macos [--goal \"instruction\"]",
    "",
    "Options:",
    "  -g, --goal <text>    Run one autonomous goal and exit",
    "  -h, --help           Show help",
  ];
  stdout.write(`${lines.join("\n")}\n`);
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
  resetSessionLog(getModelId());
  appendSessionLog("main initialized");

  writeRoleMessage("opscli", "OrgOps OpsCLI ready.");
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
  if (!cli.goal) writeRoleMessage("opscli", "Type a maintenance goal (can be empty), or 'exit' to quit.");
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
}

void main().catch((error) => {
  writeRoleMessage("error", `Fatal startup error: ${toDisplayError(error)}`, { toStderr: true });
  process.exitCode = 1;
});
