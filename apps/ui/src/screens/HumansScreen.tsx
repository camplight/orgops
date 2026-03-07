import { useMemo, useState } from "react";
import { Button, Card, Input } from "../components/ui";
import type { Human } from "../types";

type HumansScreenProps = {
  humans: Human[];
  onInviteHuman: (input: {
    username: string;
    tempPassword?: string;
  }) => Promise<{ id: string; username: string; temporaryPassword: string }>;
  onRefresh: () => Promise<void> | void;
};

function formatDate(value: number) {
  if (!Number.isFinite(value)) return "Unknown";
  return new Date(value).toLocaleString();
}

export function HumansScreen({ humans, onInviteHuman, onRefresh }: HumansScreenProps) {
  const [newHuman, setNewHuman] = useState({ username: "", tempPassword: "" });
  const [activeHumanId, setActiveHumanId] = useState<string | null>(null);
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<{
    username: string;
    temporaryPassword: string;
  } | null>(null);
  const sortedHumans = useMemo(
    () => [...humans].sort((left, right) => left.username.localeCompare(right.username)),
    [humans]
  );
  const selectedHuman = sortedHumans.find((human) => human.id === activeHumanId) ?? null;

  const handleInvite = async () => {
    const trimmedUsername = newHuman.username.trim();
    if (!trimmedUsername) return;
    setStatus(null);
    setInviteResult(null);
    try {
      const invited = await onInviteHuman({
        username: trimmedUsername,
        tempPassword: newHuman.tempPassword.trim() || undefined
      });
      setInviteResult({
        username: invited.username,
        temporaryPassword: invited.temporaryPassword
      });
      setNewHuman({ username: "", tempPassword: "" });
      setCreateDrawerOpen(false);
      setActiveHumanId(invited.id);
      setStatus(`Created human "${invited.username}".`);
      await onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to invite user");
    }
  };

  return (
    <div className="space-y-4">
      <Card title={`Humans (${sortedHumans.length})`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            Click a human row to open details.
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void onRefresh()}>
              Refresh
            </Button>
            <Button onClick={() => setCreateDrawerOpen(true)}>New human</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-300">
                <th className="px-2 py-2">Username</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">ID</th>
              </tr>
            </thead>
            <tbody>
              {sortedHumans.map((human) => (
                <tr
                  key={human.id}
                  className={`cursor-pointer border-b border-slate-900 align-top hover:bg-slate-900/40 ${
                    activeHumanId === human.id ? "bg-slate-900/70" : ""
                  }`}
                  onClick={() => setActiveHumanId(human.id)}
                >
                  <td className="whitespace-nowrap px-2 py-2 text-slate-200">{human.username}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        human.mustChangePassword
                          ? "bg-amber-900/50 text-amber-300"
                          : "bg-emerald-900/40 text-emerald-300"
                      }`}
                    >
                      {human.mustChangePassword ? "Password reset pending" : "Active"}
                    </span>
                  </td>
                  <td className="max-w-[320px] truncate px-2 py-2 text-xs text-slate-500">{human.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sortedHumans.length === 0 && (
            <div className="py-8 text-center text-slate-500">No humans found.</div>
          )}
        </div>
      </Card>

      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity lg:left-56 ${
          createDrawerOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setCreateDrawerOpen(false)}
      />
      <aside
        className={`fixed bottom-0 right-0 top-0 z-50 w-full max-w-md border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-300 ${
          createDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!createDrawerOpen}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-100">Create Human</h3>
            <Button
              type="button"
              variant="secondary"
              className="px-2 py-1 text-xs"
              onClick={() => setCreateDrawerOpen(false)}
            >
              Close
            </Button>
          </div>
          <div className="space-y-3 px-4 py-4">
            <div className="text-sm text-slate-400">
              Create a human account with a temporary password.
            </div>
            <Input
              placeholder="username"
              value={newHuman.username}
              onChange={(event) => setNewHuman((prev) => ({ ...prev, username: event.target.value }))}
            />
            <Input
              placeholder="temporary password (optional)"
              type="password"
              value={newHuman.tempPassword}
              onChange={(event) =>
                setNewHuman((prev) => ({ ...prev, tempPassword: event.target.value }))
              }
            />
            {status && <div className="text-sm text-slate-300">{status}</div>}
          </div>
          <div className="mt-auto border-t border-slate-800 px-4 py-3">
            <Button onClick={handleInvite} disabled={!newHuman.username.trim()}>
              Create
            </Button>
          </div>
        </div>
      </aside>

      <div
        className={`pointer-events-none fixed inset-0 z-50 flex justify-end lg:left-56 ${
          selectedHuman ? "" : "invisible"
        }`}
      >
        <div
          className={`pointer-events-auto flex h-full w-full max-w-3xl flex-col border-l border-slate-800 bg-slate-950/95 shadow-2xl transition-transform duration-300 ${
            selectedHuman ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                {selectedHuman ? selectedHuman.username : "No human selected"}
              </h3>
              <p className="text-sm text-slate-500">
                {selectedHuman
                  ? selectedHuman.mustChangePassword
                    ? "Password reset pending"
                    : "Active account"
                  : "Select a human to view details."}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="px-2 py-1 text-xs"
              onClick={() => setActiveHumanId(null)}
            >
              Close
            </Button>
          </div>
          <div className="grid min-h-0 flex-1 gap-4 overflow-auto px-4 py-4">
            {selectedHuman ? (
              <div className="space-y-3 rounded border border-slate-800 bg-slate-950 p-3">
                <h3 className="text-sm text-slate-300">Human Details</h3>
                <div className="space-y-2 text-sm text-slate-300">
                  <div>
                    <span className="text-slate-500">Username:</span> {selectedHuman.username}
                  </div>
                  <div className="break-all">
                    <span className="text-slate-500">ID:</span> {selectedHuman.id}
                  </div>
                  <div>
                    <span className="text-slate-500">Created:</span> {formatDate(selectedHuman.createdAt)}
                  </div>
                  <div>
                    <span className="text-slate-500">Updated:</span> {formatDate(selectedHuman.updatedAt)}
                  </div>
                  <div
                    className={`inline-block rounded px-2 py-0.5 text-xs ${
                      selectedHuman.mustChangePassword
                        ? "bg-amber-900/50 text-amber-300"
                        : "bg-emerald-900/40 text-emerald-300"
                    }`}
                  >
                    {selectedHuman.mustChangePassword ? "Password reset pending" : "Active"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500">Select a human to view details.</div>
            )}

            {inviteResult && inviteResult.username === selectedHuman?.username ? (
              <div className="space-y-2 rounded border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200">
                <h3 className="text-sm text-slate-300">Latest Temporary Password</h3>
                <div>
                  Temporary password for <span className="font-semibold">{inviteResult.username}</span>:
                </div>
                <div className="font-mono text-amber-300">{inviteResult.temporaryPassword}</div>
                <div className="text-xs text-slate-400">
                  Share this once. The user must set a new password on first login.
                </div>
              </div>
            ) : null}
          </div>
          {status && selectedHuman ? (
            <div className="shrink-0 border-t border-slate-800 px-4 py-2 text-sm text-slate-300">
              {status}
            </div>
          ) : null}
        </div>
      </div>

      {selectedHuman && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:left-56"
          onClick={() => setActiveHumanId(null)}
        />
      )}
      {status && !selectedHuman && !createDrawerOpen ? (
        <div className="text-sm text-slate-300">{status}</div>
      ) : null}
    </div>
  );
}
