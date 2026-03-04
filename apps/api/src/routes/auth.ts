import type { Hono } from "hono";
import { randomUUID } from "node:crypto";

type AuthDeps = {
  ADMIN_USER: string;
  ADMIN_PASS: string;
  RUNNER_TOKEN: string;
  sessions: Map<string, { username: string }>;
  AuthLoginSchema: { safeParse: (data: unknown) => { success: boolean; data?: any } };
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  requireAuth: (c: any, next: any) => Response | Promise<Response | void> | void;
};

export function registerAuthRoutes(app: Hono<any>, deps: AuthDeps) {
  const { ADMIN_USER, ADMIN_PASS, sessions, AuthLoginSchema, jsonResponse, requireAuth, RUNNER_TOKEN } = deps;

  app.post("/api/auth/login", async (c) => {
    const body = await c.req.json();
    const parsed = AuthLoginSchema.safeParse(body);
    if (!parsed.success) return jsonResponse(c, { error: "Invalid payload" }, 400);
    const { username, password } = parsed.data;
    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
      return jsonResponse(c, { error: "Invalid credentials" }, 401);
    }
    const sessionId = randomUUID();
    sessions.set(sessionId, { username });
    return new Response(JSON.stringify({ ok: true }), {
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
    const user = (c as any).get("user") as { username: string };
    return jsonResponse(c, { username: user.username });
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/webhooks/")) {
      return next();
    }
    if (RUNNER_TOKEN && c.req.header("x-orgops-runner-token") === RUNNER_TOKEN) {
      (c as any).set("user", { username: "runner" });
      return next();
    }
    return await requireAuth(c, next);
  });
}
