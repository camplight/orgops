import { useState } from "react";
import { apiFetch } from "../../api";
import { Button, Input, Label } from "../ui";

type LoginFormProps = {
  onSuccess: () => Promise<void> | void;
};

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [status, setStatus] = useState<string | null>(null);

  const handleLogin = async () => {
    setStatus(null);
    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password })
      });
    } catch {
      setStatus("Login failed");
      return;
    }
    await onSuccess();
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-slate-900 p-6 rounded-lg shadow w-80 space-y-4">
        <h1 className="text-xl font-semibold text-slate-100">OrgOps Login</h1>
        {status && <p className="text-red-400 text-sm">{status}</p>}
        <div className="space-y-2">
          <Label>Username</Label>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </div>
        <div className="space-y-2">
          <Label>Password</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <Button className="w-full" onClick={handleLogin}>
          Sign in
        </Button>
      </div>
    </div>
  );
}
