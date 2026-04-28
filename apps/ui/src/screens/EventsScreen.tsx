import { useEffect, useMemo, useState } from "react";
import type { Channel, EventRow, EventTypeInfo } from "../types";
import { Button, Card, Input } from "../components/ui";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { formatTimestamp } from "../utils/formatTimestamp";

type EventFilters = {
  agentName: string;
  channelId: string;
  type: string;
  source: string;
  status: string;
  auditOnly: boolean;
  excludeAuditMemory: boolean;
  excludeAuditSecret: boolean;
  scheduledOnly: boolean;
};

type EventsScreenProps = {
  events: EventRow[];
  channels: Channel[];
  eventTypes: EventTypeInfo[];
  filters: EventFilters;
  onFiltersChange: (filters: EventFilters) => void;
  onApplyFilters: (filters?: EventFilters) => void;
  onClearEvents: () => Promise<void>;
  onEmitEvent: (rawJson: string) => Promise<void>;
  onRefreshEventTypes: () => Promise<void> | void;
  onUpdateScheduledEvent: (eventId: string, input: { deliverAt: number; payload?: unknown }) => Promise<void>;
  onDeleteScheduledEvent: (eventId: string) => Promise<void>;
  focusEventId?: string | null;
  onFocusEventApplied?: () => void;
  drawerOnly?: boolean;
};

type SortKey =
  | "createdAt"
  | "type"
  | "source"
  | "destination"
  | "status";

const DEFAULT_FILTERS: EventFilters = {
  agentName: "",
  channelId: "",
  type: "",
  source: "",
  status: "",
  auditOnly: false,
  excludeAuditMemory: false,
  excludeAuditSecret: false,
  scheduledOnly: false,
};

export function EventsScreen({
  events,
  channels,
  eventTypes,
  filters,
  onFiltersChange,
  onApplyFilters,
  onClearEvents,
  onUpdateScheduledEvent,
  onDeleteScheduledEvent,
  focusEventId,
  onFocusEventApplied,
  drawerOnly = false
}: EventsScreenProps) {
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [isPaused, setIsPaused] = useState(false);
  const [pausedEventsSnapshot, setPausedEventsSnapshot] = useState<EventRow[] | null>(null);
  const [payloadFilter, setPayloadFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [scheduledDeliverAtInput, setScheduledDeliverAtInput] = useState("");
  const [scheduledTextInput, setScheduledTextInput] = useState("");
  const [scheduledActionPending, setScheduledActionPending] = useState(false);
  const eventsForView = isPaused && pausedEventsSnapshot ? pausedEventsSnapshot : events;
  const channelById = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel])),
    [channels]
  );
  const queuedWhilePausedCount = useMemo(() => {
    if (!isPaused || !pausedEventsSnapshot) return 0;
    const snapshotIds = new Set(pausedEventsSnapshot.map((event) => event.id));
    let count = 0;
    for (const event of events) {
      if (!snapshotIds.has(event.id)) count += 1;
    }
    return count;
  }, [events, isPaused, pausedEventsSnapshot]);
  const sourceOptions = useMemo(
    () =>
      [...new Set(eventsForView.map((event) => event.source).filter((source) => Boolean(source?.trim())))]
        .sort((a, b) => a.localeCompare(b)),
    [eventsForView]
  );
  const typeOptions = useMemo(
    () =>
      [
        ...new Set([
          ...eventTypes.map((eventType) => eventType.type),
          ...eventsForView.map((event) => event.type)
        ])
      ]
        .filter((type) => Boolean(type?.trim()))
        .sort((a, b) => a.localeCompare(b)),
    [eventTypes, eventsForView]
  );

  const parseSourceParticipant = (source?: string) => {
    if (!source) return null;
    const [rawType, ...rest] = source.split(":");
    if (!rawType || rest.length === 0) return null;
    const subscriberType = rawType.trim().toUpperCase();
    const subscriberId = rest.join(":").trim();
    if (!subscriberId) return null;
    if (subscriberType !== "HUMAN" && subscriberType !== "AGENT") return null;
    return { subscriberType, subscriberId };
  };
  const getProcessKindFromCommand = (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return null;
    const executable = trimmed
      .replace(/^["']/, "")
      .split(/\s+|\||&&|;/, 1)[0]
      ?.replace(/["']$/, "");
    if (!executable) return null;
    const base = executable.split("/").pop() ?? executable;
    return base || null;
  };
  const getStartedSummary = (event: EventRow) => {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const toolRaw = payload.tool;
    const cmdRaw = payload.cmd;
    const processIdRaw = payload.processId;
    const tool = typeof toolRaw === "string" && toolRaw.trim() ? toolRaw : null;
    const cmd = typeof cmdRaw === "string" && cmdRaw.trim() ? cmdRaw : null;
    const processId =
      typeof processIdRaw === "string" && processIdRaw.trim() ? processIdRaw : null;
    const processKind = cmd ? getProcessKindFromCommand(cmd) : null;
    if (!tool && !processKind && !processId) return null;
    return {
      tool,
      processKind,
      processId
    };
  };
  const formatStartedLabel = (event: EventRow) => {
    const summary = getStartedSummary(event);
    if (!summary) return "-";
    const parts: string[] = [];
    if (summary.tool) parts.push(`tool:${summary.tool}`);
    if (summary.processKind) parts.push(`proc:${summary.processKind}`);
    if (parts.length === 0 && summary.processId) {
      return `proc:${summary.processId}`;
    }
    return parts.join(" | ");
  };
  const agentNameOptions = useMemo(
    () =>
      [...new Set(
        eventsForView
          .map((event) => parseSourceParticipant(event.source))
          .filter((participant) => participant?.subscriberType === "AGENT")
          .map((participant) => participant?.subscriberId ?? "")
      )]
        .filter((name) => Boolean(name.trim()))
        .sort((a, b) => a.localeCompare(b)),
    [eventsForView]
  );

  const getDestinationLabel = (event: EventRow) => {
    if (!event.channelId) return "-";
    const channel = channelById.get(event.channelId);
    if (channel?.name?.trim()) return channel.name;
    return event.channelId;
  };

  const handleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("desc");
  };

  const filteredAndSortedEvents = useMemo(() => {
    const payloadQuery = payloadFilter.trim().toLowerCase();
    const filtered = payloadQuery
      ? eventsForView.filter((event) => {
          const payloadText = JSON.stringify(event.payload ?? {}).toLowerCase();
          return payloadText.includes(payloadQuery);
        })
      : eventsForView;

    return [...filtered].sort((a, b) => {
      const read = (event: EventRow) => {
        switch (sortKey) {
          case "createdAt":
            return event.createdAt ?? 0;
          case "type":
            return event.type ?? "";
          case "source":
            return event.source ?? "";
          case "destination":
            return getDestinationLabel(event);
          case "status":
            return event.status ?? "";
          default:
            return "";
        }
      };
      const left = read(a);
      const right = read(b);
      const cmp =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      return sortDirection === "asc" ? cmp : -cmp;
    });
  }, [eventsForView, payloadFilter, sortDirection, sortKey, channelById]);

  const sortLabel = (key: SortKey, label: string) =>
    `${label}${sortKey === key ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}`;

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedEvents.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const pagedEvents = filteredAndSortedEvents.slice(startIndex, endIndex);
  const selectedEvent = useMemo(
    () => filteredAndSortedEvents.find((event) => event.id === selectedEventId) ?? null,
    [filteredAndSortedEvents, selectedEventId]
  );
  const isSelectedFutureScheduledEvent =
    Boolean(selectedEvent?.deliverAt) &&
    (selectedEvent?.deliverAt ?? 0) > Date.now() &&
    (selectedEvent?.status ?? "").toUpperCase() === "PENDING";

  const toDateTimeLocalInputValue = (timestamp?: number) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}`;
  };

  useEscapeKey(Boolean(selectedEvent), () => {
    setSelectedEventId(null);
  });

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (!selectedEventId) return;
    const exists = filteredAndSortedEvents.some((event) => event.id === selectedEventId);
    if (!exists) {
      setSelectedEventId(null);
    }
  }, [filteredAndSortedEvents, selectedEventId]);

  useEffect(() => {
    if (!selectedEvent) {
      setScheduledDeliverAtInput("");
      setScheduledTextInput("");
      return;
    }
    setScheduledDeliverAtInput(toDateTimeLocalInputValue(selectedEvent.deliverAt));
    const payload = selectedEvent.payload;
    const payloadText =
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      typeof (payload as Record<string, unknown>).text === "string"
        ? String((payload as Record<string, unknown>).text)
        : "";
    setScheduledTextInput(payloadText);
  }, [selectedEvent]);

  useEffect(() => {
    if (!focusEventId) return;
    if (!eventsForView.some((event) => event.id === focusEventId)) return;
    setSelectedEventId(focusEventId);
    onFocusEventApplied?.();
  }, [eventsForView, focusEventId, onFocusEventApplied]);

  const handleResetFilters = () => {
    const resetFilters = { ...DEFAULT_FILTERS };
    onFiltersChange(resetFilters);
    onApplyFilters(resetFilters);
  };
  const handleTogglePause = () => {
    if (isPaused) {
      setIsPaused(false);
      setPausedEventsSnapshot(null);
      return;
    }
    setPausedEventsSnapshot(events);
    setIsPaused(true);
  };

  const handleSaveScheduledEvent = async () => {
    if (!selectedEvent) return;
    const deliverAt = Date.parse(scheduledDeliverAtInput);
    if (!Number.isFinite(deliverAt)) {
      alert("Please provide a valid date/time.");
      return;
    }
    if (deliverAt <= Date.now()) {
      alert("Scheduled time must be in the future.");
      return;
    }

    let payloadUpdate: unknown = undefined;
    if (selectedEvent.payload && typeof selectedEvent.payload === "object" && !Array.isArray(selectedEvent.payload)) {
      const currentPayload = selectedEvent.payload as Record<string, unknown>;
      if (typeof currentPayload.text === "string" && currentPayload.text !== scheduledTextInput) {
        payloadUpdate = {
          ...currentPayload,
          text: scheduledTextInput
        };
      }
    }

    try {
      setScheduledActionPending(true);
      await onUpdateScheduledEvent(selectedEvent.id, {
        deliverAt,
        ...(payloadUpdate !== undefined ? { payload: payloadUpdate } : {})
      });
    } finally {
      setScheduledActionPending(false);
    }
  };

  const handleDeleteScheduledEvent = async () => {
    if (!selectedEvent) return;
    if (!confirm("Delete this scheduled event? This cannot be undone.")) return;
    try {
      setScheduledActionPending(true);
      await onDeleteScheduledEvent(selectedEvent.id);
      setSelectedEventId(null);
    } finally {
      setScheduledActionPending(false);
    }
  };

  return (
    <div className="space-y-4">
      {!drawerOnly ? (
        <>
      <Card title="Event Filters">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onApplyFilters();
          }}
        >
          <div className="grid gap-3 md:grid-cols-4">
            <Input
              list="agent-name-filter-options"
              placeholder="Agent name"
              value={filters.agentName}
              onChange={(e) => onFiltersChange({ ...filters, agentName: e.target.value })}
            />
            <datalist id="agent-name-filter-options">
              {agentNameOptions.map((agentName) => (
                <option key={agentName} value={agentName} />
              ))}
            </datalist>
            <Input
              list="channel-filter-options"
              placeholder="Channel ID"
              value={filters.channelId}
              onChange={(e) => onFiltersChange({ ...filters, channelId: e.target.value })}
            />
            <datalist id="channel-filter-options">
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </datalist>
            <Input
              list="type-filter-options"
              placeholder="Type"
              value={filters.type}
              onChange={(e) => onFiltersChange({ ...filters, type: e.target.value })}
            />
            <datalist id="type-filter-options">
              {typeOptions.map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
            <Input
              list="source-filter-options"
              placeholder="Source"
              value={filters.source}
              onChange={(e) => onFiltersChange({ ...filters, source: e.target.value })}
            />
            <datalist id="source-filter-options">
              {sourceOptions.map((source) => (
                <option key={source} value={source} />
              ))}
            </datalist>
            <Input
              placeholder="Status"
              value={filters.status}
              onChange={(e) => onFiltersChange({ ...filters, status: e.target.value })}
            />
            <Input
              placeholder="Payload contains (client-side)"
              value={payloadFilter}
              onChange={(e) => {
                setPayloadFilter(e.target.value);
                setCurrentPage(1);
              }}
            />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={filters.auditOnly}
                onChange={(e) => onFiltersChange({ ...filters, auditOnly: e.target.checked })}
              />
              Audit only
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={filters.excludeAuditMemory}
                onChange={(e) => onFiltersChange({ ...filters, excludeAuditMemory: e.target.checked })}
              />
              Exclude audit.memory.*
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={filters.excludeAuditSecret}
                onChange={(e) => onFiltersChange({ ...filters, excludeAuditSecret: e.target.checked })}
              />
              Exclude audit.secret*
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={filters.scheduledOnly}
                onChange={(e) => onFiltersChange({ ...filters, scheduledOnly: e.target.checked })}
              />
              Scheduled only
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="submit">Apply</Button>
            <Button type="button" variant="secondary" onClick={handleResetFilters}>
              Reset
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="bg-rose-900 hover:bg-rose-800 text-rose-100"
              onClick={async () => {
                if (!confirm("Delete all events? This cannot be undone.")) return;
                await onClearEvents();
              }}
            >
              Clear all events
            </Button>
          </div>
        </form>
      </Card>

      <Card title={`Events (${filteredAndSortedEvents.length})`}>
        <div className="mb-3 flex items-center justify-between gap-3 text-sm">
          <div className="text-slate-400">
            Showing {filteredAndSortedEvents.length === 0 ? 0 : startIndex + 1}-
            {Math.min(endIndex, filteredAndSortedEvents.length)} of {filteredAndSortedEvents.length}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={handleTogglePause}>
              {isPaused ? "Resume live updates" : "Pause live updates"}
            </Button>
            {isPaused && queuedWhilePausedCount > 0 ? (
              <span className="text-amber-300">{queuedWhilePausedCount} queued</span>
            ) : null}
            <label className="text-slate-400" htmlFor="events-page-size">
              Rows
            </label>
            <select
              id="events-page-size"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
              value={String(pageSize)}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
        </div>
        <div className="mb-3 text-xs text-slate-500">
          Click an event row to open details.
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-300">
                <th className="px-2 py-2">
                  <button type="button" onClick={() => handleSort("createdAt")}>
                    {sortLabel("createdAt", "Time")}
                  </button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => handleSort("type")}>
                    {sortLabel("type", "Type")}
                  </button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => handleSort("source")}>
                    {sortLabel("source", "Source")}
                  </button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => handleSort("destination")}>
                    {sortLabel("destination", "Destination")}
                  </button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => handleSort("status")}>
                    {sortLabel("status", "Status")}
                  </button>
                </th>
                <th className="px-2 py-2">Deliver At</th>
              </tr>
            </thead>
            <tbody>
              {pagedEvents.map((event) => (
                <tr
                  key={event.id}
                  className={`cursor-pointer border-b border-slate-900 align-top hover:bg-slate-900/40 ${
                    selectedEventId === event.id ? "bg-slate-900/70" : ""
                  }`}
                  onClick={() => setSelectedEventId(event.id)}
                >
                  <td className="px-2 py-2 whitespace-nowrap text-slate-400">
                    {formatTimestamp(event.createdAt)}
                  </td>
                  <td className="px-2 py-2 text-slate-200">
                    <div>{event.type}</div>
                    {formatStartedLabel(event) !== "-" ? (
                      <div className="mt-0.5 text-xs text-slate-400">{formatStartedLabel(event)}</div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-slate-300">{event.source}</td>
                  <td className="px-2 py-2 text-slate-400">{getDestinationLabel(event)}</td>
                  <td className="px-2 py-2 text-slate-300">{event.status ?? "-"}</td>
                  <td className="px-2 py-2 whitespace-nowrap text-slate-400">
                    {event.deliverAt ? formatTimestamp(event.deliverAt) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pagedEvents.length === 0 && (
            <div className="py-6 text-center text-slate-500">No events found.</div>
          )}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
          >
            Previous
          </Button>
          <div className="text-sm text-slate-400">
            Page {currentPage} of {totalPages}
          </div>
          <Button
            variant="secondary"
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
          >
            Next
          </Button>
        </div>
      </Card>
        </>
      ) : null}

      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity lg:left-56 ${
          selectedEvent ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setSelectedEventId(null)}
      />
      <aside
        className={`fixed bottom-0 right-0 top-0 z-50 w-full max-w-3xl border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-300 ${
          selectedEvent ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!selectedEvent}
      >
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                {selectedEvent?.type ?? "Event Details"}
              </h3>
              <p className="text-xs text-slate-500">{selectedEvent?.id}</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="px-2 py-1 text-xs"
              onClick={() => setSelectedEventId(null)}
            >
              Close
            </Button>
          </div>
          {selectedEvent ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
              <div className="rounded border border-slate-800 bg-slate-950 p-3 text-sm">
                {(() => {
                  const startedSummary = getStartedSummary(selectedEvent);
                  if (!startedSummary) return null;
                  return (
                    <div className="mb-1 text-slate-300">
                      <span className="text-slate-500">Started:</span>{" "}
                      {startedSummary.tool ? `tool ${startedSummary.tool}` : null}
                      {startedSummary.tool && startedSummary.processKind ? " | " : null}
                      {startedSummary.processKind ? `process ${startedSummary.processKind}` : null}
                      {!startedSummary.tool && !startedSummary.processKind && startedSummary.processId
                        ? `process ${startedSummary.processId}`
                        : null}
                    </div>
                  );
                })()}
                <div className="text-slate-300">
                  <span className="text-slate-500">Source:</span> {selectedEvent.source}
                </div>
                <div className="mt-1 text-slate-300">
                  <span className="text-slate-500">Destination:</span>{" "}
                  {getDestinationLabel(selectedEvent)}
                </div>
                <div className="mt-1 text-slate-300">
                  <span className="text-slate-500">Status:</span> {selectedEvent.status ?? "-"}
                </div>
                <div className="mt-1 text-slate-300">
                  <span className="text-slate-500">Created:</span>{" "}
                  {formatTimestamp(selectedEvent.createdAt)}
                </div>
                <div className="mt-1 text-slate-300">
                  <span className="text-slate-500">Deliver At:</span>{" "}
                  {selectedEvent.deliverAt ? formatTimestamp(selectedEvent.deliverAt) : "-"}
                </div>
              </div>

              {isSelectedFutureScheduledEvent ? (
                <div className="rounded border border-slate-800 bg-slate-950 p-3">
                  <h4 className="mb-2 text-sm text-slate-300">Scheduled Event Actions</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs text-slate-500" htmlFor="scheduled-deliver-at">
                        Deliver At
                      </label>
                      <Input
                        id="scheduled-deliver-at"
                        type="datetime-local"
                        value={scheduledDeliverAtInput}
                        onChange={(e) => setScheduledDeliverAtInput(e.target.value)}
                        disabled={scheduledActionPending}
                      />
                    </div>
                    {selectedEvent.payload &&
                    typeof selectedEvent.payload === "object" &&
                    !Array.isArray(selectedEvent.payload) &&
                    typeof (selectedEvent.payload as Record<string, unknown>).text === "string" ? (
                      <div>
                        <label className="mb-1 block text-xs text-slate-500" htmlFor="scheduled-text">
                          Payload text
                        </label>
                        <Input
                          id="scheduled-text"
                          value={scheduledTextInput}
                          onChange={(e) => setScheduledTextInput(e.target.value)}
                          disabled={scheduledActionPending}
                        />
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={handleSaveScheduledEvent}
                        disabled={scheduledActionPending}
                      >
                        Save scheduled changes
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="bg-rose-900 hover:bg-rose-800 text-rose-100"
                        onClick={handleDeleteScheduledEvent}
                        disabled={scheduledActionPending}
                      >
                        Delete scheduled event
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="rounded border border-slate-800 bg-slate-950 p-3">
                <h4 className="mb-2 text-sm text-slate-300">Payload</h4>
                <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">
                  {JSON.stringify(selectedEvent.payload ?? {}, null, 2)}
                </pre>
              </div>

              <div className="rounded border border-slate-800 bg-slate-950 p-3">
                <h4 className="mb-2 text-sm text-slate-300">Last Error</h4>
                <pre className="max-h-[25vh] overflow-auto whitespace-pre-wrap break-words text-xs text-rose-300">
                  {selectedEvent.lastError ?? "-"}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
