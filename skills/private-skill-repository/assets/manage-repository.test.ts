import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRepositoryCommand } from "./manage-repository";
import { createGitRunner } from "./git-process";

describe("runRepositoryCommand", () => {
  it("returns bounded configuration errors", async () => {
    const result = await runRepositoryCommand(["status"], { env: {} });
    expect(result).toMatchObject({ ok: false, operation: "status", code: "CONFIG_INVALID" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SKILLS");
  });

  it("clones, begins a review branch, validates, and publishes to a local remote", async () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-git-fixture-"));
    const remote = join(root, "remote.git");
    const seed = join(root, "seed");
    const checkout = join(root, "checkout");
    execFileSync("git", ["init", "--bare", remote]);
    execFileSync("git", ["init", "-b", "main", seed]);
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: seed });
    execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: seed });
    mkdirSync(join(seed, "skills", "demo"), { recursive: true });
    writeFileSync(join(seed, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Demo\n---\n");
    execFileSync("git", ["add", "--", "skills"] , { cwd: seed });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: seed });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: seed });
    execFileSync("git", ["push", "origin", "main"], { cwd: seed });
    const env = { PRIVATE_SKILLS_REPO_URL: remote, PRIVATE_SKILLS_REPO_PATH: checkout, PRIVATE_SKILLS_REPO_BRANCH: "main", ORGOPS_SKILL_ROOTS: join(checkout, "skills") };

    expect(await runRepositoryCommand(["sync"], { env })).toMatchObject({ ok: true, operation: "sync" });
    expect(await runRepositoryCommand(["status"], { env })).toMatchObject({ ok: true, data: { branch: "main", remote: "origin", clean: true } });
    expect(await runRepositoryCommand(["status"], { env: { ...env, PRIVATE_SKILLS_REPO_URL: join(root, "different.git") } })).toMatchObject({ ok: false, code: "REPOSITORY_MISMATCH" });
    expect(await runRepositoryCommand(["begin", "--branch", "feature/demo"], { env })).toMatchObject({ ok: true });
    mkdirSync(join(checkout, "skills", "new-skill"), { recursive: true });
    writeFileSync(join(checkout, "skills", "new-skill", "SKILL.md"), "---\nname: new-skill\ndescription: New\n---\n");
    expect(await runRepositoryCommand(["validate"], { env })).toMatchObject({ ok: true, data: { skillNames: ["new-skill"] } });
    const calls: string[][] = [];
    const baseRunner = createGitRunner({ env });
    const recordingRunner = { run: async (args: string[], options?: { cwd?: string; timeoutMs?: number }) => { calls.push(args); return baseRunner.run(args, options); } };
    expect(await runRepositoryCommand(["publish", "--message", "add new skill"], { env, git: recordingRunner })).toMatchObject({ ok: true, data: { branch: "feature/demo" } });
    expect(calls.flat().some((arg) => ["stash", "rebase", "reset", "clean", "--force", "-f"].includes(arg))).toBe(false);
    expect(execFileSync("git", ["ls-remote", "--heads", remote, "feature/demo"], { encoding: "utf8" })).toContain("refs/heads/feature/demo");
    expect(await runRepositoryCommand(["publish", "--direct", "--message", "wrong branch"], { env })).toMatchObject({ ok: false, code: "NO_CHANGES" });
    expect(await runRepositoryCommand(["sync"], { env })).toMatchObject({ ok: true });
    writeFileSync(join(checkout, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Updated\n---\n");
    expect(await runRepositoryCommand(["publish", "--direct", "--message", "direct update"], { env })).toMatchObject({ ok: true, data: { branch: "main" } });
    expect(await runRepositoryCommand(["begin", "--branch", "feature/demo"], { env })).toMatchObject({ ok: true, data: { branch: "feature/demo" } });
    expect(await runRepositoryCommand(["sync"], { env })).toMatchObject({ ok: true });
    execFileSync("git", ["fetch", "origin", "main"], { cwd: seed });
    execFileSync("git", ["merge", "--ff-only", "origin/main"], { cwd: seed });
    writeFileSync(join(seed, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Remote\n---\n");
    execFileSync("git", ["add", "--", "skills/demo/SKILL.md"], { cwd: seed });
    execFileSync("git", ["commit", "-m", "remote update"], { cwd: seed });
    execFileSync("git", ["push", "origin", "main"], { cwd: seed });
    expect(await runRepositoryCommand(["sync"], { env })).toMatchObject({ ok: true });
    writeFileSync(join(checkout, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Local commit\n---\n");
    execFileSync("git", ["add", "--", "skills/demo/SKILL.md"], { cwd: checkout });
    execFileSync("git", ["commit", "-m", "local divergence"], { cwd: checkout });
    execFileSync("git", ["fetch", "origin", "main"], { cwd: seed });
    execFileSync("git", ["merge", "--ff-only", "origin/main"], { cwd: seed });
    writeFileSync(join(seed, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Remote divergence\n---\n");
    execFileSync("git", ["add", "--", "skills/demo/SKILL.md"], { cwd: seed });
    execFileSync("git", ["commit", "-m", "remote divergence"], { cwd: seed });
    execFileSync("git", ["push", "origin", "main"], { cwd: seed });
    expect(await runRepositoryCommand(["sync"], { env })).toMatchObject({ ok: false, code: "DIVERGED" });
    writeFileSync(join(checkout, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Local uncommitted\n---\n");
    expect(await runRepositoryCommand(["publish", "--direct", "--message", "must refuse divergence"], { env })).toMatchObject({ ok: false, code: "DIVERGED" });
    writeFileSync(join(checkout, "README.md"), "not allowed");
    expect(await runRepositoryCommand(["validate"], { env })).toMatchObject({ ok: false, code: "PATH_OUTSIDE_SKILLS" });
    expect(await runRepositoryCommand(["sync"], { env })).toMatchObject({ ok: false, code: "DIRTY_WORKTREE" });
  });

  it("reports conflicted worktrees and never exposes remote credentials", async () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-conflict-fixture-"));
    const remote = join(root, "remote.git");
    const seed = join(root, "seed");
    const checkout = join(root, "checkout");
    execFileSync("git", ["init", "--bare", remote]);
    execFileSync("git", ["init", "-b", "main", seed]);
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: seed });
    execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: seed });
    mkdirSync(join(seed, "skills", "demo"), { recursive: true });
    writeFileSync(join(seed, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Base\n---\n");
    execFileSync("git", ["add", "--", "skills"], { cwd: seed });
    execFileSync("git", ["commit", "-m", "base"], { cwd: seed });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: seed });
    execFileSync("git", ["push", "origin", "main"], { cwd: seed });
    execFileSync("git", ["clone", "--branch", "main", remote, checkout]);
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: checkout });
    execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: checkout });
    writeFileSync(join(checkout, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Local\n---\n");
    execFileSync("git", ["add", "--", "skills/demo/SKILL.md"], { cwd: checkout });
    execFileSync("git", ["commit", "-m", "local"], { cwd: checkout });
    writeFileSync(join(seed, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Remote\n---\n");
    execFileSync("git", ["add", "--", "skills/demo/SKILL.md"], { cwd: seed });
    execFileSync("git", ["commit", "-m", "remote"], { cwd: seed });
    execFileSync("git", ["push", "origin", "main"], { cwd: seed });
    execFileSync("git", ["fetch", "origin", "main"], { cwd: checkout });
    try { execFileSync("git", ["merge", "origin/main"], { cwd: checkout, stdio: "ignore" }); } catch { /* expected conflict */ }
    const env = { PRIVATE_SKILLS_REPO_URL: remote, PRIVATE_SKILLS_REPO_PATH: checkout, PRIVATE_SKILLS_REPO_BRANCH: "main", ORGOPS_SKILL_ROOTS: join(checkout, "skills") };
    expect(await runRepositoryCommand(["status"], { env })).toMatchObject({ ok: true, data: { remote: "origin", conflicted: true, clean: false } });
    expect(await runRepositoryCommand(["sync"], { env })).toMatchObject({ ok: false, code: "CONFLICTED" });
  });

  it("fails closed when marker creation fails and preserves a replacement lock", async () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-lock-acquire-"));
    const checkout = join(root, "checkout");
    const lock = `${checkout}.orgops-private-skills.lock`;
    const env = { PRIVATE_SKILLS_REPO_URL: join(root, "remote.git"), PRIVATE_SKILLS_REPO_PATH: checkout, PRIVATE_SKILLS_REPO_BRANCH: "main", ORGOPS_SKILL_ROOTS: join(checkout, "skills") };
    const lockWrite = async () => {
      rmdirSync(lock);
      mkdirSync(lock);
      throw new Error("marker write failed");
    };
    const result = await runRepositoryCommand(["sync"], { env, lockWrite });
    expect(result).toMatchObject({ ok: false, code: "LOCK_OWNERSHIP" });
    expect(() => writeFileSync(join(lock, "sentinel"), "replacement")).not.toThrow();
  });

  it("never deletes a replacement lock during atomic release", async () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-lock-race-"));
    const checkout = join(root, "checkout");
    const lock = `${checkout}.orgops-private-skills.lock`;
    const env = { PRIVATE_SKILLS_REPO_URL: join(root, "remote.git"), PRIVATE_SKILLS_REPO_PATH: checkout, PRIVATE_SKILLS_REPO_BRANCH: "main", ORGOPS_SKILL_ROOTS: join(checkout, "skills") };
    const lockRename = async (from: string, to: string) => {
      renameSync(from, to);
      mkdirSync(from);
      writeFileSync(join(from, "owner"), "foreign-owner");
    };
    await runRepositoryCommand(["sync"], { env, lockRename });
    expect(() => writeFileSync(join(lock, "sentinel"), "still-owned")).not.toThrow();
  });

  it("leaves a foreign quarantined lock and returns bounded ownership failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-lock-foreign-"));
    const checkout = join(root, "checkout");
    const lock = `${checkout}.orgops-private-skills.lock`;
    const env = { PRIVATE_SKILLS_REPO_URL: join(root, "remote.git"), PRIVATE_SKILLS_REPO_PATH: checkout, PRIVATE_SKILLS_REPO_BRANCH: "main", ORGOPS_SKILL_ROOTS: join(checkout, "skills") };
    let quarantine = "";
    const lockRename = async (from: string, to: string) => {
      quarantine = to;
      renameSync(from, to);
      writeFileSync(join(to, "owner"), "foreign-owner");
    };
    const result = await runRepositoryCommand(["sync"], { env, lockRename });
    expect(result).toMatchObject({ ok: false, code: "LOCK_OWNERSHIP" });
    expect(readFileSync(join(quarantine, "owner"), "utf8")).toBe("foreign-owner");
    expect(() => writeFileSync(join(lock, "sentinel"), "replacement")).toThrow();
  });

  it("refuses a lock owned by another process", async () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-lock-fixture-"));
    const checkout = join(root, "checkout");
    const env = { PRIVATE_SKILLS_REPO_URL: join(root, "remote.git"), PRIVATE_SKILLS_REPO_PATH: checkout, PRIVATE_SKILLS_REPO_BRANCH: "main", ORGOPS_SKILL_ROOTS: join(checkout, "skills") };
    mkdirSync(`${checkout}.orgops-private-skills.lock`, { recursive: true });
    expect(await runRepositoryCommand(["sync"], { env })).toMatchObject({ ok: false, code: "BUSY" });
  });
});
