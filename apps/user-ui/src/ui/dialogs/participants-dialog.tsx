import type { FormEvent } from "react";
import { participantName, participantType, shareTypeLabel } from "../../domain/conversations/channel-rules";
import type { Agent, Channel, ChannelParticipant, ChannelShare } from "../../types";

type ParticipantsDialogProps = {
  channel: Channel;
  visibleAgents: Agent[];
  humans: Array<{ username: string }>;
  participantKind: "HUMAN" | "AGENT";
  participantValue: string;
  participantSubmitting: boolean;
  participantRemovingKey: string | null;
  shareKind: "HUMAN" | "AGENT";
  shareValue: string;
  shareSubmitting: boolean;
  shareRemovingKey: string | null;
  onClose: () => void;
  onParticipantKindChange: (value: "HUMAN" | "AGENT") => void;
  onParticipantValueChange: (value: string) => void;
  onAddParticipant: (event: FormEvent<HTMLFormElement>) => void;
  onRemoveParticipant: (participant: ChannelParticipant) => void;
  onShareKindChange: (value: "HUMAN" | "AGENT") => void;
  onShareValueChange: (value: string) => void;
  onAddShare: (event: FormEvent<HTMLFormElement>) => void;
  onRemoveShare: (share: ChannelShare) => void;
};

export function ParticipantsDialog({
  channel,
  visibleAgents,
  humans,
  participantKind,
  participantValue,
  participantSubmitting,
  participantRemovingKey,
  shareKind,
  shareValue,
  shareSubmitting,
  shareRemovingKey,
  onClose,
  onParticipantKindChange,
  onParticipantValueChange,
  onAddParticipant,
  onRemoveParticipant,
  onShareKindChange,
  onShareValueChange,
  onAddShare,
  onRemoveShare
}: ParticipantsDialogProps) {
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        aria-modal="true"
        className="conversation-dialog participants-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Channel controls</span>
            <h2>Manage participants</h2>
          </div>
          <button
            aria-label="Close dialog"
            className="dialog-close"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>

        <form className="participant-form" onSubmit={onAddParticipant}>
          <select
            value={participantKind}
            onChange={(event) => onParticipantKindChange(event.target.value === "HUMAN" ? "HUMAN" : "AGENT")}
            disabled={participantSubmitting}
          >
            <option value="AGENT">Agent</option>
            <option value="HUMAN">Human</option>
          </select>
          <input
            list={participantKind === "AGENT" ? "agent-participant-options" : "human-participant-options"}
            placeholder={participantKind === "AGENT" ? "agent name" : "username"}
            value={participantValue}
            onChange={(event) => onParticipantValueChange(event.target.value)}
            disabled={participantSubmitting}
          />
          <button type="submit" disabled={participantSubmitting || !participantValue.trim()}>
            {participantSubmitting ? "Adding..." : "Add"}
          </button>
          <datalist id="agent-participant-options">
            {visibleAgents.map((agent) => (
              <option key={agent.name} value={agent.name} />
            ))}
          </datalist>
          <datalist id="human-participant-options">
            {humans.map((human) => (
              <option key={human.username} value={human.username} />
            ))}
          </datalist>
        </form>

        <div className="participants-dialog-list">
          {(channel.participants ?? []).map((participant, index) => {
            const participantKey = `${participant.subscriberType}:${participant.subscriberId}`;
            return (
              <article key={`${participant.subscriberType}:${participant.subscriberId}:${index}`}>
                <div>
                  <strong>{participantName(participant)}</strong>
                  <span>{participantType(participant)}</span>
                </div>
                <button
                  className="participant-remove-button"
                  onClick={() => onRemoveParticipant(participant)}
                  disabled={participantRemovingKey === participantKey}
                  title={`Remove ${participantName(participant)}`}
                  type="button"
                >
                  {participantRemovingKey === participantKey ? "Removing..." : "Remove"}
                </button>
              </article>
            );
          })}
          {(channel.participants ?? []).length === 0 ? (
            <p>No participants yet.</p>
          ) : null}
        </div>

        <header>
          <div>
            <span>Read-only sharing</span>
            <h2>Shared viewers</h2>
          </div>
        </header>

        <form className="participant-form" onSubmit={onAddShare}>
          <select
            value={shareKind}
            onChange={(event) => onShareKindChange(event.target.value === "AGENT" ? "AGENT" : "HUMAN")}
            disabled={shareSubmitting}
          >
            <option value="HUMAN">Human viewer</option>
            <option value="AGENT">Agent viewer</option>
          </select>
          <input
            list={shareKind === "AGENT" ? "agent-share-options" : "human-share-options"}
            placeholder={shareKind === "AGENT" ? "agent name" : "username"}
            value={shareValue}
            onChange={(event) => onShareValueChange(event.target.value)}
            disabled={shareSubmitting}
          />
          <button type="submit" disabled={shareSubmitting || !shareValue.trim()}>
            {shareSubmitting ? "Sharing..." : "Share"}
          </button>
          <datalist id="agent-share-options">
            {visibleAgents.map((agent) => (
              <option key={agent.name} value={agent.name} />
            ))}
          </datalist>
          <datalist id="human-share-options">
            {humans.map((human) => (
              <option key={human.username} value={human.username} />
            ))}
          </datalist>
        </form>

        <div className="participants-dialog-list">
          {(channel.shares ?? []).map((share, index) => {
            const shareKey = `${share.viewerType}:${share.viewerId}`;
            return (
              <article key={`${share.viewerType}:${share.viewerId}:${index}`}>
                <div>
                  <strong>{share.viewerId}</strong>
                  <span>{shareTypeLabel(share)}</span>
                </div>
                <button
                  className="participant-remove-button"
                  onClick={() => onRemoveShare(share)}
                  disabled={shareRemovingKey === shareKey}
                  title={`Remove shared viewer ${share.viewerId}`}
                  type="button"
                >
                  {shareRemovingKey === shareKey ? "Removing..." : "Remove"}
                </button>
              </article>
            );
          })}
          {(channel.shares ?? []).length === 0 ? (
            <p>No shared viewers yet.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
