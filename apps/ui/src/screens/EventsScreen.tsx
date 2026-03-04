import { useEffect, useMemo, useState } from "react";
import type { Channel, EventRow, EventTypeInfo } from "../types";
import { Button, Card, Input } from "../components/ui";
import { formatTimestamp } from "../utils/formatTimestamp";

type EventFilters = {
  agentName: string;
  channelId: string;
  type: string;
  source: string;
  status: string;
  teamId: string;
  auditOnly: boolean;
};

type EventsScreenProps = {
  events: EventRow[];
  channels: Channel[];
  eventTypes: EventTypeInfo[];
  filters: EventFilters;
  onFiltersChange: (filters: EventFilters) => void;
  onApplyFilters: () => void;
  onClearEvents: () => Promise<void>;
  onEmitEvent: (rawJson: string) => Promise<void>;
  onRefreshEventTypes: () => Promise<void> | void;
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
  teamId: "",
  auditOnly: false
};

export function EventsScreen({
  events,
  channels,
  filters,
  onFiltersChange,
  onApplyFilters,
  onClearEvents
}: EventsScreenProps) {
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [payloadFilter, setPayloadFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const channelNameById = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel.name])),
    [channels],
  );

  const getDestinationLabel = (event: EventRow) => {
    const targets: string[] = [];
    if (event.channelId) {
      const channelName = channelNameById.get(event.channelId);
      targets.push(channelName ? `channel:${channelName} (${event.channelId})` : `channel:${event.channelId}`);
    }
    return targets.length > 0 ? targets.join(" | ") : "-";
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
      ? events.filter((event) => {
          const payloadText = JSON.stringify(event.payload ?? {}).toLowerCase();
          return payloadText.includes(payloadQuery);
        })
      : events;

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
  }, [events, payloadFilter, sortDirection, sortKey, channelNameById]);

  const sortLabel = (key: SortKey, label: string) =>
    `${label}${sortKey === key ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}`;

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedEvents.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const pagedEvents = filteredAndSortedEvents.slice(startIndex, endIndex);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  return (
    <div className="space-y-4">
      <Card title="Event Filters">
        <div className="grid gap-3 md:grid-cols-4">
          <Input
            placeholder="Agent name"
            value={filters.agentName}
            onChange={(e) => onFiltersChange({ ...filters, agentName: e.target.value })}
          />
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
            placeholder="Type"
            value={filters.type}
            onChange={(e) => onFiltersChange({ ...filters, type: e.target.value })}
          />
          <Input
            placeholder="Source"
            value={filters.source}
            onChange={(e) => onFiltersChange({ ...filters, source: e.target.value })}
          />
          <Input
            placeholder="Status"
            value={filters.status}
            onChange={(e) => onFiltersChange({ ...filters, status: e.target.value })}
          />
          <Input
            placeholder="Team ID"
            value={filters.teamId}
            onChange={(e) => onFiltersChange({ ...filters, teamId: e.target.value })}
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
        </div>
        <div className="mt-3 flex gap-2">
          <Button onClick={onApplyFilters}>Apply</Button>
          <Button variant="secondary" onClick={() => onFiltersChange(DEFAULT_FILTERS)}>
            Reset
          </Button>
          <Button
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
      </Card>

      <Card title={`Events (${filteredAndSortedEvents.length})`}>
        <div className="mb-3 flex items-center justify-between gap-3 text-sm">
          <div className="text-slate-400">
            Showing {filteredAndSortedEvents.length === 0 ? 0 : startIndex + 1}-
            {Math.min(endIndex, filteredAndSortedEvents.length)} of {filteredAndSortedEvents.length}
          </div>
          <div className="flex items-center gap-2">
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
                <th className="px-2 py-2">Payload</th>
                <th className="px-2 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {pagedEvents.map((event) => (
                <tr key={event.id} className="border-b border-slate-900 align-top">
                  <td className="px-2 py-2 whitespace-nowrap text-slate-400">
                    {formatTimestamp(event.createdAt)}
                  </td>
                  <td className="px-2 py-2 text-slate-200">{event.type}</td>
                  <td className="px-2 py-2 text-slate-300">{event.source}</td>
                  <td className="px-2 py-2 text-slate-400">{getDestinationLabel(event)}</td>
                  <td className="px-2 py-2 text-slate-300">{event.status ?? "-"}</td>
                  <td className="px-2 py-2 max-w-[480px]">
                    <pre className="text-xs text-slate-400 whitespace-pre-wrap break-words">
                      {JSON.stringify(event.payload ?? {}, null, 2)}
                    </pre>
                  </td>
                  <td className="px-2 py-2 text-xs text-rose-400 max-w-[320px] whitespace-pre-wrap break-words">
                    {event.lastError ?? "-"}
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
    </div>
  );
}
