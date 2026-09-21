import type { Screen } from "../../types";

type SidebarProps = {
  canManageCatalogs?: boolean;
  canManageSourceLibrary?: boolean;
  activeScreen: Screen;
  onScreenChange: (screen: Screen) => void;
  onScreenFocus?: (screen: Screen) => void;
};

const NAV_ITEMS: { screen: Screen; label: string }[] = [
  { screen: "dashboard", label: "Dashboard" },
  { screen: "agents", label: "Agents" },
  { screen: "runners", label: "Runners" },
  { screen: "teams", label: "Teams" },
  { screen: "channels", label: "Channels" },
  { screen: "chat", label: "Chat" },
  { screen: "events", label: "Events Explorer" },
  { screen: "processes", label: "Processes" },
  { screen: "skills", label: "Skills" },
  { screen: "source-library", label: "Source Library" },
  { screen: "secrets", label: "Secrets" },
  { screen: "api-keys", label: "API keys" },
  { screen: "agent-invites", label: "Agent invites" },
  { screen: "humans", label: "Humans" },
  { screen: "profile", label: "Profile" }
];

export function Sidebar({
  activeScreen,
  onScreenChange,
  onScreenFocus,
  canManageCatalogs = false,
  canManageSourceLibrary = canManageCatalogs
}: SidebarProps) {
  const handleClick = (screen: Screen) => {
    onScreenChange(screen);
    onScreenFocus?.(screen);
  };

  return (
    <aside className="w-56 max-[640px]:w-14 border-r border-slate-800 bg-slate-950 p-4 max-[640px]:p-2 space-y-2 overflow-hidden">
      <div className="text-lg font-semibold mb-4 text-slate-100 max-[640px]:sr-only">OrgOps</div>
      {NAV_ITEMS.filter(item => item.screen !== "source-library" || canManageSourceLibrary).map(({ screen, label }) => (
        <button
          key={screen}
          type="button"
          aria-label={label}
          className={`text-left w-full px-3 py-2 rounded max-[640px]:px-1 max-[640px]:text-xs ${
            activeScreen === screen
              ? "bg-slate-800 text-white"
              : "text-slate-300 hover:bg-slate-800"
          }`}
          onClick={() => handleClick(screen)}
        >
          {label}
        </button>
      ))}
    </aside>
  );
}
