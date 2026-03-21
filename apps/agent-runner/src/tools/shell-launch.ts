import { existsSync } from "node:fs";

type ShellLaunch = {
  command: string;
  args: string[];
};

function splitShellArgs(raw: string): string[] {
  return raw
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
}

export function getShellLaunch(cmd: string): ShellLaunch {
  const customShellPath = process.env.ORGOPS_SHELL_PATH?.trim();
  if (customShellPath) {
    const customShellArgs = process.env.ORGOPS_SHELL_ARGS?.trim();
    const args = customShellArgs
      ? [...splitShellArgs(customShellArgs), cmd]
      : ["-lc", cmd];
    return { command: customShellPath, args };
  }

  if (process.platform === "win32") {
    const gitBashPath =
      process.env.ORGOPS_GIT_BASH_PATH?.trim() ||
      "C:\\Program Files\\Git\\bin\\bash.exe";
    if (existsSync(gitBashPath)) {
      return { command: gitBashPath, args: ["-lc", cmd] };
    }
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd],
    };
  }

  return { command: "/bin/bash", args: ["-lc", cmd] };
}
