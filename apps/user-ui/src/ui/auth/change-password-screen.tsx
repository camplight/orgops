import type { FormEvent } from "react";

type ChangePasswordScreenProps = {
  error: string | null;
  username: string;
  newPassword: string;
  confirmPassword: string;
  loading: boolean;
  onNewPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSignOut: () => void;
};

export function ChangePasswordScreen({
  error,
  username,
  newPassword,
  confirmPassword,
  loading,
  onNewPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
  onSignOut
}: ChangePasswordScreenProps) {
  return (
    <main className="login-screen">
      <section className="login-copy">
        <div className="brand-mark large">OO</div>
        <p>OrgOps User Workspace</p>
        <h1>Set a new password</h1>
        <span>Finish first-time setup before opening your workspace.</span>
      </section>

      <form className="login-card" onSubmit={onSubmit}>
        <div>
          <span>First login</span>
          <strong>{username || "OrgOps"}</strong>
        </div>
        <p className="login-hint">
          Your temporary password worked. Choose a new password with at least 8 characters.
        </p>
        {error ? <div className="notice error">{error}</div> : null}
        <label>
          New password
          <input
            value={newPassword}
            onChange={(event) => onNewPasswordChange(event.target.value)}
            type="password"
            autoComplete="new-password"
          />
        </label>
        <label>
          Confirm new password
          <input
            value={confirmPassword}
            onChange={(event) => onConfirmPasswordChange(event.target.value)}
            type="password"
            autoComplete="new-password"
          />
        </label>
        <button
          disabled={
            newPassword.trim().length < 8 ||
            newPassword.trim() !== confirmPassword.trim() ||
            loading
          }
        >
          {loading ? "Updating..." : "Update password"}
        </button>
        <button className="secondary-button" type="button" onClick={onSignOut}>
          Sign out
        </button>
      </form>
    </main>
  );
}
