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
import { emitError, emitOk, extractGlobalFlags, isYesMode, setCliModes } from "./lib/cli-output";
import { runInstall } from "./lib/install";
import { collectDoctorReport } from "./lib/prereqs";
import { runUpgrade } from "./lib/upgrade";
import { getComponentsStatus, startComponents, stopComponents } from "./lib/component-runtime";
import { formatComponents, parseComponentsArg } from "./lib/components";
import { loadState } from "./lib/runtime-state";
import { createShortcutAction, registerServiceAction, unregisterServiceAction } from "./lib/lifecycle-actions";
import type { ShortcutTarget } from "./lib/browser";
import { runUninstall } from "./lib/uninstall";
import { addComponents, removeComponents } from "./lib/component-actions";
import { controlAutostartServices, getAutostartServicesStatus } from "./lib/service";

type ParsedCommand =
  | { name: "help" }
  | { name: "chat"; options: CliOptions }
  | {
      name: "install";
      options: {
        installDir?: string;
        repoUrl?: string;
        repoRef?: string;
        components?: string;
        runnerApiUrl?: string;
        runnerToken?: string;
        runnerName?: string;
        runnerInviteUrl?: string;
        registerService: boolean;
        createShortcut: boolean;
        noGit: boolean;
        openBrowser: boolean;
      };
    }
  | {
      name: "upgrade";
      options: {
        installDir?: string;
        repoUrl?: string;
        repoRef?: string;
        components?: string;
        runnerApiUrl?: string;
        runnerToken?: string;
        runnerName?: string;
        runnerInviteUrl?: string;
        restart: boolean;
        noGit: boolean;
      };
    }
  | {
      name: "uninstall";
      options: { installDir?: string; components?: string; purgeData: boolean };
    }
  | {
      name: "component-add";
      options: {
        installDir?: string;
        repoUrl?: string;
        repoRef?: string;
        components: string;
        runnerApiUrl?: string;
        runnerToken?: string;
        runnerName?: string;
        runnerInviteUrl?: string;
        registerService: boolean;
        noGit: boolean;
      };
    }
  | {
      name: "component-remove";
      options: { installDir?: string; components: string; purgeData: boolean };
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
      name: "service-register";
      options: { installDir?: string; components?: string };
    }
  | {
      name: "service-unregister";
      options: { installDir?: string; components?: string };
    }
  | {
      name: "service-control";
      options: { installDir?: string; components?: string; action: "start" | "stop" | "restart" | "status" };
    }
  | {
      name: "shortcut-create";
      options: { url?: string; target: ShortcutTarget };
    }
  | {
      name: "start";
      options: { installDir?: string; openBrowser: boolean; components?: string };
    }
  | {
      name: "stop";
      options: { installDir?: string; components?: string };
    }
  | {
      name: "restart";
      options: { installDir?: string; openBrowser: boolean; components?: string };
    }
  | {
      name: "status";
      options: { installDir?: string; components?: string };
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
    "  opscli install [--dir <path>] [--repo <url>] [--ref <git-ref>] [--components <csv>] [--runner-api-url <url>] [--runner-token <token>] [--runner-name <name>] [--runner-invite-url <url>] [--register-service] [--create-shortcut] [--no-git] [--no-open] [--yes] [--json]",
    "  opscli upgrade [--dir <path>] [--repo <url>] [--ref <git-ref>] [--components <csv>] [--runner-api-url <url>] [--runner-token <token>] [--runner-name <name>] [--runner-invite-url <url>] [--no-restart] [--no-git]",
    "  opscli uninstall [--dir <path>] [--components <csv>] [--purge-data]",
    "  opscli component add --components <csv> [--dir <path>] [--register-service] [--no-git]",
    "  opscli component remove --components <csv> [--dir <path>] [--purge-data]",
    "  opscli start [--dir <path>] [--components <csv>] [--no-open]",
    "  opscli stop [--dir <path>] [--components <csv>]",
    "  opscli restart [--dir <path>] [--components <csv>] [--no-open]",
    "  opscli status [--dir <path>] [--components <csv>]",
    "  opscli service register [--dir <path>] [--components <csv>]",
    "  opscli service unregister [--dir <path>] [--components <csv>]",
    "  opscli service start|stop|restart|status [--dir <path>] [--components <csv>]",
    "  opscli shortcut create [--target user-ui|admin-ui] [--url <url>]",
    "  opscli admin open [--dir <path>]",
    "  opscli admin stop [--dir <path>]",
    "  opscli admin status [--dir <path>]",
    "  opscli doctor",
    "",
    "Options:",
    "  -g, --goal <text>    Chat: run one autonomous goal and exit",
    "  --dir <path>         Install/admin/service: OrgOps install directory (default: ./orgops)",
    "  --repo <url>         Install: git repository URL",
    "  --ref <git-ref>      Install: git branch/tag/ref (default: main)",
    "  --components <csv>   Components: api,runner,user-ui,admin-ui",
    "  --runner-api-url     Runner install/upgrade API base URL",
    "  --runner-token       Runner install/upgrade token",
    "  --runner-name        Runner display name",
    "  --runner-invite-url  Runner invite URL generated by Admin UI",
    "  --register-service   Install: register per-component auto-start services at login",
    "  --create-shortcut    Install: create desktop shortcut for User UI",
    "  --no-git             Install/upgrade from a GitHub source archive instead of a git checkout",
    "  --yes, -y            Non-interactive: skip browser opens and extra prompts",
    "  --json               Print a single JSON object instead of human-readable lines",
    "  --purge-data         Uninstall/remove: delete .env, .orgops-data, files, and backups too",
    "  --target <name>      Shortcut target: user-ui or admin-ui (default: user-ui)",
    "  --url <url>          Shortcut: override URL (default depends on --target)",
    "  --no-restart         Upgrade: do not restart previously running services",
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
    let components: string | undefined;
    const args = [second, ...rest].filter(Boolean);
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      if (token === "--components") {
        components = args.shift();
        if (!components) throw new Error("Missing value for --components.");
        continue;
      }
      if (token === "--no-open") {
        openBrowser = false;
        continue;
      }
      throw new Error(`Unknown argument for start: ${token}`);
    }
    return { name: "start", options: { installDir, openBrowser, components } };
  }
  if (first === "stop") {
    let installDir: string | undefined;
    let components: string | undefined;
    const args = [second, ...rest].filter(Boolean);
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      if (token === "--components") {
        components = args.shift();
        if (!components) throw new Error("Missing value for --components.");
        continue;
      }
      throw new Error(`Unknown argument for stop: ${token}`);
    }
    return { name: "stop", options: { installDir, components } };
  }
  if (first === "restart") {
    let installDir: string | undefined;
    let openBrowser = true;
    let components: string | undefined;
    const args = [second, ...rest].filter(Boolean);
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      if (token === "--components") {
        components = args.shift();
        if (!components) throw new Error("Missing value for --components.");
        continue;
      }
      if (token === "--no-open") {
        openBrowser = false;
        continue;
      }
      throw new Error(`Unknown argument for restart: ${token}`);
    }
    return { name: "restart", options: { installDir, openBrowser, components } };
  }
  if (first === "status") {
    let installDir: string | undefined;
    let components: string | undefined;
    const args = [second, ...rest].filter(Boolean);
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      if (token === "--components") {
        components = args.shift();
        if (!components) throw new Error("Missing value for --components.");
        continue;
      }
      throw new Error(`Unknown argument for status: ${token}`);
    }
    return { name: "status", options: { installDir, components } };
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
  if (first === "service" && second === "register") {
    let installDir: string | undefined;
    let components: string | undefined;
    const args = [...rest];
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      if (token === "--components") {
        components = args.shift();
        if (!components) throw new Error("Missing value for --components.");
        continue;
      }
      throw new Error(`Unknown argument for service register: ${token}`);
    }
    return { name: "service-register", options: { installDir, components } };
  }
  if (first === "service" && second === "unregister") {
    let installDir: string | undefined;
    let components: string | undefined;
    const args = [...rest];
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      if (token === "--components") {
        components = args.shift();
        if (!components) throw new Error("Missing value for --components.");
        continue;
      }
      throw new Error(`Unknown argument for service unregister: ${token}`);
    }
    return { name: "service-unregister", options: { installDir, components } };
  }
  if (first === "service" && ["start", "stop", "restart", "status"].includes(second)) {
    let installDir: string | undefined;
    let components: string | undefined;
    const args = [...rest];
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      if (token === "--components") {
        components = args.shift();
        if (!components) throw new Error("Missing value for --components.");
        continue;
      }
      throw new Error(`Unknown argument for service ${second}: ${token}`);
    }
    return {
      name: "service-control",
      options: { installDir, components, action: second as "start" | "stop" | "restart" | "status" },
    };
  }
  if (first === "shortcut" && second === "create") {
    let url: string | undefined;
    let target: ShortcutTarget = "user-ui";
    const args = [...rest];
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--target") {
        const raw = args.shift();
        if (!raw) throw new Error("Missing value for --target.");
        if (raw !== "user-ui" && raw !== "admin-ui") {
          throw new Error("Invalid value for --target. Use user-ui or admin-ui.");
        }
        target = raw;
        continue;
      }
      if (token === "--url") {
        url = args.shift();
        if (!url) throw new Error("Missing value for --url.");
        continue;
      }
      throw new Error(`Unknown argument for shortcut create: ${token}`);
    }
    return { name: "shortcut-create", options: { target, url } };
  }
  if (first === "install") {
    const args = [second, ...rest].filter(Boolean);
    let installDir: string | undefined;
    let repoUrl: string | undefined;
    let repoRef: string | undefined;
    let components: string | undefined;
    let runnerApiUrl: string | undefined;
    let runnerToken: string | undefined;
    let runnerName: string | undefined;
    let runnerInviteUrl: string | undefined;
    let registerService = false;
    let createShortcut = false;
    let noGit = false;
    let openBrowser = true;
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
      if (token === "--components") {
        components = args.shift();
        if (!components) throw new Error("Missing value for --components.");
        continue;
      }
      if (token === "--runner-api-url") {
        runnerApiUrl = args.shift();
        if (!runnerApiUrl) throw new Error("Missing value for --runner-api-url.");
        continue;
      }
      if (token === "--runner-token") {
        runnerToken = args.shift();
        if (!runnerToken) throw new Error("Missing value for --runner-token.");
        continue;
      }
      if (token === "--runner-name") {
        runnerName = args.shift();
        if (!runnerName) throw new Error("Missing value for --runner-name.");
        continue;
      }
      if (token === "--runner-invite-url") {
        runnerInviteUrl = args.shift();
        if (!runnerInviteUrl) throw new Error("Missing value for --runner-invite-url.");
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
      if (token === "--no-git") {
        noGit = true;
        continue;
      }
      if (token === "--no-open") {
        openBrowser = false;
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
        components,
        runnerApiUrl,
        runnerToken,
        runnerName,
        runnerInviteUrl,
        registerService,
        createShortcut,
        noGit,
        openBrowser,
      },
    };
  }
  if (first === "upgrade") {
    const args = [second, ...rest].filter(Boolean);
    let installDir: string | undefined;
    let repoUrl: string | undefined;
    let repoRef: string | undefined;
    let components: string | undefined;
    let runnerApiUrl: string | undefined;
    let runnerToken: string | undefined;
    let runnerName: string | undefined;
    let runnerInviteUrl: string | undefined;
    let restart = true;
    let noGit = false;
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
      if (token === "--components") {
        components = args.shift();
        if (!components) throw new Error("Missing value for --components.");
        continue;
      }
      if (token === "--runner-api-url") {
        runnerApiUrl = args.shift();
        if (!runnerApiUrl) throw new Error("Missing value for --runner-api-url.");
        continue;
      }
      if (token === "--runner-token") {
        runnerToken = args.shift();
        if (!runnerToken) throw new Error("Missing value for --runner-token.");
        continue;
      }
      if (token === "--runner-name") {
        runnerName = args.shift();
        if (!runnerName) throw new Error("Missing value for --runner-name.");
        continue;
      }
      if (token === "--runner-invite-url") {
        runnerInviteUrl = args.shift();
        if (!runnerInviteUrl) throw new Error("Missing value for --runner-invite-url.");
        continue;
      }
      if (token === "--no-restart") {
        restart = false;
        continue;
      }
      if (token === "--no-git") {
        noGit = true;
        continue;
      }
      throw new Error(`Unknown argument for upgrade: ${token}`);
    }
    return {
      name: "upgrade",
      options: {
        installDir,
        repoUrl,
        repoRef,
        components,
        runnerApiUrl,
        runnerToken,
        runnerName,
        runnerInviteUrl,
        restart,
        noGit,
      },
    };
  }
  if (first === "uninstall") {
    let installDir: string | undefined;
    let components: string | undefined;
    let purgeData = false;
    const args = [second, ...rest].filter(Boolean);
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      if (token === "--components") {
        components = args.shift();
        if (!components) throw new Error("Missing value for --components.");
        continue;
      }
      if (token === "--purge-data") {
        purgeData = true;
        continue;
      }
      throw new Error(`Unknown argument for uninstall: ${token}`);
    }
    return { name: "uninstall", options: { installDir, components, purgeData } };
  }
  if (first === "component" && second === "add") {
    const args = [...rest];
    let installDir: string | undefined;
    let repoUrl: string | undefined;
    let repoRef: string | undefined;
    let components = "";
    let runnerApiUrl: string | undefined;
    let runnerToken: string | undefined;
    let runnerName: string | undefined;
    let runnerInviteUrl: string | undefined;
    let registerService = false;
    let noGit = false;
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
      if (token === "--components") {
        components = args.shift() ?? "";
        if (!components) throw new Error("Missing value for --components.");
        continue;
      }
      if (token === "--runner-api-url") {
        runnerApiUrl = args.shift();
        if (!runnerApiUrl) throw new Error("Missing value for --runner-api-url.");
        continue;
      }
      if (token === "--runner-token") {
        runnerToken = args.shift();
        if (!runnerToken) throw new Error("Missing value for --runner-token.");
        continue;
      }
      if (token === "--runner-name") {
        runnerName = args.shift();
        if (!runnerName) throw new Error("Missing value for --runner-name.");
        continue;
      }
      if (token === "--runner-invite-url") {
        runnerInviteUrl = args.shift();
        if (!runnerInviteUrl) throw new Error("Missing value for --runner-invite-url.");
        continue;
      }
      if (token === "--register-service") {
        registerService = true;
        continue;
      }
      if (token === "--no-git") {
        noGit = true;
        continue;
      }
      throw new Error(`Unknown argument for component add: ${token}`);
    }
    if (!components) throw new Error("component add requires --components <csv>.");
    return {
      name: "component-add",
      options: { installDir, repoUrl, repoRef, components, runnerApiUrl, runnerToken, runnerName, runnerInviteUrl, registerService, noGit },
    };
  }
  if (first === "component" && second === "remove") {
    const args = [...rest];
    let installDir: string | undefined;
    let components = "";
    let purgeData = false;
    while (args.length > 0) {
      const token = args.shift() ?? "";
      if (token === "--dir") {
        installDir = args.shift();
        if (!installDir) throw new Error("Missing value for --dir.");
        continue;
      }
      if (token === "--components") {
        components = args.shift() ?? "";
        if (!components) throw new Error("Missing value for --components.");
        continue;
      }
      if (token === "--purge-data") {
        purgeData = true;
        continue;
      }
      throw new Error(`Unknown argument for component remove: ${token}`);
    }
    if (!components) throw new Error("component remove requires --components <csv>.");
    return { name: "component-remove", options: { installDir, components, purgeData } };
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
  const report = collectDoctorReport();
  emitOk("doctor", report, [
    "Doctor check:",
    ...report.results.map(
      (result) => `${result.name}: ${result.ok ? "ok" : "missing"}${result.output ? ` (${result.output})` : ""}`
    ),
    `git: ${report.git.available ? "available" : "optional/missing"}`,
    report.managedToolchainNote,
    ...(report.hint ? [report.hint] : []),
  ]);
}

function resolveTargetComponents(raw: string | undefined) {
  if (raw?.trim()) return parseComponentsArg(raw);
  const persisted = loadState().installedComponents;
  if (Array.isArray(persisted) && persisted.length > 0) return persisted;
  throw new Error(
    "No installed components recorded. Pass --components explicitly (e.g. api,runner,user-ui)."
  );
}

function resolveServiceComponents(raw: string | undefined) {
  if (raw?.trim()) return parseComponentsArg(raw);
  const state = loadState();
  if (Array.isArray(state.serviceComponents) && state.serviceComponents.length > 0) {
    return state.serviceComponents;
  }
  if (Array.isArray(state.installedComponents) && state.installedComponents.length > 0) {
    return state.installedComponents;
  }
  return parseComponentsArg(undefined);
}

async function main() {
  const { flags, rest } = extractGlobalFlags(process.argv.slice(2));
  setCliModes(flags);
  let parsed: ParsedCommand;
  try {
    parsed = parseGlobalArgs(rest);
  } catch (error) {
    emitError("opscli", error);
    if (!flags.json) printCliHelp();
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
      const result = await runInstall({
        ...parsed.options,
        yes: isYesMode(),
        openBrowser: isYesMode() ? false : parsed.options.openBrowser,
      });
      emitOk("install", result, [
        `Install complete at ${result.installDir}.`,
        `Installed components: ${result.componentsSummary}`,
        `Source mode: ${result.sourceMode}`,
        ...(result.generatedEnv.generatedKeys.length > 0
          ? [`Wrote generated .env at ${result.generatedEnv.envPath}.`]
          : []),
        ...(result.generatedEnv.adminPassword
          ? [
              `Admin login: ${result.generatedEnv.adminUser} / ${result.generatedEnv.adminPassword} (saved in .env)`,
            ]
          : []),
        ...(result.runnerConfigApplied ? ["Runner environment configured in .env."] : []),
        ...(result.serviceRegistered ? [result.serviceMessage || "Service registered."] : []),
        ...(result.shortcutPath ? [`Created shortcut: ${result.shortcutPath}`] : []),
        `User UI URL: ${result.userUiUrl}`,
      ]);
    } catch (error) {
      emitError("install", error);
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "upgrade") {
    try {
      const result = await runUpgrade(parsed.options);
      emitOk("upgrade", result, [
        `Upgrade complete at ${result.installDir}.`,
        result.backupPath
          ? `Safety backup: ${result.backupPath}`
          : "No backup payload found (.orgops-data/files/.env missing).",
        `Components: ${formatComponents(result.components)}`,
        `Restart policy: ${result.restartMessage}`,
      ]);
    } catch (error) {
      emitError("upgrade", error);
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "uninstall") {
    try {
      const result = runUninstall(parsed.options);
      emitOk("uninstall", result, [
        `Uninstall complete at ${result.installDir}.`,
        `Components: ${formatComponents(result.components)}`,
        result.purgedData ? "Runtime data purged." : result.preservedData ? "Runtime data preserved." : "No runtime data found.",
        ...result.serviceMessages,
      ]);
    } catch (error) {
      emitError("uninstall", error);
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "component-add") {
    try {
      const result = await addComponents({ ...parsed.options, yes: isYesMode(), openBrowser: false });
      emitOk("component add", result, [
        `Component add complete at ${result.installDir}.`,
        `Installed components: ${result.componentsSummary}`,
        ...(result.serviceRegistered ? [result.serviceMessage || "Services registered."] : []),
      ]);
    } catch (error) {
      emitError("component add", error);
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "component-remove") {
    try {
      const result = removeComponents(parsed.options);
      emitOk("component remove", result, [
        `Component remove complete at ${result.installDir}.`,
        ...result.serviceMessages,
      ]);
    } catch (error) {
      emitError("component remove", error);
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "start") {
    try {
      const components = resolveTargetComponents(parsed.options.components);
      const result = await startComponents({
        installDir: parsed.options.installDir,
        components,
        openBrowser: isYesMode() ? false : parsed.options.openBrowser,
      });
      emitOk("start", result, result.started.map((item) => (
        item.alreadyRunning
          ? `${item.component}: already running (pid ${item.pid ?? "unknown"})`
          : `${item.component}: started (pid ${item.pid ?? "unknown"})`
      )));
    } catch (error) {
      emitError("start", error);
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "stop") {
    try {
      const components = resolveTargetComponents(parsed.options.components);
      const result = stopComponents({ installDir: parsed.options.installDir, components });
      emitOk("stop", result, result.stopped.map((item) => (
        item.stopped
          ? `${item.component}: stopped (pid ${item.pid ?? "unknown"})`
          : `${item.component}: not running`
      )));
    } catch (error) {
      emitError("stop", error);
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "restart") {
    try {
      const components = resolveTargetComponents(parsed.options.components);
      stopComponents({ installDir: parsed.options.installDir, components });
      const result = await startComponents({
        installDir: parsed.options.installDir,
        components,
        openBrowser: isYesMode() ? false : parsed.options.openBrowser,
      });
      emitOk("restart", result, result.started.map((item) => (
        `${item.component}: restarted${item.pid ? ` (pid ${item.pid})` : ""}`
      )));
    } catch (error) {
      emitError("restart", error);
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "status") {
    try {
      const components = resolveTargetComponents(parsed.options.components);
      const status = await getComponentsStatus({
        installDir: parsed.options.installDir,
        components,
      });
      emitOk("status", status, [
        `Install dir: ${status.installDir}`,
        ...status.statuses.map((item) => {
          const details = [
            `running=${item.running ? "yes" : "no"}`,
            `pid=${item.pid !== null ? String(item.pid) : "none"}`,
          ];
          if (item.url) details.push(`url=${item.url}`);
          if (typeof item.reachable === "boolean") details.push(`reachable=${item.reachable ? "yes" : "no"}`);
          if (typeof item.serviceRegistered === "boolean") details.push(`service=${item.serviceRegistered ? "registered" : "missing"}`);
          if (typeof item.serviceRunning === "boolean") details.push(`serviceRunning=${item.serviceRunning ? "yes" : "no"}`);
          return `${item.component}: ${details.join(" | ")}`;
        }),
      ]);
    } catch (error) {
      emitError("status", error);
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "admin-open") {
    try {
      const result = await startComponents({
        installDir: parsed.options.installDir,
        components: ["admin-ui"],
        openBrowser: !isYesMode(),
      });
      const first = result.started[0];
      emitOk("admin open", result, [`admin-ui: ${first?.alreadyRunning ? "already running" : "started"}`]);
    } catch (error) {
      emitError("admin open", error);
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "admin-stop") {
    try {
      const result = stopComponents({
        installDir: parsed.options.installDir,
        components: ["admin-ui"],
      });
      const first = result.stopped[0];
      emitOk("admin stop", result, [first?.stopped ? "admin-ui: stopped" : "admin-ui: not running"]);
    } catch (error) {
      emitError("admin stop", error);
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "admin-status") {
    try {
      const status = await getComponentsStatus({
        installDir: parsed.options.installDir,
        components: ["admin-ui"],
      });
      const first = status.statuses[0];
      emitOk("admin status", status, first
        ? [
            `Install dir: ${status.installDir}`,
            `admin-ui: running=${first.running ? "yes" : "no"} | pid=${first.pid ?? "none"} | reachable=${first.reachable ? "yes" : "no"} | url=${first.url ?? "n/a"}`,
          ]
        : [`Install dir: ${status.installDir}`]);
    } catch (error) {
      emitError("admin status", error);
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "service-register") {
    try {
      const components = resolveServiceComponents(parsed.options.components);
      const result = registerServiceAction({
        installDir: parsed.options.installDir,
        components,
      });
      emitOk("service register", result, [
        `Services registered for install dir: ${result.installDir}`,
        `Components: ${formatComponents(result.serviceComponents)}`,
        ...result.messages,
      ]);
    } catch (error) {
      emitError("service register", error);
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "service-unregister") {
    try {
      const components = resolveServiceComponents(parsed.options.components);
      const result = unregisterServiceAction({
        installDir: parsed.options.installDir,
        components,
      });
      emitOk("service unregister", result, [
        `Services unregistered for install dir: ${result.installDir}`,
        `Components: ${formatComponents(components)}`,
        ...result.messages,
      ]);
    } catch (error) {
      emitError("service unregister", error);
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "service-control") {
    try {
      const components = resolveServiceComponents(parsed.options.components);
      const installDir = parsed.options.installDir ?? loadState().installDir ?? "orgops";
      if (parsed.options.action === "status") {
        const statuses = getAutostartServicesStatus(components, installDir);
        emitOk("service status", { installDir, statuses }, statuses.map((item) => (
          `${item.component}: registered=${item.registered ? "yes" : "no"} | running=${item.running ? "yes" : "no"} | ${item.detail}`
        )));
      } else {
        const messages = controlAutostartServices(installDir, components, parsed.options.action);
        emitOk(`service ${parsed.options.action}`, { installDir, components, messages }, messages);
      }
    } catch (error) {
      emitError(`service ${parsed.options.action}`, error);
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.name === "shortcut-create") {
    try {
      const result = createShortcutAction({ target: parsed.options.target, url: parsed.options.url });
      emitOk("shortcut create", result, [
        `Created shortcut: ${result.shortcutPath}`,
        `Shortcut target: ${result.target}`,
        `Shortcut URL: ${result.url}`,
      ]);
    } catch (error) {
      emitError("shortcut create", error);
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
