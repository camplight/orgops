import type { EventTypeSummary } from "@orgops/schemas";

export type RunnerHostInfo = {
  platform: string;
  release: string;
  arch: string;
  hostname: string;
  shell: string;
  nodeVersion: string;
};

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

function formatRunnerHostInfoSection(hostInfo: RunnerHostInfo) {
  return [
    "- Runner host info (authoritative; do not guess):",
    `  - platform: ${hostInfo.platform}`,
    `  - release: ${hostInfo.release}`,
    `  - arch: ${hostInfo.arch}`,
    `  - hostname: ${hostInfo.hostname}`,
    `  - shell: ${hostInfo.shell}`,
    `  - nodeVersion: ${hostInfo.nodeVersion}`,
  ].join("\n");
}

export function buildRunnerGuidance(
  nowMs: number,
  nowIso: string,
  skillRootPath: string,
  coreEventTypes: EventTypeSummary[],
  hostInfo: RunnerHostInfo,
) {
  return [
    "- You are running inside OrgOps agent-runner and receive events per channels.",
    "- The runner executes your tool calls and records audit events for observability.",
    "- The runner does not orchestrate your collaboration.",
    "- The runner maps relative paths as your own workspace-relative.",
    `- Skills root folder path for resolving skill-relative references: ${skillRootPath}`,
    "- Your final response MUST be JSON for one event object the runner can dispatch.",
    "- Expected shape: { type, payload, source?, channelId?, parentEventId?, deliverAt?, idempotencyKey? }.",
    "- Use event types that validate against available schemas (core + enabled skills).",
    "- Do not include markdown or prose outside of JSON.",
    `- Current UTC time is ${nowIso} (${nowMs} unix ms).`,
    formatRunnerHostInfoSection(hostInfo),
    formatCoreEventTypesSection(coreEventTypes),
  ].join("\n");
}
