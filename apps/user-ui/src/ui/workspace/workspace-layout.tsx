import type { ComponentProps } from "react";
import { Sidebar } from "../sidebar/sidebar";
import { ActivityPanel } from "../activity/activity-panel";
import { ChannelDialogs } from "../dialogs/channel-dialogs";
import { ChatStack } from "./chat-stack";
import { WorkspaceHeader } from "./workspace-header";

type WorkspaceLayoutProps = {
  sidebar: ComponentProps<typeof Sidebar>;
  header: ComponentProps<typeof WorkspaceHeader>;
  chatStack: ComponentProps<typeof ChatStack>;
  activityPanel: ComponentProps<typeof ActivityPanel>;
  dialogs: ComponentProps<typeof ChannelDialogs>;
  mobileSidebarOpen: boolean;
  onCloseMobileSidebar: () => void;
  error: string | null;
  loading: boolean;
};

export function WorkspaceLayout({
  sidebar,
  header,
  chatStack,
  activityPanel,
  dialogs,
  mobileSidebarOpen,
  onCloseMobileSidebar,
  error,
  loading
}: WorkspaceLayoutProps) {
  return (
    <main className="app-shell">
      <Sidebar {...sidebar} />
      {mobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="sidebar-mobile-backdrop"
          onClick={onCloseMobileSidebar}
        />
      ) : null}

      <section className="workspace">
        <WorkspaceHeader {...header} />

        {error ? <div className="notice error">{error}</div> : null}
        {loading ? <div className="notice">Loading OrgOps...</div> : null}

        <ChatStack {...chatStack} />
      </section>

      <ActivityPanel {...activityPanel} />

      <ChannelDialogs {...dialogs} />
    </main>
  );
}
