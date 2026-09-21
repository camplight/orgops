type PageHeaderProps = {
  title: string;
  subtitle?: string;
  username?: string | null;
  onOpenProfile?: () => void;
  onLogout?: () => void;
  onOpenMobileNav?: () => void;
};

export function PageHeader({
  title,
  subtitle = "OrgOps control plane",
  username,
  onOpenProfile,
  onLogout,
  onOpenMobileNav
}: PageHeaderProps) {
  return (
    <header className="border-b border-slate-800 p-3 md:p-6 flex flex-col sm:flex-row items-start justify-between gap-3 md:gap-4 min-w-0">
      <div className="w-full sm:w-auto min-w-0">
        <div className="flex items-start justify-between gap-3 min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold capitalize text-slate-100 min-w-0 truncate">
            {title.replace("-", " ")}
          </h1>
          <button
            type="button"
            className="rounded border border-emerald-300/50 bg-emerald-500 hover:bg-emerald-400 text-white px-3 py-1 text-xs font-semibold shadow-sm shrink-0 sm:hidden"
            onClick={onOpenMobileNav}
          >
            Menu
          </button>
        </div>
        <p className="text-slate-400 text-sm">{subtitle}</p>
      </div>
      <div className="flex w-full sm:w-auto items-center gap-2 flex-wrap sm:flex-nowrap min-w-0">
        <div className="text-xs md:text-sm text-slate-300 px-2 py-1 rounded bg-slate-900 border border-slate-800 truncate max-w-full sm:max-w-none">
          {username ?? "Unknown user"}
        </div>
        <button
          type="button"
          className="rounded bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1 text-xs md:text-sm shrink-0"
          onClick={onOpenProfile}
        >
          Profile
        </button>
        <button
          type="button"
          className="rounded bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1 text-xs md:text-sm shrink-0"
          onClick={onLogout}
        >
          Logout
        </button>
      </div>
    </header>
  );
}
