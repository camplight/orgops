import { execSync } from "node:child_process";

type EnsureReport = {
  ok: boolean;
  npxAvailable: boolean;
  cliAvailable: boolean;
  cliVersion?: string;
  hasApiKey: boolean;
  hasToken: boolean;
  warning?: string;
};

function run(command: string): string {
  return execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function buildReport(): EnsureReport {
  let npxAvailable = false;
  try {
    run("npx --version");
    npxAvailable = true;
  } catch {
    return {
      ok: false,
      npxAvailable: false,
      cliAvailable: false,
      hasApiKey: Boolean(process.env.TRELLO_API_KEY),
      hasToken: Boolean(process.env.TRELLO_TOKEN),
      warning: "npx is not installed or not in PATH.",
    };
  }

  let cliVersion = "";
  let cliAvailable = false;
  try {
    // Use npx for portability across runners without global install.
    cliVersion = run("npx -y @trello-cli/cli --version");
    cliAvailable = true;
  } catch {
    return {
      ok: false,
      npxAvailable,
      cliAvailable: false,
      hasApiKey: Boolean(process.env.TRELLO_API_KEY),
      hasToken: Boolean(process.env.TRELLO_TOKEN),
      warning:
        "Unable to execute @trello-cli/cli via npx. Check network/npm access or install globally.",
    };
  }

  const hasApiKey = Boolean(process.env.TRELLO_API_KEY);
  const hasToken = Boolean(process.env.TRELLO_TOKEN);

  const warning =
    hasApiKey && hasToken
      ? undefined
      : "CLI is available, but TRELLO_API_KEY/TRELLO_TOKEN is not fully set in environment.";

  return {
    ok: true,
    npxAvailable,
    cliAvailable,
    cliVersion,
    hasApiKey,
    hasToken,
    warning,
  };
}

const report = buildReport();
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
