import { execSync } from "node:child_process";

type EnsureReport = {
  ok: boolean;
  gcloudVersion?: string;
  account?: string | null;
  project?: string | null;
  region?: string | null;
  zone?: string | null;
  warning?: string;
};

function run(command: string): string {
  return execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function safeConfigGet(key: string): string | null {
  try {
    const value = run(`gcloud config get-value ${key} --quiet`);
    if (!value || value === "(unset)") return null;
    return value;
  } catch {
    return null;
  }
}

function buildReport(): EnsureReport {
  let gcloudVersion = "";
  try {
    gcloudVersion = run("gcloud --version | head -n 1");
  } catch {
    return {
      ok: false,
      warning:
        "gcloud is not installed or not in PATH. Install Google Cloud CLI: https://cloud.google.com/sdk/docs/install",
    };
  }

  const account = safeConfigGet("core/account");
  const project = safeConfigGet("core/project");
  const region = safeConfigGet("compute/region");
  const zone = safeConfigGet("compute/zone");
  const warning =
    !account || !project
      ? "gcloud is installed but account/project is not fully configured."
      : undefined;

  return {
    ok: true,
    gcloudVersion,
    account,
    project,
    region,
    zone,
    warning,
  };
}

const report = buildReport();
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
