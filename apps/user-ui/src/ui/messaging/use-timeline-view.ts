import { useMemo } from "react";
import type { EventRow } from "../../types";
import { isHiddenUiActionMessage } from "../../domain/messaging/event-interpretation";
import { isTraceEvent } from "../../domain/messaging/trace-rules";

export function useTimelineView({ events }: { events: EventRow[] }) {
  const visibleTimelineEvents = useMemo(
    () =>
      events.filter(
        (event) => (event.type === "message.created" && !isHiddenUiActionMessage(event)) || isTraceEvent(event)
      ),
    [events]
  );

  const timelineItems = useMemo(() => {
    const items: Array<
      | { kind: "message"; id: string; event: EventRow }
      | { kind: "trace-group"; id: string; traceEvents: EventRow[]; tone: "agent" | "system" }
    > = [];
    let traceBuffer: EventRow[] = [];
    let groupCounter = 0;

    const flushTraceBuffer = () => {
      if (traceBuffer.length === 0) return;
      const tone: "agent" | "system" = traceBuffer.some(
        (entry) => entry.type === "tool.failed" || entry.type === "wrapper.turn.failed"
      )
        ? "system"
        : "agent";
      items.push({
        kind: "trace-group",
        id: `trace-group-${traceBuffer[0]?.id ?? groupCounter}`,
        traceEvents: traceBuffer,
        tone
      });
      traceBuffer = [];
      groupCounter += 1;
    };

    for (const event of visibleTimelineEvents) {
      if (event.type === "message.created" || event.type === "agent.turn.failed") {
        flushTraceBuffer();
        items.push({ kind: "message", id: event.id, event });
      } else {
        traceBuffer.push(event);
      }
    }
    flushTraceBuffer();
    return items;
  }, [visibleTimelineEvents]);

  const agentIsThinking = useMemo(() => {
    let activeTurns = 0;
    for (const event of events) {
      if (event.type === "agent.turn.started") activeTurns += 1;
      if (event.type === "agent.turn.completed" || event.type === "agent.turn.failed") {
        activeTurns = Math.max(0, activeTurns - 1);
      }
    }
    return activeTurns > 0;
  }, [events]);

  return { timelineItems, agentIsThinking };
}
