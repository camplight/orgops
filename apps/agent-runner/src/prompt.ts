import type { EventTypeSummary } from "@orgops/schemas";

export const NOOP_TOOL_NAME = "noop";

export type RunnerHostInfo = {
  platform: string;
  release: string;
  arch: string;
  hostname: string;
  shell: string;
  nodeVersion: string;
};

function formatCoreEventTypesSection(coreEventTypes: EventTypeSummary[]) {
  if (coreEventTypes.length === 0) {
    return "- Core event types: none registered.";
  }
  const lines = coreEventTypes.map(
    (eventType) =>
      `  - ${eventType.type}${eventType.description ? `: ${eventType.description}` : ""}`,
  );
  return [
    "- Core event types available by default (compact list):",
    ...lines,
    "- To inspect full schemas for core/skill types, call `events_event_types`.",
    "- Use `events_event_types` with source/typePrefix filters for discovery and includeSchema/includeExamples when you need full shape details.",
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
  skillRootPaths: string[],
  coreEventTypes: EventTypeSummary[],
  hostInfo: RunnerHostInfo,
  options: { replyContract?: "json" | "plain-text"; agentName?: string } = {},
) {
  const skillRootsText =
    skillRootPaths.length > 0 ? skillRootPaths.join(", ") : "(none configured)";
  const replyContractLines =
    options.replyContract === "plain-text"
      ? [
          "- Reply contract: your final answer is plain text. The runner posts it to the current channel as your `message.created` reply. Write only what you want to say; no JSON.",
          `- When you should not reply, call the \`${NOOP_TOOL_NAME}\` tool instead of writing text: the message is not for you, someone already answered it, or it only acknowledges or greets. Never reply to another agent just to acknowledge it.`,
          "- Never call `events_emit` to post your reply in the current channel. Use `events_emit` only for other side effects: other channels, scheduled events, or non-message event types.",
          "- Use event types that validate against available schemas (core + enabled skills) when you call `events_emit`.",
          "- Do not guess payload shapes.",
        ]
      : [
          "- Your final response MUST be JSON for one event object the runner can dispatch.",
          "- Expected shape: { type, payload, source?, channelId?, parentEventId?, deliverAt?, idempotencyKey? }.",
          "- Use event types that validate against available schemas (core + enabled skills).",
          "- Do not guess payload shapes.",
          "- Use `events_event_types` only when needed: unknown/non-core event types, skill-defined event shapes, or after a validation failure.",
          "- For routine core events (for example `message.created`), avoid repetitive preflight `events_event_types` calls.",
          "- Return your final event only as JSON output; do not call `events_emit` for the same final event.",
          "- Use `events_emit` only for intentional extra side effects (for example intermediate updates, other agents, etc) that are different from your final returned event.",
          "- Do not include markdown or prose outside of JSON.",
        ];
  return [
    ...(options.agentName
      ? [
          `- You are the agent \`${options.agentName}\`. Your own messages have source \`agent:${options.agentName}\`; every other source is a different participant.`,
        ]
      : []),
    "- You are running inside OrgOps' agent-runner and receive events per channels.",
    "- The runner executes your tool calls on the agent-runner's host machine.",
    "- The runner does not orchestrate your collaboration.",
    "- The runner maps relative paths as your own workspace-relative.",
    "- Message attachments are saved into your workspace; open them via `payload.attachments[].localPath` with your filesystem or shell tools. Images are also shown to you inline.",
    `- Skills root folder paths for resolving skill-relative references: ${skillRootsText}`,
    "- When creating/updating skills, `SKILL.md` must start with YAML frontmatter at the very first line (`---` as the first bytes in the file).",
    "- `SKILL.md` frontmatter requires `name` and `description`.",
    "- Skill `name` must exactly match the skill directory basename.",
    ...replyContractLines,
    "- When a message must share a secret or one-time token, keep `message.created.payload.text` as a safe preview and put the secret in `message.created.payload.sensitive.plaintext` so the API encrypts it before persistence.",
    `- Current UTC time is ${nowIso} (${nowMs} unix ms).`,
    formatRunnerHostInfoSection(hostInfo),
    formatCoreEventTypesSection(coreEventTypes),
  ].join("\n");
}
