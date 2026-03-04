import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";

export function useAuth() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await apiFetch("/api/auth/me");
      const body = (await res.json().catch(() => ({}))) as { username?: string };
      setAuthenticated(true);
      setUsername(typeof body.username === "string" ? body.username : null);
    } catch {
      setAuthenticated(false);
      setUsername(null);
    } finally {
      setAuthChecked(true);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore network errors and still clear local auth state.
    } finally {
      setAuthenticated(false);
      setUsername(null);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  return { authChecked, authenticated, username, refreshAuth, logout };
}
