import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import type { AuthMe } from "../types";

export function useAuth() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await apiFetch("/api/auth/me");
      const body = (await res.json().catch(() => ({}))) as AuthMe;
      setAuthenticated(true);
      setUsername(typeof body.username === "string" ? body.username : null);
      setUserId(typeof body.id === "string" ? body.id : null);
      setMustChangePassword(Boolean(body.mustChangePassword));
    } catch {
      setAuthenticated(false);
      setUsername(null);
      setUserId(null);
      setMustChangePassword(false);
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
      setUserId(null);
      setMustChangePassword(false);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  return {
    authChecked,
    authenticated,
    username,
    userId,
    mustChangePassword,
    refreshAuth,
    logout
  };
}
