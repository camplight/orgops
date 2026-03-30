import type { Agent, Channel, EventRow, ProcessRow, SecretRow, Team } from "../types";
import { Card } from "../components/ui";
import { formatTimestamp } from "../utils/formatTimestamp";

type DashboardScreenProps = {
  agents: Agent[];
  events: EventRow[];
  eventStats: {
    total: number;
    processed: number;
    failed: number;
    pending: number;
    scheduled: number;
  };
  channels: Channel[];
  processes: ProcessRow[];
  secrets: SecretRow[];
  teams: Team[];
  onSelectAgent: (agentName: string) => void;
  onSelectEvent: (eventId: string) => void;
  onSelectProcess: (processId: string) => void;
};

const numberFormatter = new Intl.NumberFormat();

export function DashboardScreen({
  agents,
  events,
  eventStats,
  channels,
  processes,
  secrets,
  teams,
  onSelectAgent,
  onSelectEvent,
  onSelectProcess
}: DashboardScreenProps) {
  const nonAuditRecentEvents = events.filter((event) => !event.type.startsWith("audit."));
  const recentProcesses = [...processes]
    .sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0))
    .slice(0, 12);
  const metricCards = [
    { label: "Agents", value: agents.length, tone: "text-cyan-300" },
    { label: "Events (total)", value: eventStats.total, tone: "text-slate-100" },
    { label: "Processed", value: eventStats.processed, tone: "text-emerald-300" },
    { label: "Failed", value: eventStats.failed, tone: "text-rose-300" },
    { label: "Pending", value: eventStats.pending, tone: "text-amber-300" },
    { label: "Scheduled", value: eventStats.scheduled, tone: "text-violet-300" },
    { label: "Channels", value: channels.length, tone: "text-sky-300" },
    { label: "Processes", value: processes.length, tone: "text-teal-300" },
    { label: "Secrets", value: secrets.length, tone: "text-fuchsia-300" },
    { label: "Teams", value: teams.length, tone: "text-orange-300" }
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((metric) => (
          <Card key={metric.label} className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-slate-400">{metric.label}</div>
            <div className={`text-2xl font-semibold ${metric.tone}`}>
              {numberFormatter.format(metric.value)}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Agents">
          <div className="space-y-2">
            {agents.map((agent) => (
              <button
                type="button"
                key={agent.name}
                className="flex w-full items-center justify-between border-b border-slate-800 pb-2 text-left text-sm text-slate-200 hover:text-slate-100"
                onClick={() => onSelectAgent(agent.name)}
              >
                <span>{agent.name}</span>
                <span className="text-slate-300">{agent.runtimeState}</span>
              </button>
            ))}
          </div>
        </Card>
        <Card title="Recent Events">
          <div className="space-y-2 text-sm max-h-80 overflow-auto">
            {nonAuditRecentEvents.map((event) => (
              <button
                type="button"
                key={event.id}
                className="w-full border-b border-slate-800 pb-2 text-left hover:bg-slate-900/30"
                onClick={() => onSelectEvent(event.id)}
              >
                <div className="text-slate-300">{event.type}</div>
                <div className="text-slate-500 text-xs">
                  {event.source} • {formatTimestamp(event.createdAt)}
                </div>
              </button>
            ))}
            {nonAuditRecentEvents.length === 0 && (
              <div className="text-slate-500">No non-audit events yet.</div>
            )}
          </div>
        </Card>
        <Card title="Processes">
          <div className="space-y-2 text-sm max-h-80 overflow-auto">
            {recentProcesses.map((process) => (
              <button
                type="button"
                key={process.id}
                className="w-full border-b border-slate-800 pb-2 text-left hover:bg-slate-900/30"
                onClick={() => onSelectProcess(process.id)}
              >
                <div className="truncate text-slate-200">{process.cmd}</div>
                <div className="text-slate-500 text-xs">
                  {process.agent_name} • {process.state} • {formatTimestamp(process.started_at)}
                </div>
              </button>
            ))}
            {recentProcesses.length === 0 && (
              <div className="text-slate-500">No processes yet.</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
