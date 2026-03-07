import type { Screen } from "../../types";

type SidebarProps = {
  activeScreen: Screen;
  onScreenChange: (screen: Screen) => void;
  onScreenFocus?: (screen: Screen) => void;
};

const NAV_ITEMS: { screen: Screen; label: string }[] = [
  { screen: "dashboard", label: "Dashboard" },
  { screen: "agents", label: "Agents" },
  { screen: "teams", label: "Teams" },
  { screen: "channels", label: "Channels" },
  { screen: "chat", label: "Chat" },
  { screen: "events", label: "Events Explorer" },
  { screen: "processes", label: "Processes" },
  { screen: "skills", label: "Skills" },
  { screen: "secrets", label: "Secrets" },
  { screen: "humans", label: "Humans" },
  { screen: "profile", label: "Profile" }
];

export function Sidebar({
  activeScreen,
  onScreenChange,
  onScreenFocus
}: SidebarProps) {
  const handleClick = (screen: Screen) => {
    onScreenChange(screen);
    onScreenFocus?.(screen);
  };

  return (
    <aside className="w-56 border-r border-slate-800 bg-slate-950 p-4 space-y-2">
      <div className="text-lg font-semibold mb-4 text-slate-100">OrgOps</div>
      {NAV_ITEMS.map(({ screen, label }) => (
        <button
          key={screen}
          type="button"
          className={`text-left w-full px-3 py-2 rounded ${
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
