import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { parseRepositoryConfig } from "./repository-config";

const repo = "/tmp/private-skills";
const base = {
  PRIVATE_SKILLS_REPO_URL: "https://github.com/acme/private-skills.git",
  PRIVATE_SKILLS_REPO_PATH: repo,
  PRIVATE_SKILLS_REPO_BRANCH: "main",
  ORGOPS_SKILL_ROOTS: join(repo, "skills"),
};

describe("parseRepositoryConfig", () => {
  it("parses the strict repository identity and managed root", () => {
    expect(parseRepositoryConfig(base)).toEqual({
      repositoryUrl: base.PRIVATE_SKILLS_REPO_URL,
      repositoryPath: resolve(repo),
      skillsPath: resolve(repo, "skills"),
      defaultBranch: "main",
    });
  });

  it.each([
    "PRIVATE_SKILLS_REPO_URL",
    "PRIVATE_SKILLS_REPO_PATH",
    "PRIVATE_SKILLS_REPO_BRANCH",
    "ORGOPS_SKILL_ROOTS",
  ])("rejects missing %s without echoing values", (key) => {
    const env = { ...base, [key]: undefined };
    expect(() => parseRepositoryConfig(env)).toThrowError(/CONFIG_INVALID/);
  });

  it.each(["-main", "bad branch", "bad..branch", "main@{x}", "main/", "main.lock", "feature/main.lock", "feature/release.lock/x", "main\\x", "main~x", "main^x", "main:x", "main?x", "main*x", "main[x]", "@"]) (
    "rejects unsafe branch %s",
    (branch) => expect(() => parseRepositoryConfig({ ...base, PRIVATE_SKILLS_REPO_BRANCH: branch })).toThrowError(/CONFIG_INVALID/),
  );

  it("rejects plaintext HTTP repository URLs", () => {
    expect(() => parseRepositoryConfig({ ...base, PRIVATE_SKILLS_REPO_URL: "http://example.test/repo.git" })).toThrowError(/CONFIG_INVALID/);
  });

  it("rejects URL credentials and a root mismatch", () => {
    expect(() => parseRepositoryConfig({ ...base, PRIVATE_SKILLS_REPO_URL: "https://user:secret@example.test/repo.git" })).toThrowError(/CONFIG_INVALID/);
    expect(() => parseRepositoryConfig({ ...base, ORGOPS_SKILL_ROOTS: "/other/skills" })).toThrowError(/ROOT_MISMATCH/);
  });

  it("accepts the managed root among platform-delimited roots", () => {
    expect(parseRepositoryConfig({ ...base, ORGOPS_SKILL_ROOTS: `/one${process.platform === "win32" ? ";" : ":"}${repo}/skills` }).skillsPath).toBe(resolve(repo, "skills"));
  });
});
