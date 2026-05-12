import { createHash } from "node:crypto";
import type { Agent, Event } from "../types";
import type { NormalizedWrappedConfig, WrapperSessionScope, WrapperSidecarConfig } from "./types";

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function readStringEnv(value: unknown): Record<string, string> {
  const record = asRecord(value);
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === "string") out[key] = raw;
  }
  return out;
}

function normalizeSessionScope(value: unknown): WrapperSessionScope {
  return readString(value) === "per-agent" ? "per-agent" : "per-channel";
}

export function normalizeWrappedConfig(agent: Agent): NormalizedWrappedConfig {
  const raw = asRecord(agent.wrappedConfig);
  const runtime = asRecord(raw.runtime);
  const source = asRecord(raw.source);
  const setup = asRecord(raw.setup);
  const session = asRecord(raw.session);
  const sidecars = Array.isArray(raw.sidecars)
    ? raw.sidecars
        .map((sidecar) => asRecord(sidecar) as WrapperSidecarConfig)
        .filter((sidecar) => Object.keys(sidecar).length > 0)
    : [];
  return {
    kind: readString(raw.kind) ?? "custom",
    harness: readString(raw.harness) ?? readString(raw.transport) ?? "command",
    source: Object.keys(source).length > 0 ? source : undefined,
    setup: Object.keys(setup).length > 0 ? setup : undefined,
    runtime: Object.keys(runtime).length > 0 ? runtime : undefined,
    sidecars,
    sessionScope: normalizeSessionScope(session.scope),
    raw,
  };
}

export function buildWrapperSessionId(
  agent: Agent,
  channelId: string,
  scope: WrapperSessionScope,
) {
  const base = scope === "per-agent" ? agent.name : `${agent.name}:${channelId}`;
  const digest = createHash("sha256").update(base).digest("hex").slice(0, 16);
  return `orgops-${agent.name.replace(/[^a-zA-Z0-9_.-]/g, "-")}-${digest}`;
}

function eventText(event: Event) {
  const payload = asRecord(event.payload);
  return readString(payload.text) ?? "";
}

export function buildWrapperMessage(events: Event[]) {
  if (events.length === 1) {
    const text = eventText(events[0]!);
    if (text) return text;
  }
  return JSON.stringify(
    {
      type: "orgops.pending.events",
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        source: event.source,
        channelId: event.channelId,
        payload: event.payload ?? {},
        createdAt: event.createdAt,
      })),
    },
    null,
    2,
  );
}
