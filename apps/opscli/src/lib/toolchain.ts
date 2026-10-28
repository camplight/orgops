import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import * as tar from "tar";
import { ROOT_ENV_FILE } from "./config";
import { parseSimpleEnv, writeMergedEnvFile } from "./env";
import { isTruthyEnv } from "./env-flag";
import { npmCommandForHost, runChecked } from "./exec";

const DEFAULT_NODE_VERSION = "22.20.0";
const TOOLCHAIN_FILE = ".opscli-toolchain.json";

export type ManagedToolchain = {
  mode: "managed" | "system";
  nodeVersion: string;
  nodePath: string;
  npmPath: string;
  rootDir?: string;
};

function archForNode() {
  if (process.arch === "x64") return "x64";
  if (process.arch === "arm64") return "arm64";
  throw new Error(`Unsupported CPU architecture for managed Node toolchain: ${process.arch}`);
}

function platformForNode() {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  if (process.platform === "win32") return "win";
  throw new Error(`Unsupported platform for managed Node toolchain: ${process.platform}`);
}

function nodeArchiveName(version: string) {
  const platform = platformForNode();
  const arch = archForNode();
  const ext = platform === "win" ? "zip" : "tar.gz";
  return `node-v${version}-${platform}-${arch}.${ext}`;
}

function managedRoot(version: string) {
  return resolve(
    process.env.ORGOPS_OPSCLI_TOOLCHAIN_DIR ?? join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".orgops", "toolchains"),
    `node-v${version}-${platformForNode()}-${archForNode()}`
  );
}

function managedNodePath(rootDir: string) {
  return process.platform === "win32" ? join(rootDir, "node.exe") : join(rootDir, "bin", "node");
}

function managedNpmPath(rootDir: string) {
  return process.platform === "win32" ? join(rootDir, "npm.cmd") : join(rootDir, "bin", "npm");
}

function downloadFile(url: string, outputPath: string) {
  return new Promise<void>((resolveDone, reject) => {
    const request = get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, outputPath).then(resolveDone, reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`download failed for ${url}: HTTP ${response.statusCode}`));
        response.resume();
        return;
      }
      const file = createWriteStream(outputPath);
      response.pipe(file);
      file.on("finish", () => file.close(() => resolveDone()));
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

async function installManagedNode(version: string) {
  const rootDir = managedRoot(version);
  const nodePath = managedNodePath(rootDir);
  const npmPath = managedNpmPath(rootDir);
  if (existsSync(nodePath) && existsSync(npmPath)) {
    return { rootDir, nodePath, npmPath };
  }

  const archiveName = nodeArchiveName(version);
  const archiveUrl = `https://nodejs.org/dist/v${version}/${archiveName}`;
  const tmpRoot = resolve(rootDir, "..", ".downloads");
  mkdirSync(tmpRoot, { recursive: true });
  const archivePath = resolve(tmpRoot, archiveName);
  await downloadFile(archiveUrl, archivePath);

  rmSync(rootDir, { recursive: true, force: true });
  mkdirSync(rootDir, { recursive: true });
  if (archiveName.endsWith(".zip")) {
    const extractParent = resolve(rootDir, "..", `.extract-${basename(rootDir)}`);
    rmSync(extractParent, { recursive: true, force: true });
    mkdirSync(extractParent, { recursive: true });
    runChecked("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractParent.replace(/'/g, "''")}' -Force`,
    ]);
    const extracted = resolve(extractParent, archiveName.replace(/\.zip$/, ""));
    rmSync(rootDir, { recursive: true, force: true });
    runChecked("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Move-Item -Path '${extracted.replace(/'/g, "''")}' -Destination '${rootDir.replace(/'/g, "''")}' -Force`,
    ]);
    rmSync(extractParent, { recursive: true, force: true });
  } else {
    await tar.x({ file: archivePath, cwd: rootDir, strip: 1 });
  }

  if (!existsSync(nodePath) || !existsSync(npmPath)) {
    throw new Error(`Managed Node toolchain install did not produce node/npm under ${rootDir}`);
  }
  return { rootDir, nodePath, npmPath };
}

export function toolchainPath(installDir: string) {
  return resolve(installDir, TOOLCHAIN_FILE);
}

export function readInstallToolchain(installDir: string): ManagedToolchain | null {
  const path = toolchainPath(installDir);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ManagedToolchain;
    if (parsed?.nodePath && parsed?.npmPath) return parsed;
  } catch {
    return null;
  }
  return null;
}

export function npmCommandForInstall(installDir: string) {
  return readInstallToolchain(installDir)?.npmPath ?? npmCommandForHost();
}

export function nodeCommandForInstall(installDir: string) {
  return readInstallToolchain(installDir)?.nodePath ?? "node";
}

export function toolchainBinDir(toolchain: ManagedToolchain) {
  if (toolchain.rootDir) {
    return process.platform === "win32" ? toolchain.rootDir : join(toolchain.rootDir, "bin");
  }
  if (toolchain.nodePath && toolchain.nodePath !== "node") {
    return dirname(toolchain.nodePath);
  }
  return "";
}

export function servicePathValue(installDir: string) {
  const toolchain = readInstallToolchain(installDir);
  const parts: string[] = [];
  const bin = toolchain ? toolchainBinDir(toolchain) : "";
  if (bin) parts.push(bin);
  if (process.platform === "win32") {
    if (process.env.SystemRoot) parts.push(join(process.env.SystemRoot, "System32"));
    if (process.env.Path) parts.push(process.env.Path);
    if (process.env.PATH) parts.push(process.env.PATH);
  } else {
    parts.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin");
    if (process.env.PATH) parts.push(process.env.PATH);
  }
  return [...new Set(parts.filter(Boolean))].join(delimiter);
}

export function envWithToolchain(installDir: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const toolchain = readInstallToolchain(installDir);
  const pathValue = servicePathValue(installDir);
  const next: NodeJS.ProcessEnv = { ...base, PATH: pathValue };
  if (process.platform === "win32") next.Path = pathValue;
  if (toolchain?.nodePath) next.ORGOPS_OPSCLI_NODE_PATH = toolchain.nodePath;
  if (toolchain?.npmPath) next.ORGOPS_OPSCLI_NPM_PATH = toolchain.npmPath;
  return next;
}

export function writeInstallToolchain(installDir: string, toolchain: ManagedToolchain) {
  writeFileSync(toolchainPath(installDir), `${JSON.stringify(toolchain, null, 2)}\n`, "utf-8");
  writeMergedEnvFile(resolve(installDir, ROOT_ENV_FILE), {
    ORGOPS_OPSCLI_NODE_PATH: toolchain.nodePath,
    ORGOPS_OPSCLI_NPM_PATH: toolchain.npmPath,
  });
}

export async function ensureManagedToolchain(installDir: string): Promise<ManagedToolchain> {
  const forcedNodeDir = process.env.ORGOPS_OPSCLI_TOOLCHAIN_NODE_DIR?.trim();
  if (forcedNodeDir) {
    const rootDir = resolve(forcedNodeDir);
    const toolchain = {
      mode: "managed" as const,
      nodeVersion: process.env.ORGOPS_OPSCLI_NODE_VERSION ?? DEFAULT_NODE_VERSION,
      rootDir,
      nodePath: managedNodePath(rootDir),
      npmPath: managedNpmPath(rootDir),
    };
    writeInstallToolchain(installDir, toolchain);
    return toolchain;
  }

  if (isTruthyEnv(process.env.ORGOPS_OPSCLI_USE_SYSTEM_TOOLCHAIN)) {
    const toolchain = {
      mode: "system" as const,
      nodeVersion: process.version.replace(/^v/, ""),
      nodePath: "node",
      npmPath: npmCommandForHost(),
    };
    writeInstallToolchain(installDir, toolchain);
    return toolchain;
  }

  const version = process.env.ORGOPS_OPSCLI_NODE_VERSION ?? DEFAULT_NODE_VERSION;
  const installed = await installManagedNode(version);
  const toolchain = {
    mode: "managed" as const,
    nodeVersion: version,
    rootDir: installed.rootDir,
    nodePath: installed.nodePath,
    npmPath: installed.npmPath,
  };
  writeInstallToolchain(installDir, toolchain);
  return toolchain;
}

export function loadToolchainEnvIntoProcess(installDir: string) {
  const envPath = resolve(installDir, ROOT_ENV_FILE);
  if (!existsSync(envPath)) return;
  const env = parseSimpleEnv(readFileSync(envPath, "utf-8"));
  if (env.ORGOPS_OPSCLI_NODE_PATH) process.env.ORGOPS_OPSCLI_NODE_PATH = env.ORGOPS_OPSCLI_NODE_PATH;
  if (env.ORGOPS_OPSCLI_NPM_PATH) process.env.ORGOPS_OPSCLI_NPM_PATH = env.ORGOPS_OPSCLI_NPM_PATH;
}
