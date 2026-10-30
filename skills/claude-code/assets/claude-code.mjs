// Glue between the OrgOps command harness and Claude Code: one Claude Code session per
// OrgOps session, resumed on every turn. Arguments are passed on to `claude`.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:os";

// The message goes on stdin, so Claude Code's tools do not need it in their environment.
const { ORGOPS_WRAPPED_MESSAGE: message, ...env } = process.env;

// Claude Code session ids must be UUIDs; derive a stable one from the OrgOps session id.
const hex = createHash("sha256").update(env.ORGOPS_WRAPPED_SESSION_ID).digest("hex");
const sessionId = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
const context = "You are reached through an OrgOps channel: your final response is posted there as your reply. A message may be a JSON batch of OrgOps events; answer its human messages.";
// Claude Code refuses --dangerously-skip-permissions as root unless it is told it runs in a sandbox.
if (process.getuid?.() === 0) env.IS_SANDBOX = "1";
let child;
let stopping = false;

function run(sessionFlag) {
  return new Promise((resolve) => {
    const args = ["-p", "--dangerously-skip-permissions", "--append-system-prompt", context, ...process.argv.slice(2), sessionFlag, sessionId];
    child = spawn(process.env.CLAUDE_CODE_BIN || "claude", args, { env, stdio: ["pipe", "inherit", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => resolve({ code: 127, stderr: `Could not start Claude Code: ${error.message}\n` }));
    child.on("close", (code, signal) => resolve({ code: code ?? 128 + (constants.signals[signal] ?? 15), stderr }));
    // On stdin the prompt can never be read as a flag.
    child.stdin.on("error", () => {});
    child.stdin.end(message);
  });
}

// The runner stops a turn with one SIGTERM; pass it on so Claude Code and its tools stop too.
process.on("SIGTERM", () => {
  stopping = true;
  child?.kill("SIGTERM");
});

let result = await run("--resume");
if (!stopping && result.code !== 0 && /No conversation found/.test(result.stderr)) result = await run("--session-id");
// Only a failed turn shows stderr; on success the runner would post it when stdout is empty.
if (result.code !== 0) process.stderr.write(result.stderr);
process.exitCode = result.code;
