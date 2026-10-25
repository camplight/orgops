import type { Channel } from "../../types";
import { channelLabel } from "../../domain/conversations/channel-rules";

type WorkspaceHeaderProps = {
  activeChannel: Channel | null;
  username: string;
  activeChannelCanPost: boolean;
  activeChannelManageable: boolean;
  onOpenMobileSidebar: () => void;
  onManageChannel: () => void;
};

export function WorkspaceHeader({
  activeChannel,
  username,
  activeChannelCanPost,
  activeChannelManageable,
  onOpenMobileSidebar,
  onManageChannel
}: WorkspaceHeaderProps) {
  return (
    <header className="workspace-header">
      <button type="button" className="sidebar-mobile-toggle" onClick={onOpenMobileSidebar}>
        Menu
      </button>
      <div>
        <span>Workspace</span>
        <div className="workspace-title-row">
          <h1>{channelLabel(activeChannel, username)}</h1>
        </div>
        <p>
          {activeChannel?.archivedAt
            ? "Archived channel"
            : activeChannel && !activeChannelCanPost
              ? "Read-only shared channel"
            : activeChannel?.description || "Talk to the team and agents in plain language."}
        </p>
      </div>
      {activeChannel && activeChannelManageable ? (
        <div className="channel-actions">
          <button type="button" onClick={onManageChannel}>
            Manage channel
          </button>
        </div>
      ) : null}
    </header>
  );
}
