import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Label, Select } from "../components/ui";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { AgentInvite, Channel, Human } from "../types";

type AgentInvitesScreenProps = {
  invites: AgentInvite[];
  channels: Channel[];
  humans: Human[];
  currentHumanId: string | null;
  onCreateInvite: (input: {
    agentName: string;
    visibility: "PUBLIC" | "PRIVATE";
    ownerHumanId?: string | null;
    runnerScopeMode: "SCOPED" | "GLOBAL";
    allowChannelExpansion: boolean;
    channelIds: string[];
    expiresAt?: number;
  }) => Promise<AgentInvite>;
  onRevokeInvite: (id: string) => Promise<void>;
  onDeleteInvite: (id: string) => Promise<void>;
  onReissueInvite: (id: string) => Promise<AgentInvite>;
  onPromoteInviteGlobal: (
    id: string,
  ) => Promise<{ invite: AgentInvite; promotedScopedRunnerTokenCount: number }>;
  onEnableChannelExpansion: (
    id: string,
  ) => Promise<{ invite: AgentInvite; updatedScopedRunnerTokenCount: number }>;
  onRefresh: () => Promise<void> | void;
};

function formatDate(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return "Never";
  return new Date(value).toLocaleString();
}

export function AgentInvitesScreen({
  invites,
  channels,
  humans,
  currentHumanId,
  onCreateInvite,
  onRevokeInvite,
  onDeleteInvite,
  onReissueInvite,
  onPromoteInviteGlobal,
  onEnableChannelExpansion,
  onRefresh,
}: AgentInvitesScreenProps) {
  const [agentName, setAgentName] = useState("");
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [ownerHumanId, setOwnerHumanId] = useState<string | null>(currentHumanId);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [runnerScopeMode, setRunnerScopeMode] = useState<"SCOPED" | "GLOBAL">("SCOPED");
  const [allowChannelExpansion, setAllowChannelExpansion] = useState(false);
  const [channelQuery, setChannelQuery] = useState("");
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [expiresAtIso, setExpiresAtIso] = useState("");
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [selectedInviteId, setSelectedInviteId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [latestInviteLink, setLatestInviteLink] = useState<{
    inviteName: string;
    link: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const sortedInvites = useMemo(
    () => [...invites].sort((left, right) => right.createdAt - left.createdAt),
    [invites],
  );

  const sortedChannels = useMemo(
    () => [...channels].sort((left, right) => left.name.localeCompare(right.name)),
    [channels],
  );
  const sortedHumans = useMemo(
    () => [...humans].sort((left, right) => left.username.localeCompare(right.username)),
    [humans],
  );
  const humanNameById = useMemo(
    () => new Map(sortedHumans.map((human) => [human.id, human.username])),
    [sortedHumans],
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
  const channelExpansionRequired =
    runnerScopeMode === "SCOPED" && selectedChannelIds.length === 0;
  const selectedInvite = useMemo(
    () => sortedInvites.find((invite) => invite.id === selectedInviteId) ?? null,
    [selectedInviteId, sortedInvites],
  );
  const drawerOpen = createDrawerOpen || Boolean(selectedInvite);

  useEffect(() => {
    if (visibility === "PRIVATE" && !ownerHumanId && currentHumanId) {
      setOwnerHumanId(currentHumanId);
    }
  }, [currentHumanId, ownerHumanId, visibility]);

  const closeDrawers = () => {
    setCreateDrawerOpen(false);
    setChannelsOpen(false);
    setSelectedInviteId(null);
  };

  const openCreateDrawer = () => {
    setSelectedInviteId(null);
    setOwnerHumanId(currentHumanId);
    setCreateDrawerOpen(true);
  };

  const openInviteDrawer = (inviteId: string) => {
    setCreateDrawerOpen(false);
    setChannelsOpen(false);
    setSelectedInviteId(inviteId);
  };

  useEscapeKey(drawerOpen, () => {
    if (drawerOpen) closeDrawers();
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
    if (visibility === "PRIVATE" && !ownerHumanId) {
      setStatus("Choose an owner for private invites.");
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
        ...(visibility === "PRIVATE" ? { ownerHumanId } : {}),
        runnerScopeMode,
        allowChannelExpansion:
          runnerScopeMode === "SCOPED" && (channelExpansionRequired || allowChannelExpansion),
        channelIds: selectedChannelIds,
        ...(expiresAt ? { expiresAt } : {}),
      });
      setStatus(`Created invite "${created.name}" for ${created.agentName}.`);
      setLatestInviteLink(
        created.inviteLink ? { inviteName: created.name, link: created.inviteLink } : null,
      );
      setAgentName("");
      setVisibility("PUBLIC");
      setOwnerHumanId(currentHumanId);
      setRunnerScopeMode("SCOPED");
      setAllowChannelExpansion(false);
      setSelectedChannelIds([]);
      setChannelQuery("");
      setChannelsOpen(false);
      setExpiresAtIso("");
      closeDrawers();
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

  const handleDelete = async (id: string, inviteName: string) => {
    const confirmed = window.confirm(
      `Delete invite "${inviteName}"?\n\nThis removes the invite record and invalidates its invite link. Already redeemed runner tokens are not changed.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setStatus(null);
    try {
      await onDeleteInvite(id);
      setStatus(`Invite "${inviteName}" deleted.`);
      if (latestInviteLink?.inviteName === inviteName) setLatestInviteLink(null);
      closeDrawers();
      await onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to delete invite.");
    } finally {
      setBusy(false);
    }
  };

  const handleReissue = async (id: string) => {
    setBusy(true);
    setStatus(null);
    try {
      const updated = await onReissueInvite(id);
      setLatestInviteLink(
        updated.inviteLink ? { inviteName: updated.name, link: updated.inviteLink } : null,
      );
      setStatus(`Invite reissued for "${updated.agentName}". Old link is invalidated.`);
      await onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to reissue invite.");
    } finally {
      setBusy(false);
    }
  };

  const handlePromoteGlobal = async (id: string, inviteName: string) => {
    const confirmed = window.confirm(
      `Promote invite "${inviteName}" to global scope?\n\nThis removes scoped runner restrictions for this invite and all non-revoked redeemed runner tokens from it.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await onPromoteInviteGlobal(id);
      const promotedCount = result.promotedScopedRunnerTokenCount;
      setStatus(
        promotedCount > 0
          ? `Invite "${result.invite.name}" is now global. Promoted ${promotedCount} scoped runner token${promotedCount === 1 ? "" : "s"}.`
          : `Invite "${result.invite.name}" is now global.`,
      );
      await onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to promote invite to global.");
    } finally {
      setBusy(false);
    }
  };

  const handleEnableChannelExpansion = async (id: string, inviteName: string) => {
    const confirmed = window.confirm(
      `Enable channel expansion for invite "${inviteName}"?\n\nRedeemed scoped runner tokens from this invite will be able to respond in channels where the agent is added as a participant.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await onEnableChannelExpansion(id);
      const updatedCount = result.updatedScopedRunnerTokenCount;
      setStatus(
        updatedCount > 0
          ? `Channel expansion enabled for "${result.invite.name}". Updated ${updatedCount} scoped runner token${updatedCount === 1 ? "" : "s"}.`
          : `Channel expansion enabled for "${result.invite.name}".`,
      );
      await onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to enable channel expansion.");
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
            <Button onClick={openCreateDrawer}>Create invite</Button>
          </div>
        </div>
        {latestInviteLink ? (
          <div className="mb-3 rounded border border-amber-700/40 bg-amber-900/20 p-3 text-sm">
            <div className="text-slate-300">
              Latest invite link generated for{" "}
              <span className="font-medium text-slate-100">{latestInviteLink.inviteName}</span>
            </div>
            <div className="mt-1 break-all font-mono text-amber-300">
              {latestInviteLink.link}
            </div>
            <div className="mt-2">
              <Button
                variant="secondary"
                onClick={() => void handleCopyInvite(latestInviteLink.link)}
              >
                Copy invite link
              </Button>
            </div>
          </div>
        ) : null}
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
                      <div className="mt-1 text-xs text-slate-500">
                        Runner scope: {(invite.runnerScopeMode ?? "SCOPED").toLowerCase()}
                      </div>
                      {(invite.runnerScopeMode ?? "SCOPED") === "SCOPED" ? (
                        <div className="mt-1 text-xs text-slate-500">
                          Channel expansion: {invite.allowChannelExpansion ? "enabled" : "disabled"}
                        </div>
                      ) : null}
                      {invite.visibility === "PRIVATE" ? (
                        <div className="mt-1 text-xs text-slate-500">
                          Owner:{" "}
                          {invite.ownerHumanId
                            ? humanNameById.get(invite.ownerHumanId) ?? invite.ownerHumanId
                            : "none"}
                        </div>
                      ) : null}
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
                          onClick={() => openInviteDrawer(invite.id)}
                        >
                          Manage
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
      </Card>

      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity lg:left-56 ${
          drawerOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={closeDrawers}
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
              onClick={closeDrawers}
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
                onChange={(event) => {
                  const next = event.target.value === "PRIVATE" ? "PRIVATE" : "PUBLIC";
                  setVisibility(next);
                  if (next === "PRIVATE" && !ownerHumanId) {
                    setOwnerHumanId(currentHumanId);
                  }
                }}
              >
                <option value="PUBLIC">Public</option>
                <option value="PRIVATE">Private</option>
              </Select>
            </Label>
            {visibility === "PRIVATE" ? (
              <Label>
                Owner
                <Select
                  className="mt-1"
                  value={ownerHumanId ?? ""}
                  onChange={(event) => setOwnerHumanId(event.target.value || null)}
                >
                  <option value="" disabled>
                    Choose a human owner
                  </option>
                  {sortedHumans.map((human) => (
                    <option key={human.id} value={human.id}>
                      {human.username}
                      {human.id === currentHumanId ? " (you)" : ""}
                    </option>
                  ))}
                </Select>
                <div className="mt-1 text-xs text-slate-500">
                  Private invited agents need a human owner so their scoped runner can manage
                  wrapped runtime config after redemption.
                </div>
              </Label>
            ) : null}
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
            <Label>
              Runner scope
              <Select
                className="mt-1"
                value={runnerScopeMode}
                onChange={(event) =>
                  setRunnerScopeMode(event.target.value === "GLOBAL" ? "GLOBAL" : "SCOPED")
                }
              >
                <option value="SCOPED">Scoped (recommended)</option>
                <option value="GLOBAL">Global (acts like normal runner token)</option>
              </Select>
            </Label>
            {runnerScopeMode === "GLOBAL" ? (
              <div className="rounded border border-amber-700/40 bg-amber-900/20 p-2 text-xs text-amber-200">
                Global scope removes invite channel/agent/runner restrictions for this redeemed token.
                Use only for trusted environments.
              </div>
            ) : (
              <label className="flex items-start gap-2 rounded border border-slate-800 bg-slate-900/40 p-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={channelExpansionRequired || allowChannelExpansion}
                  disabled={channelExpansionRequired}
                  onChange={(event) => setAllowChannelExpansion(event.target.checked)}
                />
                <span>
                  Allow channel expansion after redeem. The scoped runner can respond in later
                  channels where this agent is added as a participant.
                  {channelExpansionRequired ? " Required when no initial channels are selected." : ""}
                </span>
              </label>
            )}
          </div>
          <div className="mt-auto border-t border-slate-800 px-4 py-3">
            <Button onClick={() => void handleCreate()} disabled={busy || !agentName.trim()}>
              {busy ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </aside>

      <aside
        className={`fixed bottom-0 right-0 top-0 z-50 w-full max-w-lg border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-300 ${
          selectedInvite ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!selectedInvite}
      >
        {selectedInvite ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Invite Details</h3>
                <div className="text-xs text-slate-500">{selectedInvite.id}</div>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={closeDrawers}
              >
                Close
              </Button>
            </div>

            <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
              <section className="rounded border border-slate-800 bg-slate-900/40 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Invite</div>
                <div className="mt-2 space-y-2 text-sm">
                  <div>
                    <div className="text-xs text-slate-500">Name</div>
                    <div className="text-slate-100">{selectedInvite.name}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Agent</div>
                    <div className="text-slate-100">
                      {selectedInvite.agentName}{" "}
                      <span className="text-xs text-slate-500">
                        ({selectedInvite.visibility === "PRIVATE" ? "private" : "public"})
                      </span>
                    </div>
                  </div>
                  {selectedInvite.visibility === "PRIVATE" ? (
                    <div>
                      <div className="text-xs text-slate-500">Owner</div>
                      <div className="text-slate-100">
                        {selectedInvite.ownerHumanId
                          ? humanNameById.get(selectedInvite.ownerHumanId) ??
                            selectedInvite.ownerHumanId
                          : "none"}
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <div className="text-xs text-slate-500">Created by</div>
                    <div className="text-slate-100">
                      {(selectedInvite.createdByType ?? "HUMAN").toLowerCase()}:{" "}
                      {selectedInvite.createdById ??
                        selectedInvite.createdByHumanId ??
                        "unknown"}
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded border border-slate-800 bg-slate-900/40 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Scope</div>
                <div className="mt-2 space-y-2 text-sm">
                  <div>
                    <div className="text-xs text-slate-500">Runner scope</div>
                    <div className="text-slate-100">
                      {(selectedInvite.runnerScopeMode ?? "SCOPED").toLowerCase()}
                    </div>
                  </div>
                  {(selectedInvite.runnerScopeMode ?? "SCOPED") === "SCOPED" ? (
                    <div>
                      <div className="text-xs text-slate-500">Channel expansion</div>
                      <div className="text-slate-100">
                        {selectedInvite.allowChannelExpansion ? "enabled" : "disabled"}
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <div className="text-xs text-slate-500">Initial channels</div>
                    <div className="break-words text-slate-100">
                      {selectedInvite.channelIds.length > 0
                        ? selectedInvite.channelIds.join(", ")
                        : "none"}
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded border border-slate-800 bg-slate-900/40 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Lifecycle</div>
                <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-slate-500">Uses</div>
                    <div className="text-slate-100">
                      {selectedInvite.useCount}/{selectedInvite.maxUses}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Status</div>
                    <div className="text-slate-100">
                      {selectedInvite.revokedAt
                        ? "revoked"
                        : selectedInvite.useCount >= selectedInvite.maxUses
                          ? "exhausted"
                          : "active"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Created</div>
                    <div className="text-slate-100">{formatDate(selectedInvite.createdAt)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Expires</div>
                    <div className="text-slate-100">{formatDate(selectedInvite.expiresAt)}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs text-slate-500">Last redeemed</div>
                    <div className="text-slate-100">
                      {formatDate(selectedInvite.lastRedeemedAt)}
                    </div>
                  </div>
                </div>
              </section>

              {selectedInvite.inviteLink ? (
                <section className="rounded border border-slate-800 bg-slate-900/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Invite link</div>
                  <div className="mt-2 break-all font-mono text-xs text-amber-300">
                    {selectedInvite.inviteLink}
                  </div>
                </section>
              ) : null}

              {status ? <div className="text-sm text-slate-300">{status}</div> : null}
            </div>

            <div className="space-y-2 border-t border-slate-800 px-4 py-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void handleCopyInvite(selectedInvite.inviteLink)}
                  disabled={!selectedInvite.inviteLink}
                >
                  Copy link
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void handleReissue(selectedInvite.id)}
                  disabled={busy}
                >
                  Reissue link
                </Button>
                {(selectedInvite.runnerScopeMode ?? "SCOPED") === "SCOPED" &&
                !selectedInvite.allowChannelExpansion ? (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void handleEnableChannelExpansion(selectedInvite.id, selectedInvite.name)
                    }
                    disabled={busy}
                  >
                    Enable channel expansion
                  </Button>
                ) : null}
                {(selectedInvite.runnerScopeMode ?? "SCOPED") === "SCOPED" ? (
                  <Button
                    variant="secondary"
                    onClick={() => void handlePromoteGlobal(selectedInvite.id, selectedInvite.name)}
                    disabled={busy}
                  >
                    Promote to global
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  onClick={() => void handleRevoke(selectedInvite.id)}
                  disabled={busy || Boolean(selectedInvite.revokedAt)}
                >
                  Revoke
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void handleDelete(selectedInvite.id, selectedInvite.name)}
                  disabled={busy}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
