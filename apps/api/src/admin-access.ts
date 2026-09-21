import type { MiddlewareHandler } from "hono";

export type AdminPrincipal = {
  id?: string;
  username?: string;
  runnerScope?: unknown;
};

export type AdminHuman = { isAdmin: boolean; mustChangePassword: boolean };

export type AdminAccessDeps = {
  findHuman: (id: string) => AdminHuman | undefined;
};

export function canManageCatalogs(
  principal: AdminPrincipal | undefined,
  deps: AdminAccessDeps,
): boolean {
  if (!principal?.id || principal.runnerScope !== undefined) return false;
  const human = deps.findHuman(principal.id);
  return human?.isAdmin === true && human.mustChangePassword === false;
}

// Apply after authentication; authority is looked up anew on every request.
export function createRequireAdmin(deps: AdminAccessDeps): MiddlewareHandler {
  return async (c, next) => {
    if (!canManageCatalogs(c.get("user"), deps)) {
      return c.json({ error: "Administrator access required" }, 403);
    }
    await next();
  };
}
