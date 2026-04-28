import { describe, expect, it } from "vitest";
import { buildRunnerGuidance } from "./prompt";

describe("buildRunnerGuidance", () => {
  it("includes concrete runner host info for agent context", () => {
    const guidance = buildRunnerGuidance(1_717_000_000_000, "2024-06-01T00:00:00.000Z", "/tmp/skills", [], {
      platform: "darwin",
      release: "24.6.0",
      arch: "arm64",
      hostname: "my-macbook",
      shell: "/bin/zsh",
      nodeVersion: "v22.15.0",
    });

    expect(guidance).toContain("Runner host info (authoritative; do not guess):");
    expect(guidance).toContain("- platform: darwin");
    expect(guidance).toContain("- release: 24.6.0");
    expect(guidance).toContain("- arch: arm64");
    expect(guidance).toContain("- hostname: my-macbook");
    expect(guidance).toContain("- shell: /bin/zsh");
    expect(guidance).toContain("- nodeVersion: v22.15.0");
    expect(guidance).toContain(
      "SKILL.md` must start with YAML frontmatter at the very first line (`---` as the first bytes in the file).",
    );
  });
});
