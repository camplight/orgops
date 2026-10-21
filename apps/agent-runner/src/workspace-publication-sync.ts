import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { extname, join, relative, resolve, sep } from "node:path";
import type { Agent } from "./types";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

type WorkspacePublicationSyncDeps = {
  apiFetch: ApiFetch;
  getRunnerId: () => string | null;
  intervalMs: number;
};

type SyncPublication = {
  id: string;
  agentName: string;
  slug: string;
  sourcePath: string;
  updatedAt?: number;
};

type ManifestFile = {
  path: string;
  sha256: string;
  size: number;
  mime?: string;
};

const MAX_BLOB_BYTES = 50 * 1024 * 1024;
const IGNORED_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".env",
  ".env.local",
  ".env.production",
  ".DS_Store",
  "node_modules",
]);

const MIME_BY_EXTENSION = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".pdf", "application/pdf"],
]);

function toPosixPath(pathValue: string) {
  return pathValue.split(sep).join("/");
}

function isWithinDirectory(targetPath: string, basePath: string) {
  if (targetPath === basePath) return true;
  return targetPath.startsWith(`${basePath}${sep}`);
}

function contentTypeForPath(pathValue: string) {
  return MIME_BY_EXTENSION.get(extname(pathValue).toLowerCase()) ?? "application/octet-stream";
}

function hashBytes(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashManifest(files: ManifestFile[]) {
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

function shouldIgnore(name: string) {
  if (IGNORED_NAMES.has(name)) return true;
  return name.startsWith(".") && name !== ".well-known";
}

function normalizeSourcePath(sourcePath: string) {
  let value = sourcePath.trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!value || value === ".") return ".";
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) return null;
  if (value.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return value;
}

function resolveSourceRoot(agent: Agent, sourcePath: string) {
  const normalizedSourcePath = normalizeSourcePath(sourcePath);
  if (!normalizedSourcePath) return null;
  const workspacePath = agent.workspacePath.startsWith("/")
    ? agent.workspacePath
    : resolve(agent.workspacePath);
  const sourceRoot = resolve(workspacePath, normalizedSourcePath);
  if (!isWithinDirectory(sourceRoot, workspacePath)) return null;
  return sourceRoot;
}

function scanPublicationFiles(agent: Agent, publication: SyncPublication): ManifestFile[] {
  const sourceRoot = resolveSourceRoot(agent, publication.sourcePath);
  if (!sourceRoot) return [];
  const root = sourceRoot;
  if (!existsSync(root)) return [];
  const sourceReal = realpathSync(root);
  const files: ManifestFile[] = [];

  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (shouldIgnore(entry.name)) continue;
      const absolutePath = join(dir, entry.name);
      const relativePath = toPosixPath(relative(root, absolutePath));
      const entryStat = lstatSync(absolutePath);
      if (entryStat.isSymbolicLink()) {
        const realTarget = realpathSync(absolutePath);
        if (!isWithinDirectory(realTarget, sourceReal)) continue;
      }
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = statSync(absolutePath);
      if (stat.size > MAX_BLOB_BYTES) continue;
      const bytes = readFileSync(absolutePath);
      files.push({
        path: relativePath,
        sha256: hashBytes(bytes),
        size: bytes.byteLength,
        mime: contentTypeForPath(absolutePath),
      });
    }
  }

  visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function createWorkspacePublicationSync(deps: WorkspacePublicationSyncDeps) {
  const lastSyncAtByPublication = new Map<string, number>();
  const lastManifestHashByPublication = new Map<string, string>();
  let inFlight = false;

  async function syncOne(agent: Agent, publication: SyncPublication) {
    const files = scanPublicationFiles(agent, publication);
    const manifestHash = hashManifest(files);
    if (lastManifestHashByPublication.get(publication.id) === manifestHash) return;

    const missingResponse = await deps.apiFetch(
      `/api/workspace-publications/${encodeURIComponent(publication.id)}/blobs/missing`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files }),
      },
    );
    const missingPayload = await readJson<{ missing?: string[] }>(missingResponse);
    const missing = new Set(missingPayload.missing ?? []);
    const sourceRoot = resolveSourceRoot(agent, publication.sourcePath);
    if (!sourceRoot) throw new Error("Publication sourcePath is outside the workspace.");
    for (const file of files) {
      if (!missing.has(file.sha256)) continue;
      const bytes = readFileSync(join(sourceRoot, file.path));
      await deps.apiFetch(
        `/api/workspace-publications/${encodeURIComponent(publication.id)}/blobs/${file.sha256}`,
        {
          method: "PUT",
          body: bytes,
        },
      );
    }

    await deps.apiFetch(`/api/workspace-publications/${encodeURIComponent(publication.id)}/revisions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orgops-agent-name": agent.name,
      },
      body: JSON.stringify({ files, createdByAgentName: agent.name }),
    });
    lastManifestHashByPublication.set(publication.id, manifestHash);
  }

  async function sync(agents: Agent[]) {
    const runnerId = deps.getRunnerId();
    if (!runnerId || inFlight) return;
    const now = Date.now();
    const agentByName = new Map(agents.map((agent) => [agent.name, agent]));
    inFlight = true;
    try {
      const response = await deps.apiFetch(
        `/api/workspace-publications/sync?runnerId=${encodeURIComponent(runnerId)}`,
      );
      const payload = await readJson<{ publications?: SyncPublication[] }>(response);
      for (const publication of payload.publications ?? []) {
        const previous = lastSyncAtByPublication.get(publication.id) ?? 0;
        if (now - previous < deps.intervalMs) continue;
        lastSyncAtByPublication.set(publication.id, now);
        const agent = agentByName.get(publication.agentName);
        if (!agent) continue;
        try {
          await syncOne(agent, publication);
        } catch (error) {
          await deps.apiFetch(
            `/api/workspace-publications/${encodeURIComponent(publication.id)}/sync-error`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            },
          ).catch(() => undefined);
          console.error("workspace_publication.sync_failed", {
            publicationId: publication.id,
            agentName: publication.agentName,
            slug: publication.slug,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      inFlight = false;
    }
  }

  return { sync };
}
