import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  controlAutostartServices,
  getAutostartServicesStatus,
  registerAutostartServices,
  unregisterAutostartServices,
} from "../src/lib/service.ts";
import { writeInstallToolchain } from "../src/lib/toolchain.ts";

const PREFIX = `com.orgops.opsclitest.${process.pid}`;
const SYSTEMD_PREFIX = `orgops-opsclitest-${process.pid}`;

function nodePaths() {
  const nodePath = process.execPath;
  const npmPath = process.platform === "win32" ? "npm.cmd" : resolve(dirname(process.execPath), "npm");
  return { nodePath, npmPath, rootDir: dirname(nodePath) };
}

async function waitFor(path: string, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(path)) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

test("live service registration starts and stops a headless component", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows live schtasks coverage is exercised in CI smoke + artifact tests");
    return;
  }
  if (process.env.CI && process.platform === "linux") {
    t.skip("systemd --user is not always available in Linux CI images");
    return;
  }

  const home = mkdtempSync(join(tmpdir(), "orgops-live-home-"));
  const installDir = mkdtempSync(join(home, "install-"));
  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    PREFIX: process.env.ORGOPS_OPSCLI_SERVICE_PREFIX,
    DRY: process.env.ORGOPS_OPSCLI_SERVICE_DRY_RUN,
    SKIP: process.env.ORGOPS_OPSCLI_SKIP_SERVICE_RUN,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.ORGOPS_OPSCLI_SERVICE_PREFIX = process.platform === "linux" ? SYSTEMD_PREFIX : PREFIX;
  delete process.env.ORGOPS_OPSCLI_SERVICE_DRY_RUN;
  delete process.env.ORGOPS_OPSCLI_SKIP_SERVICE_RUN;

  const readyPath = resolve(installDir, "READY");
  const { nodePath, npmPath, rootDir } = nodePaths();
  writeInstallToolchain(installDir, {
    mode: "system",
    nodeVersion: process.version.replace(/^v/, ""),
    rootDir,
    nodePath,
    npmPath,
  });
  mkdirSync(resolve(installDir, "apps", "api", "src"), { recursive: true });
  mkdirSync(resolve(installDir, "node_modules", "tsx"), { recursive: true });
  writeFileSync(
    resolve(installDir, "apps", "api", "src", "server.ts"),
    [
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(readyPath)}, 'ok\\n');`,
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n")
  );
  writeFileSync(
    resolve(installDir, "node_modules", "tsx", "package.json"),
    `${JSON.stringify({ name: "tsx", type: "module", exports: { ".": "./index.mjs" } })}\n`
  );
  writeFileSync(resolve(installDir, "node_modules", "tsx", "index.mjs"), "export {};\n");
  writeFileSync(resolve(installDir, ".env"), "PORT=8787\n", "utf-8");

  try {
    const messages = registerAutostartServices(installDir, ["api"]);
    assert.ok(messages[0]?.includes("registered"));
    await waitFor(readyPath);
    const running = getAutostartServicesStatus(["api"], installDir);
    assert.equal(running[0]?.registered, true);
    assert.equal(running[0]?.running, true, running[0]?.detail);
    controlAutostartServices(installDir, ["api"], "stop");
    await delay(500);
    const stopped = getAutostartServicesStatus(["api"], installDir);
    assert.equal(stopped[0]?.running, false, stopped[0]?.detail);
  } finally {
    try {
      unregisterAutostartServices(installDir, ["api"]);
    } catch {
      // always try to clean the test agent
    }
    if (previous.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = previous.HOME;
    if (previous.USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previous.USERPROFILE;
    if (previous.PREFIX === undefined) delete process.env.ORGOPS_OPSCLI_SERVICE_PREFIX;
    else process.env.ORGOPS_OPSCLI_SERVICE_PREFIX = previous.PREFIX;
    if (previous.DRY === undefined) delete process.env.ORGOPS_OPSCLI_SERVICE_DRY_RUN;
    else process.env.ORGOPS_OPSCLI_SERVICE_DRY_RUN = previous.DRY;
    if (previous.SKIP === undefined) delete process.env.ORGOPS_OPSCLI_SKIP_SERVICE_RUN;
    else process.env.ORGOPS_OPSCLI_SKIP_SERVICE_RUN = previous.SKIP;
    rmSync(home, { recursive: true, force: true });
  }
});
