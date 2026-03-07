import type { Agent, Channel, EventRow, ProcessRow, SecretRow, SkillMeta, Team } from "../types";
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
  skills: SkillMeta[];
  channels: Channel[];
  processes: ProcessRow[];
  secrets: SecretRow[];
  teams: Team[];
};

const numberFormatter = new Intl.NumberFormat();

export function DashboardScreen({
  agents,
  events,
  eventStats,
  skills,
  channels,
  processes,
  secrets,
  teams
}: DashboardScreenProps) {
  const metricCards = [
    { label: "Agents", value: agents.length, tone: "text-cyan-300" },
    { label: "Events (total)", value: eventStats.total, tone: "text-slate-100" },
    { label: "Processed", value: eventStats.processed, tone: "text-emerald-300" },
    { label: "Failed", value: eventStats.failed, tone: "text-rose-300" },
    { label: "Pending", value: eventStats.pending, tone: "text-amber-300" },
    { label: "Scheduled", value: eventStats.scheduled, tone: "text-violet-300" },
    { label: "Skills", value: skills.length, tone: "text-indigo-300" },
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
            <div
              key={agent.name}
              className="flex items-center justify-between text-sm text-slate-200"
            >
              <span>{agent.name}</span>
              <span className="text-slate-300">{agent.runtimeState}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Recent Events">
        <div className="space-y-2 text-sm max-h-80 overflow-auto">
          {events.map((event) => (
            <div key={event.id} className="border-b border-slate-800 pb-2">
              <div className="text-slate-300">{event.type}</div>
              <div className="text-slate-500 text-xs">
                {event.source} • {formatTimestamp(event.createdAt)}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Skills">
        <div className="space-y-2 text-sm">
          {skills.map((skill) => (
            <div key={skill.name} className="border-b border-slate-800 pb-2">
              <div className="text-slate-200">{skill.name}</div>
              <div className="text-slate-500 text-xs">{skill.description}</div>
            </div>
          ))}
        </div>
      </Card>
      </div>
    </div>
  );
}
