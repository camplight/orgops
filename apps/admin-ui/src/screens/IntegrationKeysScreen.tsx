import { useMemo, useState } from "react";
import { Button, Card, Input, Label, Select, Textarea } from "../components/ui";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { formatTimestamp } from "../utils/formatTimestamp";
import { embedApiOrigin } from "../config";
import { buildEmbedAgentPrompt } from "../embedAgentPrompt";
import type { Agent, IntegrationKey } from "../types";

type IntegrationKeysScreenProps = {
  keys: IntegrationKey[];
  agents: Agent[];
  onCreateKey: (input: {
    name: string;
    agentName: string;
  }) => Promise<IntegrationKey>;
  onRevokeKey: (id: string) => Promise<void>;
  onRefresh: () => Promise<void> | void;
};

function errorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "Request failed";
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    // not JSON
  }
  return raw;
}

function statusLabel(key: IntegrationKey) {
  return key.revokedAt ? "Revoked" : "Active";
}

export function IntegrationKeysScreen({
  keys,
  agents,
  onCreateKey,
  onRevokeKey,
  onRefresh,
}: IntegrationKeysScreenProps) {
  const [newKey, setNewKey] = useState({ name: "", agentName: "" });
  const [activeKeyId, setActiveKeyId] = useState<string | null>(null);
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<{
    id: string;
    token: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [promptAgentName, setPromptAgentName] = useState("");
  const sortedKeys = useMemo(
    () =>
      [...keys].sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0)),
    [keys],
  );
  const selectedKey = sortedKeys.find((key) => key.id === activeKeyId) ?? null;
  const sortedAgents = useMemo(
    () => [...agents].sort((left, right) => left.name.localeCompare(right.name)),
    [agents],
  );

  useEscapeKey(createDrawerOpen || Boolean(selectedKey), () => {
    if (selectedKey) {
      setActiveKeyId(null);
      return;
    }
    if (createDrawerOpen) {
      setCreateDrawerOpen(false);
    }
  });

  const handleCreate = async () => {
    const name = newKey.name.trim();
    const agentName = newKey.agentName.trim();
    if (!name || !agentName) return;
    setStatus(null);
    setCopied(false);
    try {
      const created = await onCreateKey({ name, agentName });
      setCreatedSecret(created.token ? { id: created.id, token: created.token } : null);
      setNewKey({ name: "", agentName: "" });
      setCreateDrawerOpen(false);
      setActiveKeyId(created.id);
      setStatus(`Created key "${created.name}". Copy the token now; it will not be shown again.`);
      await onRefresh();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };

  const handleCopyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setCopied(false);
      setStatus("Could not copy token. Select it and copy manually.");
    }
  };

  const handleRevoke = async (key: IntegrationKey) => {
    if (key.revokedAt) return;
    const confirmed = window.confirm(
      `Revoke API key "${key.name}" (${key.tokenPrefix}…)? Requests using this token will fail immediately.`,
    );
    if (!confirmed) return;
    setRevoking(true);
    setStatus(null);
    try {
      await onRevokeKey(key.id);
      if (createdSecret?.id === key.id) setCreatedSecret(null);
      setStatus(`Revoked key "${key.name}".`);
      await onRefresh();
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setRevoking(false);
    }
  };

  const resolvedPromptAgent =
    promptAgentName || selectedKey?.agentName || sortedAgents[0]?.name || "your-agent-name";
  const embedPrompt = buildEmbedAgentPrompt({
    baseUrl: embedApiOrigin(),
    agentName: resolvedPromptAgent,
  });

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(embedPrompt);
      setPromptCopied(true);
    } catch {
      setPromptCopied(false);
      setStatus("Could not copy prompt. Select the text and copy manually.");
    }
  };

  const revealedToken =
    createdSecret && createdSecret.id === selectedKey?.id ? createdSecret.token : null;

  return (
    <div className="space-y-4">
      <Card title={`API keys (${sortedKeys.length})`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            Inbound credentials for embedding an OrgOps agent. The secret is shown once at create time.
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void onRefresh()}>
              Refresh
            </Button>
            <Button onClick={() => setCreateDrawerOpen(true)}>New API key</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-300">
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Agent</th>
                <th className="px-2 py-2">Prefix</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Last used</th>
              </tr>
            </thead>
            <tbody>
              {sortedKeys.map((key) => (
                <tr
                  key={key.id}
                  className={`cursor-pointer border-b border-slate-900 align-top hover:bg-slate-900/40 ${
                    activeKeyId === key.id ? "bg-slate-900/70" : ""
                  }`}
                  onClick={() => setActiveKeyId(key.id)}
                >
                  <td className="whitespace-nowrap px-2 py-2 text-slate-200">{key.name}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-slate-300">{key.agentName}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-xs text-slate-400">
                    {key.tokenPrefix}…
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        key.revokedAt
                          ? "bg-slate-800 text-slate-400"
                          : "bg-emerald-900/40 text-emerald-300"
                      }`}
                    >
                      {statusLabel(key)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-500">
                    {key.lastUsedAt ? formatTimestamp(key.lastUsedAt) : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sortedKeys.length === 0 && (
            <div className="py-8 text-center text-slate-500">No API keys yet.</div>
          )}
        </div>
      </Card>

      <Card title="Embed prompt">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-slate-500">
              Copy this into a coding agent in the embedding app. It is filled with this
              OrgOps API origin and the selected agent. The secret key is not included —
              paste the org_sk_ token separately.
            </div>
            <Label className="mt-3 block max-w-xs">
              Agent
              <Select
                className="mt-1"
                value={resolvedPromptAgent === "your-agent-name" ? "" : resolvedPromptAgent}
                onChange={(event) => {
                  setPromptAgentName(event.target.value);
                  setPromptCopied(false);
                }}
              >
                {sortedAgents.length === 0 ? (
                  <option value="">your-agent-name</option>
                ) : (
                  sortedAgents.map((agent) => (
                    <option key={agent.name} value={agent.name}>
                      {agent.name}
                    </option>
                  ))
                )}
              </Select>
            </Label>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="shrink-0 px-3 py-1 text-xs"
            onClick={() => void handleCopyPrompt()}
          >
            {promptCopied ? "Copied" : "Copy prompt"}
          </Button>
        </div>
        <Textarea
          readOnly
          rows={14}
          className="font-mono text-xs leading-5"
          value={embedPrompt}
          onFocus={(event) => event.currentTarget.select()}
        />
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
            <h3 className="text-sm font-semibold text-slate-100">Create API key</h3>
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
              Bind the key to one agent. The embedding app will send it as{" "}
              <span className="font-mono text-slate-300">Authorization: Bearer</span>.
            </div>
            <Label>
              Name
              <Input
                className="mt-1"
                placeholder="acme-invoicing"
                value={newKey.name}
                onChange={(event) => setNewKey((prev) => ({ ...prev, name: event.target.value }))}
              />
            </Label>
            <Label>
              Agent
              <Select
                className="mt-1"
                value={newKey.agentName}
                onChange={(event) =>
                  setNewKey((prev) => ({ ...prev, agentName: event.target.value }))
                }
              >
                <option value="">Select an agent</option>
                {sortedAgents.map((agent) => (
                  <option key={agent.name} value={agent.name}>
                    {agent.name}
                  </option>
                ))}
              </Select>
            </Label>
            {sortedAgents.length === 0 ? (
              <div className="text-sm text-amber-300">Create an agent before minting a key.</div>
            ) : null}
            {status && !selectedKey ? <div className="text-sm text-slate-300">{status}</div> : null}
          </div>
          <div className="mt-auto border-t border-slate-800 px-4 py-3">
            <Button
              onClick={() => void handleCreate()}
              disabled={!newKey.name.trim() || !newKey.agentName.trim()}
            >
              Create
            </Button>
          </div>
        </div>
      </aside>

      <div
        className={`pointer-events-none fixed inset-0 z-50 flex justify-end lg:left-56 ${
          selectedKey ? "" : "invisible"
        }`}
      >
        <div
          className={`pointer-events-auto flex h-full w-full max-w-3xl flex-col border-l border-slate-800 bg-slate-950/95 shadow-2xl transition-transform duration-300 ${
            selectedKey ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                {selectedKey ? selectedKey.name : "No key selected"}
              </h3>
              <p className="text-sm text-slate-500">
                {selectedKey ? `${selectedKey.agentName} · ${statusLabel(selectedKey)}` : "Select a key to view details."}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="px-2 py-1 text-xs"
              onClick={() => setActiveKeyId(null)}
            >
              Close
            </Button>
          </div>
          <div className="grid min-h-0 flex-1 gap-4 overflow-auto px-4 py-4">
            {selectedKey ? (
              <div className="space-y-3 rounded border border-slate-800 bg-slate-950 p-3">
                <h3 className="text-sm text-slate-300">Key details</h3>
                <div className="space-y-2 text-sm text-slate-300">
                  <div>
                    <span className="text-slate-500">Agent:</span> {selectedKey.agentName}
                  </div>
                  <div className="font-mono text-xs">
                    <span className="text-slate-500">Prefix:</span> {selectedKey.tokenPrefix}…
                  </div>
                  <div className="break-all">
                    <span className="text-slate-500">ID:</span> {selectedKey.id}
                  </div>
                  <div>
                    <span className="text-slate-500">Created:</span> {formatTimestamp(selectedKey.createdAt)}
                  </div>
                  <div>
                    <span className="text-slate-500">Last used:</span>{" "}
                    {selectedKey.lastUsedAt ? formatTimestamp(selectedKey.lastUsedAt) : "Never"}
                  </div>
                </div>
                {!selectedKey.revokedAt ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="bg-rose-950 text-rose-200 hover:bg-rose-900"
                    disabled={revoking}
                    onClick={() => void handleRevoke(selectedKey)}
                  >
                    Revoke key
                  </Button>
                ) : (
                  <div className="text-sm text-slate-400">
                    Revoked {formatTimestamp(selectedKey.revokedAt)}. This token can no longer authenticate.
                  </div>
                )}
              </div>
            ) : null}

            {revealedToken ? (
              <div className="space-y-2 rounded border border-amber-800/60 bg-slate-950 p-3 text-sm text-slate-200">
                <h3 className="text-sm text-amber-200">Secret token (shown once)</h3>
                <div className="break-all font-mono text-amber-300">{revealedToken}</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() => void handleCopyToken(revealedToken)}
                  >
                    {copied ? "Copied" : "Copy token"}
                  </Button>
                </div>
                <div className="text-xs text-slate-400">
                  Store this in the embedding app. You cannot view it again after leaving this page.
                </div>
              </div>
            ) : null}
          </div>
          {status && selectedKey ? (
            <div className="shrink-0 border-t border-slate-800 px-4 py-2 text-sm text-slate-300">
              {status}
            </div>
          ) : null}
        </div>
      </div>

      {selectedKey && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:left-56"
          onClick={() => setActiveKeyId(null)}
        />
      )}
    </div>
  );
}
