import { spawnSync } from "node:child_process";

const REQUIRED_TOOLS = ["node", "npm", "git"] as const;

type ToolCheck = {
  name: (typeof REQUIRED_TOOLS)[number];
  ok: boolean;
  output: string;
};

function checkTool(name: (typeof REQUIRED_TOOLS)[number]): ToolCheck {
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

function formatInstallHint(missing: string[]) {
  const joined = missing.join(", ");
  if (process.platform === "darwin") {
    return `Install missing tools (${joined}) using Homebrew, then rerun install.`;
  }
  if (process.platform === "win32") {
    return `Install missing tools (${joined}) using winget/choco, then rerun install.`;
  }
  return `Install missing tools (${joined}) using your distro package manager, then rerun install.`;
}

export function ensurePrerequisites() {
  const results = REQUIRED_TOOLS.map((name) => checkTool(name));
  const missing = results.filter((item) => !item.ok).map((item) => item.name);
  return {
    results,
    missing,
    ok: missing.length === 0,
    hint: missing.length > 0 ? formatInstallHint(missing) : "",
  };
}
