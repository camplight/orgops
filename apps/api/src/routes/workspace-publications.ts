import type { Hono } from "hono";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";

import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import type { AccessControl, RequestUser } from "./access";

type WorkspacePublicationDeps = {
  orm: OrgOpsDrizzleDb;
  DATA_DIR: string;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  requireAuth: (c: any, next: any) => unknown;
  requireRunnerAuth: (c: any, next: any) => unknown;
  resolveWorkspacePath: (workspacePath: string) => string;
  access: AccessControl;
  hashPassword: (password: string) => string;
  verifyPassword: (password: string, hashed: string) => boolean;
  insertEvent: (input: any) => any;
};

type PublicationRow = typeof schema.workspacePublications.$inferSelect;
type RevisionRow = typeof schema.workspacePublicationRevisions.$inferSelect;

type ManifestFile = {
  path: string;
  sha256: string;
  size: number;
  mime?: string;
};

type Manifest = {
  files: ManifestFile[];
};

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const AUTH_TYPES = new Set(["PUBLIC", "PASSWORD"]);
const MAX_BLOB_BYTES = 50 * 1024 * 1024;
const RESERVED_PUBLIC_PATH_PREFIXES = ["/api/", "/ws/", "/admin/", "/health/"];

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

function isRunnerUser(user: RequestUser | undefined) {
  return user?.username === "runner";
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function contentTypeForPath(pathValue: string, fallback?: string) {
  if (fallback?.trim()) return fallback;
  return MIME_BY_EXTENSION.get(extname(pathValue).toLowerCase()) ?? "application/octet-stream";
}

function toPosixPath(pathValue: string) {
  return pathValue.split(sep).join("/");
}

function isWithinDirectory(targetPath: string, basePath: string) {
  if (targetPath === basePath) return true;
  return targetPath.startsWith(`${basePath}${sep}`);
}

function normalizeRequestPath(raw: string | undefined) {
  const value = (raw ?? "").replace(/^\/+/, "");
  if (!value || value === ".") return "index.html";
  if (value.includes("\0") || value.includes("\\")) return null;
  const parts = value.split("/");
  if (parts.some((part) => part === "..")) return null;
  return parts.filter(Boolean).join("/");
}

function normalizeSourcePath(raw: unknown): string | null {
  let value = typeof raw === "string" ? raw.trim() : "";
  value = value.replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!value || value === ".") return null;
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) return null;
  if (value.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return value;
}

function normalizePublicPath(raw: unknown): string | null {
  let value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  if (!value.startsWith("/")) value = `/${value}`;
  value = value.replace(/\/+/g, "/");
  if (!value.endsWith("/")) value = `${value}/`;
  if (value === "/") return null;
  if (value.includes("\\") || value.includes("\0")) return null;
  if (value.split("/").some((part) => part === ".." || part === ".")) return null;
  const lowered = value.toLowerCase();
  if (RESERVED_PUBLIC_PATH_PREFIXES.some((prefix) => lowered === prefix || lowered.startsWith(prefix))) {
    return null;
  }
  return value;
}

function defaultPublicPath(agentName: string) {
  return normalizePublicPath(`/agents/${agentName}/site/`) ?? `/agents/${encodeURIComponent(agentName)}/site/`;
}

function slugFromPublicPath(publicPath: string) {
  const segments = publicPath.split("/").filter(Boolean);
  const raw = segments[segments.length - 1] ?? "site";
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return validateSlug(slug) ? slug : "site";
}

function validateSlug(slug: string) {
  return SLUG_PATTERN.test(slug);
}

function validateManifestFile(input: unknown): ManifestFile | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const pathValue = typeof record.path === "string" ? record.path.trim() : "";
  const sha256 = typeof record.sha256 === "string" ? record.sha256.trim().toLowerCase() : "";
  const size = typeof record.size === "number" ? record.size : Number(record.size);
  if (!pathValue || pathValue.startsWith("/") || pathValue.includes("\\") || pathValue.includes("\0")) {
    return null;
  }
  if (pathValue.split("/").some((part) => !part || part === "." || part === "..")) {
    return null;
  }
  if (!SHA256_PATTERN.test(sha256)) return null;
  if (!Number.isFinite(size) || size < 0 || size > MAX_BLOB_BYTES) return null;
  const mime = typeof record.mime === "string" ? record.mime.trim().slice(0, 200) : undefined;
  return { path: pathValue, sha256, size: Math.floor(size), ...(mime ? { mime } : {}) };
}

function parseManifestFiles(input: unknown): ManifestFile[] | null {
  if (!Array.isArray(input)) return null;
  const parsed = input.map(validateManifestFile);
  if (parsed.some((item) => item === null)) return null;
  const byPath = new Map<string, ManifestFile>();
  for (const file of parsed as ManifestFile[]) byPath.set(file.path, file);
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function serializePublication(row: PublicationRow, origin: string) {
  return {
    id: row.id,
    agentName: row.agent_name,
    slug: row.slug,
    title: row.title ?? null,
    publicPath: row.public_path,
    sourcePath: row.source_path,
    enabled: Boolean(row.enabled),
    authType: row.auth_type,
    hasPassword: Boolean(row.password_hash),
    syncMode: row.sync_mode,
    activeRevisionId: row.active_revision_id ?? null,
    createdByType: row.created_by_type,
    createdById: row.created_by_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastPublishedAt: row.last_published_at ?? null,
    lastError: row.last_error ?? null,
    publicUrl: `${origin}${row.public_path}`,
  };
}

function resolveActor(c: any) {
  const user = (c as any).get("user") as RequestUser | undefined;
  if (isRunnerUser(user)) {
    const agentName = c.req.header("x-orgops-agent-name")?.trim();
    return agentName
      ? { type: "AGENT", id: agentName }
      : { type: "RUNNER", id: user?.runnerScope?.tokenId ?? null };
  }
  return { type: "HUMAN", id: user?.id ?? user?.username ?? null };
}

function resolveWorkspaceForAgent(
  orm: OrgOpsDrizzleDb,
  resolveWorkspacePath: (workspacePath: string) => string,
  agentName: string,
) {
  const row = orm
    .select({
      workspacePath: schema.agents.workspace_path,
      assignedRunnerId: schema.agents.assigned_runner_id,
    })
    .from(schema.agents)
    .where(eq(schema.agents.name, agentName))
    .get() as { workspacePath: string; assignedRunnerId: string | null } | undefined;
  if (!row) return null;
  return {
    workspacePath: resolveWorkspacePath(row.workspacePath),
    assignedRunnerId: row.assignedRunnerId ?? null,
  };
}

function resolveAutoSyncMode(orm: OrgOpsDrizzleDb, agentName: string) {
  const row = orm
    .select({
      assignedRunnerId: schema.agents.assigned_runner_id,
    })
    .from(schema.agents)
    .where(eq(schema.agents.name, agentName))
    .get() as { assignedRunnerId: string | null } | undefined;
  if (!row?.assignedRunnerId) return "SNAPSHOT";
  const runner = orm
    .select({ hostname: schema.runnerNodes.hostname })
    .from(schema.runnerNodes)
    .where(eq(schema.runnerNodes.id, row.assignedRunnerId))
    .get() as { hostname: string | null } | undefined;
  return runner?.hostname && runner.hostname === hostname() ? "DIRECT_LOCAL" : "SNAPSHOT";
}

function resolveSafeLocalTarget(workspacePath: string, sourcePath: string, requestPath: string) {
  try {
    const basePath = resolve(workspacePath, sourcePath);
    const targetPath = resolve(basePath, requestPath);
    if (!isWithinDirectory(targetPath, basePath)) return null;
    if (!existsSync(targetPath)) return null;
    const workspaceReal = realpathSync(workspacePath);
    const baseReal = realpathSync(basePath);
    if (!isWithinDirectory(baseReal, workspaceReal)) return null;
    const targetReal = realpathSync(targetPath);
    if (!isWithinDirectory(targetReal, baseReal)) return null;
    return targetReal;
  } catch {
    return null;
  }
}

function blobStoragePath(blobsDir: string, sha256: string) {
  return join(blobsDir, sha256.slice(0, 2), sha256);
}

function timingSafePasswordFromBasicAuth(
  header: string | undefined,
): string | null {
  const value = header?.trim() ?? "";
  if (!value.toLowerCase().startsWith("basic ")) return null;
  try {
    const decoded = Buffer.from(value.slice(6), "base64").toString("utf-8");
    const colon = decoded.indexOf(":");
    return colon >= 0 ? decoded.slice(colon + 1) : decoded;
  } catch {
    return null;
  }
}

function publicationAuthCookieName(publicationId: string) {
  return `orgops_pub_${publicationId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function publicationAuthCookieValue(publication: PublicationRow) {
  return createHash("sha256")
    .update(`${publication.id}:${publication.password_hash ?? ""}`)
    .digest("hex");
}

function hasPublicationAuthCookie(c: any, publication: PublicationRow) {
  const cookieHeader = String(c.req.header("cookie") ?? "");
  const expectedName = publicationAuthCookieName(publication.id);
  const expectedValue = publicationAuthCookieValue(publication);
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .some((part) => part === `${expectedName}=${expectedValue}`);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function passwordPage(publication: PublicationRow, failed = false) {
  const title = escapeHtml(publication.title ?? `${publication.agent_name}/${publication.slug}`);
  return new Response(
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Protected publication</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #020617; color: #e2e8f0; display: grid; min-height: 100vh; place-items: center; margin: 0; }
      form { width: min(420px, calc(100vw - 32px)); border: 1px solid #1e293b; border-radius: 12px; background: #0f172a; padding: 24px; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
      h1 { font-size: 18px; margin: 0 0 8px; }
      p { color: #94a3b8; margin: 0 0 16px; font-size: 14px; }
      input { box-sizing: border-box; width: 100%; border: 1px solid #334155; border-radius: 8px; background: #020617; color: #e2e8f0; padding: 10px 12px; font-size: 14px; }
      button { margin-top: 12px; width: 100%; border: 0; border-radius: 8px; background: #2563eb; color: white; padding: 10px 12px; font-weight: 600; cursor: pointer; }
      .error { color: #fca5a5; margin-bottom: 12px; }
    </style>
  </head>
  <body>
    <form method="post">
      <h1>${title}</h1>
      <p>This published folder is password protected.</p>
      ${failed ? `<div class="error">Incorrect password.</div>` : ""}
      <input name="password" type="password" autocomplete="current-password" autofocus placeholder="Password" />
      <button type="submit">Open publication</button>
    </form>
  </body>
</html>`,
    {
      status: failed ? 401 : 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
}

export function registerWorkspacePublicationRoutes(
  app: Hono<any>,
  deps: WorkspacePublicationDeps,
) {
  const {
    orm,
    DATA_DIR,
    jsonResponse,
    requireAuth,
    requireRunnerAuth,
    resolveWorkspacePath,
    access,
    hashPassword,
    verifyPassword,
    insertEvent,
  } = deps;
  const blobsDir = join(DATA_DIR, "publication-blobs");
  mkdirSync(blobsDir, { recursive: true });

  function getPublication(agentName: string, slug: string) {
    return orm
      .select()
      .from(schema.workspacePublications)
      .where(
        and(
          eq(schema.workspacePublications.agent_name, agentName),
          eq(schema.workspacePublications.slug, slug),
        ),
      )
      .get() as PublicationRow | undefined;
  }

  function makeUniqueSlug(agentName: string, baseSlug: string, existingId?: string) {
    let candidate = baseSlug;
    for (let index = 2; index < 1000; index += 1) {
      const existing = getPublication(agentName, candidate);
      if (!existing || existing.id === existingId) return candidate;
      candidate = `${baseSlug}-${index}`;
    }
    return `${baseSlug}-${Date.now()}`;
  }

  function findPublicationForPath(pathname: string) {
    const normalizedPath = pathname.endsWith("/") ? pathname : `${pathname}/`;
    const rows = orm
      .select()
      .from(schema.workspacePublications)
      .where(eq(schema.workspacePublications.enabled, 1))
      .all() as PublicationRow[];
    const matches = rows
      .filter((row) => normalizedPath === row.public_path || normalizedPath.startsWith(row.public_path))
      .sort((left, right) => right.public_path.length - left.public_path.length);
    const publication = matches[0];
    if (!publication) return null;
    const requestPath =
      pathname === publication.public_path.replace(/\/+$/, "")
        ? ""
        : pathname.slice(publication.public_path.length);
    return { publication, requestPath };
  }

  function emitAudit(type: string, publication: PublicationRow, actor: { type: string; id: string | null }) {
    insertEvent({
      type,
      source: `system:api`,
      status: "DELIVERED",
      payload: {
        publicationId: publication.id,
        agentName: publication.agent_name,
        slug: publication.slug,
        actor,
      },
    });
  }

  async function servePublication(c: any, publication: PublicationRow | undefined, wildcardPath?: string) {
    if (!publication || !publication.enabled) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    if (publication.auth_type === "PASSWORD") {
      const password = timingSafePasswordFromBasicAuth(c.req.header("authorization"));
      const basicAuthOk =
        Boolean(password && publication.password_hash && verifyPassword(password, publication.password_hash));
      if (!basicAuthOk && !hasPublicationAuthCookie(c, publication)) {
        return passwordPage(publication);
      }
    }

    const requestPath = normalizeRequestPath(wildcardPath);
    if (!requestPath) return jsonResponse(c, { error: "Invalid path" }, 400);

    if (publication.sync_mode === "DIRECT_LOCAL") {
      const workspace = resolveWorkspaceForAgent(orm, resolveWorkspacePath, publication.agent_name);
      if (!workspace) return jsonResponse(c, { error: "Not found" }, 404);
      let target = resolveSafeLocalTarget(workspace.workspacePath, publication.source_path, requestPath);
      const targetStat = target ? statSync(target, { throwIfNoEntry: false }) : null;
      if (targetStat?.isDirectory()) {
        target = resolveSafeLocalTarget(workspace.workspacePath, publication.source_path, `${requestPath}/index.html`);
      }
      const stat = target ? statSync(target, { throwIfNoEntry: false }) : null;
      if (!target || !stat?.isFile()) return jsonResponse(c, { error: "Not found" }, 404);
      return new Response(readFileSync(target), {
        headers: {
          "content-type": contentTypeForPath(target),
          "cache-control": "no-cache",
        },
      });
    }

    if (!publication.active_revision_id) {
      return jsonResponse(c, { error: "Publication is not synced yet" }, 404);
    }
    const revision = orm
      .select()
      .from(schema.workspacePublicationRevisions)
      .where(eq(schema.workspacePublicationRevisions.id, publication.active_revision_id))
      .get() as RevisionRow | undefined;
    if (!revision) return jsonResponse(c, { error: "Publication is not synced yet" }, 404);
    const manifest = parseJson<Manifest>(revision.manifest_json, { files: [] });
    const requested =
      manifest.files.find((file) => file.path === requestPath) ??
      manifest.files.find((file) => file.path === `${requestPath.replace(/\/+$/, "")}/index.html`);
    if (!requested) return jsonResponse(c, { error: "Not found" }, 404);
    const blob = orm
      .select()
      .from(schema.workspacePublicationBlobs)
      .where(eq(schema.workspacePublicationBlobs.sha256, requested.sha256))
      .get() as typeof schema.workspacePublicationBlobs.$inferSelect | undefined;
    if (!blob || !existsSync(blob.storage_path)) {
      return jsonResponse(c, { error: "Published file is missing" }, 500);
    }
    return new Response(readFileSync(blob.storage_path), {
      headers: {
        "content-type": contentTypeForPath(requested.path, requested.mime),
        "cache-control": "no-cache",
      },
    });
  }

  function publicationForLegacyAgentsPath(c: any, wildcardPath?: string) {
    const pathname = new URL(c.req.url).pathname;
    const pathMatch = findPublicationForPath(pathname);
    if (pathMatch) return pathMatch;
    return {
      publication: getPublication(c.req.param("name"), c.req.param("slug")),
      requestPath: wildcardPath,
    };
  }

  app.get("/agents/:name/:slug", (c) => {
    const match = publicationForLegacyAgentsPath(c);
    return servePublication(c, match.publication, match.requestPath);
  });
  app.get("/agents/:name/:slug/*", (c) => {
    const match = publicationForLegacyAgentsPath(c, c.req.param("*"));
    return servePublication(c, match.publication, match.requestPath);
  });
  app.get("*", (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    if (
      pathname === "/health" ||
      pathname.startsWith("/api/") ||
      pathname.startsWith("/ws/") ||
      pathname.startsWith("/admin/")
    ) {
      return next();
    }
    const match = findPublicationForPath(pathname);
    if (!match) return next();
    return servePublication(c, match.publication, match.requestPath);
  });

  async function handlePublicationPasswordPost(c: any, next: any) {
    const pathname = new URL(c.req.url).pathname;
    if (
      pathname === "/health" ||
      pathname.startsWith("/api/") ||
      pathname.startsWith("/ws/") ||
      pathname.startsWith("/admin/")
    ) {
      return next();
    }
    const match = findPublicationForPath(pathname);
    if (!match) return next();
    const publication = match.publication;
    if (publication.auth_type !== "PASSWORD" || !publication.password_hash) {
      return next();
    }
    const bodyText = await c.req.text();
    const password = new URLSearchParams(bodyText).get("password") ?? "";
    if (!verifyPassword(password, publication.password_hash)) {
      return passwordPage(publication, true);
    }
    const cookieName = publicationAuthCookieName(publication.id);
    const cookieValue = publicationAuthCookieValue(publication);
    return new Response(null, {
      status: 303,
      headers: {
        location: pathname,
        "set-cookie": `${cookieName}=${cookieValue}; Path=${publication.public_path}; HttpOnly; SameSite=Lax`,
      },
    });
  }

  app.post("/agents/:name/:slug", (c, next) => handlePublicationPasswordPost(c, next));
  app.post("/agents/:name/:slug/*", (c, next) => handlePublicationPasswordPost(c, next));
  app.post("*", (c, next) => handlePublicationPasswordPost(c, next));

  app.get("/api/agents/:name/publications", requireAuth as any, (c) => {
    const agentName = c.req.param("name");
    const user = (c as any).get("user") as RequestUser | undefined;
    if (!access.canViewAgent(user, agentName)) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    const origin = new URL(c.req.url).origin;
    const rows = orm
      .select()
      .from(schema.workspacePublications)
      .where(eq(schema.workspacePublications.agent_name, agentName))
      .orderBy(desc(schema.workspacePublications.updated_at))
      .all() as PublicationRow[];
    return jsonResponse(c, rows.map((row) => serializePublication(row, origin)));
  });

  app.post("/api/agents/:name/publications", requireAuth as any, async (c) => {
    const agentName = c.req.param("name");
    const user = (c as any).get("user") as RequestUser | undefined;
    if (!access.canManageAgent(user, agentName)) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const publicPath = normalizePublicPath(body.publicPath ?? defaultPublicPath(agentName));
    if (!publicPath) {
      return jsonResponse(c, { error: "publicPath must be an absolute non-reserved URL path." }, 400);
    }
    const requestedSlug = String(body.slug ?? slugFromPublicPath(publicPath)).trim().toLowerCase();
    const slug = makeUniqueSlug(agentName, requestedSlug);
    if (!validateSlug(slug)) {
      return jsonResponse(c, { error: "Slug must be lowercase letters, numbers, or dashes." }, 400);
    }
    const sourcePath = normalizeSourcePath(body.sourcePath);
    if (!sourcePath) {
      return jsonResponse(c, { error: "sourcePath must be a relative folder inside the workspace." }, 400);
    }
    const authType = String(body.authType ?? "PUBLIC").toUpperCase();
    if (!AUTH_TYPES.has(authType)) return jsonResponse(c, { error: "Invalid authType" }, 400);
    const syncMode = resolveAutoSyncMode(orm, agentName);
    const password = typeof body.password === "string" ? body.password : "";
    if (authType === "PASSWORD" && !password.trim()) {
      return jsonResponse(c, { error: "Password is required for password-protected publications." }, 400);
    }
    const actor = resolveActor(c);
    const now = Date.now();
    const row: PublicationRow = {
      id: randomUUID(),
      agent_name: agentName,
      slug,
      title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : null,
      public_path: publicPath,
      source_path: sourcePath,
      enabled: body.enabled === false ? 0 : 1,
      auth_type: authType,
      password_hash: authType === "PASSWORD" ? hashPassword(password) : null,
      sync_mode: syncMode,
      active_revision_id: null,
      created_by_type: actor.type,
      created_by_id: actor.id,
      created_at: now,
      updated_at: now,
      last_published_at: null,
      last_error: null,
    };
    try {
      orm.insert(schema.workspacePublications).values(row).run();
    } catch (error) {
      if (String(error).includes("SQLITE_CONSTRAINT")) {
        return jsonResponse(c, { error: "Publication slug already exists for this agent." }, 409);
      }
      throw error;
    }
    emitAudit("audit.workspace_publication.created", row, actor);
    return jsonResponse(c, serializePublication(row, new URL(c.req.url).origin), 201);
  });

  app.patch("/api/workspace-publications/:id", requireAuth as any, async (c) => {
    const id = c.req.param("id");
    const existing = orm
      .select()
      .from(schema.workspacePublications)
      .where(eq(schema.workspacePublications.id, id))
      .get() as PublicationRow | undefined;
    if (!existing) return jsonResponse(c, { error: "Not found" }, 404);
    const user = (c as any).get("user") as RequestUser | undefined;
    if (!access.canManageAgent(user, existing.agent_name)) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Partial<typeof schema.workspacePublications.$inferInsert> = {
      updated_at: Date.now(),
      last_error: null,
    };
    if (body.slug !== undefined) {
      const slug = String(body.slug ?? "").trim().toLowerCase();
      if (!validateSlug(slug)) return jsonResponse(c, { error: "Invalid slug" }, 400);
      patch.slug = slug;
    }
    if (body.publicPath !== undefined) {
      const publicPath = normalizePublicPath(body.publicPath);
      if (!publicPath) {
        return jsonResponse(c, { error: "publicPath must be an absolute non-reserved URL path." }, 400);
      }
      patch.public_path = publicPath;
      if (body.slug === undefined) {
        patch.slug = makeUniqueSlug(existing.agent_name, slugFromPublicPath(publicPath), existing.id);
      }
    }
    if (body.title !== undefined) {
      patch.title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : null;
    }
    if (body.sourcePath !== undefined) {
      const sourcePath = normalizeSourcePath(body.sourcePath);
      if (!sourcePath) {
        return jsonResponse(c, { error: "sourcePath must be a relative folder inside the workspace." }, 400);
      }
      patch.source_path = sourcePath;
    }
    if (body.enabled !== undefined) patch.enabled = body.enabled ? 1 : 0;
    patch.sync_mode = resolveAutoSyncMode(orm, existing.agent_name);
    if (body.authType !== undefined) {
      const authType = String(body.authType).toUpperCase();
      if (!AUTH_TYPES.has(authType)) return jsonResponse(c, { error: "Invalid authType" }, 400);
      patch.auth_type = authType;
      if (authType === "PUBLIC") patch.password_hash = null;
      if (authType === "PASSWORD" && !existing.password_hash && typeof body.password !== "string") {
        return jsonResponse(c, { error: "Password is required for password protection." }, 400);
      }
    }
    if (typeof body.password === "string" && body.password.trim()) {
      patch.password_hash = hashPassword(body.password);
      patch.auth_type = "PASSWORD";
    }
    try {
      orm
        .update(schema.workspacePublications)
        .set(patch)
        .where(eq(schema.workspacePublications.id, id))
        .run();
    } catch (error) {
      if (String(error).includes("SQLITE_CONSTRAINT")) {
        return jsonResponse(c, { error: "Publication slug already exists for this agent." }, 409);
      }
      throw error;
    }
    const updated = orm
      .select()
      .from(schema.workspacePublications)
      .where(eq(schema.workspacePublications.id, id))
      .get() as PublicationRow;
    emitAudit("audit.workspace_publication.updated", updated, resolveActor(c));
    return jsonResponse(c, serializePublication(updated, new URL(c.req.url).origin));
  });

  app.delete("/api/workspace-publications/:id", requireAuth as any, (c) => {
    const id = c.req.param("id");
    const existing = orm
      .select()
      .from(schema.workspacePublications)
      .where(eq(schema.workspacePublications.id, id))
      .get() as PublicationRow | undefined;
    if (!existing) return jsonResponse(c, { ok: true });
    const user = (c as any).get("user") as RequestUser | undefined;
    if (!access.canManageAgent(user, existing.agent_name)) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    orm.delete(schema.workspacePublications).where(eq(schema.workspacePublications.id, id)).run();
    emitAudit("audit.workspace_publication.deleted", existing, resolveActor(c));
    return jsonResponse(c, { ok: true });
  });

  app.get("/api/workspace-publications/sync", requireRunnerAuth as any, (c) => {
    const user = (c as any).get("user") as RequestUser | undefined;
    const runnerId = new URL(c.req.url).searchParams.get("runnerId")?.trim();
    if (!runnerId) return jsonResponse(c, { error: "runnerId is required" }, 400);
    if (user?.runnerScope?.mode === "SCOPED" && user.runnerScope.allowedRunnerId !== runnerId) {
      return jsonResponse(c, { error: "Forbidden" }, 403);
    }
    const assignedAgents = orm
      .select({
        name: schema.agents.name,
        workspacePath: schema.agents.workspace_path,
      })
      .from(schema.agents)
      .where(eq(schema.agents.assigned_runner_id, runnerId))
      .all();
    const agentNames = assignedAgents.map((agent) => agent.name);
    if (agentNames.length === 0) return jsonResponse(c, { publications: [] });
    const workspaceByAgent = new Map(
      assignedAgents.map((agent) => [agent.name, resolveWorkspacePath(agent.workspacePath)]),
    );
    const rows = orm
      .select()
      .from(schema.workspacePublications)
      .where(
        and(
          inArray(schema.workspacePublications.agent_name, agentNames),
          eq(schema.workspacePublications.enabled, 1),
          eq(schema.workspacePublications.sync_mode, "SNAPSHOT"),
        ),
      )
      .all() as PublicationRow[];
    const allowedRows = rows.filter((row) => access.canViewAgent(user, row.agent_name));
    return jsonResponse(c, {
      publications: allowedRows.map((row) => ({
        id: row.id,
        agentName: row.agent_name,
        slug: row.slug,
        sourcePath: row.source_path,
        workspacePath: workspaceByAgent.get(row.agent_name),
        updatedAt: row.updated_at,
        activeRevisionId: row.active_revision_id ?? null,
        lastPublishedAt: row.last_published_at ?? null,
        lastError: row.last_error ?? null,
      })),
    });
  });

  app.post("/api/workspace-publications/:id/blobs/missing", requireRunnerAuth as any, async (c) => {
    const id = c.req.param("id");
    const publication = orm
      .select()
      .from(schema.workspacePublications)
      .where(eq(schema.workspacePublications.id, id))
      .get() as PublicationRow | undefined;
    if (!publication) return jsonResponse(c, { error: "Not found" }, 404);
    const user = (c as any).get("user") as RequestUser | undefined;
    if (!access.canViewAgent(user, publication.agent_name)) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const files = parseManifestFiles(body.files);
    if (!files) return jsonResponse(c, { error: "Invalid files manifest" }, 400);
    const missing = files.filter((file) => {
      const blob = orm
        .select({ sha256: schema.workspacePublicationBlobs.sha256 })
        .from(schema.workspacePublicationBlobs)
        .where(eq(schema.workspacePublicationBlobs.sha256, file.sha256))
        .get();
      return !blob;
    });
    return jsonResponse(c, { missing: missing.map((file) => file.sha256) });
  });

  app.put("/api/workspace-publications/:id/blobs/:sha256", requireRunnerAuth as any, async (c) => {
    const id = c.req.param("id");
    const sha256 = c.req.param("sha256").toLowerCase();
    if (!SHA256_PATTERN.test(sha256)) return jsonResponse(c, { error: "Invalid sha256" }, 400);
    const publication = orm
      .select()
      .from(schema.workspacePublications)
      .where(eq(schema.workspacePublications.id, id))
      .get() as PublicationRow | undefined;
    if (!publication) return jsonResponse(c, { error: "Not found" }, 404);
    const user = (c as any).get("user") as RequestUser | undefined;
    if (!access.canViewAgent(user, publication.agent_name)) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    const bytes = Buffer.from(await c.req.arrayBuffer());
    if (bytes.byteLength > MAX_BLOB_BYTES) {
      return jsonResponse(c, { error: "Blob is too large" }, 413);
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== sha256) return jsonResponse(c, { error: "Blob hash mismatch" }, 400);
    const storagePath = blobStoragePath(blobsDir, sha256);
    mkdirSync(join(blobsDir, sha256.slice(0, 2)), { recursive: true });
    if (!existsSync(storagePath)) writeFileSync(storagePath, bytes);
    orm
      .insert(schema.workspacePublicationBlobs)
      .values({
        sha256,
        storage_path: storagePath,
        size: bytes.byteLength,
        created_at: Date.now(),
      })
      .onConflictDoNothing()
      .run();
    return jsonResponse(c, { ok: true, sha256 });
  });

  app.post("/api/workspace-publications/:id/revisions", requireRunnerAuth as any, async (c) => {
    const id = c.req.param("id");
    const publication = orm
      .select()
      .from(schema.workspacePublications)
      .where(eq(schema.workspacePublications.id, id))
      .get() as PublicationRow | undefined;
    if (!publication) return jsonResponse(c, { error: "Not found" }, 404);
    const user = (c as any).get("user") as RequestUser | undefined;
    if (!access.canViewAgent(user, publication.agent_name)) {
      return jsonResponse(c, { error: "Not found" }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const files = parseManifestFiles(body.files);
    if (!files) return jsonResponse(c, { error: "Invalid files manifest" }, 400);
    for (const file of files) {
      const blob = orm
        .select({ sha256: schema.workspacePublicationBlobs.sha256 })
        .from(schema.workspacePublicationBlobs)
        .where(eq(schema.workspacePublicationBlobs.sha256, file.sha256))
        .get();
      if (!blob) {
        return jsonResponse(c, { error: `Missing blob for ${file.path}` }, 400);
      }
    }
    const revisionId = randomUUID();
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const createdByAgentName =
      typeof body.createdByAgentName === "string" && body.createdByAgentName.trim()
        ? body.createdByAgentName.trim()
        : null;
    const now = Date.now();
    orm.transaction((tx) => {
      tx.insert(schema.workspacePublicationRevisions)
        .values({
          id: revisionId,
          publication_id: publication.id,
          manifest_json: JSON.stringify({ files } satisfies Manifest),
          file_count: files.length,
          total_bytes: totalBytes,
          created_by_agent_name: createdByAgentName,
          created_at: now,
        })
        .run();
      tx.update(schema.workspacePublications)
        .set({
          active_revision_id: revisionId,
          last_published_at: now,
          updated_at: now,
          last_error: null,
        })
        .where(eq(schema.workspacePublications.id, publication.id))
        .run();
    });
    return jsonResponse(c, {
      ok: true,
      revisionId,
      fileCount: files.length,
      totalBytes,
    });
  });

  app.post("/api/workspace-publications/:id/sync-error", requireRunnerAuth as any, async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const message = typeof body.error === "string" ? body.error.slice(0, 1000) : "Unknown sync error";
    orm
      .update(schema.workspacePublications)
      .set({ last_error: message, updated_at: Date.now() })
      .where(eq(schema.workspacePublications.id, id))
      .run();
    return jsonResponse(c, { ok: true });
  });
}
