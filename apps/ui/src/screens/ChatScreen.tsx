import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EventRow } from "../types";
import { Button, Card, SelectAutocomplete, Textarea } from "../components/ui";
import { formatTimestamp } from "../utils/formatTimestamp";

type ChatScreenProps = {
  targetOptions: {
    id: string;
    label: string;
    meta?: string;
    participantsText?: string;
  }[];
  activeTargetId: string | null;
  events: EventRow[];
  messageText: string;
  onSelectTarget: (id: string) => void;
  onMessageTextChange: (value: string) => void;
  onSendMessage: () => Promise<void>;
  onClearMessages: () => Promise<void>;
};

function getAgentNameFromSource(source: string | undefined) {
  if (!source?.startsWith("agent:")) return null;
  return source.slice("agent:".length).trim() || null;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toSentenceCase(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function humanizeEventType(type: string) {
  return type
    .split(".")
    .map((part) => part.replace(/[_-]+/g, " "))
    .join(" ");
}

function getMessageRole(event: EventRow): "human" | "agent" | "system" {
  if (event.source.startsWith("human:")) return "human";
  if (event.source.startsWith("agent:")) return "agent";
  return "system";
}

function isTerminalAgentEvent(event: EventRow) {
  if (event.type === "message.created" && event.source.startsWith("agent:")) return true;
  if (event.type === "agent.turn.completed" || event.type === "agent.turn.failed") return true;
  return /(completed|complete|done|finished|failed|error|cancelled|canceled|skipped|exited)$/i.test(
    event.type
  );
}

function getPayloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getAgentTurnFailedMessage(event: EventRow): string {
  const payload = asObject(event.payload);
  return (
    getPayloadString(payload, "error") ??
    (typeof event.lastError === "string" && event.lastError.trim() ? event.lastError.trim() : null) ??
    "Agent turn failed."
  );
}

function getAgentNameForStatusEvent(event: EventRow): string | null {
  const fromSource = getAgentNameFromSource(event.source);
  if (fromSource) return fromSource;
  const payload = asObject(event.payload);
  const fromPayload = getPayloadString(payload, "agentName") ?? getPayloadString(payload, "targetAgentName");
  return fromPayload;
}

function toInlineAgentStatus(event: EventRow): string {
  const payload = asObject(event.payload);
  if (event.type === "agent.turn.started") return "processing";
  if (event.type === "agent.turn.completed") return "completed";
  if (event.type === "agent.turn.failed") return "failed";
  if (event.type === "agent.turn.phase") {
    const phase = getPayloadString(payload, "phase");
    if (phase) return phase.toLowerCase();
  }
  if (event.type === "audit.tool.started") {
    const toolName = getPayloadString(payload, "tool");
    return toolName ? `using ${toolName.replace(/[_-]+/g, " ")}` : "using a tool";
  }
  if (event.type === "audit.tool.executed") {
    const toolName = getPayloadString(payload, "tool");
    return toolName ? `finished ${toolName.replace(/[_-]+/g, " ")}` : "finished a tool";
  }
  if (event.type === "audit.tool.failed") {
    const toolName = getPayloadString(payload, "tool");
    return toolName ? `${toolName.replace(/[_-]+/g, " ")} failed` : "tool failed";
  }
  if (event.type === "process.output") return "running process";
  if (event.type === "process.exited") return "process exited";
  const tool =
    typeof payload.tool === "string"
      ? payload.tool
      : typeof payload.toolName === "string"
        ? payload.toolName
        : null;
  if (tool) {
    return `using ${tool.replace(/[_-]+/g, " ")}`;
  }

  if (typeof payload.status === "string" && payload.status.trim()) {
    return payload.status.trim().toLowerCase();
  }

  if (typeof payload.phase === "string" && payload.phase.trim()) {
    return payload.phase.trim().toLowerCase();
  }

  if (event.type === "message.created") return "writing";
  return `processing ${humanizeEventType(event.type)}`;
}

export function ChatScreen({
  targetOptions,
  activeTargetId,
  events,
  messageText,
  onSelectTarget,
  onMessageTextChange,
  onSendMessage,
  onClearMessages
}: ChatScreenProps) {
  const messageEvents = useMemo(
    () =>
      events
        .filter((event) => event.type === "message.created")
        .sort((left, right) => {
          const leftTs = left.createdAt ?? 0;
          const rightTs = right.createdAt ?? 0;
          if (leftTs !== rightTs) return leftTs - rightTs;
          return left.id.localeCompare(right.id);
        }),
    [events]
  );
  const chatLines = useMemo(
    () =>
      events
        .filter((event) => event.type === "message.created" || event.type === "agent.turn.failed")
        .sort((left, right) => {
          const leftTs = left.createdAt ?? 0;
          const rightTs = right.createdAt ?? 0;
          if (leftTs !== rightTs) return leftTs - rightTs;
          return left.id.localeCompare(right.id);
        }),
    [events]
  );
  const activeTarget = targetOptions.find((target) => target.id === activeTargetId) ?? null;
  const activeChannelParticipants =
    activeTargetId?.startsWith("channel:") ? activeTarget?.participantsText : undefined;
  const latestHumanMessage = useMemo(() => {
    const humanMessages = messageEvents.filter((event) => event.source.startsWith("human:"));
    return humanMessages[humanMessages.length - 1] ?? null;
  }, [messageEvents]);
  const latestHumanMessageCreatedAt = latestHumanMessage?.createdAt ?? 0;
  const activityEvents = useMemo(
    () =>
      events
        .filter((event) => {
          if (!latestHumanMessage) return false;
          if ((event.createdAt ?? 0) < latestHumanMessageCreatedAt) return false;
          if (event.id === latestHumanMessage.id) return false;
          return Boolean(getAgentNameForStatusEvent(event));
        })
        .sort((left, right) => {
          const leftTs = left.createdAt ?? 0;
          const rightTs = right.createdAt ?? 0;
          if (leftTs !== rightTs) return leftTs - rightTs;
          return left.id.localeCompare(right.id);
        }),
    [events, latestHumanMessage, latestHumanMessageCreatedAt]
  );
  const typingIndicators = useMemo(() => {
    const stateByAgent = new Map<string, { status: string; latestActivityAt: number }>();
    for (const event of activityEvents) {
      const agentName = getAgentNameForStatusEvent(event);
      if (!agentName) continue;
      const ts = event.createdAt ?? 0;
      if (isTerminalAgentEvent(event)) {
        stateByAgent.delete(agentName);
        continue;
      }
      const status = toInlineAgentStatus(event);
      const existing = stateByAgent.get(agentName);
      if (!existing || ts >= existing.latestActivityAt) {
        stateByAgent.set(agentName, { status, latestActivityAt: ts });
      }
    }

    return [...stateByAgent.entries()]
      .sort((left, right) => right[1].latestActivityAt - left[1].latestActivityAt)
      .map(([agentName, value]) => ({
        agentName,
        status: value.status,
        at: value.latestActivityAt
      }));
  }, [activityEvents]);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const lastChatLineId = chatLines[chatLines.length - 1]?.id ?? null;
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    void onSendMessage();
  };
  const handleExportPdf = () => {
    window.print();
  };

  useEffect(() => {
    if (!activeTargetId || !messagesContainerRef.current) {
      return;
    }

    messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
  }, [activeTargetId, lastChatLineId, chatLines.length, typingIndicators.length]);

  return (
    <div className="space-y-6 chat-print-root">
      <div className="chat-print-hide">
        <Card title="Destination">
        <div className="space-y-2">
          <div className="text-slate-400 text-sm">
            Select a channel or pick an agent to open a direct channel.
          </div>
          <SelectAutocomplete
            value={activeTargetId}
            options={targetOptions}
            placeholder="Search agent or channel..."
            onChange={onSelectTarget}
          />
        </div>
      </Card>
      </div>

      <Card title="Messages">
        {!activeTarget && (
          <div className="text-slate-500 text-sm">
            Select where to send your message.
          </div>
        )}

        {activeTarget && (
          <div className="space-y-4">
            {activeChannelParticipants && (
              <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                <span className="text-slate-400">Participants:</span>{" "}
                {activeChannelParticipants}
              </div>
            )}
            <div
              ref={messagesContainerRef}
              className="max-h-[34rem] space-y-3 overflow-auto rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-sm chat-print-messages"
            >
              {chatLines.map((event) => {
                if (event.type === "agent.turn.failed") {
                  return (
                    <div key={event.id} className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-xs text-rose-300">
                        <span className="rounded bg-rose-900/50 px-1.5 py-0.5 text-[11px] text-rose-200">
                          {event.source}
                        </span>
                        <span>{formatTimestamp(event.createdAt)}</span>
                      </div>
                      <div className="mt-1 text-sm text-rose-200">{getAgentTurnFailedMessage(event)}</div>
                    </div>
                  );
                }

                return (
                  <div
                    key={event.id}
                    className={`space-y-1 ${getMessageRole(event) === "human" ? "text-right" : "text-left"}`}
                  >
                    <div
                      className={`flex items-center gap-2 text-xs text-slate-400 ${
                        getMessageRole(event) === "human" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300">
                        {event.source}
                      </span>
                      <span>{formatTimestamp(event.createdAt)}</span>
                    </div>
                    <div
                      className={`flex ${getMessageRole(event) === "human" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl border px-3 py-2 shadow-sm ${
                          getMessageRole(event) === "human"
                            ? "border-sky-700/70 bg-sky-900/30"
                            : getMessageRole(event) === "agent"
                              ? "border-slate-700 bg-slate-900"
                              : "border-amber-700/50 bg-amber-950/30"
                        }`}
                      >
                        <div className="text-slate-200">
                          <Markdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              p: ({ children }) => (
                                <p className="mb-2 leading-relaxed last:mb-0">{children}</p>
                              ),
                              a: ({ children, ...props }) => (
                                <a
                                  {...props}
                                  className="text-sky-400 underline hover:text-sky-300"
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {children}
                                </a>
                              ),
                              pre: ({ children }) => (
                                <pre className="mb-2 overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-100 last:mb-0">
                                  {children}
                                </pre>
                              ),
                              code: ({ children, ...props }) => (
                                <code
                                  {...props}
                                  className="rounded bg-slate-800/90 px-1 py-0.5 text-slate-100"
                                >
                                  {children}
                                </code>
                              ),
                              ul: ({ children }) => (
                                <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
                              ),
                              ol: ({ children }) => (
                                <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
                              ),
                              blockquote: ({ children }) => (
                                <blockquote className="mb-2 border-l-2 border-slate-600 pl-3 text-slate-400 last:mb-0">
                                  {children}
                                </blockquote>
                              )
                            }}
                          >
                            {(event.payload as { text?: string })?.text ?? ""}
                          </Markdown>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {typingIndicators.map((indicator) => (
                <div
                  key={`indicator-${indicator.agentName}`}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 chat-print-hide"
                >
                  <span className="font-medium text-slate-100">{indicator.agentName}</span>{" "}
                  is {toSentenceCase(indicator.status)}...
                </div>
              ))}
              {chatLines.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-4 py-8 text-center text-slate-500">
                  No messages yet. Send the first message to start the conversation.
                </div>
              )}
            </div>

            <div className="space-y-2 chat-print-hide">
              <Textarea
                rows={3}
                placeholder="Send a message..."
                value={messageText}
                onChange={(e) => onMessageTextChange(e.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              <div className="flex items-center gap-2">
                <Button onClick={onSendMessage}>Send message</Button>
                <Button variant="secondary" onClick={handleExportPdf}>
                  Export PDF
                </Button>
                <Button
                  variant="secondary"
                  className="bg-rose-900 text-rose-100 hover:bg-rose-800"
                  onClick={async () => {
                    if (!confirm("Clear all messages in this channel? This cannot be undone.")) {
                      return;
                    }
                    await onClearMessages();
                  }}
                >
                  Clear messages
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
