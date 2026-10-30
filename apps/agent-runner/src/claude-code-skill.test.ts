import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWrappedAgentTurn } from "./wrapped-runtime";
import type { Agent, Event } from "./types";

// Runs the recipe documented in skills/claude-code/SKILL.md through the real command
// harness, with a fake `claude` that keeps sessions the way the CLI does.
const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
const skillDoc = readFileSync(join(projectRoot, "skills/claude-code/SKILL.md"), "utf8");

function documentedConfig() {
  const blocks = [...skillDoc.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const create = blocks.find((block) => block.wrappedConfig?.kind === "claude-code");
  if (!create) throw new Error("SKILL.md has no agents_create example for kind claude-code");
  return create.wrappedConfig;
}

const FAKE_CLAUDE = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const state = process.env.FAKE_CLAUDE_STATE;
const argv = process.argv.slice(2);
const log = (entry) => appendFileSync(join(state, "calls.jsonl"), JSON.stringify(entry) + "\\n");
const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const message = readFileSync(0, "utf8");
log({ argv, message });
const resume = flag("--resume");
const id = resume ?? flag("--session-id");
const file = join(state, id + ".json");
const waitForStop = (then) => {
  process.on("SIGTERM", () => {
    log({ terminated: true });
    then();
  });
  setInterval(() => {}, 1000);
};
if (resume && !existsSync(file)) {
  const missing = () => {
    process.stderr.write("No conversation found with session ID: " + id + "\\n");
    process.exit(1);
  };
  if (message === "slow") waitForStop(missing);
  else missing();
} else if (!resume && existsSync(file)) {
  process.stderr.write("Error: Session ID " + id + " is already in use.\\n");
  process.exit(1);
} else if (message === "quiet") {
  process.stderr.write("warning: plugin failed to load\\n");
} else if (message === "sleep") {
  waitForStop(() => process.exit(143));
} else {
  const history = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  history.push(message);
  writeFileSync(file, JSON.stringify(history));
  if (message === "fail") {
    process.stdout.write("Error: Reached max turns (1)\\n");
    process.exit(1);
  }
  process.stdout.write("turn " + history.length + ": " + message + "\\n");
}
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orgops-claude-code-"));
  mkdirSync(join(dir, "state"));
  mkdirSync(join(dir, "workspace"));
  writeFileSync(join(dir, "claude"), FAKE_CLAUDE);
  chmodSync(join(dir, "claude"), 0o755);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function agentFrom(config: any, runtime: Record<string, unknown> = {}): Agent {
  const env = { CLAUDE_CODE_BIN: join(dir, "claude"), FAKE_CLAUDE_STATE: join(dir, "state") };
  return {
    name: "ClaudeCoder",
    workspacePath: join(dir, "workspace"),
    modelId: "wrapped:none",
    desiredState: "RUNNING",
    runtimeState: "RUNNING",
    mode: "WRAPPED",
    wrappedConfig: { ...config, runtime: { ...config.runtime, env, ...runtime } },
  };
}

async function turn(agent: Agent, channelId: string, text: string) {
  const emitted: any[] = [];
  const event: Event = {
    id: `evt-${Math.random()}`,
    type: "message.created",
    payload: { text },
    source: "human:alice",
    channelId,
    createdAt: Date.now(),
  };
  const ctx = {
    projectRoot,
    api: {
      emitEvent: async (outbound: unknown) => {
        emitted.push(outbound);
      },
      getPackageSecretsEnv: async () => ({}),
    },
  };
  const error = await runWrappedAgentTurn(ctx, agent, [event]).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  const reply = emitted.find((outbound) => outbound.type === "message.created")?.payload?.text;
  const failed = emitted.find((outbound) => outbound.type === "wrapper.turn.failed")?.payload;
  return { reply, failed, error };
}

type Call = { argv?: string[]; message?: string; terminated?: boolean };

function calls(): Call[] {
  const file = join(dir, "state/calls.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

const valueOf = (argv: string[] | undefined, name: string) => argv?.[argv.indexOf(name) + 1];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("claude-code skill recipe", () => {
  it("starts one Claude Code session per channel and resumes it on later turns", async () => {
    const agent = agentFrom(documentedConfig());

    expect((await turn(agent, "chan-1", "remember PELICAN")).reply).toBe("turn 1: remember PELICAN");
    expect((await turn(agent, "chan-1", "what word?")).reply).toBe("turn 2: what word?");
    expect((await turn(agent, "chan-2", "what word?")).reply).toBe("turn 1: what word?");

    // Each first turn tries to resume, then creates; later turns only resume.
    const [missed, created, resumed, , other] = calls();
    const id = valueOf(created.argv, "--session-id");
    expect(id).toMatch(UUID);
    expect(valueOf(missed.argv, "--resume")).toBe(id);
    expect(valueOf(resumed.argv, "--resume")).toBe(id);
    expect(valueOf(other.argv, "--session-id")).not.toBe(id);
    expect(created.argv).toEqual(expect.arrayContaining(["-p", "--dangerously-skip-permissions"]));
  });

  it("passes the message on stdin, unchanged and never as a flag", async () => {
    const agent = agentFrom(documentedConfig());
    const text = "--model=opus $(touch pwned) `id`; \"quoted\"";

    const { reply } = await turn(agent, "chan-1", text);

    expect(reply).toBe(`turn 1: ${text}`);
    expect(calls()[1].message).toBe(text);
    expect(calls()[1].argv).not.toContain(text);
    expect(existsSync(join(dir, "workspace/pwned"))).toBe(false);
  });

  it("reports a failed resumed turn as it is, without starting a new session", async () => {
    const agent = agentFrom(documentedConfig());
    await turn(agent, "chan-1", "hello");

    const { failed, error } = await turn(agent, "chan-1", "fail");

    expect(error).toBeTruthy();
    expect(failed.stdout).toContain("Reached max turns");
    expect(failed.stderr ?? "").not.toContain("already in use");
    expect(calls().filter((call) => call.argv?.includes("--session-id"))).toHaveLength(1);
  });

  it("never posts Claude Code's diagnostics as the reply", async () => {
    const agent = agentFrom(documentedConfig());
    await turn(agent, "chan-1", "hello");

    const { reply, error } = await turn(agent, "chan-1", "quiet");

    expect(error).toBeUndefined();
    expect(reply).toBeUndefined();
  });

  it("forwards extra recipe arguments to Claude Code", async () => {
    const agent = agentFrom(documentedConfig(), { args: ["--model", "sonnet"] });

    await turn(agent, "chan-1", "hi");

    expect(calls()[1].argv).toEqual(expect.arrayContaining(["--model", "sonnet"]));
  });

  it("stops Claude Code when the runner times out the turn", async () => {
    const config = documentedConfig();
    // Some shells exec a lone command and some do not; pin `exec` so the stop reaches the glue everywhere.
    expect(config.runtime.command).toMatch(/^exec node /);
    const agent = agentFrom(config, { timeoutMs: 1500 });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

    // Stopped while resuming a missing session: no new session is started afterwards.
    expect((await turn(agent, "chan-1", "slow")).failed.timedOut).toBe(true);
    await settle();
    expect(calls().filter((call) => call.argv?.includes("--session-id"))).toHaveLength(0);

    // Stopped mid-turn: Claude Code itself receives the stop.
    await turn(agent, "chan-2", "hello");
    expect((await turn(agent, "chan-2", "sleep")).failed.timedOut).toBe(true);
    await settle();
    expect(calls().at(-1)).toEqual({ terminated: true });
  }, 15_000);
});
