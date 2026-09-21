import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runChecked } from "./exec";

function isTruthyEnv(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function desktopDir() {
  if (process.platform === "win32") {
    const userProfile = process.env.USERPROFILE ?? homedir();
    return join(userProfile, "Desktop");
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
  const desktop = desktopDir();
  mkdirSync(desktop, { recursive: true });

  if (process.platform === "darwin") {
    const path = join(desktop, "OrgOps User UI.webloc");
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
    const path = join(desktop, "OrgOps User UI.url");
    writeFileSync(path, `[InternetShortcut]\nURL=${url}\n`, "utf-8");
    return path;
  }

  const path = join(desktop, "orgops-user-ui.desktop");
  const entry = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=OrgOps User UI",
    `Exec=xdg-open ${url}`,
    "Terminal=false",
    "",
  ].join("\n");
  writeFileSync(path, entry, { encoding: "utf-8", mode: 0o755 });
  return path;
}
