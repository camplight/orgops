import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { InstallComponent } from "./components";
import { runChecked } from "./exec";

const COMPONENT_START_COMMAND: Record<InstallComponent, string> = {
  api: "start:api:env",
  runner: "start:runner:env",
  "admin-ui": "start:admin-ui:preview:env",
  "user-ui": "start:user-ui:preview:env",
};

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

function componentSlug(component: InstallComponent) {
  return component.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function macosLabelFor(component: InstallComponent) {
  return `com.orgops.${componentSlug(component)}`;
}

function windowsTaskNameFor(component: InstallComponent) {
  if (component === "admin-ui") return "OrgOpsAdminUi";
  if (component === "user-ui") return "OrgOpsUserUi";
  if (component === "runner") return "OrgOpsRunner";
  return "OrgOpsApi";
}

function systemdServiceNameFor(component: InstallComponent) {
  return `orgops-${componentSlug(component)}`;
}

export function registerAutostartServices(installDir: string, components: InstallComponent[]) {
  if (components.length === 0) return [] as string[];

  if (process.platform === "darwin") {
    const launchAgentsDir = resolve(homedir(), "Library", "LaunchAgents");
    mkdirSync(launchAgentsDir, { recursive: true });
    const uid = String(process.getuid?.() ?? 0);
    const messages: string[] = [];
    for (const component of components) {
      const label = macosLabelFor(component);
      const plistPath = join(launchAgentsDir, `${label}.plist`);
      const command = `cd "${escapeForDoubleQuotes(installDir)}" && npm run ${COMPONENT_START_COMMAND[component]}`;
      const slug = componentSlug(component);
      const plist = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<!DOCTYPE plist PUBLIC \"-//Apple Computer//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
        '<plist version="1.0">',
        "<dict>",
        "<key>Label</key>",
        `<string>${label}</string>`,
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
        `<string>${escapeForDoubleQuotes(join(installDir, `.orgops-${slug}.log`))}</string>`,
        "<key>StandardErrorPath</key>",
        `<string>${escapeForDoubleQuotes(join(installDir, `.orgops-${slug}.err.log`))}</string>`,
        "</dict>",
        "</plist>",
        "",
      ].join("\n");
      writeFileSync(plistPath, plist, "utf-8");
      runBestEffort("launchctl", ["bootout", `gui/${uid}`, plistPath]);
      runChecked("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
      runChecked("launchctl", ["enable", `gui/${uid}/${label}`]);
      messages.push(`LaunchAgent for ${component} registered at ${plistPath}`);
    }
    return messages;
  }

  if (process.platform === "win32") {
    const messages: string[] = [];
    for (const component of components) {
      const slug = componentSlug(component);
      const taskName = windowsTaskNameFor(component);
      const scriptPath = resolve(installDir, `.orgops-start-${slug}.cmd`);
      const script = [
        "@echo off",
        `cd /d "${installDir}"`,
        `npm run ${COMPONENT_START_COMMAND[component]}`,
        "",
      ].join("\r\n");
      writeFileSync(scriptPath, script, "utf-8");
      runChecked("schtasks", [
        "/Create",
        "/SC",
        "ONLOGON",
        "/TN",
        taskName,
        "/TR",
        `"${scriptPath}"`,
        "/F",
      ]);
      runChecked("schtasks", ["/Run", "/TN", taskName]);
      messages.push(`Scheduled task ${taskName} registered with script ${scriptPath}`);
    }
    return messages;
  }

  const systemdDir = resolve(homedir(), ".config", "systemd", "user");
  mkdirSync(systemdDir, { recursive: true });
  const unitNames: string[] = [];
  const messages: string[] = [];
  for (const component of components) {
    const serviceName = systemdServiceNameFor(component);
    unitNames.push(serviceName);
    const servicePath = join(systemdDir, `${serviceName}.service`);
    const serviceBody = [
      "[Unit]",
      `Description=OrgOps component ${component}`,
      "After=network.target",
      "",
      "[Service]",
      "Type=simple",
      `WorkingDirectory=${installDir}`,
      `ExecStart=/usr/bin/env npm run ${COMPONENT_START_COMMAND[component]}`,
      "Restart=always",
      "RestartSec=3",
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n");
    writeFileSync(servicePath, serviceBody, "utf-8");
    messages.push(`systemd user service for ${component} registered at ${servicePath}`);
  }
  runChecked("systemctl", ["--user", "daemon-reload"]);
  for (const serviceName of unitNames) {
    runChecked("systemctl", ["--user", "enable", "--now", serviceName]);
  }
  return messages;
}

export function unregisterAutostartServices(installDir: string, components: InstallComponent[]) {
  if (components.length === 0) return [] as string[];

  if (process.platform === "darwin") {
    const uid = String(process.getuid?.() ?? 0);
    const messages: string[] = [];
    for (const component of components) {
      const label = macosLabelFor(component);
      const plistPath = join(resolve(homedir(), "Library", "LaunchAgents"), `${label}.plist`);
      runBestEffort("launchctl", ["disable", `gui/${uid}/${label}`]);
      runBestEffort("launchctl", ["bootout", `gui/${uid}`, plistPath]);
      if (existsSync(plistPath)) unlinkSync(plistPath);
      messages.push(`LaunchAgent for ${component} removed from ${plistPath}`);
    }
    return messages;
  }

  if (process.platform === "win32") {
    const messages: string[] = [];
    for (const component of components) {
      const slug = componentSlug(component);
      const taskName = windowsTaskNameFor(component);
      const scriptPath = resolve(installDir, `.orgops-start-${slug}.cmd`);
      runBestEffort("schtasks", ["/End", "/TN", taskName]);
      runBestEffort("schtasks", ["/Delete", "/TN", taskName, "/F"]);
      rmSync(scriptPath, { force: true });
      messages.push(`Scheduled task ${taskName} deleted`);
    }
    return messages;
  }

  const systemdDir = resolve(homedir(), ".config", "systemd", "user");
  const messages: string[] = [];
  for (const component of components) {
    const serviceName = systemdServiceNameFor(component);
    const servicePath = join(systemdDir, `${serviceName}.service`);
    runBestEffort("systemctl", ["--user", "disable", "--now", serviceName]);
    rmSync(servicePath, { force: true });
    messages.push(`systemd user service for ${component} removed`);
  }
  runBestEffort("systemctl", ["--user", "daemon-reload"]);
  return messages;
}
