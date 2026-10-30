import type { LlmTool } from "@orgops/llm";
import type { Agent, Event } from "../types";
import type { EventTypeSummary } from "@orgops/schemas";
import type { z } from "zod";

export type RunnerToolDeps = {
  agent: Agent;
  event: Event;
  channelId?: string;
  runTool: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  emitEvent: (event: unknown) => Promise<void>;
};

/** Context passed to each tool's execute function. */
export type ExecuteContext = {
  agent: Agent;
  triggerEvent: Event;
  channelId?: string;
  extraAllowedRoots?: string[];
  injectionEnv: Record<string, string>;
  listEventTypes?: (input?: {
    source?: string;
    typePrefix?: string;
  }) => EventTypeSummary[];
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  emitEvent: (event: unknown) => Promise<void>;
  emitAudit: (type: string, payload: unknown, source?: string) => Promise<void>;
  // CLASSIC turns can stage unscheduled chat output until final response validation succeeds.
  deferMessage?: (event: {
    type: string;
    payload: unknown;
    source: string;
    channelId?: string;
    parentEventId?: string;
    deliverAt?: number;
    idempotencyKey?: string;
  }) => void;
  validateEvent?: (event: {
    type: string;
    payload: unknown;
    source: string;
    channelId?: string;
    parentEventId?: string;
    deliverAt?: number;
    idempotencyKey?: string;
  }) =>
    | { ok: true; matchedDefinitions: number }
    | { ok: false; type: string; matchedDefinitions: number; issues: Array<{ source: string; message: string }> };
};

export type ToolDef = [string, string, z.ZodTypeAny];

export type CreateExecuteFn = (
  toolName: string,
) => (args: Record<string, unknown>) => Promise<unknown>;

const REDACTED_ONE_TIME_SECRET = "[REDACTED: one-time secret]";
const ORGOPS_INTEGRATION_TOKEN_RE = /org_sk_[A-Za-z0-9]{20,}/g;
export const MAX_PERSISTED_TOOL_OUTPUT_CHARS = 16_000;

function redactIntegrationTokenStrings(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(ORGOPS_INTEGRATION_TOKEN_RE, REDACTED_ONE_TIME_SECRET);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactIntegrationTokenStrings(item));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "token" ? REDACTED_ONE_TIME_SECRET : redactIntegrationTokenStrings(entry),
    ]),
  );
}

function truncatePersistedToolOutput(output: unknown): { output: unknown; truncated: boolean } {
  let serialized: string;
  try {
    serialized = JSON.stringify(output) ?? String(output);
  } catch {
    serialized = String(output);
  }
  if (serialized.length <= MAX_PERSISTED_TOOL_OUTPUT_CHARS) {
    return { output, truncated: false };
  }
  const omitted = serialized.length - MAX_PERSISTED_TOOL_OUTPUT_CHARS;
  return {
    output: {
      truncated: true,
      omittedChars: omitted,
      preview: serialized.slice(0, MAX_PERSISTED_TOOL_OUTPUT_CHARS),
    },
    truncated: true,
  };
}

export function redactPersistedToolOutput(toolName: string, output: unknown) {
  const redactedOutput =
    toolName === "agents_create_integration_key"
      ? redactIntegrationTokenStrings(output)
      : output;
  const tokenRedacted = toolName === "agents_create_integration_key";
  const sizeLimited = truncatePersistedToolOutput(redactedOutput);
  return {
    output: sizeLimited.output,
    redacted: tokenRedacted || sizeLimited.truncated,
  };
}

export function createWrapExecute(deps: RunnerToolDeps): CreateExecuteFn {
  const { agent, channelId, runTool, emitEvent } = deps;
  return (toolName: string) => async (args: Record<string, unknown>) => {
    let phase: "emit_started" | "run_tool" | "emit_executed" | "emit_failed_audit" =
      "emit_started";
    try {
      await emitEvent({
        type: "tool.started",
        payload: { tool: toolName, args },
        source: `agent:${agent.name}`,
        ...(channelId ? { channelId } : {}),
      });
      phase = "run_tool";
      const output = await runTool(toolName, args);
      // Tool errors are model feedback, not failures of the triggering human event.
      // The channel loop owns receipt failures when the entire turn throws.
      phase = "emit_executed";
      const persistedOutput = redactPersistedToolOutput(toolName, output);
      await emitEvent({
        type: "tool.executed",
        payload: {
          tool: toolName,
          args,
          output: persistedOutput.output,
          ...(persistedOutput.redacted ? { sensitiveOutputRedacted: true } : {}),
        },
        source: `agent:${agent.name}`,
        ...(channelId ? { channelId } : {}),
      });
      return output;
    } catch (error) {
      const failedPhase = phase;
      phase = "emit_failed_audit";
      try {
        await emitEvent({
          type: "tool.failed",
          payload: {
            tool: toolName,
            args,
            error: String(error),
            wrapperPhase: failedPhase,
          },
          source: `agent:${agent.name}`,
          ...(channelId ? { channelId } : {}),
        });
      } catch {}
      return { error: String(error) };
    }
  };
}

export function toolDefToLlmTool(
  [name, description, parameters]: ToolDef,
  wrapExecute: CreateExecuteFn,
): [string, LlmTool] {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid tool name: ${name}`);
  }
  return [name, { description, parameters, execute: wrapExecute(name) }];
}
