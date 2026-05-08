import { stdout } from "node:process";
import { PROGRESS_ENABLED, SPINNER_ENABLED } from "./config";

const ANSI_ENABLED = stdout.isTTY && process.env.NO_COLOR !== "1";
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

export type UiRole = "user" | "agent" | "opscli" | "error" | "muted";

function stylize(text: string, color: keyof typeof ANSI, bold = false) {
  if (!ANSI_ENABLED) return text;
  const weight = bold ? ANSI.bold : "";
  return `${weight}${ANSI[color]}${text}${ANSI.reset}`;
}

export function rolePrefix(role: UiRole) {
  if (role === "user") return stylize("You>", "cyan", true);
  if (role === "agent") return stylize("Agent>", "magenta", true);
  if (role === "error") return stylize("Error>", "red", true);
  if (role === "muted") return stylize("OpsCLI>", "gray", true);
  return stylize("OpsCLI>", "yellow", true);
}

export function writeRoleMessage(
  role: UiRole,
  text: string,
  options?: { leadingNewline?: boolean; toStderr?: boolean }
) {
  const prefix = rolePrefix(role);
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const [firstLine = "", ...rest] = lines;
  const rendered = [`${prefix} ${firstLine}`, ...rest].join("\n");
  const output = `${options?.leadingNewline ? "\n" : ""}${rendered}\n`;
  if (options?.toStderr) {
    process.stderr.write(output);
    return;
  }
  stdout.write(output);
}

export function reportProgress(message: string, options?: { leadingNewline?: boolean }) {
  if (!PROGRESS_ENABLED) return;
  writeRoleMessage("muted", `progress: ${message}`, options);
}

type SpinnerControls = { stop: (doneLabel?: string) => void };
let stopActiveSpinner: (() => void) | null = null;

export function forceStopSpinner() {
  stopActiveSpinner?.();
  stopActiveSpinner = null;
}

export function startSpinner(label: string): SpinnerControls {
  if (!stdout.isTTY || !SPINNER_ENABLED) {
    return { stop: () => {} };
  }
  const frames = ["-", "\\", "|", "/"];
  let frameIndex = 0;
  let interval: NodeJS.Timeout | null = null;
  let hasRendered = false;

  const render = () => {
    const frame = frames[frameIndex % frames.length];
    frameIndex += 1;
    hasRendered = true;
    stdout.write(`\r${rolePrefix("muted")} ${label} ${frame}`);
  };

  const delay = setTimeout(() => {
    render();
    interval = setInterval(render, 100);
  }, 200);

  const stop = (doneLabel?: string) => {
    clearTimeout(delay);
    if (interval) clearInterval(interval);
    if (!hasRendered) return;
    const finalLabel = doneLabel ? `${doneLabel}   ` : `${label} done.   `;
    stdout.write(`\r${rolePrefix("muted")} ${finalLabel}\n`);
  };

  stopActiveSpinner = () => stop();
  return {
    stop: (doneLabel?: string) => {
      stop(doneLabel);
      if (stopActiveSpinner) stopActiveSpinner = null;
    },
  };
}
