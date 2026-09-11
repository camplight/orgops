import { useMemo, useState } from "react";
import { Button, Card, Input, Label, Select } from "../components/ui";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { AgentInvite, Channel } from "../types";

type AgentInvitesScreenProps = {
  invites: AgentInvite[];
  channels: Channel[];
  onCreateInvite: (input: {
    agentName: string;
    visibility: "PUBLIC" | "PRIVATE";
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
  const [agentName, setAgentName] = useState("");
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [channelQuery, setChannelQuery] = useState("");
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [expiresAtIso, setExpiresAtIso] = useState("");
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
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
  const visibleChannels = useMemo(() => {
    const query = channelQuery.trim().toLowerCase();
    if (!query) return sortedChannels;
    return sortedChannels.filter((channel) => {
      const haystack = `${channel.name} ${channel.id}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [channelQuery, sortedChannels]);
  const selectedChannelNames = useMemo(() => {
    const byId = new Map(sortedChannels.map((channel) => [channel.id, channel.name]));
    return selectedChannelIds.map((id) => byId.get(id) ?? id);
  }, [selectedChannelIds, sortedChannels]);
  const selectedCount = selectedChannelIds.length;

  useEscapeKey(createDrawerOpen, () => {
    if (createDrawerOpen) {
      setCreateDrawerOpen(false);
      setChannelsOpen(false);
    }
  });

  const toggleChannel = (channelId: string) => {
    setSelectedChannelIds((prev) =>
      prev.includes(channelId)
        ? prev.filter((id) => id !== channelId)
        : [...prev, channelId],
    );
  };

  const handleCreate = async () => {
    const trimmedAgentName = agentName.trim();
    if (!trimmedAgentName) return;
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(trimmedAgentName)) {
      setStatus("Agent name must match ^[a-zA-Z0-9._-]{1,80}$.");
      return;
    }
    setBusy(true);
    setStatus(null);
    setLatestInviteLink(null);
    try {
      const expiresAt =
        expiresAtIso.trim().length > 0
          ? new Date(expiresAtIso).getTime()
          : undefined;
      const created = await onCreateInvite({
        agentName: trimmedAgentName,
        visibility,
        channelIds: selectedChannelIds,
        ...(expiresAt ? { expiresAt } : {}),
      });
      setStatus(`Created invite "${created.name}" for ${created.agentName}.`);
      setLatestInviteLink(created.inviteLink ?? null);
      setAgentName("");
      setVisibility("PUBLIC");
      setSelectedChannelIds([]);
      setChannelQuery("");
      setChannelsOpen(false);
      setExpiresAtIso("");
      setCreateDrawerOpen(false);
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
      <Card title={`Agent Invites (${sortedInvites.length})`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            Invite external wrapped agents to self-bootstrap into OrgOps with scoped runner auth.
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void onRefresh()}>
              Refresh
            </Button>
            <Button onClick={() => setCreateDrawerOpen(true)}>Create invite</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-300">
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Agent</th>
                <th className="px-2 py-2">Created by</th>
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
                      <div className="text-slate-200">
                        {invite.agentName}{" "}
                        <span className="text-xs text-slate-500">
                          ({invite.visibility === "PRIVATE" ? "private" : "public"})
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Channels:{" "}
                        {invite.channelIds.length > 0 ? invite.channelIds.join(", ") : "none"}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-slate-300">
                      {(invite.createdByType ?? "HUMAN").toLowerCase()}:
                      {" "}
                      {invite.createdById ?? invite.createdByHumanId ?? "unknown"}
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
            <div className="py-8 text-center text-slate-500">
              No invites yet. Create one to generate a one-time bootstrap link for an external agent.
            </div>
          ) : null}
        </div>
        {status ? <div className="mt-3 text-sm text-slate-300">{status}</div> : null}
        {latestInviteLink ? (
          <div className="mt-3 rounded border border-slate-800 bg-slate-900/40 p-2 text-sm">
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

      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity lg:left-56 ${
          createDrawerOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => {
          setCreateDrawerOpen(false);
          setChannelsOpen(false);
        }}
      />
      <aside
        className={`fixed bottom-0 right-0 top-0 z-50 w-full max-w-md border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-300 ${
          createDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!createDrawerOpen}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-100">Create Agent Invite</h3>
            <Button
              type="button"
              variant="secondary"
              className="px-2 py-1 text-xs"
              onClick={() => {
                setCreateDrawerOpen(false);
                setChannelsOpen(false);
              }}
            >
              Close
            </Button>
          </div>
          <div className="space-y-3 px-4 py-4">
            <div className="text-sm text-slate-400">
              Enter one agent name. Invite name is auto-generated from this name + timestamp.
            </div>
            <Label>
              Agent name
              <Input
                className="mt-1"
                placeholder="ClaudeWorker01"
                value={agentName}
                onChange={(event) => setAgentName(event.target.value)}
              />
            </Label>
            <Label>
              Agent visibility
              <Select
                className="mt-1"
                value={visibility}
                onChange={(event) =>
                  setVisibility(event.target.value === "PRIVATE" ? "PRIVATE" : "PUBLIC")
                }
              >
                <option value="PUBLIC">Public</option>
                <option value="PRIVATE">Private</option>
              </Select>
            </Label>
            <Label>
              Expires at
              <Input
                className="mt-1"
                type="datetime-local"
                value={expiresAtIso}
                onChange={(event) => setExpiresAtIso(event.target.value)}
              />
            </Label>
            <div className="space-y-1">
              <Label>Allowed channels (optional)</Label>
              <div className="relative">
                <button
                  type="button"
                  className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-left text-sm text-slate-200"
                  onClick={() => setChannelsOpen((current) => !current)}
                >
                  {selectedCount === 0
                    ? "No channels selected"
                    : `${selectedCount} channel${selectedCount === 1 ? "" : "s"} selected`}
                </button>
                {channelsOpen ? (
                  <div className="absolute z-20 mt-1 w-full rounded border border-slate-700 bg-slate-900 shadow-lg">
                    <div className="border-b border-slate-800 p-2">
                      <Input
                        placeholder="Search channels..."
                        value={channelQuery}
                        onChange={(event) => setChannelQuery(event.target.value)}
                      />
                    </div>
                    <div className="max-h-56 overflow-auto p-2">
                      {visibleChannels.length === 0 ? (
                        <div className="text-sm text-slate-500">No channels match.</div>
                      ) : (
                        <div className="space-y-1">
                          {visibleChannels.map((channel) => (
                            <label
                              key={channel.id}
                              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-slate-800"
                            >
                              <input
                                type="checkbox"
                                checked={selectedChannelIds.includes(channel.id)}
                                onChange={() => toggleChannel(channel.id)}
                              />
                              <span className="text-sm text-slate-200">{channel.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
              {selectedChannelNames.length > 0 ? (
                <div className="text-xs text-slate-500">
                  {selectedChannelNames.join(", ")}
                </div>
              ) : (
                <div className="text-xs text-slate-500">
                  Invite still works without channels; lifecycle channel access is always included.
                </div>
              )}
            </div>
          </div>
          <div className="mt-auto border-t border-slate-800 px-4 py-3">
            <Button onClick={() => void handleCreate()} disabled={busy || !agentName.trim()}>
              {busy ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
