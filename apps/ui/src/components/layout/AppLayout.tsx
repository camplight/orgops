import type { ReactNode } from "react";
import type { Screen } from "../../types";
import { PageHeader } from "./PageHeader";
import { Sidebar } from "./Sidebar";

type AppLayoutProps = {
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
        activeScreen={activeScreen}
        onScreenChange={onScreenChange}
        onScreenFocus={onScreenFocus}
      />
      <div className="flex-1">
        <PageHeader
          title={activeScreen}
          username={username}
          onOpenProfile={onOpenProfile}
          onLogout={onLogout}
        />
        <main className="p-6 space-y-6">{children}</main>
      </div>
    </div>
  );
}
