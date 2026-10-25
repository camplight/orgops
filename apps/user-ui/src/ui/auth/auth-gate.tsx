import type { ReactNode } from "react";
import type { SessionState } from "../../domain/identity/session-state";
import { ChangePasswordScreen } from "./change-password-screen";
import { LoginScreen } from "./login-screen";

type AuthGateProps = {
  sessionState: SessionState;
  error: string | null;
  username: string;
  loginUsername: string;
  loginPassword: string;
  authLoading: boolean;
  setLoginUsername: (value: string) => void;
  setLoginPassword: (value: string) => void;
  handleLogin: Parameters<typeof LoginScreen>[0]["onSubmit"];
  newPassword: string;
  confirmPassword: string;
  setNewPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
  handlePasswordUpdate: Parameters<typeof ChangePasswordScreen>[0]["onSubmit"];
  handleLogout: () => Promise<void> | void;
  children: ReactNode;
};

export function AuthGate({
  sessionState,
  error,
  username,
  loginUsername,
  loginPassword,
  authLoading,
  setLoginUsername,
  setLoginPassword,
  handleLogin,
  newPassword,
  confirmPassword,
  setNewPassword,
  setConfirmPassword,
  handlePasswordUpdate,
  handleLogout,
  children
}: AuthGateProps) {
  if (sessionState === "loading") {
    return <main className="loading-screen">Loading OrgOps...</main>;
  }

  if (sessionState === "signedOut") {
    return (
      <LoginScreen
        error={error}
        username={loginUsername}
        password={loginPassword}
        loading={authLoading}
        onUsernameChange={setLoginUsername}
        onPasswordChange={setLoginPassword}
        onSubmit={handleLogin}
      />
    );
  }

  if (sessionState === "mustChangePassword") {
    return (
      <ChangePasswordScreen
        error={error}
        username={username}
        newPassword={newPassword}
        confirmPassword={confirmPassword}
        loading={authLoading}
        onNewPasswordChange={setNewPassword}
        onConfirmPasswordChange={setConfirmPassword}
        onSubmit={handlePasswordUpdate}
        onSignOut={() => void handleLogout()}
      />
    );
  }

  return <>{children}</>;
}
