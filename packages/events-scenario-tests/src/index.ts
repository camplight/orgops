import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Primitive = string | number | boolean | null;

type EventMatcher = {
  alias?: string;
  type?: string;
  source?: string;
  channelId?: string | null;
  parentEventId?: string | null;
  status?: string;
  payloadEquals?: Record<string, Primitive>;
  payloadContains?: Record<string, string>;
  payloadRegex?: Record<string, string>;
};

type FileCheck = {
  path: string;
  mustContain?: string[];
  mustMatchRegex?: string[];
};

type ScenarioDefinition = {
  id: string;
  description?: string;
  setup?: {
    clearEvents?: boolean;
    cleanupWorkspaces?: string[];
    ensureDirectChannels?: Array<{
      alias: string;
      participants: Array<{ subscriberType: string; subscriberId: string }>;
      description?: string;
    }>;
  };
  polling?: {
    timeoutMs?: number;
    intervalMs?: number;
  };
  trigger: Record<string, unknown>;
  assertions?: {
    mustExistSequence?: EventMatcher[];
    mustExist?: EventMatcher[];
    atLeastOne?: EventMatcher[];
    mustNotExist?: EventMatcher[];
    fileChecks?: FileCheck[];
  };
};

type OrgEvent = {
  id: string;
  type: string;
  source: string;
  channelId?: string;
  parentEventId?: string;
  status?: string;
  payload?: Record<string, unknown>;
  createdAt?: number;
};

const API_URL = process.env.ORGOPS_API_URL ?? "http://localhost:8787";
const RUNNER_TOKEN = process.env.ORGOPS_RUNNER_TOKEN ?? "dev-runner-token";
const PACKAGE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCENARIOS_DIR = resolve(PACKAGE_ROOT, "scenarios");
const PROJECT_ROOT = resolve(PACKAGE_ROOT, "..", "..");

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function getArgValue(flag: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function getByPath(input: unknown, path: string): unknown {
  if (!path) return input;
  const parts = path.split(".");
  let current: unknown = input;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function toStringValue(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof input === "number" || typeof input === "boolean") return String(input);
  if (input === null || input === undefined) return "";
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return String(value);
}

function resolveReference(
  value: string,
  ctx: {
    trigger: OrgEvent;
    aliases: Map<string, OrgEvent>;
    setupChannels?: Map<string, { id: string; name: string }>;
  },
): unknown {
  if (!value.startsWith("$")) return value;
  if (value === "$trigger.id") return ctx.trigger.id;
  const envMatch = value.match(/^\$env:([A-Z0-9_]+)$/);
  if (envMatch) {
    return process.env[envMatch[1]] ?? "";
  }

  const aliasMatch = value.match(/^\$alias:([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_.-]+)$/);
  if (aliasMatch) {
    const aliasEvent = ctx.aliases.get(aliasMatch[1]);
    return getByPath(aliasEvent, aliasMatch[2]);
  }

  const eventMatch = value.match(/^\$event:([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_.-]+)$/);
  if (eventMatch) {
    const aliasEvent = ctx.aliases.get(eventMatch[1]);
    return getByPath(aliasEvent, eventMatch[2]);
  }

  const setupMatch = value.match(/^\$setup:([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_.-]+)$/);
  if (setupMatch) {
    const channel = ctx.setupChannels?.get(setupMatch[1]);
    return getByPath(channel, setupMatch[2]);
  }

  return value;
}

function resolveTemplate(value: unknown, ctx: Parameters<typeof resolveReference>[1]): unknown {
  if (typeof value === "string") {
    return resolveReference(value, ctx);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplate(item, ctx));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        resolveTemplate(nested, ctx),
      ]),
    );
  }
  return value;
}

function topLevelFieldMatches(
  event: OrgEvent,
  matcher: EventMatcher,
  field:
    | "type"
    | "source"
    | "channelId"
    | "parentEventId"
    | "status",
  expected: unknown,
) {
  if (expected === undefined) return true;
  const actual = (event as Record<string, unknown>)[field];
  if (expected === null) return actual === null || actual === undefined;
  return String(actual ?? "") === String(expected);
}

function eventMatches(
  event: OrgEvent,
  matcher: EventMatcher,
  ctx: { trigger: OrgEvent; aliases: Map<string, OrgEvent> },
): boolean {
  const topLevelChecks: Array<[keyof EventMatcher, unknown]> = [
    ["type", matcher.type],
    ["source", matcher.source],
    ["channelId", matcher.channelId],
    ["parentEventId", matcher.parentEventId],
    ["status", matcher.status],
  ];
  for (const [field, rawExpected] of topLevelChecks) {
    if (rawExpected === undefined) continue;
    const expected =
      typeof rawExpected === "string" ? resolveReference(rawExpected, ctx) : rawExpected;
    const ok = topLevelFieldMatches(event, matcher, field as any, expected);
    if (!ok) return false;
  }

  for (const [path, rawExpected] of Object.entries(matcher.payloadEquals ?? {})) {
    const expected =
      typeof rawExpected === "string" ? resolveReference(rawExpected, ctx) : rawExpected;
    const actual = getByPath(event.payload, path);
    const expectedStr = asNullableString(expected);
    if (expectedStr === null) {
      if (actual !== null && actual !== undefined) return false;
      continue;
    }
    if (String(actual ?? "") !== String(expectedStr ?? "")) return false;
  }

  for (const [path, rawNeedle] of Object.entries(matcher.payloadContains ?? {})) {
    const needle = String(resolveReference(rawNeedle, ctx) ?? "");
    const haystack = toStringValue(getByPath(event.payload, path));
    if (!haystack.includes(needle)) return false;
  }

  for (const [path, rawPattern] of Object.entries(matcher.payloadRegex ?? {})) {
    const pattern = String(resolveReference(rawPattern, ctx) ?? "");
    const value = toStringValue(getByPath(event.payload, path));
    const regex = new RegExp(pattern);
    if (!regex.test(value)) return false;
  }

  return true;
}

function describeMatcher(matcher: EventMatcher) {
  return JSON.stringify(matcher);
}

async function apiFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("x-orgops-runner-token", RUNNER_TOKEN);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${response.status} ${text}`);
  }
  return response;
}

function canonicalDirectChannelName(
  participants: Array<{ subscriberType: string; subscriberId: string }>,
) {
  const normalized = participants
    .map((participant) => ({
      subscriberType: String(participant.subscriberType ?? "").trim().toUpperCase(),
      subscriberId: String(participant.subscriberId ?? "").trim(),
    }))
    .filter((participant) => participant.subscriberType && participant.subscriberId)
    .sort((left, right) =>
      `${left.subscriberType}:${left.subscriberId}`.localeCompare(
        `${right.subscriberType}:${right.subscriberId}`,
      ),
    );
  return `direct:${normalized
    .map((participant) => `${participant.subscriberType}:${participant.subscriberId}`)
    .join("|")}`;
}

async function listScenarios() {
  const entries = await readdir(SCENARIOS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.replace(/\.json$/, ""))
    .sort();
}

async function loadScenario(input?: string): Promise<{ scenario: ScenarioDefinition; path: string }> {
  const provided = input?.trim();
  if (!provided) {
    const available = await listScenarios();
    throw new Error(
      `Missing --scenario. Available scenarios: ${available.length ? available.join(", ") : "(none)"}`,
    );
  }
  let scenarioPath = provided;
  if (!provided.endsWith(".json")) {
    scenarioPath = `${provided}.json`;
  }
  if (!isAbsolute(scenarioPath)) {
    const fromScenariosDir = join(SCENARIOS_DIR, scenarioPath);
    scenarioPath = resolve(fromScenariosDir);
  }
  const raw = await readFile(scenarioPath, "utf-8");
  const scenario = JSON.parse(raw) as ScenarioDefinition;
  if (!scenario.id) {
    scenario.id = scenarioPath.split("/").pop()?.replace(/\.json$/, "") ?? "unnamed";
  }
  return { scenario, path: scenarioPath };
}

async function fetchEvents(after: number) {
  const response = await apiFetch(`/api/events?all=1&order=asc&after=${after}`);
  return (await response.json()) as OrgEvent[];
}

function eventSummary(event: OrgEvent) {
  const text = toStringValue(event.payload?.text).replace(/\s+/g, " ").trim().slice(0, 90);
  return `${event.createdAt ?? 0} ${event.type} ${event.source} -> ${event.channelId ?? "-"} ${text ? `| ${text}` : ""}`;
}

function evaluateAssertions(
  events: OrgEvent[],
  scenario: ScenarioDefinition,
  triggerEvent: OrgEvent,
  setupChannels: Map<string, { id: string; name: string }>,
) {
  const assertions = scenario.assertions ?? {};
  const aliases = new Map<string, OrgEvent>();
  const missing: string[] = [];
  const violations: string[] = [];
  const matched: string[] = [];
  const workingContext = { trigger: triggerEvent, aliases, setupChannels };

  let sequenceCursor = 0;
  for (const matcher of assertions.mustExistSequence ?? []) {
    const candidateIndex = events.findIndex(
      (event, index) =>
        index >= sequenceCursor && eventMatches(event, matcher, workingContext),
    );
    const candidate = candidateIndex >= 0 ? events[candidateIndex] : undefined;
    if (!candidate) {
      missing.push(`mustExistSequence ${describeMatcher(matcher)}`);
      continue;
    }
    sequenceCursor = candidateIndex + 1;
    if (matcher.alias) aliases.set(matcher.alias, candidate);
    matched.push(`mustExistSequence ${matcher.alias ?? matcher.type ?? "event"} => ${candidate.id}`);
  }

  for (const matcher of assertions.mustExist ?? []) {
    const candidate = events.find((event) => eventMatches(event, matcher, workingContext));
    if (!candidate) {
      missing.push(`mustExist ${describeMatcher(matcher)}`);
      continue;
    }
    if (matcher.alias) aliases.set(matcher.alias, candidate);
    matched.push(`mustExist ${matcher.alias ?? matcher.type ?? "event"} => ${candidate.id}`);
  }

  if ((assertions.atLeastOne?.length ?? 0) > 0) {
    const found = (assertions.atLeastOne ?? []).find((matcher) =>
      events.some((event) => eventMatches(event, matcher, workingContext)),
    );
    if (!found) {
      missing.push(
        `atLeastOne ${JSON.stringify(assertions.atLeastOne)}`,
      );
    } else {
      matched.push(`atLeastOne matched => ${JSON.stringify(found)}`);
    }
  }

  for (const matcher of assertions.mustNotExist ?? []) {
    const offender = events.find((event) => eventMatches(event, matcher, workingContext));
    if (offender) {
      violations.push(
        `mustNotExist matched ${describeMatcher(matcher)} with event ${offender.id} (${eventSummary(offender)})`,
      );
    }
  }

  const ok = missing.length === 0 && violations.length === 0;
  return { ok, missing, violations, matched, aliases };
}

async function evaluateFileChecks(
  checks: FileCheck[] | undefined,
  ctx: {
    trigger: OrgEvent;
    aliases: Map<string, OrgEvent>;
    setupChannels: Map<string, { id: string; name: string }>;
  },
) {
  const missing: string[] = [];
  const violations: string[] = [];
  const matched: string[] = [];
  for (const check of checks ?? []) {
    const resolvedPathValue = resolveTemplate(check.path, ctx);
    const resolvedPath = String(resolvedPathValue ?? "");
    const filePath = isAbsolute(resolvedPath)
      ? resolvedPath
      : resolve(PROJECT_ROOT, resolvedPath);
    let content = "";
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      missing.push(`fileChecks missing file ${filePath}`);
      continue;
    }
    for (const item of check.mustContain ?? []) {
      const needle = String(resolveTemplate(item, ctx) ?? "");
      if (!content.includes(needle)) {
        violations.push(`fileChecks ${filePath} missing required text: ${needle}`);
      } else {
        matched.push(`fileChecks contains ${needle} in ${filePath}`);
      }
    }
    for (const patternRaw of check.mustMatchRegex ?? []) {
      const pattern = String(resolveTemplate(patternRaw, ctx) ?? "");
      const regex = new RegExp(pattern);
      if (!regex.test(content)) {
        violations.push(`fileChecks ${filePath} failed regex: ${pattern}`);
      } else {
        matched.push(`fileChecks regex matched ${pattern} in ${filePath}`);
      }
    }
  }
  const ok = missing.length === 0 && violations.length === 0;
  return { ok, missing, violations, matched };
}

async function run() {
  const scenarioArg = getArgValue("--scenario");
  const { scenario, path } = await loadScenario(scenarioArg);
  const timeoutMs = Math.max(1000, scenario.polling?.timeoutMs ?? 60000);
  const intervalMs = Math.max(500, scenario.polling?.intervalMs ?? 1500);

  console.log(`Scenario: ${scenario.id}`);
  if (scenario.description) {
    console.log(`Description: ${scenario.description}`);
  }
  console.log(`Definition: ${path}`);
  console.log(`API URL: ${API_URL}`);
  console.log("");

  try {
    await apiFetch("/api/agents");
  } catch (error) {
    throw new Error(
      `API is unreachable or unauthorized. Ensure dev services are running and ORGOPS_RUNNER_TOKEN matches. ${String(error)}`,
    );
  }

  if (scenario.setup?.clearEvents) {
    await apiFetch("/api/events", { method: "DELETE" });
    console.log("Setup: cleared events");
  }
  for (const agentName of scenario.setup?.cleanupWorkspaces ?? []) {
    await apiFetch(`/api/agents/${encodeURIComponent(agentName)}/cleanup-workspace`, {
      method: "POST",
    });
    console.log(`Setup: cleaned workspace for ${agentName}`);
  }

  const startAfter = Date.now() - 1;
  const setupChannels = new Map<string, { id: string; name: string }>();
  for (const channelSetup of scenario.setup?.ensureDirectChannels ?? []) {
    try {
      const createRes = await apiFetch("/api/channels/direct", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participants: channelSetup.participants,
          description: channelSetup.description,
        }),
      });
      const created = (await createRes.json()) as { id: string; name: string };
      setupChannels.set(channelSetup.alias, { id: created.id, name: created.name });
      console.log(`Setup: ensured direct channel ${channelSetup.alias} => ${created.id}`);
    } catch {
      const channelName = canonicalDirectChannelName(channelSetup.participants);
      const channelsRes = await apiFetch("/api/channels");
      const channels = (await channelsRes.json()) as Array<{ id: string; name: string }>;
      let channel = channels.find((candidate) => candidate.name === channelName);
      if (!channel) {
        const createChannelRes = await apiFetch("/api/channels", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: channelName,
            description: channelSetup.description ?? "Scenario direct channel",
          }),
        });
        const created = (await createChannelRes.json()) as { id: string };
        channel = { id: created.id, name: channelName };
      }
      for (const participant of channelSetup.participants) {
        await apiFetch(`/api/channels/${encodeURIComponent(channel.id)}/subscribe`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            subscriberType: participant.subscriberType,
            subscriberId: participant.subscriberId,
          }),
        });
      }
      setupChannels.set(channelSetup.alias, channel);
      console.log(`Setup: ensured fallback channel ${channelSetup.alias} => ${channel.id}`);
    }
  }
  const triggerContext = {
    trigger: { id: "__pending__", type: "trigger", source: "scenario" } as OrgEvent,
    aliases: new Map<string, OrgEvent>(),
    setupChannels,
  };
  const triggerPayload = resolveTemplate(scenario.trigger, triggerContext);
  const triggerResponse = await apiFetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(triggerPayload),
  });
  const triggerEvent = (await triggerResponse.json()) as OrgEvent;
  console.log(`Trigger event created: ${triggerEvent.id}`);

  const deadline = Date.now() + timeoutMs;
  let lastEvaluation = evaluateAssertions([], scenario, triggerEvent, setupChannels);
  let lastFileEvaluation = await evaluateFileChecks(
    scenario.assertions?.fileChecks,
    {
      trigger: triggerEvent,
      aliases: lastEvaluation.aliases,
      setupChannels
    },
  );
  let latestEvents: OrgEvent[] = [];
  while (Date.now() < deadline) {
    latestEvents = await fetchEvents(startAfter);
    lastEvaluation = evaluateAssertions(latestEvents, scenario, triggerEvent, setupChannels);
    lastFileEvaluation = await evaluateFileChecks(
      scenario.assertions?.fileChecks,
      {
        trigger: triggerEvent,
        aliases: lastEvaluation.aliases,
        setupChannels
      },
    );
    if (lastEvaluation.ok && lastFileEvaluation.ok) break;
    await sleep(intervalMs);
  }

  const finalEvents = latestEvents;
  const passed = lastEvaluation.ok && lastFileEvaluation.ok;

  console.log("");
  console.log(`Result: ${passed ? "PASS" : "FAIL"}`);
  if (lastEvaluation.matched.length > 0) {
    console.log("Matched:");
    for (const line of lastEvaluation.matched) {
      console.log(`- ${line}`);
    }
  }
  if (lastEvaluation.missing.length > 0) {
    console.log("Missing assertions:");
    for (const line of lastEvaluation.missing) {
      console.log(`- ${line}`);
    }
  }
  if (lastEvaluation.violations.length > 0) {
    console.log("Violations:");
    for (const line of lastEvaluation.violations) {
      console.log(`- ${line}`);
    }
  }
  if (lastFileEvaluation.matched.length > 0) {
    console.log("File checks matched:");
    for (const line of lastFileEvaluation.matched) {
      console.log(`- ${line}`);
    }
  }
  if (lastFileEvaluation.missing.length > 0) {
    console.log("Missing file checks:");
    for (const line of lastFileEvaluation.missing) {
      console.log(`- ${line}`);
    }
  }
  if (lastFileEvaluation.violations.length > 0) {
    console.log("File check violations:");
    for (const line of lastFileEvaluation.violations) {
      console.log(`- ${line}`);
    }
  }

  console.log("");
  console.log(`Observed events: ${finalEvents.length}`);
  for (const event of finalEvents.slice(-12)) {
    console.log(`- ${eventSummary(event)}`);
  }

  if (!passed) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
