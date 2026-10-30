import { spawn } from "node:child_process";

const bind = process.env.LIVEKIT_BIND?.trim() || "127.0.0.1";
const args = ["--dev", "--bind", bind];

const child = spawn("livekit-server", args, { stdio: "inherit" });
child.on("error", (error) => {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    console.error(
      "livekit-server is not on PATH. Install it with `brew install livekit`, then run `npm run livekit`.",
    );
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
