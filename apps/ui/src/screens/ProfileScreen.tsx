import { useEffect, useState } from "react";
import { Button, Input, Label } from "../components/ui";

type ProfileScreenProps = {
  username: string | null;
  mustChangePassword: boolean;
  onSaveProfile: (input: {
    username: string;
    currentPassword?: string;
    newPassword?: string;
  }) => Promise<void>;
};

export function ProfileScreen({
  username,
  mustChangePassword,
  onSaveProfile
}: ProfileScreenProps) {
  const [nextUsername, setNextUsername] = useState(username ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setNextUsername(username ?? "");
  }, [username]);

  const handleSave = async () => {
    setStatus(null);
    if (!nextUsername.trim()) {
      setStatus("Username is required.");
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      setStatus("New password and confirmation do not match.");
      return;
    }
    try {
      await onSaveProfile({
        username: nextUsername.trim(),
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setStatus("Profile updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to update profile");
    }
  };

  return (
    <div className="max-w-xl rounded border border-slate-800 bg-slate-950 p-4 space-y-4">
      <h2 className="text-slate-100 text-lg font-medium">Profile</h2>
      {mustChangePassword && (
        <div className="rounded border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-200">
          First login detected. Set a new password before continuing.
        </div>
      )}
      <div className="space-y-2">
        <Label>Username</Label>
        <Input value={nextUsername} onChange={(event) => setNextUsername(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Current password {mustChangePassword ? "(optional on first login)" : ""}</Label>
        <Input
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
        />
      </div>
      <div className="space-y-2">
        <Label>New password</Label>
        <Input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete="new-password"
        />
      </div>
      <div className="space-y-2">
        <Label>Confirm new password</Label>
        <Input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
        />
      </div>
      <Button onClick={handleSave}>Save Profile</Button>
      {status && (
        <div className="text-sm text-slate-300">
          {status}
        </div>
      )}
      <div className="text-sm text-slate-400">
        Signed in as <span className="text-slate-200">{username ?? "Unknown"}</span>
      </div>
    </div>
  );
}
