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

export function createWrapExecute(deps: RunnerToolDeps): CreateExecuteFn {
  const { agent, event, channelId, runTool, apiFetch, emitEvent } = deps;
  return (toolName: string) => async (args: Record<string, unknown>) => {
    let phase:
      | "emit_started"
      | "run_tool"
      | "mark_trigger_failed_on_tool_error"
      | "emit_executed"
      | "emit_failed_audit"
      | "mark_trigger_failed_in_catch" = "emit_started";
    try {
      await emitEvent({
        type: "tool.started",
        payload: { tool: toolName, args },
        source: `agent:${agent.name}`,
        ...(channelId ? { channelId } : {}),
      });
      phase = "run_tool";
      const output = await runTool(toolName, args);
      if (output && typeof output === "object" && "error" in output) {
        phase = "mark_trigger_failed_on_tool_error";
        await apiFetch(`/api/events/${event.id}/fail`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            error: String((output as { error: unknown }).error),
          }),
        });
      }
      phase = "emit_executed";
      await emitEvent({
        type: "tool.executed",
        payload: { tool: toolName, args, output },
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
      phase = "mark_trigger_failed_in_catch";
      try {
        await apiFetch(`/api/events/${event.id}/fail`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: String(error) }),
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
