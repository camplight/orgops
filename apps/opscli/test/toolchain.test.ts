import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureManagedToolchain,
  envWithToolchain,
  readInstallToolchain,
  servicePathValue,
} from "../src/lib/toolchain.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("system toolchain pin writes install metadata and PATH hints", async () => {
  const installDir = mkdtempSync(join(tmpdir(), "orgops-toolchain-"));
  const previous = process.env.ORGOPS_OPSCLI_USE_SYSTEM_TOOLCHAIN;
  process.env.ORGOPS_OPSCLI_USE_SYSTEM_TOOLCHAIN = "1";
  try {
    const toolchain = await ensureManagedToolchain(installDir);
    assert.equal(toolchain.mode, "system");
    const stored = readInstallToolchain(installDir);
    assert.equal(stored?.npmPath, toolchain.npmPath);
    const pathValue = servicePathValue(installDir);
    assert.match(pathValue, /bin|System32/i);
    const env = envWithToolchain(installDir, { PATH: "/custom" });
    assert.ok(env.PATH?.includes("/custom") || env.PATH);
    const envFile = readFileSync(resolve(installDir, ".env"), "utf-8");
    assert.match(envFile, /ORGOPS_OPSCLI_NODE_PATH=/);
    assert.match(envFile, /ORGOPS_OPSCLI_NPM_PATH=/);
  } finally {
    if (previous === undefined) delete process.env.ORGOPS_OPSCLI_USE_SYSTEM_TOOLCHAIN;
    else process.env.ORGOPS_OPSCLI_USE_SYSTEM_TOOLCHAIN = previous;
    rmSync(installDir, { recursive: true, force: true });
  }
});

test("forced toolchain dir uses the provided node layout", async () => {
  const installDir = mkdtempSync(join(tmpdir(), "orgops-toolchain-forced-"));
  const previous = process.env.ORGOPS_OPSCLI_TOOLCHAIN_NODE_DIR;
  process.env.ORGOPS_OPSCLI_TOOLCHAIN_NODE_DIR = here;
  try {
    const toolchain = await ensureManagedToolchain(installDir);
    assert.equal(toolchain.mode, "managed");
    assert.equal(toolchain.rootDir, resolve(here));
    assert.ok(servicePathValue(installDir).includes(here) || servicePathValue(installDir).includes("bin"));
  } finally {
    if (previous === undefined) delete process.env.ORGOPS_OPSCLI_TOOLCHAIN_NODE_DIR;
    else process.env.ORGOPS_OPSCLI_TOOLCHAIN_NODE_DIR = previous;
    rmSync(installDir, { recursive: true, force: true });
  }
});
