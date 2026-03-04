import type { Agent, EventRow, SkillMeta } from "../types";
import { Card } from "../components/ui";
import { formatTimestamp } from "../utils/formatTimestamp";

type DashboardScreenProps = {
  agents: Agent[];
  events: EventRow[];
  skills: SkillMeta[];
};

export function DashboardScreen({ agents, events, skills }: DashboardScreenProps) {
  return (
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
  );
}
