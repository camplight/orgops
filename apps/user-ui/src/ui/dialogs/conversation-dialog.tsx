import type { FormEvent } from "react";
import type { Agent } from "../../types";

type ConversationDialogProps = {
  name: string;
  description: string;
  visibility: "PUBLIC" | "PRIVATE";
  selectedAgents: Agent[];
  agentSearchQuery: string;
  visibleAgents: Agent[];
  agentSuggestions: Agent[];
  loading: boolean;
  canStart: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onVisibilityChange: (value: "PUBLIC" | "PRIVATE") => void;
  onRemoveAgent: (agentName: string) => void;
  onAddAgent: (agentName: string) => void;
  onAgentSearchQueryChange: (value: string) => void;
};

export function ConversationDialog({
  name,
  description,
  visibility,
  selectedAgents,
  agentSearchQuery,
  visibleAgents,
  agentSuggestions,
  loading,
  canStart,
  onClose,
  onSubmit,
  onNameChange,
  onDescriptionChange,
  onVisibilityChange,
  onRemoveAgent,
  onAddAgent,
  onAgentSearchQueryChange
}: ConversationDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className="conversation-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Start conversation</span>
            <h2>New conversation</h2>
          </div>
          <button
            aria-label="Close dialog"
            className="dialog-close"
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <form className="conversation-form" onSubmit={onSubmit}>
          <label>
            <span>Channel name</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Leave blank for a DM"
            />
          </label>
          <label>
            <span>Description</span>
            <input
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label>
            <span>Visibility</span>
            <select
              value={visibility}
              onChange={(event) =>
                onVisibilityChange(event.target.value === "PUBLIC" ? "PUBLIC" : "PRIVATE")
              }
            >
              <option value="PRIVATE">Private</option>
              <option value="PUBLIC">Public</option>
            </select>
          </label>
          <div className="agent-combobox">
            <span>Agents</span>
            {selectedAgents.length > 0 ? (
              <div className="selected-agent-chips">
                {selectedAgents.map((agent) => (
                  <button
                    key={agent.name}
                    onClick={() => onRemoveAgent(agent.name)}
                    type="button"
                  >
                    {agent.name}
                    <span>Remove</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="agent-picker-hint">Select one agent for a DM, or many for a channel.</p>
            )}
            <label className="agent-search-field">
              <span>Search agents</span>
              <input
                value={agentSearchQuery}
                onChange={(event) => onAgentSearchQueryChange(event.target.value)}
                placeholder="Type an agent name..."
              />
            </label>
            {visibleAgents.length === 0 ? (
              <p className="sidebar-note">No available agents.</p>
            ) : agentSuggestions.length > 0 ? (
              <div className="agent-suggestions">
                {agentSuggestions.map((agent) => (
                  <button
                    key={agent.name}
                    onClick={() => onAddAgent(agent.name)}
                    type="button"
                  >
                    <span>{agent.name}</span>
                    <em>{agent.runtimeState === "RUNNING" ? "Running" : "Off"}</em>
                  </button>
                ))}
              </div>
            ) : (
              <p className="agent-picker-hint">No matching agents.</p>
            )}
          </div>
          <button disabled={loading || !canStart}>Start</button>
        </form>
      </section>
    </div>
  );
}
