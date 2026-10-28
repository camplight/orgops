import { spawnSync } from "node:child_process";
import { commandAvailable } from "./exec";
import { ensureGit } from "./git";

const HOST_TOOLS = ["node", "npm", "git"] as const;

export type ToolCheck = {
  name: (typeof HOST_TOOLS)[number];
  ok: boolean;
  output: string;
};

function checkTool(name: (typeof HOST_TOOLS)[number]): ToolCheck {
  const result = spawnSync(name, ["--version"], {
    encoding: "utf-8",
    shell: process.platform === "win32",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return {
    name,
    ok: result.status === 0,
    output,
  };
}

export function checkHostTools() {
  return HOST_TOOLS.map((name) => checkTool(name));
}

export type DoctorReport = {
  ok: boolean;
  results: ToolCheck[];
  git: ReturnType<typeof ensureGit>;
  managedToolchainNote: string;
  hint: string;
};

export function collectDoctorReport(): DoctorReport {
  const results = checkHostTools();
  const node = results.find((item) => item.name === "node");
  const npm = results.find((item) => item.name === "npm");
  const gitAvailable = commandAvailable("git");
  const git = {
    ok: true,
    available: gitAvailable,
    installed: false,
    skipped: false,
    hint: gitAvailable
      ? ""
      : "git is optional. Default install will try to install it; pass --no-git to use a source archive.",
  };
  const hostRuntimeOk = Boolean(node?.ok && npm?.ok);
  const hint = hostRuntimeOk
    ? git.available
      ? ""
      : "git is optional. Default install will try to install it; pass --no-git to use a source archive."
    : "Host node/npm are missing. opscli install will download a private Node toolchain under ~/.orgops/toolchains.";
  return {
    ok: true,
    results,
    git,
    managedToolchainNote: hostRuntimeOk
      ? "Host node/npm found. Install still prefers a private toolchain unless ORGOPS_OPSCLI_USE_SYSTEM_TOOLCHAIN=1."
      : "Install will provision a managed Node/npm toolchain.",
    hint,
  };
}

export function ensurePrerequisites() {
  const results = checkHostTools();
  const missing = results.filter((item) => !item.ok).map((item) => item.name);
  const gitMissing = missing.includes("git");
  const runtimeMissing = missing.filter((name) => name !== "git");
  return {
    results,
    missing,
    ok: runtimeMissing.length === 0,
    hint: gitMissing
      ? "git is optional. Install git, or pass --no-git."
      : runtimeMissing.length > 0
        ? `Install missing tools (${runtimeMissing.join(", ")}) or let opscli download a managed Node toolchain during install.`
        : "",
    gitAvailable: commandAvailable("git"),
  };
}
