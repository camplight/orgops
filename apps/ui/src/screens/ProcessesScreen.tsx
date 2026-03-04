import type { ProcessRow } from "../types";
import { Button, Card } from "../components/ui";

type ProcessesScreenProps = {
  processes: ProcessRow[];
  processOutput: Record<string, unknown[]>;
  activeProcessId: string | null;
  onSelectProcess: (id: string) => void;
  onRefresh: () => void;
};

function isOutputEntry(x: unknown): x is { text?: string } {
  return typeof x === "object" && x !== null;
}

export function ProcessesScreen({
  processes,
  processOutput,
  activeProcessId,
  onSelectProcess,
  onRefresh
}: ProcessesScreenProps) {
  const output = activeProcessId
    ? (processOutput[activeProcessId] ?? [])
    : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <Card title="Processes">
        <div className="flex items-center justify-between mb-2">
          <Button
            variant="secondary"
            className="px-3 py-1 text-sm"
            onClick={onRefresh}
          >
            Refresh
          </Button>
        </div>
        <div className="space-y-2 text-sm">
          {processes.map((proc) => (
            <button
              key={proc.id}
              type="button"
              className={`w-full text-left px-2 py-1 rounded ${
                activeProcessId === proc.id ? "bg-slate-800" : "hover:bg-slate-800"
              } text-slate-200`}
              onClick={() => onSelectProcess(proc.id)}
            >
              <div>{proc.cmd}</div>
              <div className="text-slate-500">{proc.state}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Live output">
        <div className="text-xs text-slate-300 whitespace-pre-wrap max-h-[600px] overflow-auto">
          {output.map((entry, index) => (
            <div key={index}>
              {isOutputEntry(entry) ? entry.text : String(entry)}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
