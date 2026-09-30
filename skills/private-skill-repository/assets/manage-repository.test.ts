import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRepositoryCommand } from "./manage-repository";

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
    expect(await runRepositoryCommand(["status"], { env })).toMatchObject({ ok: true, data: { branch: "main", clean: true } });
    expect(await runRepositoryCommand(["begin", "--branch", "feature/demo"], { env })).toMatchObject({ ok: true });
    mkdirSync(join(checkout, "skills", "new-skill"), { recursive: true });
    writeFileSync(join(checkout, "skills", "new-skill", "SKILL.md"), "---\nname: new-skill\ndescription: New\n---\n");
    expect(await runRepositoryCommand(["validate"], { env })).toMatchObject({ ok: true, data: { skillNames: ["new-skill"] } });
    expect(await runRepositoryCommand(["publish", "--message", "add new skill"], { env })).toMatchObject({ ok: true, data: { branch: "feature/demo" } });
    expect(execFileSync("git", ["ls-remote", "--heads", remote, "feature/demo"], { encoding: "utf8" })).toContain("refs/heads/feature/demo");
    expect(await runRepositoryCommand(["publish", "--direct", "--message", "wrong branch"], { env })).toMatchObject({ ok: false, code: "NO_CHANGES" });
    expect(await runRepositoryCommand(["sync"], { env })).toMatchObject({ ok: true });
    writeFileSync(join(checkout, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Updated\n---\n");
    expect(await runRepositoryCommand(["publish", "--direct", "--message", "direct update"], { env })).toMatchObject({ ok: true, data: { branch: "main" } });
    writeFileSync(join(checkout, "README.md"), "not allowed");
    expect(await runRepositoryCommand(["validate"], { env })).toMatchObject({ ok: false, code: "PATH_OUTSIDE_SKILLS" });
    expect(await runRepositoryCommand(["sync"], { env })).toMatchObject({ ok: false, code: "DIRTY_WORKTREE" });
  });

  it("refuses a lock owned by another process", async () => {
    const root = mkdtempSync(join(tmpdir(), "orgops-lock-fixture-"));
    const checkout = join(root, "checkout");
    const env = { PRIVATE_SKILLS_REPO_URL: join(root, "remote.git"), PRIVATE_SKILLS_REPO_PATH: checkout, PRIVATE_SKILLS_REPO_BRANCH: "main", ORGOPS_SKILL_ROOTS: join(checkout, "skills") };
    mkdirSync(`${checkout}.orgops-private-skills.lock`, { recursive: true });
    expect(await runRepositoryCommand(["sync"], { env })).toMatchObject({ ok: false, code: "BUSY" });
  });
});
