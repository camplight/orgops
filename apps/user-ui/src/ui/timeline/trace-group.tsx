import {
  traceChipCode,
  traceChipTone,
  traceDetail,
  traceTitle
} from "../../domain/messaging/trace-rules";
import { formatTime } from "../../domain/messaging/time-format";
import type { EventRow } from "../../types";

type TraceGroupProps = {
  traceEvents: EventRow[];
  tone: "agent" | "system";
  expandedTraceEventId: string | null;
  onToggleTraceEvent: (eventId: string) => void;
};

export function TraceGroup({
  traceEvents,
  tone,
  expandedTraceEventId,
  onToggleTraceEvent
}: TraceGroupProps) {
  const selectedEvent = traceEvents.find((event) => event.id === expandedTraceEventId) ?? null;
  return (
    <article className={`trace-group trace-group-${tone}`}>
      <div className="trace-chips" role="list" aria-label="Agent activity trace">
        {traceEvents.map((event) => {
          const selected = event.id === expandedTraceEventId;
          const summary = traceTitle(event);
          return (
            <button
              key={event.id}
              className={`trace-chip trace-chip-${traceChipTone(event)} ${
                selected ? "trace-chip-active" : ""
              }`}
              title={`${summary}${event.createdAt ? ` • ${formatTime(event.createdAt)}` : ""}`}
              type="button"
              onClick={() => onToggleTraceEvent(event.id)}
              aria-label={summary}
            >
              <span>{traceChipCode(event)}</span>
            </button>
          );
        })}
      </div>
      {selectedEvent ? (
        <div className="trace-detail-card">
          <div className="trace-detail-meta">
            <strong>{traceTitle(selectedEvent)}</strong>
            <span>{formatTime(selectedEvent.createdAt)}</span>
          </div>
          {traceDetail(selectedEvent) ? (
            <pre>{traceDetail(selectedEvent)}</pre>
          ) : (
            <p>No additional details.</p>
          )}
        </div>
      ) : null}
    </article>
  );
}
