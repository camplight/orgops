import { channelLabel } from "../../domain/conversations/channel-rules";
import type { Channel } from "../../types";

type ChannelGroupProps = {
  label: string;
  channels: Channel[];
  collapsed: boolean;
  activeChannelId: string | null;
  username: string;
  unreadCounts: Record<string, number>;
  onToggle: () => void;
  onSelectChannel: (channelId: string) => void;
};

export function ChannelGroup({
  label,
  channels,
  collapsed,
  activeChannelId,
  username,
  unreadCounts,
  onToggle,
  onSelectChannel
}: ChannelGroupProps) {
  return (
    <section className="channel-group">
      <button
        type="button"
        className="channel-group-toggle"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span>{label}</span>
        <em>{channels.length}</em>
        <strong>{collapsed ? "+" : "-"}</strong>
      </button>

      {!collapsed ? (
        <div className="channel-group-items">
          {channels.map((channel) => (
            <button
              key={channel.id}
              className={channel.id === activeChannelId ? "active" : undefined}
              onClick={() => onSelectChannel(channel.id)}
            >
              <span>{channelLabel(channel, username)}</span>
              {unreadCounts[channel.id] ? <em>{unreadCounts[channel.id]}</em> : null}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
