import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { InstallComponent } from "./components";

const STATE_DIR = resolve(homedir(), ".orgops");
const STATE_PATH = join(STATE_DIR, "opscli-state.json");

export type OpsCliState = {
  installDir?: string;
  repoUrl?: string;
  repoRef?: string;
  serviceRegistered?: boolean;
  installedComponents?: InstallComponent[];
};

export function getStatePath() {
  return STATE_PATH;
}

export function loadState(): OpsCliState {
  if (!existsSync(STATE_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf-8")) as OpsCliState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveState(next: OpsCliState) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
}
