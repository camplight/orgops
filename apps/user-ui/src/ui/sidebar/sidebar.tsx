import type { ChannelGroupId } from "../../domain/conversations/channel-rules";
import type { Channel } from "../../types";
import { ArchivedChannelGroup } from "./archived-channel-group";
import { ChannelGroup } from "./channel-group";

type SidebarProps = {
  mobileOpen: boolean;
  username: string;
  loading: boolean;
  channelQuery: string;
  isSearchingChannels: boolean;
  groupedChannels: Array<{ id: ChannelGroupId; label: string; channels: Channel[] }>;
  collapsedChannelGroups: Record<ChannelGroupId, boolean>;
  filteredChannels: Channel[];
  filteredArchivedChannels: Channel[];
  showArchivedChannels: boolean;
  activeChannelId: string | null;
  unreadCounts: Record<string, number>;
  onCloseMobile: () => void;
  onChannelQueryChange: (value: string) => void;
  onToggleChannelGroup: (groupId: ChannelGroupId) => void;
  onToggleArchivedChannels: () => void;
  onSelectChannel: (channelId: string) => void;
  onNewConversation: () => void;
  onLogout: () => void;
};

export function Sidebar({
  mobileOpen,
  username,
  loading,
  channelQuery,
  isSearchingChannels,
  groupedChannels,
  collapsedChannelGroups,
  filteredChannels,
  filteredArchivedChannels,
  showArchivedChannels,
  activeChannelId,
  unreadCounts,
  onCloseMobile,
  onChannelQueryChange,
  onToggleChannelGroup,
  onToggleArchivedChannels,
  onSelectChannel,
  onNewConversation,
  onLogout
}: SidebarProps) {
  return (
    <aside className={`sidebar ${mobileOpen ? "sidebar-mobile-open" : ""}`}>
      <button
        type="button"
        className="sidebar-mobile-close"
        onClick={onCloseMobile}
      >
        Close
      </button>
      <div className="brand">
        <div className="brand-mark">OO</div>
        <div>
          <strong>OrgOps</strong>
          <span>User workspace</span>
        </div>
      </div>

      <section className="sidebar-section">
        <label className="channel-search">
          <span>Search channels</span>
          <input
            value={channelQuery}
            onChange={(event) => onChannelQueryChange(event.target.value)}
            placeholder="Search channels..."
          />
        </label>
        <div className="channel-list">
          {groupedChannels.map((group) => {
            const isCollapsed = !isSearchingChannels && collapsedChannelGroups[group.id];
            return (
              <ChannelGroup
                key={group.id}
                label={group.label}
                channels={group.channels}
                collapsed={Boolean(isCollapsed)}
                activeChannelId={activeChannelId}
                username={username}
                unreadCounts={unreadCounts}
                onToggle={() => onToggleChannelGroup(group.id)}
                onSelectChannel={onSelectChannel}
              />
            );
          })}
          {filteredArchivedChannels.length > 0 ? (
            <ArchivedChannelGroup
              channels={filteredArchivedChannels}
              activeChannelId={activeChannelId}
              username={username}
              expanded={isSearchingChannels || showArchivedChannels}
              onToggle={onToggleArchivedChannels}
              onSelectChannel={onSelectChannel}
            />
          ) : null}
          {!loading &&
          channelQuery.trim() &&
          filteredChannels.length === 0 &&
          filteredArchivedChannels.length === 0 ? (
            <p className="channel-empty">No channels match "{channelQuery.trim()}".</p>
          ) : null}
        </div>
      </section>

      <section className="sidebar-section start-conversation">
        <button className="new-conversation-button" onClick={onNewConversation}>
          <span>New conversation</span>
          <kbd>Cmd+K</kbd>
        </button>
      </section>

      <section className="sidebar-section account-actions">
        <button className="logout-button" onClick={onLogout}>
          Sign out {username ? `(${username})` : ""}
        </button>
      </section>
    </aside>
  );
}
