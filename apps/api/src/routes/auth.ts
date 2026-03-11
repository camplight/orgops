import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";

type AuthDeps = {
  orm: any;
  humanSchema: any;
  RUNNER_TOKEN: string;
  sessions: Map<string, { id?: string; username: string; mustChangePassword: boolean }>;
  AuthLoginSchema: { safeParse: (data: unknown) => { success: boolean; data?: any } };
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  requireAuth: (c: any, next: any) => Response | Promise<Response | void> | void;
  hashPassword: (password: string) => string;
  verifyPassword: (password: string, hashed: string) => boolean;
};

export function registerAuthRoutes(app: Hono<any>, deps: AuthDeps) {
  const {
    orm,
    humanSchema,
    sessions,
    AuthLoginSchema,
    jsonResponse,
    requireAuth,
    RUNNER_TOKEN,
    hashPassword,
    verifyPassword
  } = deps;

  app.post("/api/auth/login", async (c) => {
    const body = await c.req.json();
    const parsed = AuthLoginSchema.safeParse(body);
    if (!parsed.success) return jsonResponse(c, { error: "Invalid payload" }, 400);
    const { username, password } = parsed.data;
    const human = orm
      .select()
      .from(humanSchema)
      .where(eq(humanSchema.username, username))
      .get() as
      | {
          id: string;
          username: string;
          password_hash: string;
          must_change_password: number;
        }
      | undefined;
    if (!human || !verifyPassword(password, human.password_hash)) {
      return jsonResponse(c, { error: "Invalid credentials" }, 401);
    }
    const sessionId = randomUUID();
    const mustChangePassword = Boolean(human.must_change_password);
    sessions.set(sessionId, {
      id: human.id,
      username: human.username,
      mustChangePassword
    });
    return new Response(JSON.stringify({ ok: true, mustChangePassword }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": `orgops_session=${sessionId}; HttpOnly; Path=/; SameSite=Strict`
      }
    });
  });

  app.post("/api/auth/logout", requireAuth, (c) => {
    const cookie = c.req.header("cookie") ?? "";
    const match = cookie.match(/orgops_session=([^;]+)/);
    if (match) sessions.delete(match[1]);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": "orgops_session=; HttpOnly; Path=/; Max-Age=0"
      }
    });
  });

  app.get("/api/auth/me", requireAuth, (c) => {
    const user = (c as any).get("user") as {
      id?: string;
      username: string;
      mustChangePassword?: boolean;
    };
    return jsonResponse(c, {
      id: user.id ?? null,
      username: user.username,
      mustChangePassword: Boolean(user.mustChangePassword)
    });
  });

  app.patch("/api/auth/profile", requireAuth, async (c) => {
    const user = (c as any).get("user") as {
      id?: string;
      username: string;
      mustChangePassword?: boolean;
    };
    if (!user.id || user.username === "runner") {
      return jsonResponse(c, { error: "Authenticated human user required" }, 401);
    }
    const body = await c.req.json().catch(() => ({}));
    const nextUsername =
      typeof body.username === "string" ? body.username.trim() : user.username;
    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword =
      typeof body.newPassword === "string" ? body.newPassword.trim() : "";
    if (!nextUsername) {
      return jsonResponse(c, { error: "username is required" }, 400);
    }
    const existing = orm
      .select()
      .from(humanSchema)
      .where(eq(humanSchema.id, user.id))
      .get() as
      | {
          id: string;
          username: string;
          password_hash: string;
        }
      | undefined;
    if (!existing) {
      return jsonResponse(c, { error: "User not found" }, 404);
    }
    if (nextUsername !== existing.username) {
      const duplicate = orm
        .select({ id: humanSchema.id })
        .from(humanSchema)
        .where(and(eq(humanSchema.username, nextUsername), ne(humanSchema.id, existing.id)))
        .get();
      if (duplicate) {
        return jsonResponse(c, { error: "Username already exists" }, 409);
      }
    }

    const wantsPasswordChange = newPassword.length > 0;
    if (wantsPasswordChange && newPassword.length < 8) {
      return jsonResponse(c, { error: "New password must be at least 8 characters" }, 400);
    }
    if (wantsPasswordChange && !user.mustChangePassword) {
      if (!currentPassword || !verifyPassword(currentPassword, existing.password_hash)) {
        return jsonResponse(c, { error: "Current password is incorrect" }, 401);
      }
    }

    const now = Date.now();
    orm
      .update(humanSchema)
      .set({
        username: nextUsername,
        password_hash: wantsPasswordChange
          ? hashPassword(newPassword)
          : existing.password_hash,
        must_change_password: wantsPasswordChange ? 0 : user.mustChangePassword ? 1 : 0,
        updated_at: now
      })
      .where(eq(humanSchema.id, user.id))
      .run();

    const cookie = c.req.header("cookie") ?? "";
    const sessionMatch = cookie.match(/orgops_session=([^;]+)/);
    if (sessionMatch?.[1]) {
      sessions.set(sessionMatch[1], {
        id: user.id,
        username: nextUsername,
        mustChangePassword: wantsPasswordChange ? false : Boolean(user.mustChangePassword)
      });
    }
    return jsonResponse(c, {
      ok: true,
      username: nextUsername,
      mustChangePassword: wantsPasswordChange ? false : Boolean(user.mustChangePassword)
    });
  });

  app.use("/api/*", async (c, next) => {
    if (RUNNER_TOKEN && c.req.header("x-orgops-runner-token") === RUNNER_TOKEN) {
      (c as any).set("user", { username: "runner", mustChangePassword: false });
      return next();
    }
    const guardedNext = async () => {
      const user = (c as any).get("user") as
        | { username?: string; mustChangePassword?: boolean }
        | undefined;
      if (
        user?.username &&
        user.username !== "runner" &&
        user.mustChangePassword &&
        c.req.path !== "/api/auth/me" &&
        c.req.path !== "/api/auth/profile" &&
        c.req.path !== "/api/auth/logout"
      ) {
        return jsonResponse(
          c,
          { error: "Password update required before accessing this resource" },
          403
        );
      }
      return next();
    };
    return await requireAuth(c, guardedNext);
  });
}
