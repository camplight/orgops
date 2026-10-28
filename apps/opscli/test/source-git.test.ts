import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkpointDirtyGitTree, ensureSourceReady } from "../src/lib/source.ts";

function git(args: string[], cwd: string) {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("dirty install trees get an opscli checkpoint commit", () => {
  const dir = mkdtempSync(join(tmpdir(), "orgops-git-"));
  try {
    git(["init"], dir);
    git(["config", "user.email", "opscli@orgops.local"], dir);
    git(["config", "user.name", "OrgOps OpsCLI"], dir);
    writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "orgops-git-test" })}\n`);
    git(["add", "package.json"], dir);
    git(["commit", "-m", "init"], dir);
    writeFileSync(join(dir, "agent-edit.txt"), "local agent change\n");
    const created = checkpointDirtyGitTree(dir);
    assert.equal(created, true);
    const log = git(["log", "-1", "--pretty=%s"], dir);
    assert.match(log, /opscli autosave before update/);
    const status = git(["status", "--porcelain"], dir);
    assert.equal(status.trim(), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureSourceReady supports archive smoke mode without creating .git", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orgops-archive-"));
  const previous = process.env.ORGOPS_OPSCLI_INSTALL_SMOKE_MOCK;
  process.env.ORGOPS_OPSCLI_INSTALL_SMOKE_MOCK = "1";
  try {
    const mode = await ensureSourceReady({
      installDir: dir,
      repoUrl: "https://github.com/camplight/orgops.git",
      repoRef: "main",
      noGit: true,
    });
    assert.equal(mode, "archive");
  } finally {
    if (previous === undefined) delete process.env.ORGOPS_OPSCLI_INSTALL_SMOKE_MOCK;
    else process.env.ORGOPS_OPSCLI_INSTALL_SMOKE_MOCK = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
