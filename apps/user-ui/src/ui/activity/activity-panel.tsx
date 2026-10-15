import { participantAgentStatus, participantName, participantType, shareTypeLabel } from "../../domain/conversations/channel-rules";
import { sourceLabel } from "../../domain/messaging/event-interpretation";
import type { Agent, Channel, EventRow } from "../../types";

type ActivityPanelProps = {
  channel: Channel | null;
  agents: Agent[];
  events: EventRow[];
  agentIsThinking: boolean;
};

export function ActivityPanel({ channel, agents, events, agentIsThinking }: ActivityPanelProps) {
  return (
  <aside className="activity-panel">
    <section className="participants-card">
      <div className="participants-header-row">
        <h2>Participants</h2>
      </div>
      <div className="participant-list">
        {channel?.participants?.map((participant, index) => {
          const agentStatus = participantAgentStatus(participant, agents);
          return (
            <article key={`${participant.subscriberType}:${participant.subscriberId}:${index}`}>
              <div className="participant-avatar">{participantName(participant).slice(0, 2)}</div>
              <div>
                <strong>
                  {agentStatus ? (
                    <i
                      className={`agent-status-dot agent-status-${agentStatus}`}
                      title={agentStatus === "running" ? "Agent running" : "Agent off"}
                    />
                  ) : null}
                  {participantName(participant)}
                </strong>
                <span>{participantType(participant)}</span>
              </div>
            </article>
          );
        })}
        {!channel?.participants?.length ? (
          <p>No participants listed for this channel.</p>
        ) : null}
      </div>
      <div className="shared-viewer-list">
        <h3>Shared viewers</h3>
        {channel?.shares?.map((share, index) => (
          <article key={`${share.viewerType}:${share.viewerId}:${index}`}>
            <div className="participant-avatar">{share.viewerId.slice(0, 2) || "SV"}</div>
            <div>
              <strong>{share.viewerId}</strong>
              <span>{shareTypeLabel(share)}</span>
            </div>
          </article>
        ))}
        {!channel?.shares?.length ? <p>No shared viewers.</p> : null}
      </div>
    </section>

    <section>
      <h2>Recent Activity</h2>
      {agentIsThinking ? <p className="thinking-indicator">Agent is thinking...</p> : null}
      <div className="activity-list">
        {events.slice(-6).reverse().map((event) => (
          <article key={event.id}>
            <strong>{sourceLabel(event.source)}</strong>
            <span>{event.type.replaceAll(".", " ")}</span>
          </article>
        ))}
        {events.length === 0 ? <p>No recent activity in this channel.</p> : null}
      </div>
    </section>
  </aside>
  );
}
