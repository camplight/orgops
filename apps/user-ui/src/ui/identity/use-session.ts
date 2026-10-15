import { useState, type FormEvent } from "react";
import { validateNewPassword } from "../../domain/identity/password-rules";
import { deriveSessionState } from "../../domain/identity/session-state";
import type { LoadSessionResult } from "../../application/identity/load-session";

export function useSession(options: {
  loadCurrentSession: () => Promise<LoadSessionResult>;
  signIn: (credentials: { username: string; password: string }) => Promise<void>;
  changePassword: (input: {
    username: string;
    fallbackUsername: string;
    newPassword: string;
  }) => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const { loadCurrentSession, signIn, changePassword, setError } = options;
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [loginPassword, setLoginPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loginUsername, setLoginUsername] = useState("admin");
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const sessionState = deriveSessionState({ authenticated, authLoading, mustChangePassword });

  async function loadSession() {
    setAuthLoading(true);
    setError(null);
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

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setAuthLoading(true);
    try {
      await signIn({
        username: loginUsername,
        password: loginPassword
      });
      setLoginPassword("");
      await loadSession();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Unable to sign in");
      setAuthenticated(false);
      setAuthLoading(false);
    }
  }

  async function handlePasswordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const nextPassword = newPassword.trim();
    const passwordError = validateNewPassword(newPassword, confirmPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setAuthLoading(true);
    try {
      await changePassword({
        username,
        fallbackUsername: loginUsername,
        newPassword: nextPassword
      });
      setNewPassword("");
      setConfirmPassword("");
      await loadSession();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update password");
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
    loginPassword,
    setLoginPassword,
    handleLogin,
    newPassword,
    confirmPassword,
    setNewPassword,
    setConfirmPassword,
    handlePasswordUpdate,
    setUsername,
    setUserId,
    setLoginUsername,
    setMustChangePassword,
    setAuthenticated
  };
}
