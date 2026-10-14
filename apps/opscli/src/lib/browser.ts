import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runChecked } from "./exec";

export type ShortcutTarget = "user-ui" | "admin-ui";

function isTruthyEnv(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function desktopDir() {
  if (process.platform === "win32") {
    const userProfile = process.env.USERPROFILE ?? homedir();
    const profileDesktop = join(userProfile, "Desktop");
    if (existsSync(profileDesktop)) return profileDesktop;
    const oneDriveDesktop = join(process.env.OneDrive ?? "", "Desktop");
    if (process.env.OneDrive && existsSync(oneDriveDesktop)) return oneDriveDesktop;
    return profileDesktop;
  }
  return join(homedir(), "Desktop");
}

export function openUrlInBrowser(url: string) {
  if (isTruthyEnv(process.env.ORGOPS_OPSCLI_NO_BROWSER)) {
    return;
  }
  if (process.platform === "darwin") {
    runChecked("open", [url]);
    return;
  }
  if (process.platform === "win32") {
    runChecked("cmd", ["/c", "start", "", url]);
    return;
  }
  runChecked("xdg-open", [url]);
}

export function createUserUiShortcut(url: string) {
  return createUiShortcut("user-ui", url);
}

export function createWindowsStackLauncherShortcut(options: {
  installDir: string;
  componentsCsv: string;
}) {
  if (process.platform !== "win32") {
    throw new Error("Windows stack launcher shortcut is only supported on Windows.");
  }
  const desktop = desktopDir();
  mkdirSync(desktop, { recursive: true });
  const path = join(desktop, "OrgOps Start.vbs");
  const command = [
    "npm.cmd run --workspace @orgops/opscli start --",
    `--dir "${options.installDir}"`,
    `--components ${options.componentsCsv}`,
  ].join(" ");
  const script = [
    'Set shell = CreateObject("WScript.Shell")',
    `cmd = "cmd /c ${command.replace(/"/g, '""')}"`,
    "shell.Run cmd, 0, False",
    "",
  ].join("\r\n");
  writeFileSync(path, script, "utf-8");
  return path;
}

export function createUiShortcut(target: ShortcutTarget, url: string) {
  const desktop = desktopDir();
  mkdirSync(desktop, { recursive: true });
  const title = target === "admin-ui" ? "OrgOps Admin UI" : "OrgOps User UI";

  if (process.platform === "darwin") {
    const path = join(desktop, `${title}.webloc`);
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
      '<plist version="1.0">',
      "<dict>",
      "<key>URL</key>",
      `<string>${url}</string>`,
      "</dict>",
      "</plist>",
      "",
    ].join("\n");
    writeFileSync(path, xml, "utf-8");
    return path;
  }

  if (process.platform === "win32") {
    const path = join(desktop, `${title}.url`);
    writeFileSync(path, `[InternetShortcut]\nURL=${url}\n`, "utf-8");
    return path;
  }

  const path = join(desktop, target === "admin-ui" ? "orgops-admin-ui.desktop" : "orgops-user-ui.desktop");
  const entry = [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${title}`,
    `Exec=xdg-open ${url}`,
    "Terminal=false",
    "",
  ].join("\n");
  writeFileSync(path, entry, { encoding: "utf-8", mode: 0o755 });
  return path;
}
