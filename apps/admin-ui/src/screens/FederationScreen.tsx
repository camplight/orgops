import { useState } from "react";
import type { Channel, FederationChannelLink, FederationInstance } from "../types";
import { Button, Card, Input, Select } from "../components/ui";
import { formatTimestamp } from "../utils/formatTimestamp";

type FederationScreenProps = {
  instances: FederationInstance[];
  channelLinks: FederationChannelLink[];
  channels: Channel[];
  onRefresh: () => Promise<void> | void;
  onCreateInstance: (input: {
    name: string;
    baseUrl: string;
    outboundToken?: string;
  }) => Promise<FederationInstance>;
  onUpdateInstance: (id: string, input: { outboundToken?: string }) => Promise<void>;
  onDeleteInstance: (id: string) => Promise<void>;
  onCreateChannelLink: (input: {
    role: "LOCAL_HOME" | "REMOTE_PROJECTION";
    localChannelId?: string;
    localName?: string;
    homeInstanceId?: string;
    remoteChannelId?: string;
  }) => Promise<void>;
  onDeleteChannelLink: (
    localChannelId: string,
    input?: { deleteLocalChannel?: boolean },
  ) => Promise<void>;
  onSyncChannel: (localChannelId: string) => Promise<void>;
  onCreateJoinLink: (localChannelId: string) => Promise<{ joinUrl: string }>;
  onClearPendingJoinLinks: (channelId?: string) => Promise<{ deletedCount?: number } | void>;
  onJoinFromUrl: (input: { joinUrl: string; peerBaseUrl: string; localName?: string }) => Promise<void>;
};

export function FederationScreen({
  instances,
  channelLinks,
  channels,
  onRefresh,
  onCreateInstance,
  onUpdateInstance,
  onDeleteInstance,
  onCreateChannelLink,
  onDeleteChannelLink,
  onSyncChannel,
  onCreateJoinLink,
  onClearPendingJoinLinks,
  onJoinFromUrl,
}: FederationScreenProps) {
  const [instanceForm, setInstanceForm] = useState({
    name: "",
    baseUrl: "",
    outboundToken: "",
  });
  const [linkForm, setLinkForm] = useState({
    role: "REMOTE_PROJECTION" as "LOCAL_HOME" | "REMOTE_PROJECTION",
    localChannelId: "",
    localName: "",
    homeInstanceId: "",
    remoteChannelId: "",
  });
  const [createdInboundToken, setCreatedInboundToken] = useState<string>("");
  const [joinUrl, setJoinUrl] = useState("");
  const [joinPeerBaseUrl, setJoinPeerBaseUrl] = useState(() => window.location.origin);
  const [joinLocalName, setJoinLocalName] = useState("");
  const [hostChannelId, setHostChannelId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const instancesById = new Map(instances.map((instance) => [instance.id, instance]));
  const connectedInstances = instances.filter((instance) => instance.baseUrl.trim().length > 0);
  const pendingInviteCount = instances.length - connectedInstances.length;
  const localHomeLinks = channelLinks.filter((link) => link.role === "LOCAL_HOME");
  const remoteProjectionLinks = channelLinks.filter((link) => link.role === "REMOTE_PROJECTION");

  const createInstance = async () => {
    setError(null);
    setMessage(null);
    if (!instanceForm.name.trim() || !instanceForm.baseUrl.trim()) {
      setError("Peer name and base URL are required.");
      return;
    }
    setPending("instance");
    try {
      const created = await onCreateInstance({
        name: instanceForm.name.trim(),
        baseUrl: instanceForm.baseUrl.trim(),
        outboundToken: instanceForm.outboundToken.trim() || undefined,
      });
      setCreatedInboundToken(created.inboundToken ?? "");
      setInstanceForm({ name: "", baseUrl: "", outboundToken: "" });
      await onRefresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create peer.");
    } finally {
      setPending(null);
    }
  };

  const updateOutboundToken = async (instance: FederationInstance) => {
    const token = window.prompt(`Outbound token for ${instance.name}`, "");
    if (token === null) return;
    setPending(`token:${instance.id}`);
    setError(null);
    setMessage(null);
    try {
      await onUpdateInstance(instance.id, { outboundToken: token.trim() || undefined });
      await onRefresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update token.");
    } finally {
      setPending(null);
    }
  };

  const deleteInstance = async (instance: FederationInstance) => {
    const confirmed = window.confirm(
      `Remove peer "${instance.name}"? Remote projection links from this peer will be disconnected.`,
    );
    if (!confirmed) return;
    setPending(`delete-instance:${instance.id}`);
    setError(null);
    setMessage(null);
    try {
      await onDeleteInstance(instance.id);
      setMessage(`Removed peer "${instance.name}".`);
      await onRefresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to remove peer.");
    } finally {
      setPending(null);
    }
  };

  const createChannelLink = async () => {
    setError(null);
    setMessage(null);
    if (linkForm.role === "LOCAL_HOME" && !linkForm.localChannelId) {
      setError("Choose the local home channel.");
      return;
    }
    if (
      linkForm.role === "REMOTE_PROJECTION" &&
      (!linkForm.homeInstanceId || !linkForm.remoteChannelId.trim())
    ) {
      setError("Remote projections require a home instance and remote channel ID.");
      return;
    }
    setPending("channel-link");
    try {
      await onCreateChannelLink({
        role: linkForm.role,
        localChannelId: linkForm.localChannelId || undefined,
        localName: linkForm.localName.trim() || undefined,
        homeInstanceId: linkForm.homeInstanceId || undefined,
        remoteChannelId: linkForm.remoteChannelId.trim() || undefined,
      });
      setLinkForm({
        role: "REMOTE_PROJECTION",
        localChannelId: "",
        localName: "",
        homeInstanceId: "",
        remoteChannelId: "",
      });
      await onRefresh();
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Failed to create channel link.");
    } finally {
      setPending(null);
    }
  };

  const syncChannel = async (localChannelId: string) => {
    setPending(`sync:${localChannelId}`);
    setError(null);
    setMessage(null);
    try {
      await onSyncChannel(localChannelId);
      await onRefresh();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Failed to sync channel.");
    } finally {
      setPending(null);
    }
  };

  const deleteChannelLink = async (link: FederationChannelLink) => {
    const isProjection = link.role === "REMOTE_PROJECTION";
    const label = link.localChannelName ?? link.localChannelId;
    const confirmed = window.confirm(
      isProjection
        ? `Remove joined channel "${label}" and delete its local projection channel?`
        : `Stop sharing "${label}" through federation?`,
    );
    if (!confirmed) return;
    setPending(`delete-link:${link.localChannelId}`);
    setError(null);
    setMessage(null);
    try {
      await onDeleteChannelLink(link.localChannelId, {
        deleteLocalChannel: isProjection,
      });
      setMessage(isProjection ? "Deleted projection channel." : "Stopped sharing channel.");
      await onRefresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Failed to remove federation link.",
      );
    } finally {
      setPending(null);
    }
  };

  const clearPendingJoinLinks = async () => {
    const confirmed = window.confirm("Clear all pending federation join URLs?");
    if (!confirmed) return;
    setPending("clear-pending-join-links");
    setError(null);
    setMessage(null);
    try {
      const result = await onClearPendingJoinLinks();
      setMessage(`Cleared ${result?.deletedCount ?? 0} pending join URL(s).`);
      await onRefresh();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Failed to clear join URLs.");
    } finally {
      setPending(null);
    }
  };

  const createJoinLink = async (localChannelId: string) => {
    setPending(`join-link:${localChannelId}`);
    setError(null);
    setMessage(null);
    try {
      const result = await onCreateJoinLink(localChannelId);
      await navigator.clipboard?.writeText(result.joinUrl).catch(() => undefined);
      setCreatedInboundToken("");
      setMessage("Join URL copied to clipboard.");
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Failed to create join URL.");
    } finally {
      setPending(null);
    }
  };

  const hostChannelAndCopyJoinUrl = async () => {
    setError(null);
    setMessage(null);
    if (!hostChannelId) {
      setError("Choose a channel to host.");
      return;
    }
    setPending("host-channel");
    try {
      const existing = channelLinks.find(
        (link) => link.localChannelId === hostChannelId && link.role === "LOCAL_HOME",
      );
      if (!existing) {
        await onCreateChannelLink({ role: "LOCAL_HOME", localChannelId: hostChannelId });
      }
      const result = await onCreateJoinLink(hostChannelId);
      await navigator.clipboard?.writeText(result.joinUrl).catch(() => undefined);
      setMessage("Channel is hosted. Join URL copied to clipboard.");
      await onRefresh();
    } catch (hostError) {
      setError(hostError instanceof Error ? hostError.message : "Failed to host channel.");
    } finally {
      setPending(null);
    }
  };

  const joinFromUrl = async () => {
    setError(null);
    setMessage(null);
    if (!joinUrl.trim() || !joinPeerBaseUrl.trim()) {
      setError("Join URL and this instance base URL are required.");
      return;
    }
    setPending("join-url");
    try {
      await onJoinFromUrl({
        joinUrl: joinUrl.trim(),
        peerBaseUrl: joinPeerBaseUrl.trim(),
        localName: joinLocalName.trim() || undefined,
      });
      setJoinUrl("");
      setJoinLocalName("");
      setMessage("Joined federated channel.");
      await onRefresh();
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Failed to join federated channel.");
    } finally {
      setPending(null);
    }
  };

  const roleLabel = (role: string) => {
    if (role === "LOCAL_HOME") return "Hosted here";
    if (role === "REMOTE_PROJECTION") return "Joined";
    return role;
  };

  const homeLabel = (link: FederationChannelLink) => {
    if (link.role === "LOCAL_HOME") return "This instance";
    if (!link.homeInstanceId) return "-";
    return instancesById.get(link.homeInstanceId)?.name ?? link.homeInstanceId;
  };

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}
      {createdInboundToken ? (
        <div className="rounded border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          New inbound token, shown once:{" "}
          <code className="rounded bg-slate-950 px-1 py-0.5">{createdInboundToken}</code>
        </div>
      ) : null}
      {message ? (
        <div className="rounded border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
          {message}
        </div>
      ) : null}

      <Card title="Federation Setup">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded border border-slate-800 bg-slate-950 p-3">
            <div className="mb-1 text-sm font-medium text-slate-100">Join another OrgOps</div>
            <p className="mb-3 text-xs text-slate-500">
              Paste a join URL copied from the home instance. This creates the peer and local
              projection channel automatically.
            </p>
            <div className="space-y-2">
              <Input
                value={joinUrl}
                onChange={(event) => setJoinUrl(event.target.value)}
                placeholder="Paste federation join URL"
              />
              <div className="grid gap-2 md:grid-cols-2">
                <Input
                  value={joinPeerBaseUrl}
                  onChange={(event) => setJoinPeerBaseUrl(event.target.value)}
                  placeholder="This instance public base URL"
                />
                <Input
                  value={joinLocalName}
                  onChange={(event) => setJoinLocalName(event.target.value)}
                  placeholder="Optional local channel name"
                />
              </div>
              <Button onClick={() => void joinFromUrl()} disabled={pending === "join-url"}>
                {pending === "join-url" ? "Joining..." : "Join channel"}
              </Button>
            </div>
          </div>

          <div className="rounded border border-slate-800 bg-slate-950 p-3">
            <div className="mb-1 text-sm font-medium text-slate-100">Share a local channel</div>
            <p className="mb-3 text-xs text-slate-500">
              Choose a channel to host here, then copy one URL for the peer instance to paste.
            </p>
            <div className="space-y-2">
              <Select
                value={hostChannelId}
                onChange={(event) => setHostChannelId(event.target.value)}
              >
                <option value="">Choose local channel</option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </Select>
              <Button
                onClick={() => void hostChannelAndCopyJoinUrl()}
                disabled={pending === "host-channel"}
              >
                {pending === "host-channel" ? "Preparing..." : "Host and copy join URL"}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3">
          <div className="text-xs text-slate-500">
            Advanced setup is only needed for manual token exchange or debugging.
          </div>
          <Button variant="secondary" onClick={() => setShowAdvanced((value) => !value)}>
            {showAdvanced ? "Hide advanced" : "Show advanced"}
          </Button>
        </div>
      </Card>

      <Card title={`Peer Instances (${connectedInstances.length})`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            Peers appear here after another OrgOps joins or when you add one manually. Pending join
            URLs are not shown as peers
            {pendingInviteCount > 0 ? ` (${pendingInviteCount} pending)` : ""}.
          </div>
          {pendingInviteCount > 0 ? (
            <Button
              variant="secondary"
              className="px-2 py-1 text-xs"
              onClick={() => void clearPendingJoinLinks()}
              disabled={pending === "clear-pending-join-links"}
            >
              {pending === "clear-pending-join-links" ? "Clearing..." : "Clear pending URLs"}
            </Button>
          ) : null}
        </div>
        {showAdvanced ? (
        <div className="mb-4 grid gap-2 md:grid-cols-4">
          <Input
            value={instanceForm.name}
            onChange={(event) => setInstanceForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Peer name"
          />
          <Input
            value={instanceForm.baseUrl}
            onChange={(event) => setInstanceForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
            placeholder="https://orgops.example"
          />
          <Input
            value={instanceForm.outboundToken}
            onChange={(event) =>
              setInstanceForm((prev) => ({ ...prev, outboundToken: event.target.value }))
            }
            placeholder="Outbound token from peer"
          />
          <Button onClick={() => void createInstance()} disabled={pending === "instance"}>
            {pending === "instance" ? "Adding..." : "Add Peer"}
          </Button>
        </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-300">
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Base URL</th>
                <th className="px-2 py-2">Inbound Prefix</th>
                <th className="px-2 py-2">Outbound</th>
                <th className="px-2 py-2">Last Seen</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {connectedInstances.map((instance) => (
                <tr key={instance.id} className="border-b border-slate-900">
                  <td className="px-2 py-2 text-slate-100">{instance.name}</td>
                  <td className="px-2 py-2 text-slate-400">{instance.baseUrl}</td>
                  <td className="px-2 py-2 text-slate-400">{instance.inboundTokenPrefix ?? "-"}</td>
                  <td className="px-2 py-2 text-slate-400">
                    {instance.hasOutboundToken ? "configured" : "missing"}
                  </td>
                  <td className="px-2 py-2 text-slate-400">
                    {instance.lastSeenAt ? formatTimestamp(instance.lastSeenAt) : "-"}
                  </td>
                  <td className="space-x-2 px-2 py-2">
                    <Button
                      variant="secondary"
                      className="px-2 py-1 text-xs"
                      onClick={() => void updateOutboundToken(instance)}
                      disabled={pending === `token:${instance.id}`}
                    >
                      Set token
                    </Button>
                    <Button
                      variant="secondary"
                      className="px-2 py-1 text-xs text-red-200"
                      onClick={() => void deleteInstance(instance)}
                      disabled={pending === `delete-instance:${instance.id}`}
                    >
                      {pending === `delete-instance:${instance.id}` ? "Removing..." : "Remove"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {connectedInstances.length === 0 ? (
            <div className="py-4 text-center text-slate-500">No peer instances configured.</div>
          ) : null}
        </div>
      </Card>

      <Card title={`Federated Channels (${channelLinks.length})`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {localHomeLinks.length} hosted here, {remoteProjectionLinks.length} joined from peers.
          </div>
          <Button variant="secondary" onClick={() => void onRefresh()}>
            Refresh
          </Button>
        </div>
        {showAdvanced ? (
        <div className="mb-4 rounded border border-slate-800 bg-slate-950 p-3">
          <div className="mb-2 text-sm font-medium text-slate-200">Manual channel link</div>
        <div className="mb-4 grid gap-2 md:grid-cols-5">
          <Select
            value={linkForm.role}
            onChange={(event) =>
              setLinkForm((prev) => ({
                ...prev,
                role: event.target.value as "LOCAL_HOME" | "REMOTE_PROJECTION",
              }))
            }
          >
            <option value="REMOTE_PROJECTION">Remote projection</option>
            <option value="LOCAL_HOME">Local home</option>
          </Select>
          <Select
            value={linkForm.localChannelId}
            onChange={(event) =>
              setLinkForm((prev) => ({ ...prev, localChannelId: event.target.value }))
            }
          >
            <option value="">
              {linkForm.role === "REMOTE_PROJECTION" ? "Create local channel" : "Choose channel"}
            </option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </Select>
          <Input
            value={linkForm.localName}
            onChange={(event) => setLinkForm((prev) => ({ ...prev, localName: event.target.value }))}
            placeholder="Local projection name"
          />
          <Select
            value={linkForm.homeInstanceId}
            onChange={(event) =>
              setLinkForm((prev) => ({ ...prev, homeInstanceId: event.target.value }))
            }
            disabled={linkForm.role === "LOCAL_HOME"}
          >
            <option value="">Home instance</option>
            {connectedInstances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </Select>
          <Input
            value={linkForm.remoteChannelId}
            onChange={(event) =>
              setLinkForm((prev) => ({ ...prev, remoteChannelId: event.target.value }))
            }
            placeholder="Remote channel ID"
            disabled={linkForm.role === "LOCAL_HOME"}
          />
          <Button onClick={() => void createChannelLink()} disabled={pending === "channel-link"}>
            {pending === "channel-link" ? "Saving..." : "Save Link"}
          </Button>
        </div>
        </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-300">
                <th className="px-2 py-2">Local Channel</th>
                <th className="px-2 py-2">Role</th>
                <th className="px-2 py-2">Home</th>
                <th className="px-2 py-2">Remote Channel</th>
                <th className="px-2 py-2">Realtime</th>
                <th className="px-2 py-2">Cursor</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {channelLinks.map((link) => (
                <tr key={link.localChannelId} className="border-b border-slate-900">
                  <td className="px-2 py-2 text-slate-100">
                    {link.localChannelName ?? link.localChannelId}
                  </td>
                  <td className="px-2 py-2 text-slate-400">{roleLabel(link.role)}</td>
                  <td className="px-2 py-2 text-slate-400">{homeLabel(link)}</td>
                  <td className="max-w-[280px] truncate px-2 py-2 text-slate-400">
                    {link.remoteChannelId ?? "-"}
                  </td>
                  <td className="px-2 py-2 text-slate-400">
                    {link.role === "LOCAL_HOME" ? (
                      <span title={link.lastError ?? undefined}>
                        {link.subscriberCount ?? 0} subscriber
                        {(link.subscriberCount ?? 0) === 1 ? "" : "s"}
                        {link.lastAckAt ? `, ack ${formatTimestamp(link.lastAckAt)}` : ""}
                        {link.lastError ? " (error)" : ""}
                      </span>
                    ) : (
                      <span>pull fallback</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-slate-400">{link.syncCursor ?? "-"}</td>
                  <td className="space-x-2 px-2 py-2">
                    {link.role === "REMOTE_PROJECTION" ? (
                      <Button
                        variant="secondary"
                        className="px-2 py-1 text-xs"
                        onClick={() => void syncChannel(link.localChannelId)}
                        disabled={pending === `sync:${link.localChannelId}`}
                      >
                        {pending === `sync:${link.localChannelId}` ? "Syncing..." : "Sync"}
                      </Button>
                    ) : link.role === "LOCAL_HOME" ? (
                      <Button
                        variant="secondary"
                        className="px-2 py-1 text-xs"
                        onClick={() => void createJoinLink(link.localChannelId)}
                        disabled={pending === `join-link:${link.localChannelId}`}
                      >
                        {pending === `join-link:${link.localChannelId}` ? "Copying..." : "Copy Join URL"}
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-500">Home</span>
                    )}
                    <Button
                      variant="secondary"
                      className="px-2 py-1 text-xs text-red-200"
                      onClick={() => void deleteChannelLink(link)}
                      disabled={pending === `delete-link:${link.localChannelId}`}
                    >
                      {pending === `delete-link:${link.localChannelId}`
                        ? "Removing..."
                        : link.role === "REMOTE_PROJECTION"
                          ? "Delete projection"
                          : "Stop sharing"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {channelLinks.length === 0 ? (
            <div className="py-4 text-center text-slate-500">No federated channels configured.</div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
