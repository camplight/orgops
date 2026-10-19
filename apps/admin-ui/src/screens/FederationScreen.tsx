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
  onCreateChannelLink: (input: {
    role: "LOCAL_HOME" | "REMOTE_PROJECTION";
    localChannelId?: string;
    localName?: string;
    homeInstanceId?: string;
    remoteChannelId?: string;
  }) => Promise<void>;
  onSyncChannel: (localChannelId: string) => Promise<void>;
  onCreateJoinLink: (localChannelId: string) => Promise<{ joinUrl: string }>;
  onJoinFromUrl: (input: { joinUrl: string; peerBaseUrl: string; localName?: string }) => Promise<void>;
};

export function FederationScreen({
  instances,
  channelLinks,
  channels,
  onRefresh,
  onCreateInstance,
  onUpdateInstance,
  onCreateChannelLink,
  onSyncChannel,
  onCreateJoinLink,
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
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const instancesById = new Map(instances.map((instance) => [instance.id, instance]));

  const createInstance = async () => {
    setError(null);
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
    try {
      await onUpdateInstance(instance.id, { outboundToken: token.trim() || undefined });
      await onRefresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update token.");
    } finally {
      setPending(null);
    }
  };

  const createChannelLink = async () => {
    setError(null);
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
    try {
      await onSyncChannel(localChannelId);
      await onRefresh();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Failed to sync channel.");
    } finally {
      setPending(null);
    }
  };

  const createJoinLink = async (localChannelId: string) => {
    setPending(`join-link:${localChannelId}`);
    setError(null);
    try {
      const result = await onCreateJoinLink(localChannelId);
      await navigator.clipboard?.writeText(result.joinUrl).catch(() => undefined);
      setCreatedInboundToken("");
      setError(null);
      window.alert("Federation join URL copied to clipboard.");
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Failed to create join URL.");
    } finally {
      setPending(null);
    }
  };

  const joinFromUrl = async () => {
    setError(null);
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
      await onRefresh();
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Failed to join federated channel.");
    } finally {
      setPending(null);
    }
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

      <Card title="Peer Instances">
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
              {instances.map((instance) => (
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
                  <td className="px-2 py-2">
                    <Button
                      variant="secondary"
                      className="px-2 py-1 text-xs"
                      onClick={() => void updateOutboundToken(instance)}
                      disabled={pending === `token:${instance.id}`}
                    >
                      Set token
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {instances.length === 0 ? (
            <div className="py-4 text-center text-slate-500">No peer instances configured.</div>
          ) : null}
        </div>
      </Card>

      <Card title="Federated Channels">
        <div className="mb-4 rounded border border-slate-800 bg-slate-950 p-3">
          <div className="mb-2 text-sm font-medium text-slate-200">Join From URL</div>
          <div className="grid gap-2 md:grid-cols-4">
            <Input
              value={joinUrl}
              onChange={(event) => setJoinUrl(event.target.value)}
              placeholder="Paste federation join URL"
            />
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
            <Button onClick={() => void joinFromUrl()} disabled={pending === "join-url"}>
              {pending === "join-url" ? "Joining..." : "Join Channel"}
            </Button>
          </div>
        </div>
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
            {instances.map((instance) => (
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
                  <td className="px-2 py-2 text-slate-400">{link.role}</td>
                  <td className="px-2 py-2 text-slate-400">
                    {link.homeInstanceId ? instancesById.get(link.homeInstanceId)?.name ?? link.homeInstanceId : "local"}
                  </td>
                  <td className="px-2 py-2 text-slate-400">{link.remoteChannelId ?? "-"}</td>
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
                  <td className="px-2 py-2">
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
