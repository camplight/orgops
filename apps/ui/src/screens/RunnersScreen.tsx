import { useEffect, useMemo, useState } from "react";
import type { Agent, RunnerNode, RunnerSetupConfig } from "../types";
import { Button, Card } from "../components/ui";
import { formatTimestamp } from "../utils/formatTimestamp";

type RunnersScreenProps = {
  runners: RunnerNode[];
  agents: Agent[];
  onRefresh: () => Promise<void> | void;
  onDeregisterRunner: (runnerId: string) => Promise<void>;
  loadRunnerSetupConfig: () => Promise<RunnerSetupConfig>;
};

export function RunnersScreen({
  runners,
  agents,
  onRefresh,
  onDeregisterRunner,
  loadRunnerSetupConfig
}: RunnersScreenProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [pendingRunnerId, setPendingRunnerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runnerToken, setRunnerToken] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void loadRunnerSetupConfig()
      .then((config) => {
        if (cancelled) return;
        setRunnerToken((config.runnerToken ?? "").trim());
      })
      .catch(() => {
        if (cancelled) return;
        setRunnerToken("");
      });
    return () => {
      cancelled = true;
    };
    // Intentionally once on screen mount; no polling or periodic refresh.
  }, []);

  const assignedAgentNamesByRunner = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const agent of agents) {
      const runnerId = agent.assignedRunnerId ?? "";
      if (!runnerId) continue;
      const existing = map.get(runnerId) ?? [];
      existing.push(agent.name);
      map.set(runnerId, existing);
    }
    for (const [runnerId, names] of map.entries()) {
      map.set(
        runnerId,
        [...names].sort((left, right) => left.localeCompare(right))
      );
    }
    return map;
  }, [agents]);

  const apiBaseUrl = window.location.origin;
  const runnerTokenLine = runnerToken
    ? `- ORGOPS_RUNNER_TOKEN=${runnerToken}`
    : "- ORGOPS_RUNNER_TOKEN=<paste-shared-runner-token>";
  const opsCliSetupPrompt = [
    "Set up this host as an OrgOps runner connected to my API.",
    "",
    "Use these environment variables:",
    `- ORGOPS_API_URL=${apiBaseUrl}`,
    runnerTokenLine,
    "- ORGOPS_RUNNER_NAME=<optional-friendly-runner-name>",
    "",
    "Then:",
    "1) Ensure dependencies are installed.",
    "2) Start @orgops/agent-runner for this host.",
    "3) Verify it successfully registers and heartbeats to the API.",
    "4) Print the runner id and status once connected."
  ].join("\n");

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1200);
    } catch {
      setError("Clipboard write failed. Copy manually from the snippet.");
    }
  };

  const handleDeregisterRunner = async (runnerId: string, displayName: string) => {
    const confirmed = window.confirm(
      `De-register runner "${displayName}"? Agents assigned to it will become unassigned.`
    );
    if (!confirmed) return;
    setError(null);
    setPendingRunnerId(runnerId);
    try {
      await onDeregisterRunner(runnerId);
      await onRefresh();
    } catch (deregisterError) {
      const message =
        deregisterError instanceof Error
          ? deregisterError.message
          : "Failed to de-register runner.";
      setError(message);
    } finally {
      setPendingRunnerId(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card title="OpsCLI Runner Setup Prompt">
        <div className="space-y-3 text-sm">
          <div className="rounded border border-slate-800 bg-slate-950 p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
              Prompt to give OpsCLI
            </div>
            <div className="flex items-start justify-between gap-3 rounded border border-slate-800 bg-slate-900 px-3 py-2">
              <pre className="overflow-auto whitespace-pre-wrap break-all text-xs text-slate-200">
                {opsCliSetupPrompt}
              </pre>
              <Button
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={() => void copyText("opscli-setup-prompt", opsCliSetupPrompt)}
              >
                {copiedKey === "opscli-setup-prompt" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card title={`Runners (${runners.length})`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            Live updates via websocket. De-register to remove stale hosts.
          </div>
          <Button variant="secondary" onClick={() => void onRefresh()}>
            Refresh
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-300">
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Runner ID</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Last Seen</th>
                <th className="px-2 py-2">Host</th>
                <th className="px-2 py-2">Version</th>
                <th className="px-2 py-2">Assigned Agents</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runners.map((runner) => {
                const assignedAgents = assignedAgentNamesByRunner.get(runner.id) ?? [];
                return (
                  <tr key={runner.id} className="border-b border-slate-900 align-top">
                    <td className="whitespace-nowrap px-2 py-2 text-slate-200">
                      {runner.displayName}
                    </td>
                    <td className="max-w-[260px] truncate px-2 py-2 text-xs text-slate-500">
                      {runner.id}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      <span
                        className={`rounded px-2 py-1 text-xs ${
                          runner.online
                            ? "bg-emerald-900/40 text-emerald-300"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {runner.online ? "ONLINE" : "OFFLINE"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-400">
                      {formatTimestamp(runner.lastSeenAt)}
                    </td>
                    <td className="px-2 py-2 text-slate-400">
                      {[runner.hostname, runner.platform, runner.arch]
                        .filter((value) => Boolean(value && String(value).trim()))
                        .join(" | ") || "-"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-400">
                      {runner.version ?? "-"}
                    </td>
                    <td className="px-2 py-2 text-slate-400">
                      {assignedAgents.length > 0 ? assignedAgents.join(", ") : "-"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      <Button
                        variant="secondary"
                        className="bg-rose-900 text-rose-100 hover:bg-rose-800"
                        onClick={() =>
                          void handleDeregisterRunner(runner.id, runner.displayName)
                        }
                        disabled={pendingRunnerId === runner.id}
                      >
                        {pendingRunnerId === runner.id ? "Removing..." : "De-register"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {runners.length === 0 ? (
            <div className="py-8 text-center text-slate-500">No runners registered.</div>
          ) : null}
        </div>
      </Card>
      {error ? <div className="text-sm text-rose-400">{error}</div> : null}
    </div>
  );
}
