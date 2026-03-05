import { useEffect, useMemo, useRef, useState } from "react";
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
};

const INDICATOR_GRACE_MS = 4000;

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

function isTerminalAgentEvent(event: EventRow) {
  if (event.type === "message.created") return true;
  return /(completed|complete|done|finished|failed|error|cancelled|canceled|skipped|exited)$/i.test(
    event.type
  );
}

function toInlineAgentStatus(event: EventRow): string {
  const payload = asObject(event.payload);
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
  onSendMessage
}: ChatScreenProps) {
  const [nowTick, setNowTick] = useState(0);
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
          const sourceAgent = getAgentNameFromSource(event.source);
          if (sourceAgent) return true;
          return event.type === "agent.scheduled.trigger";
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
    const stateByAgent = new Map<
      string,
      { status: string; latestActivityAt: number; latestTerminalAt: number | null }
    >();
    for (const event of activityEvents) {
      const agentName = getAgentNameFromSource(event.source);
      if (!agentName) continue;
      const ts = event.createdAt ?? 0;
      const status = toInlineAgentStatus(event);
      const existing = stateByAgent.get(agentName);
      if (!existing) {
        stateByAgent.set(agentName, {
          status,
          latestActivityAt: isTerminalAgentEvent(event) ? 0 : ts,
          latestTerminalAt: isTerminalAgentEvent(event) ? ts : null
        });
        continue;
      }

      if (isTerminalAgentEvent(event)) {
        if (!existing.latestTerminalAt || ts >= existing.latestTerminalAt) {
          stateByAgent.set(agentName, {
            ...existing,
            latestTerminalAt: ts
          });
        }
        continue;
      }

      if (ts >= existing.latestActivityAt) {
        stateByAgent.set(agentName, {
          status,
          latestActivityAt: ts,
          latestTerminalAt: existing.latestTerminalAt
        });
      }
    }

    const now = Date.now();
    return [...stateByAgent.entries()]
      .filter(([, value]) => {
        if (value.latestActivityAt <= 0) return false;
        if (value.latestTerminalAt === null) return true;
        if (value.latestTerminalAt < value.latestActivityAt) return true;
        return now - value.latestTerminalAt <= INDICATOR_GRACE_MS;
      })
      .sort((left, right) => right[1].latestActivityAt - left[1].latestActivityAt)
      .map(([agentName, value]) => ({
        agentName,
        status: value.status,
        at: value.latestActivityAt
      }));
  }, [activityEvents, nowTick]);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const lastMessageId = messageEvents[messageEvents.length - 1]?.id ?? null;

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeTargetId || !messagesContainerRef.current) {
      return;
    }

    messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
  }, [activeTargetId, lastMessageId, messageEvents.length]);

  return (
    <div className="space-y-6">
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
            <div ref={messagesContainerRef} className="space-y-2 text-sm max-h-96 overflow-auto">
              {messageEvents.map((event) => (
                <div key={event.id} className="border-b border-slate-800 pb-2">
                  <div className="text-slate-300">
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
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
                          <pre className="mb-2 overflow-x-auto rounded bg-slate-900 p-2 text-slate-100 last:mb-0">
                            {children}
                          </pre>
                        ),
                        code: ({ children, ...props }) => (
                          <code
                            {...props}
                            className="rounded bg-slate-800 px-1 py-0.5 text-slate-100"
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
                  <div className="text-slate-500 text-xs">
                    {event.source} • {formatTimestamp(event.createdAt)}
                  </div>
                </div>
              ))}
              {typingIndicators.map((indicator) => (
                <div
                  key={`indicator-${indicator.agentName}`}
                  className="rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-400 italic"
                >
                  {indicator.agentName} is {toSentenceCase(indicator.status)}...
                </div>
              ))}
              {messageEvents.length === 0 && (
                <div className="text-slate-500">No messages yet.</div>
              )}
            </div>

            <div className="space-y-2">
              <Textarea
                rows={3}
                placeholder="Send a message..."
                value={messageText}
                onChange={(e) => onMessageTextChange(e.target.value)}
              />
              <Button onClick={onSendMessage}>Send message</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
