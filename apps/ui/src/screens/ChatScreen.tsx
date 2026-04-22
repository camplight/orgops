import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EventRow } from "../types";
import { apiJson } from "../api";
import { Button, Card, SelectAutocomplete, Textarea } from "../components/ui";
import { formatTimestamp } from "../utils/formatTimestamp";

type ChatScreenProps = {
  targetOptions: {
    id: string;
    label: string;
    meta?: string;
    participantsText?: string;
    agentNames?: string[];
  }[];
  activeChannelId: string | null;
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
  if (event.type === "tool.started") {
    const toolName = getPayloadString(payload, "tool");
    return toolName ? `using ${toolName.replace(/[_-]+/g, " ")}` : "using a tool";
  }
  if (event.type === "tool.executed") {
    const toolName = getPayloadString(payload, "tool");
    return toolName ? `finished ${toolName.replace(/[_-]+/g, " ")}` : "finished a tool";
  }
  if (event.type === "tool.failed") {
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

type AgentContextUsage = {
  agentName: string;
  usedTokens: number;
  availableTokens: number;
  contextWindowTokens: number;
  utilizationPct: number;
  updatedAt: number;
};

type MemoryRecord = {
  summaryText: string;
  windowStartAt?: number;
  lastProcessedAt: number;
  updatedAt: number;
};

type AgentMemory = {
  agentName: string;
  channelRecent: MemoryRecord | null;
  channelFull: MemoryRecord | null;
  error?: string;
};

function summarizeMemoryTitle(record: MemoryRecord | null, fallback: string): string {
  if (!record || !record.summaryText.trim()) return fallback;
  return record.summaryText;
}

function getRecordMeta(record: MemoryRecord | null): string {
  if (!record) return "No record yet";
  const updated = formatTimestamp(record.updatedAt);
  const processed = formatTimestamp(record.lastProcessedAt);
  return `Updated: ${updated} | Last processed: ${processed}`;
}

function parseAgentContextUsage(event: EventRow): AgentContextUsage | null {
  if (event.type !== "telemetry.context.window.updated") return null;
  const payload = asObject(event.payload);
  const agentNameRaw = payload.agentName;
  const agentName =
    typeof agentNameRaw === "string" && agentNameRaw.trim().length > 0
      ? agentNameRaw.trim()
      : getAgentNameForStatusEvent(event);
  if (!agentName) return null;
  const usedTokens =
    typeof payload.estimatedUsedTokens === "number" && Number.isFinite(payload.estimatedUsedTokens)
      ? Math.max(0, Math.floor(payload.estimatedUsedTokens))
      : 0;
  const availableTokens =
    typeof payload.estimatedAvailableTokens === "number" &&
    Number.isFinite(payload.estimatedAvailableTokens)
      ? Math.max(0, Math.floor(payload.estimatedAvailableTokens))
      : 0;
  const contextWindowTokens =
    typeof payload.contextWindowTokens === "number" && Number.isFinite(payload.contextWindowTokens)
      ? Math.max(1, Math.floor(payload.contextWindowTokens))
      : usedTokens + availableTokens;
  const computedPct = contextWindowTokens > 0 ? (usedTokens / contextWindowTokens) * 100 : 0;
  const utilizationPct =
    typeof payload.utilizationPct === "number" && Number.isFinite(payload.utilizationPct)
      ? Math.max(0, Math.min(100, payload.utilizationPct))
      : Math.max(0, Math.min(100, computedPct));
  return {
    agentName,
    usedTokens,
    availableTokens,
    contextWindowTokens,
    utilizationPct,
    updatedAt: event.createdAt ?? 0,
  };
}

function ContextRing({
  usedPct,
  size = 36,
  stroke = 4,
  showLabel = true
}: {
  usedPct: number;
  size?: number;
  stroke?: number;
  showLabel?: boolean;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, usedPct));
  const dashOffset = circumference - (clamped / 100) * circumference;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="rgb(51 65 85)"
        strokeWidth={stroke}
        fill="transparent"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={clamped >= 90 ? "rgb(248 113 113)" : clamped >= 75 ? "rgb(250 204 21)" : "rgb(56 189 248)"}
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="transparent"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {showLabel ? (
        <text
          x="50%"
          y="50%"
          dominantBaseline="middle"
          textAnchor="middle"
          className="fill-slate-200 text-[9px] font-medium"
        >
          {Math.round(clamped)}%
        </text>
      ) : null}
    </svg>
  );
}

export function ChatScreen({
  targetOptions,
  activeChannelId,
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
  const activeAgentNames = useMemo(() => {
    if (!activeTargetId) return [];
    if (activeTargetId.startsWith("agent:")) {
      const agentName = activeTargetId.slice("agent:".length).trim();
      return agentName ? [agentName] : [];
    }
    const fromTarget = activeTarget?.agentNames ?? [];
    return [...new Set(fromTarget.filter((name) => Boolean(name?.trim())))];
  }, [activeTarget, activeTargetId]);
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
  const contextUsageByAgent = useMemo(() => {
    const latestByAgent = new Map<string, AgentContextUsage>();
    const ordered = events
      .slice()
      .sort((left, right) => {
        const leftTs = left.createdAt ?? 0;
        const rightTs = right.createdAt ?? 0;
        if (leftTs !== rightTs) return leftTs - rightTs;
        return left.id.localeCompare(right.id);
      });
    for (const event of ordered) {
      const usage = parseAgentContextUsage(event);
      if (!usage) continue;
      const existing = latestByAgent.get(usage.agentName);
      if (!existing || usage.updatedAt >= existing.updatedAt) {
        latestByAgent.set(usage.agentName, usage);
      }
    }
    return [...latestByAgent.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }, [events]);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const [memoryDrawerOpen, setMemoryDrawerOpen] = useState(false);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [agentMemories, setAgentMemories] = useState<AgentMemory[]>([]);
  const [memoryReloadToken, setMemoryReloadToken] = useState(0);
  const memoryCacheRef = useRef<Map<string, AgentMemory[]>>(new Map());
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

  const memoryFetchKey = useMemo(() => {
    if (!activeChannelId || activeAgentNames.length === 0) return "";
    const names = [...activeAgentNames].sort((left, right) => left.localeCompare(right));
    return `${activeChannelId}::${names.join(",")}`;
  }, [activeAgentNames, activeChannelId]);
  const stableAgentNames = useMemo(() => {
    if (!memoryFetchKey.includes("::")) return [];
    const namesPart = memoryFetchKey.split("::")[1] ?? "";
    return namesPart.split(",").map((name) => name.trim()).filter(Boolean);
  }, [memoryFetchKey]);

  useEffect(() => {
    if (!memoryDrawerOpen || !memoryFetchKey || !activeChannelId || stableAgentNames.length === 0) {
      setAgentMemories([]);
      setMemoryLoading(false);
      return;
    }
    const cached = memoryCacheRef.current.get(memoryFetchKey);
    if (cached) {
      setAgentMemories(cached);
      setMemoryLoading(false);
      return;
    }
    let cancelled = false;
    setMemoryLoading(true);
    const load = async () => {
      const bundles = await Promise.all(
        stableAgentNames.map(async (agentName): Promise<AgentMemory> => {
          const channelParams = new URLSearchParams({
            agentName,
            channelId: activeChannelId
          });
          try {
            const [
              channelRecent,
              channelFull
            ] = await Promise.all([
              apiJson<{ record?: MemoryRecord | null }>(
                `/api/memory/channel/recent?${channelParams.toString()}`
              ),
              apiJson<{ record?: MemoryRecord | null }>(
                `/api/memory/channel/full?${channelParams.toString()}`
              )
            ]);
            return {
              agentName,
              channelRecent: channelRecent.record ?? null,
              channelFull: channelFull.record ?? null
            };
          } catch (error) {
            return {
              agentName,
              channelRecent: null,
              channelFull: null,
              error: error instanceof Error ? error.message : "Unable to load memory"
            };
          }
        })
      );
      if (cancelled) return;
      memoryCacheRef.current.set(memoryFetchKey, bundles);
      setAgentMemories(bundles);
      setMemoryLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [memoryDrawerOpen, activeChannelId, memoryFetchKey, memoryReloadToken, stableAgentNames]);

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
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={onSendMessage}>Send message</Button>
                  <Button variant="secondary" onClick={handleExportPdf}>
                    Export PDF
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setMemoryDrawerOpen(true)}
                    disabled={!activeChannelId || activeAgentNames.length === 0}
                  >
                    View memory
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
                {contextUsageByAgent.length > 0 && (
                  <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      Context
                    </span>
                    {contextUsageByAgent.map((usage) => (
                      <div
                        key={`context-footer-${usage.agentName}`}
                        className="group relative flex items-center gap-1.5 rounded border border-slate-800 bg-slate-900/70 px-1.5 py-1"
                        tabIndex={0}
                      >
                        <ContextRing usedPct={usage.utilizationPct} size={18} stroke={2.5} showLabel={false} />
                        <span className="max-w-24 truncate text-[11px] font-medium text-slate-200">
                          {usage.agentName}
                        </span>
                        <span className="text-[10px] text-slate-400">{Math.round(usage.utilizationPct)}%</span>
                        <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-56 max-w-[calc(100vw-1rem)] translate-y-1 rounded-lg border border-slate-700 bg-slate-900/95 p-2.5 text-left opacity-0 shadow-xl transition-all duration-150 sm:w-60 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
                          <div className="mb-1.5 border-b border-slate-700 pb-1.5 text-xs font-semibold text-slate-100">
                            {usage.agentName}
                          </div>
                          <div className="space-y-1 text-[11px]">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">Utilization</span>
                              <span className="font-medium text-slate-200">
                                {Math.round(usage.utilizationPct)}%
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">Used</span>
                              <span className="font-medium text-slate-200">
                                {usage.usedTokens.toLocaleString()} tokens
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">Available</span>
                              <span className="font-medium text-slate-200">
                                {usage.availableTokens.toLocaleString()} tokens
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">Context window</span>
                              <span className="font-medium text-slate-200">
                                {usage.contextWindowTokens.toLocaleString()} tokens
                              </span>
                            </div>
                            <div className="mt-1 border-t border-slate-700 pt-1 text-[10px] text-slate-500">
                              Updated {usage.updatedAt ? formatTimestamp(usage.updatedAt) : "unknown"}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity lg:left-56 ${
          memoryDrawerOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setMemoryDrawerOpen(false)}
      />
      <aside
        className={`fixed bottom-0 right-0 top-0 z-50 w-full max-w-4xl border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-300 ${
          memoryDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!memoryDrawerOpen}
      >
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Agent Memory</h3>
              <p className="text-xs text-slate-500">
                Channel recent and channel full memory per agent.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={() => {
                  if (memoryFetchKey) {
                    memoryCacheRef.current.delete(memoryFetchKey);
                  }
                  setMemoryReloadToken((value) => value + 1);
                }}
                disabled={!memoryFetchKey}
              >
                Refresh
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={() => setMemoryDrawerOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
            {memoryLoading ? (
              <div className="rounded border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-400">
                Loading memory...
              </div>
            ) : activeAgentNames.length === 0 ? (
              <div className="rounded border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-400">
                No agent participants found for this chat.
              </div>
            ) : (
              <div className="space-y-4">
                {agentMemories.map((memory) => (
                  <div
                    key={`memory-${memory.agentName}`}
                    className="space-y-3 rounded border border-slate-800 bg-slate-900/50 p-3"
                  >
                    <div className="text-sm font-semibold text-slate-100">{memory.agentName}</div>
                    {memory.error ? (
                      <div className="rounded border border-rose-900/60 bg-rose-950/30 p-2 text-xs text-rose-200">
                        {memory.error}
                      </div>
                    ) : null}
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded border border-slate-800 bg-slate-950 p-3">
                        <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
                          Channel Recent
                        </div>
                        <div className="whitespace-pre-wrap text-sm text-slate-200">
                          {summarizeMemoryTitle(memory.channelRecent, "No recent channel memory yet.")}
                        </div>
                        <div className="mt-2 text-[11px] text-slate-500">
                          {getRecordMeta(memory.channelRecent)}
                        </div>
                      </div>
                      <div className="rounded border border-slate-800 bg-slate-950 p-3">
                        <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
                          Channel Full
                        </div>
                        <div className="whitespace-pre-wrap text-sm text-slate-200">
                          {summarizeMemoryTitle(memory.channelFull, "No full channel memory yet.")}
                        </div>
                        <div className="mt-2 text-[11px] text-slate-500">
                          {getRecordMeta(memory.channelFull)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
