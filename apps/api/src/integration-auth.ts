import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type OrgOpsDrizzleDb } from "@orgops/db";

export const INTEGRATION_TOKEN_PREFIX = "org_sk_";

export type IntegrationKeyRow = {
  id: string;
  name: string;
  agent_name: string;
  token_hash: string;
  token_prefix: string;
  created_by_human_id: string | null;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

export function hashIntegrationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateIntegrationToken(): {
  token: string;
  prefix: string;
  hash: string;
} {
  const token = `${INTEGRATION_TOKEN_PREFIX}${randomBytes(24).toString("hex")}`;
  return {
    token,
    prefix: token.slice(0, 12),
    hash: hashIntegrationToken(token),
  };
}

export function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export function findActiveIntegrationKey(
  orm: OrgOpsDrizzleDb,
  token: string,
): IntegrationKeyRow | undefined {
  if (!token.startsWith(INTEGRATION_TOKEN_PREFIX)) return undefined;
  const hash = hashIntegrationToken(token);
  const storedHash = Buffer.from(hash, "hex");
  const row = orm
    .select()
    .from(schema.integrationKeys)
    .where(
      and(
        eq(schema.integrationKeys.token_hash, hash),
        isNull(schema.integrationKeys.revoked_at),
      ),
    )
    .get() as IntegrationKeyRow | undefined;
  if (!row) return undefined;
  const rowHash = Buffer.from(row.token_hash, "hex");
  if (storedHash.length !== rowHash.length || !timingSafeEqual(storedHash, rowHash)) {
    return undefined;
  }
  return row;
}

export function touchIntegrationKeyLastUsed(
  orm: OrgOpsDrizzleDb,
  id: string,
  at = Date.now(),
) {
  orm
    .update(schema.integrationKeys)
    .set({ last_used_at: at })
    .where(eq(schema.integrationKeys.id, id))
    .run();
}
