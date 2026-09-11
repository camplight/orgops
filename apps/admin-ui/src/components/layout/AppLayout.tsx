import { useState, type ReactNode } from "react";
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-dvh flex flex-col md:flex-row">
      {mobileNavOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-slate-950/65 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}
      <Sidebar
        activeScreen={activeScreen}
        onScreenChange={(screen) => {
          onScreenChange(screen);
          setMobileNavOpen(false);
        }}
        onScreenFocus={onScreenFocus}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />
      <div className="flex-1 min-w-0">
        <PageHeader
          title={activeScreen}
          username={username}
          onOpenProfile={onOpenProfile}
          onLogout={onLogout}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
        <main className="p-3 md:p-6 space-y-6">{children}</main>
      </div>
    </div>
  );
}
