import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseComponentsArg } from "../src/lib/components.ts";
import { registerServiceAction, unregisterServiceAction } from "../src/lib/lifecycle-actions.ts";
import { loadState, saveState } from "../src/lib/runtime-state.ts";
import {
  getAutostartServicesStatus,
  registerAutostartServices,
  serviceArtifactPath,
  unregisterAutostartServices,
} from "../src/lib/service.ts";
import { writeInstallToolchain } from "../src/lib/toolchain.ts";

function withTempHome<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), "orgops-home-"));
  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;
  const previousDryRun = process.env.ORGOPS_OPSCLI_SERVICE_DRY_RUN;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.ORGOPS_OPSCLI_SERVICE_DRY_RUN = "1";
  try {
    return fn(home);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousProfile;
    if (previousDryRun === undefined) delete process.env.ORGOPS_OPSCLI_SERVICE_DRY_RUN;
    else process.env.ORGOPS_OPSCLI_SERVICE_DRY_RUN = previousDryRun;
    rmSync(home, { recursive: true, force: true });
  }
}

test("service artifacts pin managed PATH and stay headless", () => {
  withTempHome((home) => {
    const installDir = mkdtempSync(join(home, "install-"));
    writeInstallToolchain(installDir, {
      mode: "managed",
      nodeVersion: "22.20.0",
      rootDir: resolve(home, "toolchains", "node-v22.20.0"),
      nodePath: resolve(home, "toolchains", "node-v22.20.0", "bin", "node"),
      npmPath: resolve(home, "toolchains", "node-v22.20.0", "bin", "npm"),
    });
    const components = parseComponentsArg("api,runner,admin-ui,user-ui");
    const messages = registerAutostartServices(installDir, components);
    assert.equal(messages.length, 4);

    for (const component of components) {
      const artifact = serviceArtifactPath(installDir, component);
      assert.equal(existsSync(artifact), true, `missing ${artifact}`);
      const body = readFileSync(artifact, "utf-8");
      assert.match(body, /toolchains|node-v22|PATH/i);
      if (process.platform === "darwin") {
        assert.match(body, /WorkingDirectory/);
        assert.match(body, /ProcessType/);
        assert.match(body, /Background/);
        assert.match(body, /TMPDIR/);
        assert.match(body, /NODE_ENV/);
        assert.match(body, /\/bin\/zsh/);
        assert.match(body, /\.orgops-run-/);
        assert.doesNotMatch(body, />npm</);
        const launcher = readFileSync(resolve(installDir, `.orgops-run-${component}.sh`), "utf-8");
        assert.match(launcher, /unset NODE_OPTIONS/);
        assert.match(launcher, /exec /);
        assert.doesNotMatch(launcher, /npm run /);
        assert.match(launcher, /tsx|vite\.js/);
      } else if (process.platform === "win32") {
        assert.match(body, /WindowStyle Hidden/);
        assert.match(body, /WorkingDirectory/);
        assert.match(body, /\$env:PATH/);
        assert.doesNotMatch(body, /npm run /);
      } else {
        assert.match(body, /WorkingDirectory=/);
        assert.match(body, /Environment=PATH=/);
        assert.doesNotMatch(body, /\/bin\/sh -lc/);
        assert.doesNotMatch(body, /npm run /);
      }
    }

    const statuses = getAutostartServicesStatus(components, installDir);
    assert.equal(statuses.every((item) => item.registered), true);
    unregisterAutostartServices(installDir, components);
    for (const component of components) {
      assert.equal(existsSync(serviceArtifactPath(installDir, component)), false);
    }
  });
});

test("service register merges components instead of replacing them", () => {
  withTempHome((home) => {
    const installDir = mkdtempSync(join(home, "install-"));
    saveState({ installDir, serviceComponents: ["api"], serviceRegistered: true });
    const result = registerServiceAction({ installDir, components: ["runner"] });
    assert.deepEqual(result.serviceComponents, ["api", "runner"]);
    const state = loadState();
    assert.deepEqual(state.serviceComponents, ["api", "runner"]);
    const removed = unregisterServiceAction({ installDir, components: ["runner"] });
    assert.deepEqual(removed.serviceComponents, ["api"]);
    writeFileSync(resolve(home, "keep.txt"), "ok");
  });
});
