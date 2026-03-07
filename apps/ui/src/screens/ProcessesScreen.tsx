import { useMemo, useState } from "react";
import type { ProcessOutputRow, ProcessRow } from "../types";
import { Button, Card } from "../components/ui";
import { formatTimestamp } from "../utils/formatTimestamp";

type ProcessesScreenProps = {
  processes: ProcessRow[];
  processOutput: Record<string, ProcessOutputRow[]>;
  activeProcessId: string | null;
  onSelectProcess: (id: string | null) => void;
  onRefresh: () => void;
  onClearAll: () => Promise<void>;
  onExitProcess: (id: string) => Promise<void>;
};

function formatDurationMs(startedAt?: number, endedAt?: number) {
  if (!startedAt) return "-";
  const end = endedAt ?? Date.now();
  const totalSec = Math.max(0, Math.floor((end - startedAt) / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins === 0) return `${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours === 0) return `${mins}m ${secs}s`;
  return `${hours}h ${remMins}m`;
}

export function ProcessesScreen({
  processes,
  processOutput,
  activeProcessId,
  onSelectProcess,
  onRefresh,
  onClearAll,
  onExitProcess
}: ProcessesScreenProps) {
  const [expandedCommands, setExpandedCommands] = useState<Record<string, boolean>>({});
  const [exitingProcessIds, setExitingProcessIds] = useState<Record<string, boolean>>({});
  const selectedProcess = useMemo(
    () => processes.find((process) => process.id === activeProcessId) ?? null,
    [activeProcessId, processes]
  );
  const output = activeProcessId ? (processOutput[activeProcessId] ?? []) : [];
  const canExitProcess = (process: ProcessRow) =>
    process.state === "RUNNING" || process.state === "STARTING";
  const exitProcess = async (process: ProcessRow) => {
    if (!canExitProcess(process)) return;
    if (!confirm(`Exit process "${process.cmd}"?`)) return;
    setExitingProcessIds((prev) => ({ ...prev, [process.id]: true }));
    try {
      await onExitProcess(process.id);
    } finally {
      setExitingProcessIds((prev) => ({ ...prev, [process.id]: false }));
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-1">
      <Card title={`Processes (${processes.length})`}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              className="px-3 py-1 text-sm"
              onClick={onRefresh}
            >
              Refresh
            </Button>
            <Button
              variant="secondary"
              className="bg-rose-900 px-3 py-1 text-sm text-rose-100 hover:bg-rose-800"
              onClick={async () => {
                if (
                  !confirm(
                    "Clear all processes and terminate any running ones? This cannot be undone."
                  )
                ) {
                  return;
                }
                await onClearAll();
              }}
            >
              Clear all
            </Button>
          </div>
          <div className="text-xs text-slate-500">
            Click a row to inspect output in the right pane.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-300">
                <th className="px-2 py-2">Started</th>
                <th className="px-2 py-2">Agent</th>
                <th className="px-2 py-2">State</th>
                <th className="px-2 py-2">Output</th>
                <th className="px-2 py-2">PID</th>
                <th className="px-2 py-2">Channel</th>
                <th className="px-2 py-2">Command</th>
              </tr>
            </thead>
            <tbody>
              {processes.map((proc) => {
                const expanded = expandedCommands[proc.id] ?? false;
                const isLongCommand = proc.cmd.length > 88;
                return (
                  <tr
                    key={proc.id}
                    className={`cursor-pointer border-b border-slate-900 align-top hover:bg-slate-900/40 ${
                      activeProcessId === proc.id ? "bg-slate-900/70" : ""
                    }`}
                    onClick={() => onSelectProcess(proc.id)}
                  >
                    <td className="whitespace-nowrap px-2 py-2 text-slate-400">
                      {formatTimestamp(proc.started_at)}
                    </td>
                    <td className="px-2 py-2 text-slate-200">{proc.agent_name}</td>
                    <td className="px-2 py-2">
                      <div className="text-slate-200">{proc.state}</div>
                      <div className="text-xs text-slate-500">
                        {formatDurationMs(proc.started_at, proc.ended_at)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-400">
                      {proc.output_count ?? 0}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-400">
                      {proc.pid ?? "-"}
                    </td>
                    <td className="max-w-[180px] truncate px-2 py-2 text-slate-400">
                      {proc.channel_id ?? "-"}
                    </td>
                    <td className="max-w-[560px] px-2 py-2 text-slate-300">
                      <div className={expanded ? "whitespace-pre-wrap break-words" : "truncate"}>
                        {proc.cmd}
                      </div>
                      {isLongCommand && (
                        <button
                          type="button"
                          className="mt-1 text-xs text-sky-400 hover:text-sky-300"
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpandedCommands((prev) => ({
                              ...prev,
                              [proc.id]: !expanded
                            }));
                          }}
                        >
                          {expanded ? "Collapse command" : "Expand command"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {processes.length === 0 && (
            <div className="py-8 text-center text-slate-500">No processes found.</div>
          )}
        </div>
      </Card>
      {selectedProcess && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:left-56"
          onClick={() => onSelectProcess(null)}
        />
      )}
      <div
        className={`pointer-events-none fixed inset-0 z-50 flex justify-end lg:left-56 ${
          selectedProcess ? "" : "invisible"
        }`}
      >
        <div
          className={`pointer-events-auto flex h-full w-full max-w-4xl flex-col border-l border-slate-800 bg-slate-950/95 shadow-2xl transition-transform duration-300 ${
            selectedProcess ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div
            className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-3"
          >
            <div className="text-sm font-semibold text-slate-100">Process Output</div>
            <div className="flex items-center gap-2">
              {selectedProcess && canExitProcess(selectedProcess) && (
                <Button
                  variant="secondary"
                  className="bg-rose-900 px-2 py-1 text-xs text-rose-100 hover:bg-rose-800"
                  onClick={async () => {
                    await exitProcess(selectedProcess);
                  }}
                  disabled={Boolean(exitingProcessIds[selectedProcess.id])}
                >
                  {exitingProcessIds[selectedProcess.id] ? "Exiting..." : "Exit process"}
                </Button>
              )}
              <Button
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={() => onSelectProcess(null)}
              >
                Close
              </Button>
            </div>
          </div>
          {selectedProcess ? (
            <>
              <div className="shrink-0 border-b border-slate-800 px-4 py-3 text-xs text-slate-400">
                <div className="text-slate-200">{selectedProcess.cmd}</div>
                <div className="mt-1">
                  {selectedProcess.agent_name} | {selectedProcess.state} | started{" "}
                  {formatTimestamp(selectedProcess.started_at)}
                </div>
                <div className="mt-1">
                  Source:{" "}
                  {selectedProcess.state === "RUNNING"
                    ? "Live stream + recorded history"
                    : "Recorded history"}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs">
                {output.map((entry, index) => (
                  <div key={`${entry.seq}-${index}`} className="whitespace-pre-wrap break-words">
                    <span
                      className={entry.stream === "STDERR" ? "text-rose-300" : "text-emerald-300"}
                    >
                      [{entry.stream}]
                    </span>{" "}
                    <span className="text-slate-500">{entry.seq}</span>{" "}
                    <span className="text-slate-200">{entry.text}</span>
                  </div>
                ))}
                {output.length === 0 && (
                  <div className="py-8 text-center text-slate-500">No output yet.</div>
                )}
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-500">
              Select a process to view output.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
