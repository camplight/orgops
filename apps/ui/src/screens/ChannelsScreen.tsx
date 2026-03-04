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
  const [error, setError] = useState<string | null>(null);
  const selectedChannel = channels.find((channel) => channel.id === activeChannelId) ?? null;
  const activeAgentParticipants = channelParticipants.filter(
    (participant) => participant.subscriberType === "AGENT"
  );

  const handleCreateChannel = async () => {
    setError(null);
    if (!newChannel.name.trim()) {
      setError("Channel name is required.");
      return;
    }
    await onCreateChannel(newChannel);
    setNewChannel({ name: "", description: "" });
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
    if (channel.kind?.includes("DM") || channel.kind === "DIRECT_GROUP") {
      const participants = (channel.participants ?? []).map(
        (participant) => `${participant.subscriberType}:${participant.subscriberId}`
      );
      if (participants.length > 0) return participants.join(" | ");
    }
    return channel.description;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <Card title="Channels">
        <div className="grid gap-3 space-y-4">
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
        </div>
        <Button onClick={handleCreateChannel}>Create</Button>
        {error && <div className="pt-2 text-sm text-rose-400">{error}</div>}
        <div className="pt-4 space-y-2 text-sm">
          <h3 className="text-slate-300">All Channels</h3>
          {channels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              className={`w-full text-left px-2 py-1 rounded ${
                activeChannelId === channel.id ? "bg-slate-800" : "hover:bg-slate-800"
              } text-slate-200`}
              onClick={() => handleChannelClick(channel.id)}
            >
              <div>{channel.name}</div>
              <div className="text-slate-500">{channelSubtitle(channel)}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Selected Channel">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-slate-200 text-sm">
                {selectedChannel ? selectedChannel.name : "No channel selected"}
              </h3>
              <p className="text-slate-500 text-sm">
                {selectedChannel
                  ? channelSubtitle(selectedChannel) ?? "No description"
                  : "Select a channel from the left to manage it."}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="px-2 py-1 text-xs text-rose-300 hover:text-rose-200"
              onClick={() =>
                selectedChannel && handleDeleteChannel(selectedChannel.id, selectedChannel.name)
              }
              disabled={!selectedChannel || deletingChannelId === selectedChannel.id}
            >
              Delete Channel
            </Button>
          </div>

          <div className="border-t border-slate-800 pt-4 space-y-3">
            <h3 className="text-slate-300 text-sm">Add Agent Participant</h3>
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

          <div className="border-t border-slate-800 pt-4 space-y-2">
            <h3 className="text-slate-300 text-sm">Current Agent Participants</h3>
            {activeChannelId ? (
              activeAgentParticipants.length > 0 ? (
                <div className="space-y-1 text-sm">
                  {activeAgentParticipants.map((participant) => (
                    <div
                      key={`${participant.subscriberType}:${participant.subscriberId}`}
                      className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 px-2 py-1 text-slate-300"
                    >
                      <span>{participant.subscriberId}</span>
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
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500">No agents subscribed yet.</div>
              )
            ) : (
              <div className="text-sm text-slate-500">Select a channel to view participants.</div>
            )}
          </div>

          <div className="border-t border-slate-800 pt-4 space-y-2">
            <h3 className="text-slate-300 text-sm">Channel Events</h3>
            <div className="space-y-2 text-sm max-h-80 overflow-auto">
              {activeChannelId ? (
                channelEvents.map((event) => (
                  <div key={event.id} className="border-b border-slate-800 pb-2">
                    <div className="text-slate-300">{event.type}</div>
                    <div className="text-slate-500 text-xs">
                      {event.source} • {formatTimestamp(event.createdAt)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-500">Select a channel to view events.</div>
              )}
              {activeChannelId && channelEvents.length === 0 ? (
                <div className="text-sm text-slate-500">No events yet for this channel.</div>
              ) : null}
            </div>
          </div>
          {error ? (
            <div className="text-sm text-rose-400">
              {error}
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
