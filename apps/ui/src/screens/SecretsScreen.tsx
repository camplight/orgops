import { useState } from "react";
import type { SecretRow } from "../types";
import { Button, Card, Input, Select } from "../components/ui";
import { formatTimestamp } from "../utils/formatTimestamp";

type SecretsScreenProps = {
  secrets: SecretRow[];
  onAddSecret: (secret: {
    name: string;
    scopeType: string;
    scopeId: string | null;
    value: string;
  }) => Promise<void>;
  onDeleteSecret: (id: string) => Promise<void>;
};

export function SecretsScreen({ secrets, onAddSecret, onDeleteSecret }: SecretsScreenProps) {
  const [newSecret, setNewSecret] = useState({
    name: "",
    scopeType: "package",
    scopeId: "",
    value: ""
  });
  const [activeSecretId, setActiveSecretId] = useState<string | null>(null);
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [deletingSecretId, setDeletingSecretId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedSecret = secrets.find((secret) => secret.id === activeSecretId) ?? null;

  const handleSave = async () => {
    setError(null);
    if (!newSecret.name.trim()) {
      setError("Secret name is required.");
      return;
    }
    if (!newSecret.value.trim()) {
      setError("Secret value is required.");
      return;
    }
    try {
      await onAddSecret({
        name: newSecret.name.trim(),
        scopeType: newSecret.scopeType,
        scopeId: newSecret.scopeId.trim() || null,
        value: newSecret.value
      });
      setNewSecret({ name: "", scopeType: "package", scopeId: "", value: "" });
      setCreateDrawerOpen(false);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to create secret.";
      setError(message);
    }
  };

  const handleDeleteSecret = async (secret: SecretRow) => {
    setError(null);
    const confirmed = window.confirm(
      `Delete secret "${secret.name}" (${secret.scope_type})? This cannot be undone.`
    );
    if (!confirmed) return;
    setDeletingSecretId(secret.id);
    try {
      await onDeleteSecret(secret.id);
      if (activeSecretId === secret.id) {
        setActiveSecretId(null);
      }
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "Failed to delete secret.";
      setError(message);
    } finally {
      setDeletingSecretId(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card title={`Secrets (${secrets.length})`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">Click a secret row to open details.</div>
          <Button onClick={() => setCreateDrawerOpen(true)}>New secret</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-300">
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Scope</th>
                <th className="px-2 py-2">Created</th>
                <th className="px-2 py-2">ID</th>
              </tr>
            </thead>
            <tbody>
              {secrets.map((secret) => (
                <tr
                  key={secret.id}
                  className={`cursor-pointer border-b border-slate-900 align-top hover:bg-slate-900/40 ${
                    activeSecretId === secret.id ? "bg-slate-900/70" : ""
                  }`}
                  onClick={() => setActiveSecretId(secret.id)}
                >
                  <td className="whitespace-nowrap px-2 py-2 text-slate-200">{secret.name}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-slate-400">
                    {secret.scope_type}
                    {secret.scope_id ? `:${secret.scope_id}` : ""}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-slate-500">
                    {formatTimestamp(secret.created_at)}
                  </td>
                  <td className="max-w-[320px] truncate px-2 py-2 text-xs text-slate-500">
                    {secret.id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {secrets.length === 0 && (
            <div className="py-8 text-center text-slate-500">No secrets found.</div>
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
            <h3 className="text-sm font-semibold text-slate-100">Create Secret</h3>
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
            <Input
              placeholder="Name"
              value={newSecret.name}
              onChange={(e) => setNewSecret({ ...newSecret, name: e.target.value })}
            />
            <Select
              value={newSecret.scopeType}
              onChange={(e) => setNewSecret({ ...newSecret, scopeType: e.target.value })}
            >
              <option value="package">package</option>
              <option value="app">app</option>
              <option value="agent">agent</option>
              <option value="team">team</option>
            </Select>
            <Input
              placeholder="Scope ID (optional)"
              value={newSecret.scopeId}
              onChange={(e) => setNewSecret({ ...newSecret, scopeId: e.target.value })}
            />
            <Input
              placeholder="Value"
              value={newSecret.value}
              onChange={(e) => setNewSecret({ ...newSecret, value: e.target.value })}
            />
            {error && <div className="text-sm text-rose-400">{error}</div>}
          </div>
          <div className="mt-auto border-t border-slate-800 px-4 py-3">
            <Button onClick={handleSave}>Create</Button>
          </div>
        </div>
      </aside>

      <div
        className={`pointer-events-none fixed inset-0 z-50 flex justify-end lg:left-56 ${
          selectedSecret ? "" : "invisible"
        }`}
      >
        <div
          className={`pointer-events-auto flex h-full w-full max-w-2xl flex-col border-l border-slate-800 bg-slate-950/95 shadow-2xl transition-transform duration-300 ${
            selectedSecret ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                {selectedSecret ? selectedSecret.name : "No secret selected"}
              </h3>
              <p className="text-sm text-slate-500">
                {selectedSecret
                  ? `${selectedSecret.scope_type}${selectedSecret.scope_id ? `:${selectedSecret.scope_id}` : ""}`
                  : "Select a secret to view details."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs text-rose-300 hover:text-rose-200"
                onClick={() => selectedSecret && handleDeleteSecret(selectedSecret)}
                disabled={!selectedSecret || deletingSecretId === selectedSecret.id}
              >
                Delete Secret
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={() => setActiveSecretId(null)}
              >
                Close
              </Button>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 gap-4 overflow-auto px-4 py-4">
            {selectedSecret ? (
              <div className="space-y-3 rounded border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
                <h3 className="text-sm text-slate-300">Secret Details</h3>
                <div>
                  <span className="text-slate-500">Name:</span> {selectedSecret.name}
                </div>
                <div>
                  <span className="text-slate-500">Scope:</span> {selectedSecret.scope_type}
                </div>
                <div className="break-all">
                  <span className="text-slate-500">Scope ID:</span>{" "}
                  {selectedSecret.scope_id ?? "-"}
                </div>
                <div className="break-all">
                  <span className="text-slate-500">ID:</span> {selectedSecret.id}
                </div>
                <div>
                  <span className="text-slate-500">Created:</span>{" "}
                  {formatTimestamp(selectedSecret.created_at)}
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500">Select a secret to view details.</div>
            )}
          </div>
          {error && selectedSecret ? (
            <div className="shrink-0 border-t border-slate-800 px-4 py-2 text-sm text-rose-400">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      {selectedSecret && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:left-56"
          onClick={() => setActiveSecretId(null)}
        />
      )}
      {error && !selectedSecret && !createDrawerOpen ? (
        <div className="text-sm text-rose-400">{error}</div>
      ) : null}
    </div>
  );
}
