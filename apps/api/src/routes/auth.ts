import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import {bodyLimit} from 'hono/body-limit';
import {DUMMY_PASSWORD_HASH} from '../passwords';
import type {HumanSession} from './google-auth';

type AuthDeps = {
  orm: any;
  humanSchema: any;
  RUNNER_TOKEN: string;
  isGoogleHuman: (id: string) => boolean;
  sessions: Map<string, HumanSession>;
  AuthLoginSchema: { safeParse: (data: unknown) => { success: boolean; data?: any } };
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  requireAuth: (c: any, next: any) => Response | Promise<Response | void> | void;
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (password: string, hashed: string) => Promise<boolean>;
};

type CookieSecureMode = "always" | "never" | "auto";

function getCookieSecureMode(): CookieSecureMode {
  const configured = (process.env.ORGOPS_COOKIE_SECURE ?? "auto").trim().toLowerCase();
  if (configured === "always" || configured === "never" || configured === "auto") {
    return configured;
  }
  return "auto";
}

function isRequestHttps(c: any): boolean {
  const forwardedProto = (c.req.header("x-forwarded-proto") ?? "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto === "https") return true;
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}

function shouldUseSecureCookie(c: any): boolean {
  const mode = getCookieSecureMode();
  if (mode === "always") return true;
  if (mode === "never") return false;
  return isRequestHttps(c);
}

export function buildSessionCookie(c: any, sessionId: string, maxAge: number | null = null) {
  const parts = [
    `orgops_session=${sessionId}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
  ];
  if (shouldUseSecureCookie(c)) {
    parts.push("Secure");
  }
  if (typeof maxAge === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  }
  return parts.join("; ");
}

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

  const sessionAge=8*60*60;
  let activeLogins=0, windowStart=Date.now(), attempts=0;
  const accountAttempts=new Map<string,number>();
  app.use('/api/auth/*',bodyLimit({maxSize:4096,onError:c=>c.json({error:'Request too large'},413)}));

  app.post("/api/auth/login", async (c) => {
    const body = await c.req.json().catch(()=>null);
    const parsed = AuthLoginSchema.safeParse(body);
    if (!parsed.success) return jsonResponse(c, { error: "Invalid payload" }, 400);
    const { username, password } = parsed.data;
    if(username.length>1024||password.length>1024)return jsonResponse(c,{error:'Invalid payload'},400);
    if(Date.now()-windowStart>=60_000){windowStart=Date.now();attempts=0;accountAttempts.clear();}
    const count=accountAttempts.get(username)??0;
    if(attempts>=60||count>=8||activeLogins>=4){
      c.header('Retry-After','60');return jsonResponse(c,{error:'Please try again shortly'},429);
    }
    attempts++;accountAttempts.set(username,count+1);activeLogins++;
    try {
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
    const verified=await verifyPassword(password,human?.password_hash??DUMMY_PASSWORD_HASH);
    if (!human || deps.isGoogleHuman(human.id) || !verified) {
      return jsonResponse(c, { error: "Invalid credentials" }, 401);
    }
    const sessionId = randomUUID();
    const mustChangePassword = Boolean(human.must_change_password);
    sessions.set(sessionId, {
      id: human.id,
      username: human.username,
      mustChangePassword,
      expiresAt:Date.now()+sessionAge*1000,
    });
    return new Response(JSON.stringify({ ok: true, mustChangePassword }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": buildSessionCookie(c, sessionId,sessionAge),
        "cache-control":"no-store",
      }
    });
    } finally {activeLogins--;}
  });

  app.post("/api/auth/logout", requireAuth, (c) => {
    const cookie = c.req.header("cookie") ?? "";
    const match = cookie.match(/orgops_session=([^;]+)/);
    if (match) sessions.delete(match[1]);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": buildSessionCookie(c, "", 0)
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
    if (deps.isGoogleHuman(user.id)) return jsonResponse(c, { error: "Google manages this account profile" }, 403);
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
      if (!currentPassword || !await verifyPassword(currentPassword, existing.password_hash)) {
        return jsonResponse(c, { error: "Current password is incorrect" }, 401);
      }
    }

    const now = Date.now();
    orm
      .update(humanSchema)
      .set({
        username: nextUsername,
        password_hash: wantsPasswordChange
          ? await hashPassword(newPassword)
          : existing.password_hash,
        must_change_password: wantsPasswordChange ? 0 : user.mustChangePassword ? 1 : 0,
        updated_at: now
      })
      .where(eq(humanSchema.id, user.id))
      .run();

    const cookie = c.req.header("cookie") ?? "";
    const sessionMatch = cookie.match(/orgops_session=([^;]+)/);
    if (sessionMatch?.[1]) {
      const expiresAt=sessions.get(sessionMatch[1])?.expiresAt??Date.now()+sessionAge*1000;
      const rotate=wantsPasswordChange||nextUsername!==existing.username;
      const nextSession=rotate?randomUUID():sessionMatch[1];
      if(rotate)for(const [id,session] of sessions)if(session.id===user.id)sessions.delete(id);
      sessions.set(nextSession, {
        id: user.id,
        username: nextUsername,
        mustChangePassword: wantsPasswordChange ? false : Boolean(user.mustChangePassword),
        expiresAt,
      });
      if(rotate)c.header('Set-Cookie',buildSessionCookie(c,nextSession,Math.max(0,Math.floor((expiresAt-Date.now())/1000))));
    }
    return jsonResponse(c, {
      ok: true,
      username: nextUsername,
      mustChangePassword: wantsPasswordChange ? false : Boolean(user.mustChangePassword)
    });
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/agent-invites/public/")) {
      return next();
    }
    if (
      /^\/api\/federation\/channels\/[^/]+\/events$/.test(c.req.path) ||
      /^\/api\/federation\/channels\/[^/]+\/participants$/.test(c.req.path) ||
      /^\/api\/federation\/channels\/[^/]+\/subscribers$/.test(c.req.path) ||
      /^\/api\/federation\/projections\/[^/]+\/events$/.test(c.req.path) ||
      /^\/api\/federation\/agents\/[^/]+\/transfer$/.test(c.req.path) ||
      c.req.path === "/api/federation/agents/transfer"
    ) {
      return next();
    }
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
