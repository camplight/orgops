import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { decryptSecret, encryptSecret, parseMasterKey } from "@orgops/crypto";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";
import { and, eq, or } from "drizzle-orm";
import { listSkills, type SkillRoot } from "@orgops/skills";

const SKIP_DIR_NAMES = new Set(["node_modules", ".git"]);
const MAX_FILE_BYTES = 1_000_000;
const MAX_TRANSFER_FILES = 400;

export type TransferFile = {
  path: string;
  contentBase64: string;
};

export type TransferSkill = {
  name: string;
  files: TransferFile[];
};

export type TransferSecret = {
  name: string;
  value: string;
};

export type TransferMemoryRecord = {
  summaryText: string;
  windowStartAt?: number;
  lastProcessedAt?: number;
  lastProcessedEventId?: string | null;
  version?: number;
  createdAt?: number;
  updatedAt?: number;
};

export type TransferChannelMemory = {
  channelId: string;
  channelName: string | null;
  recent: TransferMemoryRecord | null;
  full: TransferMemoryRecord | null;
};

export type TransferMemory = {
  crossChannelRecent: TransferMemoryRecord | null;
  crossChannelFull: TransferMemoryRecord | null;
  channels: TransferChannelMemory[];
};

export type AgentTransferBundle = {
  agent: Record<string, unknown>;
  workspaceFiles: TransferFile[];
  skills: TransferSkill[];
  secrets: TransferSecret[];
  memory: TransferMemory;
};

type AgentRow = Record<string, any>;

export function createAgentTransfer(deps: {
  orm: OrgOpsDrizzleDb;
  skillRoots: SkillRoot[];
  resolveWorkspacePath: (workspacePath: string) => string;
  parseStringArraySafe: (input: string | null | undefined) => string[];
}) {
  const { orm, skillRoots, resolveWorkspacePath, parseStringArraySafe } = deps;

  function repoSkillNames() {
    return new Set(listSkillsFromRootsSafe(skillRoots));
  }

  function readMasterKey() {
    const raw = process.env.ORGOPS_MASTER_KEY ?? "";
    if (!raw.trim()) return null;
    try {
      return parseMasterKey(raw);
    } catch {
      return null;
    }
  }

  function sharedSecretNames() {
    const rows = orm
      .select({ name: schema.secrets.name, scope_type: schema.secrets.scope_type })
      .from(schema.secrets)
      .where(
        or(eq(schema.secrets.scope_type, "public"), eq(schema.secrets.scope_type, "package")),
      )
      .all() as Array<{ name: string; scope_type: string }>;
    return new Set(rows.map((row) => row.name));
  }

  function exportAgent(name: string): AgentTransferBundle | null {
    const source = orm.select().from(schema.agents).where(eq(schema.agents.name, name)).get() as
      | AgentRow
      | undefined;
    if (!source) return null;
    const enabledSkills = parseStringArraySafe(source.enabled_skills_json);
    const alwaysPreloadedSkills = parseStringArraySafe(source.always_preloaded_skills_json);
    const additionalSkillRoots = parseStringArraySafe(source.additional_skill_roots_json);
    const workspacePath = resolveWorkspacePath(String(source.workspace_path ?? ""));
    return {
      agent: agentRowToBundle(source, {
        enabledSkills,
        alwaysPreloadedSkills,
        additionalSkillRoots,
      }),
      workspaceFiles: collectDirectoryFiles(workspacePath),
      skills: collectAgentSkills({
        enabledSkills,
        additionalSkillRoots,
        workspacePath,
      }),
      secrets: collectPrivateSecrets(name),
      memory: collectMemory(name),
    };
  }

  function importAgent(
    bundle: AgentTransferBundle,
    options: { name: string; assignedRunnerId?: string | null; desiredState?: string },
  ) {
    const targetName = options.name.trim();
    if (!targetName) throw new Error("name is required");
    const existing = orm
      .select({ name: schema.agents.name })
      .from(schema.agents)
      .where(eq(schema.agents.name, targetName))
      .get();
    if (existing) throw new Error("Resource already exists");

    const sourceAgent = bundle.agent ?? {};
    const desiredState = options.desiredState === "RUNNING" ? "RUNNING" : "STOPPED";
    const runtimeState = desiredState === "RUNNING" ? "STARTING" : "STOPPED";
    const workspaceInput =
      typeof sourceAgent.workspacePath === "string" && sourceAgent.workspacePath.trim()
        ? sourceAgent.workspacePath
        : `.orgops-data/workspaces/${targetName}`;
    const workspacePath = workspaceInput.includes(String(sourceAgent.name ?? ""))
      ? resolveWorkspacePath(workspaceInput.replaceAll(String(sourceAgent.name ?? ""), targetName))
      : resolveWorkspacePath(`.orgops-data/workspaces/${targetName}`);
    const installed = installPortableSkills(workspacePath, bundle.skills ?? []);
    const additionalSkillRoots = mergeSkillRoots(
      Array.isArray(sourceAgent.additionalSkillRoots)
        ? sourceAgent.additionalSkillRoots.filter((item): item is string => typeof item === "string")
        : [],
      installed.skillRoot,
    );
    const now = Date.now();
    const id = randomUUID();
    orm
      .insert(schema.agents)
      .values({
        id,
        name: targetName,
        icon: stringOrNull(sourceAgent.icon),
        description: stringOrNull(sourceAgent.description),
        model_id: String(sourceAgent.modelId ?? "openai:gpt-4o-mini"),
        soul_contents: String(sourceAgent.soulContents ?? ""),
        workspace_path: workspacePath,
        allow_outside_workspace: sourceAgent.allowOutsideWorkspace ? 1 : 0,
        llm_call_timeout_ms: numberOrNull(sourceAgent.llmCallTimeoutMs),
        classic_max_model_steps: numberOrNull(sourceAgent.classicMaxModelSteps),
        context_session_gap_ms: numberOrNull(sourceAgent.contextSessionGapMs),
        emit_audit_events: sourceAgent.emitAuditEvents === false ? 0 : 1,
        memory_context_mode: String(sourceAgent.memoryContextMode ?? "PER_CHANNEL_CROSS_CHANNEL"),
        mode: String(sourceAgent.mode ?? "CLASSIC"),
        wrapped_config_json: JSON.stringify(sourceAgent.wrappedConfig ?? {}),
        visibility: sourceAgent.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC",
        owner_human_id: stringOrNull(sourceAgent.ownerHumanId),
        assigned_runner_id:
          options.assignedRunnerId === undefined
            ? stringOrNull(sourceAgent.assignedRunnerId)
            : options.assignedRunnerId,
        enabled_skills_json: JSON.stringify(stringList(sourceAgent.enabledSkills)),
        always_preloaded_skills_json: JSON.stringify(stringList(sourceAgent.alwaysPreloadedSkills)),
        additional_skill_roots_json: JSON.stringify(additionalSkillRoots),
        allow_owner_human_secrets: sourceAgent.allowOwnerHumanSecrets ? 1 : 0,
        desired_state: desiredState,
        runtime_state: runtimeState,
        last_heartbeat_at: null,
        created_at: now,
        updated_at: now,
      })
      .run();

    const workspaceFilesWritten = writeTransferFiles(workspacePath, bundle.workspaceFiles ?? []);
    const secretsCopied = writePrivateSecrets(targetName, bundle.secrets ?? []);
    const memoryCopied = writeMemory(targetName, bundle.memory);
    return {
      id,
      name: targetName,
      workspacePath,
      desiredState,
      assignedRunnerId:
        options.assignedRunnerId === undefined
          ? stringOrNull(sourceAgent.assignedRunnerId)
          : options.assignedRunnerId,
      workspaceFilesWritten,
      skillsInstalled: installed.installed,
      skillsReusedFromRepo: installed.reusedFromRepo,
      secretsCopied,
      secretsReusedFromShared: secretsCopied.skippedShared,
      ...memoryCopied,
    };
  }

  function applyLocalCopy(input: {
    source: AgentRow;
    targetName: string;
    workspacePath: string;
  }) {
    const bundle = exportAgent(input.source.name);
    if (!bundle) return { workspaceFilesWritten: 0, skillsInstalled: [] as string[], secretsCopied: 0 };
    const renamed: AgentTransferBundle = {
      ...bundle,
      agent: { ...bundle.agent, name: input.targetName, workspacePath: input.workspacePath },
    };
    const workspaceFilesWritten = writeTransferFiles(input.workspacePath, renamed.workspaceFiles);
    const installed = installPortableSkills(input.workspacePath, renamed.skills);
    if (installed.skillRoot) {
      const current = parseStringArraySafe(input.source.additional_skill_roots_json);
      const merged = mergeSkillRoots(current, installed.skillRoot);
      orm
        .update(schema.agents)
        .set({
          additional_skill_roots_json: JSON.stringify(merged),
          updated_at: Date.now(),
        })
        .where(eq(schema.agents.name, input.targetName))
        .run();
    }
    const secretsCopied = writePrivateSecrets(input.targetName, renamed.secrets);
    const memoryCopied = writeMemory(input.targetName, renamed.memory);
    return {
      workspaceFilesWritten,
      skillsInstalled: installed.installed,
      skillsReusedFromRepo: installed.reusedFromRepo,
      secretsCopied: secretsCopied.copied,
      secretsReusedFromShared: secretsCopied.skippedShared,
      ...memoryCopied,
    };
  }

  function collectMemory(agentName: string): TransferMemory {
    const recentRows = orm
      .select()
      .from(schema.channelMemoryRecent)
      .where(eq(schema.channelMemoryRecent.agent_name, agentName))
      .all() as Array<Record<string, any>>;
    const fullRows = orm
      .select()
      .from(schema.channelMemoryFull)
      .where(eq(schema.channelMemoryFull.agent_name, agentName))
      .all() as Array<Record<string, any>>;
    const crossRecent = orm
      .select()
      .from(schema.crossChannelMemoryRecent)
      .where(eq(schema.crossChannelMemoryRecent.agent_name, agentName))
      .get() as Record<string, any> | undefined;
    const crossFull = orm
      .select()
      .from(schema.crossChannelMemoryFull)
      .where(eq(schema.crossChannelMemoryFull.agent_name, agentName))
      .get() as Record<string, any> | undefined;
    const channelIds = new Set<string>([
      ...recentRows.map((row) => String(row.channel_id)),
      ...fullRows.map((row) => String(row.channel_id)),
    ]);
    const channels = [...channelIds].map((channelId) => {
      const channel = orm
        .select({ name: schema.channels.name })
        .from(schema.channels)
        .where(eq(schema.channels.id, channelId))
        .get() as { name?: string } | undefined;
      return {
        channelId,
        channelName: channel?.name ?? null,
        recent: toMemoryRecord(recentRows.find((row) => row.channel_id === channelId), true),
        full: toMemoryRecord(fullRows.find((row) => row.channel_id === channelId), false),
      };
    });
    return {
      crossChannelRecent: toMemoryRecord(crossRecent, true),
      crossChannelFull: toMemoryRecord(crossFull, false),
      channels,
    };
  }

  function writeMemory(agentName: string, memory: TransferMemory | undefined) {
    let crossChannelCopied = 0;
    let channelsCopied = 0;
    if (!memory) return { crossChannelCopied, channelsCopied };
    if (memory.crossChannelRecent) {
      insertCrossChannelMemory(schema.crossChannelMemoryRecent, agentName, memory.crossChannelRecent, true);
      crossChannelCopied += 1;
    }
    if (memory.crossChannelFull) {
      insertCrossChannelMemory(schema.crossChannelMemoryFull, agentName, memory.crossChannelFull, false);
      crossChannelCopied += 1;
    }
    for (const channel of memory.channels ?? []) {
      const channelId = resolveDestinationChannelId(channel);
      if (!channelId || (!channel.recent && !channel.full)) continue;
      if (channel.recent) insertChannelMemory(schema.channelMemoryRecent, agentName, channelId, channel.recent, true);
      if (channel.full) insertChannelMemory(schema.channelMemoryFull, agentName, channelId, channel.full, false);
      channelsCopied += 1;
    }
    return { crossChannelCopied, channelsCopied };
  }

  function resolveDestinationChannelId(channel: TransferChannelMemory) {
    const byId = orm
      .select({ id: schema.channels.id })
      .from(schema.channels)
      .where(eq(schema.channels.id, channel.channelId))
      .get() as { id: string } | undefined;
    if (byId) return byId.id;
    if (!channel.channelName) return null;
    const byName = orm
      .select({ id: schema.channels.id })
      .from(schema.channels)
      .where(eq(schema.channels.name, channel.channelName))
      .get() as { id: string } | undefined;
    return byName?.id ?? null;
  }

  function insertChannelMemory(
    table: typeof schema.channelMemoryRecent | typeof schema.channelMemoryFull,
    agentName: string,
    channelId: string,
    record: TransferMemoryRecord,
    includeWindow: boolean,
  ) {
    const now = Date.now();
    orm
      .insert(table)
      .values({
        agent_name: agentName,
        channel_id: channelId,
        summary_text: record.summaryText ?? "",
        ...(includeWindow ? { window_start_at: record.windowStartAt ?? 0 } : {}),
        last_processed_at: record.lastProcessedAt ?? 0,
        last_processed_event_id: record.lastProcessedEventId ?? null,
        version: record.version ?? 0,
        created_at: record.createdAt ?? now,
        updated_at: record.updatedAt ?? now,
      } as any)
      .run();
  }

  function insertCrossChannelMemory(
    table: typeof schema.crossChannelMemoryRecent | typeof schema.crossChannelMemoryFull,
    agentName: string,
    record: TransferMemoryRecord,
    includeWindow: boolean,
  ) {
    const now = Date.now();
    orm
      .insert(table)
      .values({
        agent_name: agentName,
        summary_text: record.summaryText ?? "",
        ...(includeWindow ? { window_start_at: record.windowStartAt ?? 0 } : {}),
        last_processed_at: record.lastProcessedAt ?? 0,
        last_processed_event_id: record.lastProcessedEventId ?? null,
        version: record.version ?? 0,
        created_at: record.createdAt ?? now,
        updated_at: record.updatedAt ?? now,
      } as any)
      .run();
  }

  function collectPrivateSecrets(agentName: string): TransferSecret[] {
    const masterKey = readMasterKey();
    if (!masterKey) return [];
    const rows = orm
      .select({
        name: schema.secrets.name,
        ciphertext_b64: schema.secrets.ciphertext_b64,
      })
      .from(schema.secrets)
      .where(
        and(eq(schema.secrets.scope_type, "private"), eq(schema.secrets.scope_id, agentName)),
      )
      .all() as Array<{ name: string; ciphertext_b64: string }>;
    const secrets: TransferSecret[] = [];
    for (const row of rows) {
      try {
        secrets.push({ name: row.name, value: decryptSecret(masterKey, row.ciphertext_b64) });
      } catch {
        // Skip secrets that cannot be decrypted with the current master key.
      }
    }
    return secrets;
  }

  function writePrivateSecrets(agentName: string, secrets: TransferSecret[]) {
    const masterKey = readMasterKey();
    const shared = sharedSecretNames();
    let copied = 0;
    let skippedShared = 0;
    if (!masterKey) return { copied, skippedShared };
    for (const secret of secrets) {
      if (!secret.name || shared.has(secret.name)) {
        if (secret.name && shared.has(secret.name)) skippedShared += 1;
        continue;
      }
      const existing = orm
        .select({ id: schema.secrets.id })
        .from(schema.secrets)
        .where(
          and(
            eq(schema.secrets.name, secret.name),
            eq(schema.secrets.scope_type, "private"),
            eq(schema.secrets.scope_id, agentName),
          ),
        )
        .get() as { id: string } | undefined;
      const ciphertext = encryptSecret(masterKey, secret.value);
      if (existing) continue;
      orm
        .insert(schema.secrets)
        .values({
          id: randomUUID(),
          name: secret.name,
          scope_type: "private",
          scope_id: agentName,
          ciphertext_b64: ciphertext,
          created_at: Date.now(),
        })
        .run();
      copied += 1;
    }
    return { copied, skippedShared };
  }

  function collectAgentSkills(input: {
    enabledSkills: string[];
    additionalSkillRoots: string[];
    workspacePath: string;
  }): TransferSkill[] {
    const skills: TransferSkill[] = [];
    const seen = new Set<string>();
    const roots = [
      ...skillRoots.map((root) => root.path),
      ...input.additionalSkillRoots.map((root) => resolveWorkspacePath(root)),
      join(input.workspacePath, "skills"),
    ];
    for (const skillName of input.enabledSkills) {
      const dir = findSkillDirectory(skillName, roots);
      if (!dir || seen.has(skillName)) continue;
      seen.add(skillName);
      skills.push({ name: skillName, files: collectDirectoryFiles(dir) });
    }
    for (const root of input.additionalSkillRoots.map((item) => resolveWorkspacePath(item))) {
      for (const skill of listSkillDirectories(root)) {
        if (seen.has(skill.name)) continue;
        seen.add(skill.name);
        skills.push({ name: skill.name, files: collectDirectoryFiles(skill.path) });
      }
    }
    return skills;
  }

  function installPortableSkills(workspacePath: string, skills: TransferSkill[]) {
    const repoNames = repoSkillNames();
    const installed: string[] = [];
    const reusedFromRepo: string[] = [];
    const skillRoot = resolve(workspacePath, "skills");
    for (const skill of skills) {
      if (!skill.name || skill.name.includes("/") || skill.name.includes("..")) continue;
      if (repoNames.has(skill.name)) {
        reusedFromRepo.push(skill.name);
        continue;
      }
      const target = resolve(skillRoot, skill.name);
      writeTransferFiles(target, skill.files ?? []);
      installed.push(skill.name);
    }
    return {
      installed,
      reusedFromRepo,
      skillRoot: installed.length > 0 ? skillRoot : null,
    };
  }

  return { exportAgent, importAgent, applyLocalCopy, repoSkillNames };
}

function toMemoryRecord(row: Record<string, any> | undefined, includeWindow: boolean): TransferMemoryRecord | null {
  if (!row) return null;
  return {
    summaryText: String(row.summary_text ?? ""),
    ...(includeWindow ? { windowStartAt: Number(row.window_start_at ?? 0) } : {}),
    lastProcessedAt: Number(row.last_processed_at ?? 0),
    lastProcessedEventId: row.last_processed_event_id ?? null,
    version: Number(row.version ?? 0),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

function listSkillsFromRootsSafe(roots: SkillRoot[]) {
  const names: string[] = [];
  for (const root of roots) {
    try {
      for (const skill of listSkills(root)) names.push(skill.name);
    } catch {
      // Missing skill roots are ignored.
    }
  }
  return names;
}

function agentRowToBundle(
  source: AgentRow,
  lists: {
    enabledSkills: string[];
    alwaysPreloadedSkills: string[];
    additionalSkillRoots: string[];
  },
) {
  let wrappedConfig: unknown = {};
  try {
    wrappedConfig = JSON.parse(String(source.wrapped_config_json ?? "{}"));
  } catch {
    wrappedConfig = {};
  }
  return {
    name: source.name,
    icon: source.icon ?? null,
    description: source.description ?? null,
    modelId: source.model_id,
    soulContents: source.soul_contents ?? "",
    workspacePath: source.workspace_path,
    allowOutsideWorkspace: Boolean(source.allow_outside_workspace),
    llmCallTimeoutMs: source.llm_call_timeout_ms ?? null,
    classicMaxModelSteps: source.classic_max_model_steps ?? null,
    contextSessionGapMs: source.context_session_gap_ms ?? null,
    emitAuditEvents: source.emit_audit_events !== 0,
    memoryContextMode: source.memory_context_mode ?? "PER_CHANNEL_CROSS_CHANNEL",
    mode: source.mode ?? "CLASSIC",
    wrappedConfig,
    visibility: source.visibility ?? "PUBLIC",
    ownerHumanId: source.owner_human_id ?? null,
    assignedRunnerId: source.assigned_runner_id ?? null,
    enabledSkills: lists.enabledSkills,
    alwaysPreloadedSkills: lists.alwaysPreloadedSkills,
    additionalSkillRoots: lists.additionalSkillRoots,
    allowOwnerHumanSecrets: Boolean(source.allow_owner_human_secrets),
  };
}

export function collectDirectoryFiles(root: string): TransferFile[] {
  if (!root || !existsSync(root)) return [];
  const files: TransferFile[] = [];
  const visit = (dir: string) => {
    if (files.length >= MAX_TRANSFER_FILES) return;
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_TRANSFER_FILES) return;
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      let size = 0;
      try {
        size = statSync(fullPath).size;
      } catch {
        continue;
      }
      if (size > MAX_FILE_BYTES) continue;
      const rel = toPosixPath(relative(root, fullPath));
      if (!rel || rel.startsWith("..") || rel.includes(`..${sep}`)) continue;
      files.push({
        path: rel,
        contentBase64: readFileSync(fullPath).toString("base64"),
      });
    }
  };
  visit(root);
  return files;
}

export function writeTransferFiles(root: string, files: TransferFile[]) {
  if (!root) return 0;
  let written = 0;
  for (const file of files) {
    const rel = String(file.path ?? "").replaceAll("\\", "/");
    if (!rel || rel.startsWith("/") || rel.split("/").includes("..")) continue;
    const target = resolve(root, rel);
    const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
    if (target !== root && !target.startsWith(rootWithSep)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(String(file.contentBase64 ?? ""), "base64"));
    written += 1;
  }
  return written;
}

function findSkillDirectory(skillName: string, roots: string[]) {
  for (const root of roots) {
    if (!root || !existsSync(root)) continue;
    const direct = join(root, skillName);
    if (existsSync(join(direct, "SKILL.md"))) return direct;
    if (basename(root) === skillName && existsSync(join(root, "SKILL.md"))) return root;
  }
  return null;
}

function listSkillDirectories(root: string) {
  if (!root || !existsSync(root)) return [] as Array<{ name: string; path: string }>;
  if (existsSync(join(root, "SKILL.md"))) {
    return [{ name: basename(root), path: root }];
  }
  const found: Array<{ name: string; path: string }> = [];
  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    if (existsSync(join(path, "SKILL.md"))) found.push({ name: entry.name, path });
  }
  return found;
}

function mergeSkillRoots(current: string[], skillRoot: string | null) {
  if (!skillRoot) return current;
  return current.includes(skillRoot) ? current : [...current, skillRoot];
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toPosixPath(value: string) {
  return value.split(sep).join("/");
}
