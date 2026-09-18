import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { runChecked } from "./exec";

const SERVICE_NAME = "orgops-user-stack";
const MACOS_LABEL = "com.orgops.user-stack";
const WINDOWS_TASK_NAME = "OrgOpsUserStack";

function escapeForDoubleQuotes(value: string) {
  return value.replace(/"/g, '\\"');
}

function runBestEffort(command: string, args: string[]) {
  try {
    runChecked(command, args);
  } catch {
    // Best effort for commands that may fail on first registration.
  }
}

export function registerAutostartService(installDir: string) {
  if (process.platform === "darwin") {
    const launchAgentsDir = resolve(homedir(), "Library", "LaunchAgents");
    mkdirSync(launchAgentsDir, { recursive: true });
    const plistPath = join(launchAgentsDir, `${MACOS_LABEL}.plist`);
    const command = `cd "${escapeForDoubleQuotes(installDir)}" && npm run start:user-stack:env`;
    const plist = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<!DOCTYPE plist PUBLIC \"-//Apple Computer//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
      '<plist version="1.0">',
      "<dict>",
      "<key>Label</key>",
      `<string>${MACOS_LABEL}</string>`,
      "<key>ProgramArguments</key>",
      "<array>",
      "<string>/bin/zsh</string>",
      "<string>-lc</string>",
      `<string>${command}</string>`,
      "</array>",
      "<key>RunAtLoad</key>",
      "<true/>",
      "<key>KeepAlive</key>",
      "<true/>",
      "<key>StandardOutPath</key>",
      `<string>${escapeForDoubleQuotes(join(installDir, ".orgops-user-stack.log"))}</string>`,
      "<key>StandardErrorPath</key>",
      `<string>${escapeForDoubleQuotes(join(installDir, ".orgops-user-stack.err.log"))}</string>`,
      "</dict>",
      "</plist>",
      "",
    ].join("\n");
    writeFileSync(plistPath, plist, "utf-8");
    const uid = String(process.getuid?.() ?? 0);
    runBestEffort("launchctl", ["bootout", `gui/${uid}`, plistPath]);
    runChecked("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
    runChecked("launchctl", ["enable", `gui/${uid}/${MACOS_LABEL}`]);
    return `LaunchAgent registered at ${plistPath}`;
  }

  if (process.platform === "win32") {
    const scriptPath = resolve(installDir, ".orgops-start-user-stack.cmd");
    const script = [
      "@echo off",
      `cd /d "${installDir}"`,
      "npm run start:user-stack:env",
      "",
    ].join("\r\n");
    writeFileSync(scriptPath, script, "utf-8");
    runChecked("schtasks", [
      "/Create",
      "/SC",
      "ONLOGON",
      "/TN",
      WINDOWS_TASK_NAME,
      "/TR",
      `"${scriptPath}"`,
      "/F",
    ]);
    runChecked("schtasks", ["/Run", "/TN", WINDOWS_TASK_NAME]);
    return `Scheduled task ${WINDOWS_TASK_NAME} registered with script ${scriptPath}`;
  }

  const systemdDir = resolve(homedir(), ".config", "systemd", "user");
  mkdirSync(systemdDir, { recursive: true });
  const servicePath = join(systemdDir, `${SERVICE_NAME}.service`);
  const serviceBody = [
    "[Unit]",
    "Description=OrgOps user stack",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${installDir}`,
    "ExecStart=/usr/bin/env npm run start:user-stack:env",
    "Restart=always",
    "RestartSec=3",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
  writeFileSync(servicePath, serviceBody, "utf-8");
  runChecked("systemctl", ["--user", "daemon-reload"]);
  runChecked("systemctl", ["--user", "enable", "--now", SERVICE_NAME]);
  return `systemd user service registered at ${servicePath}`;
}

export function stopAutostartService(installDir: string) {
  if (process.platform === "darwin") {
    const plistPath = join(resolve(homedir(), "Library", "LaunchAgents"), `${MACOS_LABEL}.plist`);
    const uid = String(process.getuid?.() ?? 0);
    runBestEffort("launchctl", ["bootout", `gui/${uid}`, plistPath]);
    return `LaunchAgent stopped via ${plistPath}`;
  }
  if (process.platform === "win32") {
    runBestEffort("schtasks", ["/End", "/TN", WINDOWS_TASK_NAME]);
    return `Scheduled task ${WINDOWS_TASK_NAME} stop requested`;
  }
  runBestEffort("systemctl", ["--user", "stop", SERVICE_NAME]);
  return `systemd user service ${SERVICE_NAME} stop requested`;
}
