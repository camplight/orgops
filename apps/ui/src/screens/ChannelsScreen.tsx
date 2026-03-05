import { useState } from "react";
import type { Agent, Channel, ChannelParticipant, EventRow } from "../types";
import { Button, Card, Input, Select } from "../components/ui";
import { formatTimestamp } from "../utils/formatTimestamp";

type ChannelsScreenProps = {
  agents: Agent[];
  channels: Channel[];
  channelEvents: EventRow[];
  channelParticipants: ChannelParticipant[];
  activeChannelId: string | null;
  onSelectChannel: (id: string | null) => void;
  loadChannelEvents: (id: string) => Promise<unknown>;
  loadChannelParticipants: (id: string) => Promise<unknown>;
  onCreateChannel: (channel: { name: string; description: string }) => Promise<void>;
  onDeleteChannel: (id: string) => Promise<void>;
  onSubscribe: (channelId: string, agentName: string) => Promise<void>;
  onUnsubscribe: (channelId: string, agentName: string) => Promise<void>;
};

export function ChannelsScreen({
  agents,
  channels,
  channelEvents,
  channelParticipants,
  activeChannelId,
  onSelectChannel,
  loadChannelEvents,
  loadChannelParticipants,
  onCreateChannel,
  onDeleteChannel,
  onSubscribe,
  onUnsubscribe
}: ChannelsScreenProps) {
  const [newChannel, setNewChannel] = useState({ name: "", description: "" });
  const [newSubscription, setNewSubscription] = useState({ agentName: "" });
  const [deletingChannelId, setDeletingChannelId] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [unsubscribingAgent, setUnsubscribingAgent] = useState<string | null>(null);
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedChannel = channels.find((channel) => channel.id === activeChannelId) ?? null;
  const formatParticipantLabel = (participant: ChannelParticipant) => {
    if (participant.subscriberType === "HUMAN") {
      return `${participant.subscriberId} (human)`;
    }
    if (participant.subscriberType === "AGENT") {
      return `${participant.subscriberId} (agent)`;
    }
    return `${participant.subscriberId} (${participant.subscriberType.toLowerCase()})`;
  };
  const handleCreateChannel = async () => {
    setError(null);
    if (!newChannel.name.trim()) {
      setError("Channel name is required.");
      return;
    }
    await onCreateChannel(newChannel);
    setNewChannel({ name: "", description: "" });
    setCreateDrawerOpen(false);
  };

  const handleChannelClick = (id: string) => {
    onSelectChannel(id);
    loadChannelEvents(id);
    loadChannelParticipants(id);
  };

  const handleSubscribe = async () => {
    setError(null);
    if (!activeChannelId || !newSubscription.agentName.trim()) {
      setError("Select a channel and agent.");
      return;
    }
    setSubscribing(true);
    try {
      await onSubscribe(activeChannelId, newSubscription.agentName);
      await loadChannelParticipants(activeChannelId);
      setNewSubscription({ agentName: "" });
    } finally {
      setSubscribing(false);
    }
  };

  const handleUnsubscribeAgent = async (agentName: string) => {
    setError(null);
    if (!activeChannelId) {
      setError("Select a channel.");
      return;
    }
    setUnsubscribingAgent(agentName);
    try {
      await onUnsubscribe(activeChannelId, agentName);
      await loadChannelParticipants(activeChannelId);
    } finally {
      setUnsubscribingAgent(null);
    }
  };

  const handleDeleteChannel = async (id: string, name: string) => {
    setError(null);
    const confirmed = window.confirm(`Delete channel "${name}"? This cannot be undone.`);
    if (!confirmed) return;
    setDeletingChannelId(id);
    try {
      await onDeleteChannel(id);
      if (activeChannelId === id) {
        onSelectChannel(null);
      }
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : "Failed to delete channel.";
      setError(message);
    } finally {
      setDeletingChannelId(null);
    }
  };

  const channelSubtitle = (channel: Channel) => {
    const participants = (channel.participants ?? []).map((participant) =>
      formatParticipantLabel(participant)
    );
    if (participants.length > 0) {
      return participants.join(" | ");
    }
    return channel.description;
  };

  return (
    <div className="space-y-4">
      <Card title={`Channels (${channels.length})`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            Click a channel row to open details.
          </div>
          <Button onClick={() => setCreateDrawerOpen(true)}>New channel</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-300">
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Description / Participants</th>
                <th className="px-2 py-2">ID</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((channel) => (
                <tr
                  key={channel.id}
                  className={`cursor-pointer border-b border-slate-900 align-top hover:bg-slate-900/40 ${
                    activeChannelId === channel.id ? "bg-slate-900/70" : ""
                  }`}
                  onClick={() => handleChannelClick(channel.id)}
                >
                  <td className="whitespace-nowrap px-2 py-2 text-slate-200">{channel.name}</td>
                  <td className="max-w-[520px] px-2 py-2 text-slate-400">{channelSubtitle(channel)}</td>
                  <td className="max-w-[320px] truncate px-2 py-2 text-xs text-slate-500">
                    {channel.id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {channels.length === 0 && (
            <div className="py-8 text-center text-slate-500">No channels found.</div>
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
            <h3 className="text-sm font-semibold text-slate-100">Create Channel</h3>
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
              value={newChannel.name}
              onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
            />
            <Input
              placeholder="Description"
              value={newChannel.description}
              onChange={(e) =>
                setNewChannel({ ...newChannel, description: e.target.value })
              }
            />
            {error && <div className="text-sm text-rose-400">{error}</div>}
          </div>
          <div className="mt-auto border-t border-slate-800 px-4 py-3">
            <Button onClick={handleCreateChannel}>Create</Button>
          </div>
        </div>
      </aside>

      <div
        className={`pointer-events-none fixed bottom-0 left-0 right-0 z-50 flex items-end lg:left-56 ${
          selectedChannel ? "" : "invisible"
        }`}
      >
        <div
          className={`pointer-events-auto flex h-[70vh] w-full flex-col border-t border-slate-800 bg-slate-950/95 shadow-2xl transition-transform duration-300 ${
            selectedChannel ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                {selectedChannel ? selectedChannel.name : "No channel selected"}
              </h3>
              <p className="text-sm text-slate-500">
                {selectedChannel
                  ? channelSubtitle(selectedChannel) ?? "No description"
                  : "Select a channel to view details."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs text-rose-300 hover:text-rose-200"
                onClick={() =>
                  selectedChannel &&
                  handleDeleteChannel(selectedChannel.id, selectedChannel.name)
                }
                disabled={!selectedChannel || deletingChannelId === selectedChannel?.id}
              >
                Delete Channel
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={() => onSelectChannel(null)}
              >
                Close
              </Button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 overflow-auto px-4 py-4 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-3 rounded border border-slate-800 bg-slate-950 p-3">
                <h3 className="text-sm text-slate-300">Add Agent Participant</h3>
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <Select
                    value={newSubscription.agentName}
                    onChange={(e) =>
                      setNewSubscription({
                        agentName: e.target.value
                      })
                    }
                    disabled={!activeChannelId || subscribing}
                  >
                    <option value="">Select agent</option>
                    {agents.map((agent) => (
                      <option key={agent.name} value={agent.name}>
                        {agent.name}
                      </option>
                    ))}
                  </Select>
                  <Button onClick={handleSubscribe} disabled={!activeChannelId || subscribing}>
                    Add
                  </Button>
                </div>
              </div>

              <div className="space-y-2 rounded border border-slate-800 bg-slate-950 p-3">
                <h3 className="text-sm text-slate-300">Current Participants</h3>
                {selectedChannel && channelParticipants.length > 0 ? (
                  <div className="space-y-1 text-sm">
                    {channelParticipants.map((participant) => (
                      <div
                        key={`${participant.subscriberType}:${participant.subscriberId}`}
                        className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 px-2 py-1 text-slate-300"
                      >
                        <span>{formatParticipantLabel(participant)}</span>
                        {participant.subscriberType === "AGENT" ? (
                          <button
                            type="button"
                            className="rounded px-2 text-rose-300 hover:bg-slate-800 hover:text-rose-200 disabled:opacity-50"
                            onClick={() => handleUnsubscribeAgent(participant.subscriberId)}
                            disabled={unsubscribingAgent === participant.subscriberId}
                            aria-label={`Unsubscribe ${participant.subscriberId}`}
                            title={`Unsubscribe ${participant.subscriberId}`}
                          >
                            x
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500">managed</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">No participants yet.</div>
                )}
              </div>
            </div>

            <div className="space-y-2 rounded border border-slate-800 bg-slate-950 p-3">
              <h3 className="text-sm text-slate-300">Channel Events</h3>
              <div className="max-h-full space-y-2 overflow-auto pr-1 text-sm">
                {selectedChannel ? (
                  channelEvents.map((event) => (
                    <div key={event.id} className="border-b border-slate-800 pb-2">
                      <div className="text-slate-300">{event.type}</div>
                      <div className="text-xs text-slate-500">
                        {event.source} • {formatTimestamp(event.createdAt)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-500">Select a channel to view events.</div>
                )}
                {selectedChannel && channelEvents.length === 0 ? (
                  <div className="text-sm text-slate-500">No events yet for this channel.</div>
                ) : null}
              </div>
            </div>
          </div>

          {error && selectedChannel ? (
            <div className="shrink-0 border-t border-slate-800 px-4 py-2 text-sm text-rose-400">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      {selectedChannel && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:left-56"
          onClick={() => onSelectChannel(null)}
        />
      )}
      {error && !selectedChannel && !createDrawerOpen ? (
        <div className="text-sm text-rose-400">
          {error}
        </div>
      ) : null}
    </div>
  );
}
