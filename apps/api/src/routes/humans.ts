import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";

type HumansDeps = {
  orm: any;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  humanSchema: any;
  hashPassword: (password: string) => string;
};

function generateTemporaryPassword() {
  return `tmp-${Math.random().toString(36).slice(2, 8)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function registerHumansRoutes(app: Hono<any>, deps: HumansDeps) {
  const { orm, jsonResponse, humanSchema, hashPassword } = deps;

  app.get("/api/humans", (c) => {
    const rows = orm
      .select({
        id: humanSchema.id,
        username: humanSchema.username,
        must_change_password: humanSchema.must_change_password,
        created_at: humanSchema.created_at,
        updated_at: humanSchema.updated_at
      })
      .from(humanSchema)
      .orderBy(asc(humanSchema.username))
      .all() as Array<{
      id: string;
      username: string;
      must_change_password: number;
      created_at: number;
      updated_at: number;
    }>;

    return jsonResponse(
      c,
      rows.map((row) => ({
        id: row.id,
        username: row.username,
        mustChangePassword: Boolean(row.must_change_password),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    );
  });

  app.post("/api/humans/invite", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const suppliedTempPassword =
      typeof body.tempPassword === "string" ? body.tempPassword.trim() : "";
    if (!username) return jsonResponse(c, { error: "username is required" }, 400);
    const tempPassword = suppliedTempPassword || generateTemporaryPassword();
    if (tempPassword.length < 8) {
      return jsonResponse(c, { error: "Temporary password must be at least 8 characters" }, 400);
    }

    const existing = orm
      .select({ id: humanSchema.id })
      .from(humanSchema)
      .where(eq(humanSchema.username, username))
      .get();
    if (existing) return jsonResponse(c, { error: "Username already exists" }, 409);

    const actor = c.get("user") as { id?: string; username?: string } | undefined;
    const now = Date.now();
    const id = randomUUID();
    orm
      .insert(humanSchema)
      .values({
        id,
        username,
        password_hash: hashPassword(tempPassword),
        must_change_password: 1,
        created_at: now,
        updated_at: now,
        invited_by_human_id: actor?.id ?? null
      })
      .run();

    return jsonResponse(
      c,
      {
        id,
        username,
        mustChangePassword: true,
        temporaryPassword: tempPassword
      },
      201
    );
  });
}
