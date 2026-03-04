type ProfileScreenProps = {
  username: string | null;
};

export function ProfileScreen({ username }: ProfileScreenProps) {
  return (
    <div className="max-w-xl rounded border border-slate-800 bg-slate-950 p-4">
      <h2 className="text-slate-100 text-lg font-medium">Profile</h2>
      <div className="mt-3 text-sm text-slate-300">
        <div className="text-slate-400">Current user</div>
        <div>{username ?? "Unknown"}</div>
      </div>
    </div>
  );
}
