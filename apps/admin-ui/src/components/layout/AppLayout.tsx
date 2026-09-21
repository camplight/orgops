import type { ReactNode } from "react";
import type { Screen } from "../../types";
import { PageHeader } from "./PageHeader";
import { Sidebar } from "./Sidebar";

type AppLayoutProps = {
  canManageCatalogs?: boolean;
  canManageSourceLibrary?: boolean;
  activeScreen: Screen;
  onScreenChange: (screen: Screen) => void;
  onScreenFocus?: (screen: Screen) => void;
  username?: string | null;
  onOpenProfile?: () => void;
  onLogout?: () => void;
  children: ReactNode;
};

export function AppLayout({
  activeScreen,
  canManageCatalogs = false,
  canManageSourceLibrary = canManageCatalogs,
  onScreenChange,
  onScreenFocus,
  username,
  onOpenProfile,
  onLogout,
  children
}: AppLayoutProps) {
  return (
    <div className="min-h-screen flex">
      <Sidebar
        canManageCatalogs={canManageCatalogs}
        canManageSourceLibrary={canManageSourceLibrary}
        activeScreen={activeScreen}
        onScreenChange={onScreenChange}
        onScreenFocus={onScreenFocus}
      />
      <div className="flex-1 min-w-0">
        <PageHeader
          title={activeScreen}
          username={username}
          onOpenProfile={onOpenProfile}
          onLogout={onLogout}
        />
        <main className="p-6 max-[640px]:p-3 space-y-6 min-w-0">{children}</main>
      </div>
    </div>
  );
}
