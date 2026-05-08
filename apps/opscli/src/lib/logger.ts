import { appendFileSync, writeFileSync } from "node:fs";
import { SESSION_LOG_PATH } from "./config";

export function appendSessionLog(message: string) {
  const timestamp = new Date().toISOString();
  try {
    appendFileSync(SESSION_LOG_PATH, `[${timestamp}] ${message}\n`, "utf-8");
  } catch {
    // Keep resilient even if log writes fail.
  }
}

export function resetSessionLog(modelId: string) {
  const header = [
    `[${new Date().toISOString()}] OrgOps OpsCLI session started`,
    `cwd=${process.cwd()}`,
    `model=${modelId}`,
    "",
  ].join("\n");
  writeFileSync(SESSION_LOG_PATH, header, "utf-8");
}
