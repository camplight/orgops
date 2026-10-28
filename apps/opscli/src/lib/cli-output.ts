import { stdout } from "node:process";
import { writeRoleMessage } from "./ui";
import { toDisplayError } from "./utils";

let jsonMode = false;
let yesMode = false;

export function setCliModes(options: { json?: boolean; yes?: boolean }) {
  jsonMode = Boolean(options.json);
  yesMode = Boolean(options.yes);
}

export function isJsonMode() {
  return jsonMode;
}

export function isYesMode() {
  return yesMode;
}

export function extractGlobalFlags(argv: string[]) {
  const flags = { json: false, yes: false };
  const rest: string[] = [];
  for (const token of argv) {
    if (token === "--json") flags.json = true;
    else if (token === "--yes" || token === "-y") flags.yes = true;
    else rest.push(token);
  }
  return { flags, rest };
}

export function emitOk(command: string, result: unknown, lines: string[]) {
  if (jsonMode) {
    stdout.write(`${JSON.stringify({ ok: true, command, result })}\n`);
    return;
  }
  for (const line of lines) writeRoleMessage("opscli", line);
}

export function emitError(command: string, error: unknown) {
  const message = toDisplayError(error);
  if (jsonMode) {
    stdout.write(`${JSON.stringify({ ok: false, command, error: message })}\n`);
  } else {
    writeRoleMessage("error", `${command} failed: ${message}`, { toStderr: true });
  }
}
