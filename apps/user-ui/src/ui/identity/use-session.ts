import { useState } from "react";
import { deriveSessionState } from "../../domain/identity/session-state";
import type { LoadSessionResult } from "../../application/identity/load-session";

export function useSession(options: {
  loadCurrentSession: () => Promise<LoadSessionResult>;
  clearError: () => void;
}) {
  const { loadCurrentSession, clearError } = options;
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [loginUsername, setLoginUsername] = useState("admin");
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const sessionState = deriveSessionState({ authenticated, authLoading, mustChangePassword });

  async function loadSession() {
    setAuthLoading(true);
    clearError();
    try {
      const session = await loadCurrentSession();
      if (session.kind === "loaded") {
        setUsername(session.username);
        setUserId(session.userId);
        setLoginUsername(session.username || "admin");
        setAuthenticated(session.authenticated);
        setMustChangePassword(session.mustChangePassword);
      } else {
        setAuthenticated(false);
        setUsername("");
        setUserId(null);
        setMustChangePassword(false);
      }
    } finally {
      setAuthLoading(false);
    }
  }

  return {
    username,
    userId,
    loginUsername,
    mustChangePassword,
    authenticated,
    authLoading,
    sessionState,
    loadSession,
    setUsername,
    setUserId,
    setLoginUsername,
    setMustChangePassword,
    setAuthenticated,
    setAuthLoading
  };
}
