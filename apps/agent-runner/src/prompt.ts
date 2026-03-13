import type { EventTypeSummary } from "@orgops/schemas";

function stringifySchema(schema: unknown) {
  try {
    return JSON.stringify(schema);
  } catch {
    return '"<unserializable-schema>"';
  }
}

function formatCoreEventTypesSection(coreEventTypes: EventTypeSummary[]) {
  if (coreEventTypes.length === 0) {
    return "- Core event types: none registered.";
  }
  const lines = coreEventTypes.map((eventType) =>
    [
      `  - ${eventType.type}${eventType.description ? `: ${eventType.description}` : ""}`,
      `    schemaKind: ${eventType.schemaKind ?? "none"}`,
      `    schema: ${stringifySchema(eventType.schema)}`,
    ].join("\n"),
  );
  return [
    "- Core event types available by default (not exhaustive):",
    ...lines,
    "- You are not limited to core types; use `events_event_types` to discover additional skill or runtime-specific types.",
  ].join("\n");
}

export function buildRunnerGuidance(
  nowMs: number,
  nowIso: string,
  skillRootPath: string,
  coreEventTypes: EventTypeSummary[],
) {
  return [
    "Runner environment contract:",
    "- You are running inside OrgOps agent-runner and receive one triggering event at a time from a channel.",
    "- OrgOps is an event-driven runtime system running in a host OS directly from source located at the repo root",
    "- The runner executes your tool calls and records audit events for observability.",
    "- The runner does not orchestrate your collaboration; you must decide delegation, waiting, and completion behavior.",
    "- The runner maps relative paths as your own workspace-relative.",
    `- Skills root folder path for resolving skill-relative references: ${skillRootPath}`,
    "- The runner will do nothing with your response, use your tools wisely.",
    `- Current UTC time is ${nowIso} (${nowMs} unix ms).`,
    formatCoreEventTypesSection(coreEventTypes),
  ].join("\n");
}
