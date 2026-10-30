import { describe, expect, it } from "vitest";
import { buildRunnerGuidance } from "./prompt";

describe("buildRunnerGuidance", () => {
  it("includes concrete runner host info for agent context", () => {
    const guidance = buildRunnerGuidance(
      1_717_000_000_000,
      "2024-06-01T00:00:00.000Z",
      ["/tmp/skills"],
      [],
      {
      platform: "darwin",
      release: "24.6.0",
      arch: "arm64",
        hostname: "my-macbook",
        shell: "/bin/zsh",
        nodeVersion: "v22.15.0",
      },
    );

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
    expect(guidance).toContain("Your final response MUST be JSON");
  });

  it("swaps the JSON event contract for plain-text replies", () => {
    const host = {
      platform: "darwin",
      release: "24.6.0",
      arch: "arm64",
      hostname: "h",
      shell: "/bin/zsh",
      nodeVersion: "v24",
    };
    const guidance = buildRunnerGuidance(1, "1970-01-01T00:00:00.001Z", [], [], host, {
      replyContract: "plain-text",
      agentName: "voice-agent",
    });

    expect(guidance).toContain("You are the agent `voice-agent`");
    expect(guidance).toContain("your final answer is plain text");
    expect(guidance).toContain("call the `noop` tool");
    expect(guidance).not.toContain("MUST be JSON");
    expect(guidance).not.toContain("prose outside of JSON");
  });
});
