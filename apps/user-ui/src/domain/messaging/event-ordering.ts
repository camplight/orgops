import type { EventRow } from "../../types";

export function mergeEventsChronologically(current: EventRow[], incoming: EventRow[]) {
  const byId = new Map<string, EventRow>();
  for (const event of current) byId.set(event.id, event);
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((left, right) => {
    const leftPrimary = left.deliverAt ?? left.createdAt ?? 0;
    const rightPrimary = right.deliverAt ?? right.createdAt ?? 0;
    if (leftPrimary !== rightPrimary) return leftPrimary - rightPrimary;
    const leftCreated = left.createdAt ?? 0;
    const rightCreated = right.createdAt ?? 0;
    if (leftCreated !== rightCreated) return leftCreated - rightCreated;
    return left.id.localeCompare(right.id);
  });
}
