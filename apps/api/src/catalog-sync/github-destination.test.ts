import { describe, expect, it } from "vitest";
import { parseGitHubDestination } from "./github-destination";

describe("parseGitHubDestination", () => {
  it.each([
    ["https://github.com/org/repo", { owner: "org", name: "repo", fetchUrl: "https://github.com/org/repo.git" }],
    ["https://github.com/org/repo.git", { owner: "org", name: "repo", fetchUrl: "https://github.com/org/repo.git" }],
    ["https://github.com/my-org/re.po_x-y", { owner: "my-org", name: "re.po_x-y", fetchUrl: "https://github.com/my-org/re.po_x-y.git" }],
    ["https://github.com/a/b", { owner: "a", name: "b", fetchUrl: "https://github.com/a/b.git" }],
  ])("accepts %s", (url, expected) => {
    const result = parseGitHubDestination(url);
    expect(result).toEqual({ ok: true, value: expected });
    expect(Object.isFrozen(result.ok ? result.value : null)).toBe(true);
  });
  it.each([
    "https://www.github.com/org/repo", "https://github.com.evil.org/org/repo", "https://GITHUB.com/org/repo",
    "HTTPS://github.com/org/repo", "http://github.com/org/repo", "ssh://git@github.com/org/repo",
    "git://github.com/org/repo", "file:///github.com/org/repo",
    "https://github.com:8443/org/repo", "https://user@github.com/org/repo", "https://user:pw@github.com/org/repo",
    "https://github.com/org/repo?x=1", "https://github.com/org/repo#f", "https://github.com/org/repo%2e%2e",
    "https://192.0.2.1/org/repo", "https://[::1]/org/repo", "https://10.0.0.9/org/repo",
    "https://github.com/org", "https://github.com/org/repo/extra", "https://github.com//repo",
    "https://github.com/org/", "https://github.com/org/repo.git.git", "https://github.com/org/.",
    "https://github.com/./repo", "https://github.com/../repo", "https://github.com/-org/repo",
    "https://github.com/org-/repo", "https://github.com/" + "o".repeat(40) + "/repo",
    "https://github.com/org/" + "r".repeat(101), "https://github.com/org/repo\u0000",
    "", "github.com/org/repo", "https://github.com",
  ])("rejects %s", url => {
    expect(parseGitHubDestination(url)).toEqual({ ok: false });
  });
  it("rejects over-length and non-string-shaped input", () => {
    expect(parseGitHubDestination(`https://github.com/org/${"r".repeat(2048)}`)).toEqual({ ok: false });
    expect(parseGitHubDestination(undefined as unknown as string)).toEqual({ ok: false });
  });
});
