import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureGeneratedInstallEnv,
  generateMasterKey,
  parseSimpleEnv,
} from "../src/lib/env.ts";

test("first install writes a generated working .env instead of .env.example", () => {
  const installDir = mkdtempSync(join(tmpdir(), "orgops-env-"));
  try {
    writeFileSync(join(installDir, ".env.example"), "ORGOPS_MASTER_KEY=example-only\nORGOPS_ADMIN_PASS=admin\n");
    const first = ensureGeneratedInstallEnv(installDir);
    assert.equal(existsSync(first.envPath), true);
    assert.ok(first.generatedKeys.includes("ORGOPS_MASTER_KEY"));
    assert.ok(first.generatedKeys.includes("ORGOPS_RUNNER_TOKEN"));
    assert.ok(first.generatedKeys.includes("ORGOPS_ADMIN_PASS"));
    assert.equal(first.adminUser, "admin");
    assert.ok(first.adminPassword && first.adminPassword !== "admin");

    const parsed = parseSimpleEnv(readFileSync(first.envPath, "utf-8"));
    assert.equal(parsed.PORT, "8787");
    assert.equal(parsed.ORGOPS_API_URL, "http://localhost:8787");
    assert.equal(parsed.ORGOPS_COOKIE_SECURE, "auto");
    assert.notEqual(parsed.ORGOPS_MASTER_KEY, "example-only");
    assert.ok(parsed.ORGOPS_RUNNER_TOKEN.startsWith("org_rt_"));
    assert.equal(Buffer.from(parsed.ORGOPS_MASTER_KEY, "base64").length, 32);
    assert.doesNotMatch(readFileSync(first.envPath, "utf-8"), /ORGOPS_GOOGLE_REDIRECT_URI/);

    const second = ensureGeneratedInstallEnv(installDir);
    assert.deepEqual(second.generatedKeys, []);
    assert.equal(second.adminPassword, undefined);
    const again = parseSimpleEnv(readFileSync(first.envPath, "utf-8"));
    assert.equal(again.ORGOPS_MASTER_KEY, parsed.ORGOPS_MASTER_KEY);
    assert.equal(again.ORGOPS_RUNNER_TOKEN, parsed.ORGOPS_RUNNER_TOKEN);
    assert.equal(again.ORGOPS_ADMIN_PASS, parsed.ORGOPS_ADMIN_PASS);
  } finally {
    rmSync(installDir, { recursive: true, force: true });
  }
});

test("generated master keys are 32-byte base64", () => {
  const key = generateMasterKey();
  assert.equal(Buffer.from(key, "base64").length, 32);
});
