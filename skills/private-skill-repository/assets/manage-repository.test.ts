import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
    writeFileSync(join(checkout, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Local\n---\n");
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
    expect(await runRepositoryCommand(["sync"], { env })).toMatchObject({ ok: false, code: "CONFLICTED" });
  });

  it("refuses a lock owned by another process", async () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-lock-fixture-"));
    const checkout = join(root, "checkout");
    const env = { PRIVATE_SKILLS_REPO_URL: join(root, "remote.git"), PRIVATE_SKILLS_REPO_PATH: checkout, PRIVATE_SKILLS_REPO_BRANCH: "main", ORGOPS_SKILL_ROOTS: join(checkout, "skills") };
    mkdirSync(`${checkout}.orgops-private-skills.lock`, { recursive: true });
    expect(await runRepositoryCommand(["sync"], { env })).toMatchObject({ ok: false, code: "BUSY" });
  });
});
