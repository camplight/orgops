import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const distDir = resolve(repoRoot, "dist");

function fail(message) {
  console.error(`[opscli-smoke] ${message}`);
  process.exit(1);
}

function findBinaryPath() {
  const entries = readdirSync(distDir).filter((name) => name.startsWith("opscli-"));
  if (entries.length === 0) fail(`No opscli binary found in ${distDir}`);
  const binaryName = entries.sort()[0];
  const binaryPath = resolve(distDir, binaryName);
  if (!existsSync(binaryPath)) fail(`Binary path does not exist: ${binaryPath}`);
  return binaryPath;
}

function run(binaryPath, args, extraEnv = {}) {
  console.log(`[opscli-smoke] Running: ${binaryPath} ${args.join(" ")}`);
  const result = spawnSync(binaryPath, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
    shell: false,
  });
  if (result.status !== 0) {
    fail(`Command failed with exit code ${result.status}: ${args.join(" ")}`);
  }
}

function runBestEffort(binaryPath, args, extraEnv = {}) {
  console.log(`[opscli-smoke] Best-effort: ${binaryPath} ${args.join(" ")}`);
  spawnSync(binaryPath, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
    shell: false,
  });
}

function assertPath(path, label) {
  if (!existsSync(path)) {
    fail(`Missing expected ${label}: ${path}`);
  }
}

function writeFixtureRuntimePackage(installDir) {
  const pkg = {
    name: "orgops-ci-smoke-runtime",
    private: true,
    scripts: {
      "start:api:env": "node .opscli-smoke-api-server.mjs",
      "start:runner:env": "node .opscli-smoke-runner-process.mjs",
      "start:user-stack:env": "node .opscli-smoke-user-ui-server.mjs",
      "start:user-ui:preview:env": "node .opscli-smoke-user-ui-server.mjs",
      "start:admin-ui:preview:env": "node .opscli-smoke-admin-ui-server.mjs",
    },
  };
  writeFileSync(resolve(installDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");

  const userUiServer = [
    "import http from 'node:http';",
    "const server = http.createServer((_req, res) => { res.statusCode = 200; res.end('ok'); });",
    "server.listen(4190);",
    "const shutdown = () => server.close(() => process.exit(0));",
    "process.on('SIGTERM', shutdown);",
    "process.on('SIGINT', shutdown);",
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n");
  writeFileSync(resolve(installDir, ".opscli-smoke-user-ui-server.mjs"), userUiServer, "utf-8");

  const apiServer = [
    "import http from 'node:http';",
    "const server = http.createServer((_req, res) => { res.statusCode = 200; res.end('ok'); });",
    "server.listen(8787);",
    "const shutdown = () => server.close(() => process.exit(0));",
    "process.on('SIGTERM', shutdown);",
    "process.on('SIGINT', shutdown);",
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n");
  writeFileSync(resolve(installDir, ".opscli-smoke-api-server.mjs"), apiServer, "utf-8");

  const runnerProcess = [
    "const shutdown = () => process.exit(0);",
    "process.on('SIGTERM', shutdown);",
    "process.on('SIGINT', shutdown);",
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n");
  writeFileSync(resolve(installDir, ".opscli-smoke-runner-process.mjs"), runnerProcess, "utf-8");

  const adminUiServer = [
    "import http from 'node:http';",
    "const server = http.createServer((_req, res) => { res.statusCode = 200; res.end('ok'); });",
    "server.listen(4173);",
    "const shutdown = () => server.close(() => process.exit(0));",
    "process.on('SIGTERM', shutdown);",
    "process.on('SIGINT', shutdown);",
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n");
  writeFileSync(resolve(installDir, ".opscli-smoke-admin-ui-server.mjs"), adminUiServer, "utf-8");
}

const binaryPath = findBinaryPath();
const tempHome = mkdtempSync(join(tmpdir(), "orgops-home-smoke-"));
const installDir = mkdtempSync(join(tmpdir(), "orgops-install-smoke-"));
const smokeEnv = {
  ORGOPS_OPSCLI_INSTALL_SMOKE_MOCK: "1",
  ORGOPS_OPSCLI_NO_BROWSER: "1",
  ORGOPS_LLM_STUB: "1",
  OPENAI_API_KEY: "stub-key",
  ORGOPS_OPSCLI_MODEL: "openai:gpt-5.2",
  ORGOPS_OPSCLI_LOG_PATH: resolve(tempHome, "opscli-session.log"),
  HOME: tempHome,
  USERPROFILE: tempHome,
};

try {
  run(binaryPath, ["--help"]);
  run(binaryPath, ["chat", "--help"], smokeEnv);
  run(binaryPath, ["doctor"], smokeEnv);

  run(
    binaryPath,
    ["install", "--dir", installDir, "--create-shortcut"],
    smokeEnv
  );

  assertPath(resolve(installDir, ".opscli-install-smoke.json"), "mock install metadata file");
  assertPath(resolve(installDir, ".opscli-install-smoke-build.txt"), "mock build marker file");
  assertPath(resolve(installDir, "OrgOps User UI.smoke-shortcut"), "mock shortcut file");

  // Seed realistic mutable payload so upgrade backup creation is exercised.
  mkdirSync(resolve(installDir, ".orgops-data"), { recursive: true });
  mkdirSync(resolve(installDir, "files"), { recursive: true });
  writeFileSync(resolve(installDir, ".env"), "ORGOPS_ADMIN_USER=admin\n", "utf-8");
  writeFileSync(resolve(installDir, ".orgops-data", "seed.txt"), "seed\n", "utf-8");
  writeFileSync(resolve(installDir, "files", "seed.txt"), "seed\n", "utf-8");

  run(binaryPath, ["upgrade", "--dir", installDir, "--no-restart"], smokeEnv);

  const backupsDir = resolve(installDir, ".opscli-backups");
  assertPath(backupsDir, "upgrade backups directory");
  const backupArtifacts = readdirSync(backupsDir).filter((name) => name.startsWith("upgrade-backup-"));
  if (backupArtifacts.length === 0) {
    fail("Missing expected upgrade backup artifact under .opscli-backups");
  }

  writeFixtureRuntimePackage(installDir);

  // Smoke the deterministic lifecycle commands.
  run(binaryPath, ["start", "--dir", installDir, "--no-open"], smokeEnv);
  run(binaryPath, ["status", "--dir", installDir], smokeEnv);
  run(binaryPath, ["stop", "--dir", installDir], smokeEnv);
  run(binaryPath, ["status", "--dir", installDir], smokeEnv);

  // Smoke the admin command surface (browser launch disabled by env).
  run(binaryPath, ["admin", "open", "--dir", installDir], smokeEnv);
  run(binaryPath, ["admin", "status", "--dir", installDir], smokeEnv);
  run(binaryPath, ["admin", "stop", "--dir", installDir], smokeEnv);
  run(binaryPath, ["admin", "status", "--dir", installDir], smokeEnv);

  // Smoke chat one-shot path without external model dependency.
  run(binaryPath, ["chat", "--goal", "Acknowledge smoke test success in one sentence."], smokeEnv);

  console.log("[opscli-smoke] Completed successfully.");
} finally {
  runBestEffort(binaryPath, ["stop", "--dir", installDir], smokeEnv);
  runBestEffort(binaryPath, ["admin", "stop", "--dir", installDir], smokeEnv);
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(installDir, { recursive: true, force: true });
}
