import type { LlmTool } from "@orgops/llm";
import type { Agent, Event } from "../types";
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
  injectionEnv: Record<string, string>;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  emitEvent: (event: unknown) => Promise<void>;
  emitAudit: (type: string, payload: unknown, source?: string) => Promise<void>;
};

export type ToolDef = [string, string, z.ZodTypeAny];

export type CreateExecuteFn = (
  toolName: string,
) => (args: Record<string, unknown>) => Promise<unknown>;

export function createWrapExecute(deps: RunnerToolDeps): CreateExecuteFn {
  const { agent, event, channelId, runTool, apiFetch, emitEvent } = deps;
  return (toolName: string) => async (args: Record<string, unknown>) => {
    try {
      const output = await runTool(toolName, args);
      if (output && typeof output === "object" && "error" in output) {
        await apiFetch(`/api/events/${event.id}/fail`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            error: String((output as { error: unknown }).error),
          }),
        });
      }
      await emitEvent({
        type: "audit.tool.executed",
        payload: { tool: toolName, args, output },
        source: `agent:${agent.name}`,
        ...(channelId ? { channelId } : {}),
      });
      return output;
    } catch (error) {
      await apiFetch(`/api/events/${event.id}/fail`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: String(error) }),
      });
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
