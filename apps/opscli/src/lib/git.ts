import { commandAvailable, runChecked } from "./exec";
import { isTruthyEnv } from "./env-flag";

export type GitEnsureResult = {
  ok: boolean;
  available: boolean;
  installed: boolean;
  skipped: boolean;
  hint: string;
};

function tryInstallGit() {
  if (isTruthyEnv(process.env.ORGOPS_OPSCLI_INSTALL_SMOKE_MOCK)) return false;
  if (isTruthyEnv(process.env.ORGOPS_OPSCLI_SKIP_GIT_INSTALL)) return false;

  try {
    if (process.platform === "darwin" && commandAvailable("brew")) {
      runChecked("brew", ["install", "git"]);
      return commandAvailable("git");
    }
    if (process.platform === "win32" && commandAvailable("winget")) {
      runChecked("winget", [
        "install",
        "--id",
        "Git.Git",
        "-e",
        "--source",
        "winget",
        "--accept-package-agreements",
        "--accept-source-agreements",
      ]);
      return commandAvailable("git");
    }
    if (process.platform === "linux") {
      if (commandAvailable("apt-get")) {
        runChecked("apt-get", ["install", "-y", "git"]);
        return commandAvailable("git");
      }
      if (commandAvailable("dnf")) {
        runChecked("dnf", ["install", "-y", "git"]);
        return commandAvailable("git");
      }
    }
  } catch {
    return false;
  }
  return false;
}

export function ensureGit(options?: { required?: boolean }): GitEnsureResult {
  const required = options?.required !== false;
  if (!required) {
    return {
      ok: true,
      available: commandAvailable("git"),
      installed: false,
      skipped: true,
      hint: "Git skipped (--no-git). Source will be installed from a GitHub archive.",
    };
  }
  if (commandAvailable("git")) {
    return { ok: true, available: true, installed: false, skipped: false, hint: "" };
  }
  const installed = tryInstallGit();
  if (commandAvailable("git")) {
    return { ok: true, available: true, installed, skipped: false, hint: "" };
  }
  return {
    ok: false,
    available: false,
    installed: false,
    skipped: false,
    hint: "git is missing and could not be installed automatically. Install git, or re-run with --no-git to use a source archive.",
  };
}
