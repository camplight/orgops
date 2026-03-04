type PageHeaderProps = {
  title: string;
  subtitle?: string;
  username?: string | null;
  onOpenProfile?: () => void;
  onLogout?: () => void;
};

export function PageHeader({
  title,
  subtitle = "OrgOps control plane",
  username,
  onOpenProfile,
  onLogout
}: PageHeaderProps) {
  return (
    <header className="border-b border-slate-800 p-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold capitalize text-slate-100">
          {title.replace("-", " ")}
        </h1>
        <p className="text-slate-400 text-sm">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-sm text-slate-300 px-2 py-1 rounded bg-slate-900 border border-slate-800">
          {username ?? "Unknown user"}
        </div>
        <button
          type="button"
          className="rounded bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1 text-sm"
          onClick={onOpenProfile}
        >
          Profile
        </button>
        <button
          type="button"
          className="rounded bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1 text-sm"
          onClick={onLogout}
        >
          Logout
        </button>
      </div>
    </header>
  );
}
