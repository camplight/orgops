import { apiUrl } from "./config";

export type AuthSnapshot = {
  authChecked: boolean; authenticated: boolean; username: string | null; userId: string | null;
  mustChangePassword: boolean; isAdmin: boolean;
};
export type AuthSession = {
  getSnapshot(): AuthSnapshot;
  subscribe(listener: () => void): () => void;
  refreshAuth(): Promise<AuthSnapshot | null>;
  invalidateCatalogAuthority(expectedUserId: string): void;
  logout(): Promise<void>;
  dispose(): void;
};

function signedOut(authChecked: boolean): AuthSnapshot {
  return { authChecked, authenticated: false, username: null, userId: null, mustChangePassword: false, isAdmin: false };
}
function parseMe(body: unknown): AuthSnapshot {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return signedOut(true);
  const value = body as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id.trim() || typeof value.username !== "string" || !value.username.trim()) return signedOut(true);
  // Missing capability never grants authority; malformed password state cannot bypass rotation.
  const mustChangePassword = value.mustChangePassword === undefined ? false : Boolean(value.mustChangePassword);
  return {
    authChecked: true, authenticated: true, username: value.username, userId: value.id, mustChangePassword,
    isAdmin: value.isAdmin === true && value.mustChangePassword === false,
  };
}

export function createAuthSession(fetchImpl: typeof fetch = fetch): AuthSession {
  let snapshot = signedOut(false);
  let generation = 0;
  let pending: AbortController | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  function publish(next: AuthSnapshot) {
    if (snapshot.authChecked === next.authChecked && snapshot.authenticated === next.authenticated &&
        snapshot.username === next.username && snapshot.userId === next.userId &&
        snapshot.mustChangePassword === next.mustChangePassword && snapshot.isAdmin === next.isAdmin) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }
  function invalidate() {
    generation += 1;
    pending?.abort();
    pending = null;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (!disposed) listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async refreshAuth() {
      if (disposed) return null;
      invalidate();
      const current = generation;
      const controller = new AbortController();
      pending = controller;
      let next: AuthSnapshot;
      try {
        const response = await fetchImpl(apiUrl("/api/auth/me"), { method: "GET", credentials: "include", cache: "no-store", signal: controller.signal });
        next = response.ok ? parseMe(await response.json()) : signedOut(true);
      } catch { next = signedOut(true); }
      if (disposed || current !== generation) return null;
      pending = null;
      publish(next);
      // A subscriber may synchronously invalidate or start a newer check.
      return !disposed && current === generation ? snapshot : null;
    },
    invalidateCatalogAuthority(expectedUserId) {
      if (disposed || snapshot.userId !== expectedUserId) return;
      invalidate();
      publish({ ...snapshot, isAdmin: false });
    },
    async logout() {
      if (disposed) return;
      invalidate();
      publish(signedOut(true));
      try {
        await fetchImpl(apiUrl("/api/auth/logout"), { method: "POST", credentials: "include", cache: "no-store" });
      } catch { /* Local logout remains authoritative even when the POST fails. */ }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidate();
      listeners.clear();
      snapshot = signedOut(true);
    },
  };
}
