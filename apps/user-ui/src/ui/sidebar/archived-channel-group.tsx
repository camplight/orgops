import { channelLabel } from "../../domain/conversations/channel-rules";
import type { Channel } from "../../types";

type ArchivedChannelGroupProps = {
  channels: Channel[];
  activeChannelId: string | null;
  username: string;
  expanded: boolean;
  onToggle: () => void;
  onSelectChannel: (channelId: string) => void;
};

export function ArchivedChannelGroup({
  channels,
  activeChannelId,
  username,
  expanded,
  onToggle,
  onSelectChannel
}: ArchivedChannelGroupProps) {
  return (
    <section className="channel-group">
      <button
        type="button"
        className="channel-group-toggle"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span>Archived</span>
        <em>{channels.length}</em>
        <strong>{expanded ? "-" : "+"}</strong>
      </button>

      {expanded ? (
        <div className="channel-group-items archived-channel-items">
          {channels.map((channel) => (
            <button
              key={channel.id}
              className={channel.id === activeChannelId ? "active" : undefined}
              onClick={() => onSelectChannel(channel.id)}
            >
              <span>{channelLabel(channel, username)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
