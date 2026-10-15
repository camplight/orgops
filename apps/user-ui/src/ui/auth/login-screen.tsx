import type { FormEvent } from "react";

type LoginScreenProps = {
  error: string | null;
  username: string;
  password: string;
  loading: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function LoginScreen({
  error,
  username,
  password,
  loading,
  onUsernameChange,
  onPasswordChange,
  onSubmit
}: LoginScreenProps) {
  return (
    <main className="login-screen">
      <section className="login-copy">
        <div className="brand-mark large">OO</div>
        <p>OrgOps User Workspace</p>
        <h1>Welcome back</h1>
        <span>Sign in to talk to your team and agents.</span>
      </section>

      <form className="login-card" onSubmit={onSubmit}>
        <div>
          <span>Sign in</span>
          <strong>OrgOps</strong>
        </div>
        {error ? <div className="notice error">{error}</div> : null}
        <label>
          Username
          <input
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
            autoComplete="username"
          />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </label>
        <button disabled={!username.trim() || !password || loading}>
          {loading ? "Signing in..." : "Continue"}
        </button>
      </form>
    </main>
  );
}
