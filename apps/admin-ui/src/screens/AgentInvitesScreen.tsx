import { useMemo, useState } from "react";
import { Button, Card, Input } from "../components/ui";
import type { AgentInvite, Channel } from "../types";

type AgentInvitesScreenProps = {
  invites: AgentInvite[];
  channels: Channel[];
  onCreateInvite: (input: {
    name: string;
    agentName: string;
    channelIds: string[];
    expiresAt?: number;
  }) => Promise<AgentInvite>;
  onRevokeInvite: (id: string) => Promise<void>;
  onReissueInvite: (id: string) => Promise<AgentInvite>;
  onRefresh: () => Promise<void> | void;
};

function formatDate(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return "Never";
  return new Date(value).toLocaleString();
}

export function AgentInvitesScreen({
  invites,
  channels,
  onCreateInvite,
  onRevokeInvite,
  onReissueInvite,
  onRefresh,
}: AgentInvitesScreenProps) {
  const [name, setName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [expiresAtIso, setExpiresAtIso] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [latestInviteLink, setLatestInviteLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sortedInvites = useMemo(
    () => [...invites].sort((left, right) => right.createdAt - left.createdAt),
    [invites],
  );

  const sortedChannels = useMemo(
    () => [...channels].sort((left, right) => left.name.localeCompare(right.name)),
    [channels],
  );

  const toggleChannel = (channelId: string) => {
    setSelectedChannelIds((prev) =>
      prev.includes(channelId)
        ? prev.filter((id) => id !== channelId)
        : [...prev, channelId],
    );
  };

  const handleCreate = async () => {
    const trimmedName = name.trim();
    const trimmedAgentName = agentName.trim();
    if (!trimmedName || !trimmedAgentName || selectedChannelIds.length === 0) return;
    setBusy(true);
    setStatus(null);
    setLatestInviteLink(null);
    try {
      const expiresAt =
        expiresAtIso.trim().length > 0
          ? new Date(expiresAtIso).getTime()
          : undefined;
      const created = await onCreateInvite({
        name: trimmedName,
        agentName: trimmedAgentName,
        channelIds: selectedChannelIds,
        ...(expiresAt ? { expiresAt } : {}),
      });
      setStatus(`Created invite "${created.name}" for ${created.agentName}.`);
      setLatestInviteLink(created.inviteLink ?? null);
      setName("");
      setAgentName("");
      setSelectedChannelIds([]);
      setExpiresAtIso("");
      await onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create invite.");
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setBusy(true);
    setStatus(null);
    try {
      await onRevokeInvite(id);
      setStatus("Invite revoked.");
      await onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to revoke invite.");
    } finally {
      setBusy(false);
    }
  };

  const handleReissue = async (id: string) => {
    setBusy(true);
    setStatus(null);
    try {
      const updated = await onReissueInvite(id);
      setLatestInviteLink(updated.inviteLink ?? null);
      setStatus(`Invite reissued for "${updated.agentName}". Old link is invalidated.`);
      await onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to reissue invite.");
    } finally {
      setBusy(false);
    }
  };

  const handleCopyInvite = async (inviteLink: string | undefined) => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setStatus("Invite link copied.");
    } catch {
      setStatus(inviteLink);
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Create Agent Invite">
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            placeholder="Invite name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            placeholder="Wrapped agent name (e.g. ClaudeWorker01)"
            value={agentName}
            onChange={(event) => setAgentName(event.target.value)}
          />
          <Input
            type="datetime-local"
            value={expiresAtIso}
            onChange={(event) => setExpiresAtIso(event.target.value)}
          />
        </div>
        <div className="mt-3 space-y-2">
          <div className="text-sm text-slate-400">Allowed channels</div>
          <div className="max-h-48 overflow-auto rounded border border-slate-800 p-2">
            {sortedChannels.length === 0 ? (
              <div className="text-sm text-slate-500">No channels available.</div>
            ) : (
              <div className="space-y-1">
                {sortedChannels.map((channel) => (
                  <label
                    key={channel.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-slate-900/40"
                  >
                    <input
                      type="checkbox"
                      checked={selectedChannelIds.includes(channel.id)}
                      onChange={() => toggleChannel(channel.id)}
                    />
                    <span className="text-sm text-slate-200">{channel.name}</span>
                    <span className="text-xs text-slate-500">{channel.id}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button
            onClick={handleCreate}
            disabled={
              busy ||
              !name.trim() ||
              !agentName.trim() ||
              selectedChannelIds.length === 0
            }
          >
            {busy ? "Working..." : "Create invite"}
          </Button>
          <Button variant="secondary" onClick={() => void onRefresh()}>
            Refresh
          </Button>
        </div>
        {status ? <div className="mt-2 text-sm text-slate-300">{status}</div> : null}
        {latestInviteLink ? (
          <div className="mt-2 rounded border border-slate-800 bg-slate-900/40 p-2 text-sm">
            <div className="text-slate-300">Latest invite link</div>
            <div className="break-all font-mono text-amber-300">{latestInviteLink}</div>
            <div className="mt-2">
              <Button variant="secondary" onClick={() => void handleCopyInvite(latestInviteLink)}>
                Copy invite link
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card title={`Agent Invites (${sortedInvites.length})`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-300">
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Agent</th>
                <th className="px-2 py-2">Uses</th>
                <th className="px-2 py-2">Created</th>
                <th className="px-2 py-2">Expires</th>
                <th className="px-2 py-2">Last redeemed</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedInvites.map((invite) => {
                const exhausted = invite.useCount >= invite.maxUses;
                const revoked = Boolean(invite.revokedAt);
                return (
                  <tr key={invite.id} className="border-b border-slate-900 align-top">
                    <td className="px-2 py-2 text-slate-200">
                      <div>{invite.name}</div>
                      <div className="text-xs text-slate-500">{invite.id}</div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="text-slate-200">{invite.agentName}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        Channels: {invite.channelIds.join(", ")}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-slate-300">
                      {invite.useCount}/{invite.maxUses}
                      {exhausted ? " (exhausted)" : ""}
                      {revoked ? " (revoked)" : ""}
                    </td>
                    <td className="px-2 py-2 text-slate-300">{formatDate(invite.createdAt)}</td>
                    <td className="px-2 py-2 text-slate-300">{formatDate(invite.expiresAt)}</td>
                    <td className="px-2 py-2 text-slate-300">
                      {formatDate(invite.lastRedeemedAt)}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => void handleCopyInvite(invite.inviteLink)}
                          disabled={!invite.inviteLink}
                        >
                          Copy link
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void handleRevoke(invite.id)}
                          disabled={busy || revoked}
                        >
                          Revoke
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void handleReissue(invite.id)}
                          disabled={busy}
                        >
                          Reissue link
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sortedInvites.length === 0 ? (
            <div className="py-8 text-center text-slate-500">No invites created.</div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
