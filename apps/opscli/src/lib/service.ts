import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { InstallComponent } from "./components";
import { isTruthyEnv } from "./env-flag";
import { runChecked } from "./exec";
import { envWithToolchain, nodeCommandForInstall, servicePathValue } from "./toolchain";

const COMPONENT_START_ARGS: Record<InstallComponent, string[]> = {
  api: ["--env-file=.env", "--import", "tsx", "apps/api/src/server.ts"],
  runner: ["--env-file=.env", "--import", "tsx", "apps/agent-runner/src/index.ts"],
  "admin-ui": [
    "--env-file=.env",
    "./node_modules/vite/bin/vite.js",
    "preview",
    "--config",
    "apps/admin-ui/vite.config.ts",
    "--host",
    "0.0.0.0",
    "--port",
    "4173",
  ],
  "user-ui": [
    "--env-file=.env",
    "./node_modules/vite/bin/vite.js",
    "preview",
    "--config",
    "apps/user-ui/vite.config.ts",
    "--host",
    "0.0.0.0",
    "--port",
    "4190",
  ],
};

function isServiceDryRun() {
  return isTruthyEnv(process.env.ORGOPS_OPSCLI_SERVICE_DRY_RUN);
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function serviceEnvironment(installDir: string): Record<string, string> {
  return {
    PATH: servicePathValue(installDir),
    HOME: homedir(),
    TMPDIR: tmpdir(),
    LANG: process.env.LANG?.trim() || "en_US.UTF-8",
    NODE_ENV: "production",
    NODE_OPTIONS: "",
  };
}

function runBestEffort(command: string, args: string[]) {
  spawnSync(command, args, {
    stdio: "ignore",
    shell: process.platform === "win32",
    env: process.env,
  });
}

function runSchtasks(args: string[]) {
  const result = spawnSync("schtasks", args, {
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`schtasks ${args.join(" ")} failed with status ${result.status}`);
  }
}

function runSchtasksBestEffort(args: string[]) {
  try {
    runSchtasks(args);
  } catch {
    // Best effort for cleanup and re-registration steps.
  }
}

export function componentSlug(component: InstallComponent) {
  return component.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function macosLabelPrefix() {
  return process.env.ORGOPS_OPSCLI_SERVICE_PREFIX?.trim() || "com.orgops";
}

export function macosLabelFor(component: InstallComponent) {
  return `${macosLabelPrefix()}.${componentSlug(component)}`;
}

export function windowsTaskNameFor(component: InstallComponent) {
  const prefix = process.env.ORGOPS_OPSCLI_SERVICE_PREFIX?.trim() || "OrgOps";
  const suffix =
    component === "admin-ui"
      ? "AdminUi"
      : component === "user-ui"
        ? "UserUi"
        : component === "runner"
          ? "Runner"
          : "Api";
  return `${prefix}${suffix}`;
}

export function systemdServiceNameFor(component: InstallComponent) {
  const prefix = process.env.ORGOPS_OPSCLI_SERVICE_PREFIX?.trim() || "orgops";
  return `${prefix}-${componentSlug(component)}`;
}

export function serviceArtifactPath(installDir: string, component: InstallComponent) {
  const slug = componentSlug(component);
  if (process.platform === "darwin") {
    return join(resolve(homedir(), "Library", "LaunchAgents"), `${macosLabelFor(component)}.plist`);
  }
  if (process.platform === "win32") {
    return resolve(installDir, `.orgops-start-${slug}.ps1`);
  }
  return join(resolve(homedir(), ".config", "systemd", "user"), `${systemdServiceNameFor(component)}.service`);
}

function writeLauncherScript(installDir: string, component: InstallComponent) {
  const slug = componentSlug(component);
  const scriptPath = resolve(installDir, `.orgops-run-${slug}.sh`);
  const nodeCommand = nodeCommandForInstall(installDir);
  const env = serviceEnvironment(installDir);
  const quotedArgs = [nodeCommand, ...COMPONENT_START_ARGS[component]].map(shellQuote).join(" ");
  const script = [
    "#!/bin/zsh",
    "set -eu",
    `cd ${shellQuote(installDir)}`,
    ...Object.entries(env).map(([key, value]) => `export ${key}=${shellQuote(value)}`),
    "unset NODE_OPTIONS",
    `exec ${quotedArgs}`,
    "",
  ].join("\n");
  writeFileSync(scriptPath, script, { encoding: "utf-8", mode: 0o755 });
  return scriptPath;
}

function writeMacosPlist(installDir: string, component: InstallComponent) {
  const label = macosLabelFor(component);
  const plistPath = serviceArtifactPath(installDir, component);
  mkdirSync(resolve(homedir(), "Library", "LaunchAgents"), { recursive: true });
  const launcherPath = writeLauncherScript(installDir, component);
  const slug = componentSlug(component);
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "<key>Label</key>",
    `<string>${xmlEscape(label)}</string>`,
    "<key>ProgramArguments</key>",
    "<array>",
    "<string>/bin/zsh</string>",
    `<string>${xmlEscape(launcherPath)}</string>`,
    "</array>",
    "<key>WorkingDirectory</key>",
    `<string>${xmlEscape(installDir)}</string>`,
    "<key>EnvironmentVariables</key>",
    "<dict>",
    ...Object.entries(serviceEnvironment(installDir)).flatMap(([key, value]) => [
      `<key>${xmlEscape(key)}</key>`,
      `<string>${xmlEscape(value)}</string>`,
    ]),
    "</dict>",
    "<key>RunAtLoad</key>",
    "<true/>",
    "<key>KeepAlive</key>",
    "<true/>",
    "<key>ProcessType</key>",
    "<string>Background</string>",
    "<key>StandardOutPath</key>",
    `<string>${xmlEscape(join(installDir, `.orgops-${slug}.log`))}</string>`,
    "<key>StandardErrorPath</key>",
    `<string>${xmlEscape(join(installDir, `.orgops-${slug}.err.log`))}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
  writeFileSync(plistPath, plist, "utf-8");
  return { label, plistPath };
}

function writeWindowsScript(installDir: string, component: InstallComponent) {
  const slug = componentSlug(component);
  const taskName = windowsTaskNameFor(component);
  const scriptPath = serviceArtifactPath(installDir, component);
  const nodeCommand = nodeCommandForInstall(installDir);
  const argumentList = COMPONENT_START_ARGS[component]
    .map((arg) => `"${arg.replace(/"/g, '`"')}"`)
    .join(", ");
  const env = serviceEnvironment(installDir);
  const script = [
    '$ErrorActionPreference = "Stop"',
    ...Object.entries(env).map(([key, value]) => `$env:${key} = "${value.replace(/"/g, '""')}"`),
    `Set-Location -Path "${installDir.replace(/"/g, '""')}"`,
    `Start-Process -FilePath "${nodeCommand.replace(/"/g, '""')}" -ArgumentList @(${argumentList}) -WorkingDirectory "${installDir.replace(/"/g, '""')}" -WindowStyle Hidden`,
    "",
  ].join("\n");
  writeFileSync(scriptPath, script, "utf-8");
  return { taskName, scriptPath };
}

function writeSystemdUnit(installDir: string, component: InstallComponent) {
  const serviceName = systemdServiceNameFor(component);
  const servicePath = serviceArtifactPath(installDir, component);
  mkdirSync(resolve(homedir(), ".config", "systemd", "user"), { recursive: true });
  const nodeCommand = nodeCommandForInstall(installDir);
  const slug = componentSlug(component);
  const execStart = [nodeCommand, ...COMPONENT_START_ARGS[component]].map(shellQuote).join(" ");
  const serviceBody = [
    "[Unit]",
    `Description=OrgOps component ${component}`,
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${installDir}`,
    ...Object.entries(serviceEnvironment(installDir)).map(([key, value]) => `Environment=${key}=${value}`),
    `ExecStart=${execStart}`,
    "Restart=always",
    "RestartSec=3",
    `StandardOutput=append:${join(installDir, `.orgops-${slug}.log`)}`,
    `StandardError=append:${join(installDir, `.orgops-${slug}.err.log`)}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
  writeFileSync(servicePath, serviceBody, "utf-8");
  return { serviceName, servicePath };
}

export function registerAutostartServices(installDir: string, components: InstallComponent[]) {
  if (components.length === 0) return [] as string[];
  envWithToolchain(installDir);

  if (process.platform === "darwin") {
    const uid = String(process.getuid?.() ?? 0);
    const messages: string[] = [];
    for (const component of components) {
      const { label, plistPath } = writeMacosPlist(installDir, component);
      if (!isServiceDryRun()) {
        runBestEffort("launchctl", ["bootout", `gui/${uid}/${label}`]);
        runBestEffort("launchctl", ["bootout", `gui/${uid}`, plistPath]);
        runChecked("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
        runChecked("launchctl", ["enable", `gui/${uid}/${label}`]);
      }
      messages.push(`LaunchAgent for ${component} registered at ${plistPath}`);
    }
    return messages;
  }

  if (process.platform === "win32") {
    const messages: string[] = [];
    for (const component of components) {
      const { taskName, scriptPath } = writeWindowsScript(installDir, component);
      if (!isServiceDryRun()) {
        runSchtasksBestEffort(["/Delete", "/TN", taskName, "/F"]);
        runSchtasks([
          "/Create",
          "/SC",
          "ONLOGON",
          "/TN",
          taskName,
          "/TR",
          `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}"`,
          "/F",
        ]);
      }
      if (!isServiceDryRun() && !isTruthyEnv(process.env.ORGOPS_OPSCLI_SKIP_SERVICE_RUN)) {
        runSchtasks(["/Run", "/TN", taskName]);
      }
      messages.push(`Scheduled task ${taskName} registered with script ${scriptPath}`);
    }
    return messages;
  }

  const messages: string[] = [];
  const unitNames: string[] = [];
  for (const component of components) {
    const { serviceName, servicePath } = writeSystemdUnit(installDir, component);
    unitNames.push(serviceName);
    messages.push(`systemd user service for ${component} registered at ${servicePath}`);
  }
  if (!isServiceDryRun()) {
    runChecked("systemctl", ["--user", "daemon-reload"]);
    for (const serviceName of unitNames) {
      runChecked("systemctl", ["--user", "enable", "--now", serviceName]);
    }
  }
  return messages;
}

export type ServiceState = {
  component: InstallComponent;
  registered: boolean;
  running: boolean;
  detail: string;
};

export function controlAutostartServices(
  installDir: string,
  components: InstallComponent[],
  action: "start" | "stop" | "restart"
) {
  if (components.length === 0) return [] as string[];

  if (process.platform === "darwin") {
    const uid = String(process.getuid?.() ?? 0);
    const messages: string[] = [];
    for (const component of components) {
      const label = macosLabelFor(component);
      const plistPath = serviceArtifactPath(installDir, component);
      if (!isServiceDryRun()) {
        if (action === "stop" || action === "restart" || action === "start") {
          runBestEffort("launchctl", ["bootout", `gui/${uid}/${label}`]);
          runBestEffort("launchctl", ["bootout", `gui/${uid}`, plistPath]);
        }
        if (action === "start" || action === "restart") {
          if (!existsSync(plistPath)) {
            throw new Error(`LaunchAgent plist missing for ${component}: ${plistPath}`);
          }
          runChecked("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
          runChecked("launchctl", ["enable", `gui/${uid}/${label}`]);
        }
      }
      messages.push(`LaunchAgent ${label}: ${action}`);
    }
    return messages;
  }

  if (process.platform === "win32") {
    const messages: string[] = [];
    for (const component of components) {
      const taskName = windowsTaskNameFor(component);
      if (!isServiceDryRun()) {
        if (action === "stop" || action === "restart") runSchtasksBestEffort(["/End", "/TN", taskName]);
        if (action === "start" || action === "restart") runSchtasks(["/Run", "/TN", taskName]);
      }
      messages.push(`Scheduled task ${taskName}: ${action}`);
    }
    return messages;
  }

  const messages: string[] = [];
  for (const component of components) {
    const serviceName = systemdServiceNameFor(component);
    if (!isServiceDryRun()) runChecked("systemctl", ["--user", action, serviceName]);
    messages.push(`systemd user service ${serviceName}: ${action}`);
  }
  return messages;
}

export function getAutostartServicesStatus(components: InstallComponent[], installDir?: string): ServiceState[] {
  if (components.length === 0) return [];
  const resolvedInstallDir = installDir ?? process.cwd();

  if (process.platform === "darwin") {
    const uid = String(process.getuid?.() ?? 0);
    return components.map((component) => {
      const label = macosLabelFor(component);
      const plistPath = serviceArtifactPath(resolvedInstallDir, component);
      if (!existsSync(plistPath)) {
        return { component, registered: false, running: false, detail: "plist missing" };
      }
      if (isServiceDryRun()) {
        return { component, registered: true, running: false, detail: "plist present (dry run)" };
      }
      const result = spawnSync("launchctl", ["print", `gui/${uid}/${label}`], {
        encoding: "utf-8",
        shell: false,
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      const running = result.status === 0 && /state\s*=\s*running/i.test(output);
      return {
        component,
        registered: true,
        running,
        detail: running ? "loaded and running" : result.status === 0 ? "registered but not running" : "registered but not loaded",
      };
    });
  }

  if (process.platform === "win32") {
    return components.map((component) => {
      const taskName = windowsTaskNameFor(component);
      const scriptPath = serviceArtifactPath(resolvedInstallDir, component);
      if (isServiceDryRun()) {
        return {
          component,
          registered: existsSync(scriptPath),
          running: false,
          detail: existsSync(scriptPath) ? "launcher script present (dry run)" : "launcher script missing (dry run)",
        };
      }
      const result = spawnSync("schtasks", ["/Query", "/TN", taskName, "/FO", "LIST"], {
        encoding: "utf-8",
        shell: false,
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      return {
        component,
        registered: result.status === 0,
        running: /Status:\s+Running/i.test(output),
        detail: result.status === 0 ? output.split(/\r?\n/).find((line) => /^Status:/i.test(line)) ?? "registered" : "task missing",
      };
    });
  }

  return components.map((component) => {
    const serviceName = systemdServiceNameFor(component);
    const registered = existsSync(serviceArtifactPath(resolvedInstallDir, component));
    if (isServiceDryRun()) {
      return {
        component,
        registered,
        running: false,
        detail: registered ? "unit present (dry run)" : "unit missing (dry run)",
      };
    }
    const result = spawnSync("systemctl", ["--user", "is-active", serviceName], {
      encoding: "utf-8",
      shell: false,
    });
    return {
      component,
      registered,
      running: result.status === 0,
      detail: (result.stdout || result.stderr || (registered ? "registered" : "unit missing")).trim(),
    };
  });
}

export function unregisterAutostartServices(installDir: string, components: InstallComponent[]) {
  if (components.length === 0) return [] as string[];

  if (process.platform === "darwin") {
    const uid = String(process.getuid?.() ?? 0);
    const messages: string[] = [];
    for (const component of components) {
      const label = macosLabelFor(component);
      const plistPath = serviceArtifactPath(installDir, component);
      if (!isServiceDryRun()) {
        runBestEffort("launchctl", ["disable", `gui/${uid}/${label}`]);
        runBestEffort("launchctl", ["bootout", `gui/${uid}/${label}`]);
        runBestEffort("launchctl", ["bootout", `gui/${uid}`, plistPath]);
      }
      if (existsSync(plistPath)) unlinkSync(plistPath);
      messages.push(`LaunchAgent for ${component} removed from ${plistPath}`);
    }
    return messages;
  }

  if (process.platform === "win32") {
    const messages: string[] = [];
    for (const component of components) {
      const taskName = windowsTaskNameFor(component);
      const scriptPath = serviceArtifactPath(installDir, component);
      if (!isServiceDryRun()) {
        runSchtasksBestEffort(["/End", "/TN", taskName]);
        runSchtasksBestEffort(["/Delete", "/TN", taskName, "/F"]);
      }
      rmSync(scriptPath, { force: true });
      messages.push(`Scheduled task ${taskName} deleted`);
    }
    return messages;
  }

  const messages: string[] = [];
  for (const component of components) {
    const serviceName = systemdServiceNameFor(component);
    const servicePath = serviceArtifactPath(installDir, component);
    if (!isServiceDryRun()) runBestEffort("systemctl", ["--user", "disable", "--now", serviceName]);
    rmSync(servicePath, { force: true });
    messages.push(`systemd user service for ${component} removed`);
  }
  if (!isServiceDryRun()) runBestEffort("systemctl", ["--user", "daemon-reload"]);
  return messages;
}
