import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runUninstall } from "../src/lib/uninstall.ts";
import { runUpgrade } from "../src/lib/upgrade.ts";
import { saveState } from "../src/lib/runtime-state.ts";

function withTempHome<T>(fn: (home: string) => T | Promise<T>): Promise<T> | T {
  const home = mkdtempSync(join(tmpdir(), "orgops-home-"));
  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const done = () => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousProfile;
    rmSync(home, { recursive: true, force: true });
  };
  try {
    const result = fn(home);
    if (result && typeof result === "object" && "then" in result) {
      return Promise.resolve(result).finally(done);
    }
    done();
    return result;
  } catch (error) {
    done();
    throw error;
  }
}

test("uninstall preserves runtime data by default", () => {
  return withTempHome((home) => {
    const installDir = mkdtempSync(join(home, "install-"));
    mkdirSync(resolve(installDir, ".orgops-data"), { recursive: true });
    mkdirSync(resolve(installDir, "files"), { recursive: true });
    writeFileSync(resolve(installDir, ".env"), "ORGOPS_ADMIN_USER=admin\n");
    writeFileSync(resolve(installDir, ".orgops-data", "db.sqlite"), "db\n");
    writeFileSync(resolve(installDir, "files", "note.txt"), "keep\n");
    writeFileSync(resolve(installDir, "package.json"), "{}\n");
    saveState({ installDir, installedComponents: ["api", "runner"], serviceComponents: [] });
    const result = runUninstall({ installDir });
    assert.equal(result.purgedData, false);
    assert.equal(result.preservedData, true);
    assert.equal(readFileSync(resolve(installDir, ".env"), "utf-8"), "ORGOPS_ADMIN_USER=admin\n");
    assert.equal(existsSync(resolve(installDir, ".orgops-data", "db.sqlite")), true);
    assert.equal(existsSync(resolve(installDir, "package.json")), false);
  });
});

test("upgrade works for archive installs without a .git directory", async () => {
  const previousMock = process.env.ORGOPS_OPSCLI_INSTALL_SMOKE_MOCK;
  const previousBrowser = process.env.ORGOPS_OPSCLI_NO_BROWSER;
  process.env.ORGOPS_OPSCLI_INSTALL_SMOKE_MOCK = "1";
  process.env.ORGOPS_OPSCLI_NO_BROWSER = "1";
  await withTempHome(async (home) => {
    const installDir = mkdtempSync(join(home, "install-"));
    writeFileSync(resolve(installDir, "package.json"), `${JSON.stringify({ name: "orgops-archive" })}\n`);
    mkdirSync(resolve(installDir, ".orgops-data"), { recursive: true });
    writeFileSync(resolve(installDir, ".env"), "ORGOPS_ADMIN_USER=admin\n");
    writeFileSync(resolve(installDir, ".orgops-data", "seed.txt"), "seed\n");
    saveState({
      installDir,
      installedComponents: ["api"],
      sourceMode: "archive",
      serviceRegistered: false,
    });
    const result = await runUpgrade({ installDir, noGit: true, restart: false });
    assert.equal(result.installDir, resolve(installDir));
    assert.ok(result.backupPath);
    assert.equal(existsSync(resolve(installDir, ".orgops-data", "seed.txt")), true);
  });
  if (previousMock === undefined) delete process.env.ORGOPS_OPSCLI_INSTALL_SMOKE_MOCK;
  else process.env.ORGOPS_OPSCLI_INSTALL_SMOKE_MOCK = previousMock;
  if (previousBrowser === undefined) delete process.env.ORGOPS_OPSCLI_NO_BROWSER;
  else process.env.ORGOPS_OPSCLI_NO_BROWSER = previousBrowser;
});
