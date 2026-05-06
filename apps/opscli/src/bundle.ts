import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import * as tar from "tar";
import { MAX_SYSTEM_DOC_CHARS, ROOT_ENV_FILE } from "./config";
import { truncateText } from "./utils";

const BUNDLED_ROOT_DIR_NAME = "orgops";
const RUNTIME_DIR = (() => {
  try {
    return __dirname;
  } catch {
    return process.cwd();
  }
})();
const SEA_ASSET_CACHE_DIR = resolve(tmpdir(), "orgops-opscli-sea-assets");
const seaAssetFileCache = new Map<string, string>();
const runtimeRequire = (() => {
  try {
    return createRequire(resolve(process.cwd(), "__orgops_opscli_require__.cjs"));
  } catch {
    return null;
  }
})();

type SeaModule = {
  isSea: () => boolean;
  getAsset: (key: string, encoding?: string) => ArrayBuffer | string;
};

function getSeaModule(): SeaModule | null {
  try {
    if (!runtimeRequire) return null;
    const sea = runtimeRequire("node:sea") as SeaModule;
    return typeof sea.isSea === "function" && typeof sea.getAsset === "function" ? sea : null;
  } catch {
    return null;
  }
}

function getRuntimeAssetPath(fileName: string) {
  const candidates = [
    join(RUNTIME_DIR, "assets", fileName),
    resolve(process.cwd(), "apps/opscli/assets", fileName),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function loadBundledAssetText(fileName: string) {
  const sea = getSeaModule();
  if (sea?.isSea()) {
    try {
      const value = sea.getAsset(fileName, "utf8");
      if (typeof value === "string") return value;
    } catch {}
  }
  const assetPath = getRuntimeAssetPath(fileName);
  if (!existsSync(assetPath)) return "";
  return readFileSync(assetPath, "utf-8");
}

function ensureBundledAssetFile(fileName: string) {
  const fileAssetPath = getRuntimeAssetPath(fileName);
  if (existsSync(fileAssetPath)) return fileAssetPath;
  const cached = seaAssetFileCache.get(fileName);
  if (cached && existsSync(cached)) return cached;

  const sea = getSeaModule();
  if (!sea?.isSea()) return fileAssetPath;

  const raw = sea.getAsset(fileName);
  if (!(raw instanceof ArrayBuffer)) {
    throw new Error(`Bundled SEA asset ${fileName} has unexpected type.`);
  }
  mkdirSync(SEA_ASSET_CACHE_DIR, { recursive: true });
  const outPath = join(SEA_ASSET_CACHE_DIR, fileName);
  writeFileSync(outPath, Buffer.from(raw));
  seaAssetFileCache.set(fileName, outPath);
  return outPath;
}

function resolveDefaultExtractedRootPath() {
  return resolve(process.cwd(), BUNDLED_ROOT_DIR_NAME);
}

function wrapDoubleQuotes(value: string) {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function buildPm2Commands(extractedRoot: string) {
  const cwd = wrapDoubleQuotes(extractedRoot);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  return [
    `pm2 start ${npmCommand} --name orgops-api --cwd ${cwd} -- run start:api:env`,
    `pm2 start ${npmCommand} --name orgops-runner --cwd ${cwd} -- run start:runner:env`,
    `pm2 start ${npmCommand} --name orgops-ui --cwd ${cwd} -- run start:ui:preview:env`,
    `pm2 start ${npmCommand} --name orgops-site --cwd ${cwd} -- run start:site:preview:env`,
    "pm2 save",
  ];
}

export function loadBuildTimestamp() {
  try {
    const raw = loadBundledAssetText("opscli-build-info.json");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as { builtAt?: string };
    return typeof parsed.builtAt === "string" && parsed.builtAt.trim() ? parsed.builtAt : null;
  } catch {
    return null;
  }
}

export function loadBundledDocsText() {
  const docs = loadBundledAssetText("orgops-system-docs.md").trim();
  if (!docs) return "";
  return truncateText(docs, MAX_SYSTEM_DOC_CHARS).text;
}

export async function extractBundledOrgOps(options?: { force?: boolean }) {
  const archivePath = ensureBundledAssetFile("orgops-bundle.tar.gz");
  if (!existsSync(archivePath)) {
    throw new Error("Bundled OrgOps archive not found. Use a release-built opscli binary.");
  }
  const extractedRoot = resolveDefaultExtractedRootPath();
  const targetDir = process.cwd();
  mkdirSync(targetDir, { recursive: true });
  if (options?.force && existsSync(extractedRoot)) {
    rmSync(extractedRoot, { recursive: true, force: true });
  }
  if (!existsSync(extractedRoot)) {
    await tar.x({ file: archivePath, cwd: targetDir });
  }

  return {
    extractedRoot,
    envPath: join(extractedRoot, ROOT_ENV_FILE),
    pm2Commands: buildPm2Commands(extractedRoot),
  };
}
