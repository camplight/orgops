import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";

const AGENT_INVITE_PREFIX = "org_inv_";
const RUNNER_TOKEN_PREFIX = "org_rt_";

export type AgentInviteRow = {
  id: string;
  name: string;
  agent_name: string;
  agent_visibility: string;
  token_hash: string;
  token_prefix: string;
  channel_ids_json: string;
  wrapped_config_json: string;
  max_uses: number;
  use_count: number;
  created_by_type: string;
  created_by_id: string | null;
  created_by_human_id: string | null;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  last_redeemed_at: number | null;
};

export type RunnerTokenRow = {
  id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  allowed_agent_name: string | null;
  allowed_runner_id: string | null;
  allowed_channel_ids_json: string;
  invite_id: string | null;
  created_by_human_id: string | null;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function verifyHash(candidateToken: string, storedHashHex: string): boolean {
  const candidate = Buffer.from(hashToken(candidateToken), "hex");
  const stored = Buffer.from(storedHashHex, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export function generateAgentInviteToken() {
  const token = `${AGENT_INVITE_PREFIX}${randomBytes(24).toString("hex")}`;
  return { token, prefix: token.slice(0, 16), hash: hashToken(token) };
}

export function generateRunnerScopedToken() {
  const token = `${RUNNER_TOKEN_PREFIX}${randomBytes(24).toString("hex")}`;
  return { token, prefix: token.slice(0, 16), hash: hashToken(token) };
}

export function findActiveInviteByToken(
  orm: OrgOpsDrizzleDb,
  token: string,
  now = Date.now(),
): AgentInviteRow | undefined {
  if (!token.startsWith(AGENT_INVITE_PREFIX)) return undefined;
  const hash = hashToken(token);
  const row = orm
    .select()
    .from(schema.agentInvites)
    .where(
      and(
        eq(schema.agentInvites.token_hash, hash),
        isNull(schema.agentInvites.revoked_at),
      ),
    )
    .get() as AgentInviteRow | undefined;
  if (!row) return undefined;
  if (!verifyHash(token, row.token_hash)) return undefined;
  if (row.revoked_at) return undefined;
  if (row.expires_at !== null && row.expires_at <= now) return undefined;
  if (row.use_count >= row.max_uses) return undefined;
  return row;
}

export function findActiveRunnerTokenByToken(
  orm: OrgOpsDrizzleDb,
  token: string,
  now = Date.now(),
): RunnerTokenRow | undefined {
  if (!token.startsWith(RUNNER_TOKEN_PREFIX)) return undefined;
  const hash = hashToken(token);
  const row = orm
    .select()
    .from(schema.runnerTokens)
    .where(
      and(
        eq(schema.runnerTokens.token_hash, hash),
        isNull(schema.runnerTokens.revoked_at),
      ),
    )
    .get() as RunnerTokenRow | undefined;
  if (!row) return undefined;
  if (!verifyHash(token, row.token_hash)) return undefined;
  if (row.expires_at !== null && row.expires_at <= now) return undefined;
  if (row.revoked_at) return undefined;
  return row;
}

export function touchRunnerTokenLastUsed(
  orm: OrgOpsDrizzleDb,
  id: string,
  at = Date.now(),
) {
  orm
    .update(schema.runnerTokens)
    .set({ last_used_at: at })
    .where(eq(schema.runnerTokens.id, id))
    .run();
}

export function parseStringArraySafe(input: string | null | undefined): string[] {
  if (!input) return [];
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}
