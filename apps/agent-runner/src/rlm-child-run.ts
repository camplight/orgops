import { runRlmEvent } from "./rlm";
import type { ExecuteContext } from "./tools";
import type { Agent, Event } from "./types";
import type { EventTypeSummary } from "@orgops/schemas";

type RunEventPayload = {
  agent: Agent;
  event: Event;
  channelId: string;
  systemPrompt: string;
  baseMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  injectionEnv: Record<string, string>;
  extraAllowedRoots: string[];
  eventTypes: EventTypeSummary[];
  apiUrl: string;
  runnerToken: string;
};

type ParentMessage =
  | { type: "runEvent"; id: string; payload: RunEventPayload }
  | { type: "ping"; id: string };

function createApiFetch(apiUrl: string, runnerToken: string) {
  return async (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (runnerToken) headers.set("x-orgops-runner-token", runnerToken);
    const res = await fetch(`${apiUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${path} failed: ${res.status} ${text}`);
    }
    return res;
  };
}

process.on("message", async (message: ParentMessage) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "ping") {
    process.send?.({ type: "pong", id: message.id });
    return;
  }
  if (message.type !== "runEvent") return;

  const { id, payload } = message;
  try {
    const {
      agent,
      event,
      channelId,
      systemPrompt,
      baseMessages,
      injectionEnv,
      extraAllowedRoots,
      eventTypes,
      apiUrl,
      runnerToken,
    } =
      payload;
    const apiFetch = createApiFetch(apiUrl, runnerToken);
    const emitEvent = async (eventDraft: unknown) => {
      await apiFetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(eventDraft),
      });
    };
    const emitAudit = async (type: string, payloadValue: unknown, source = `agent:${agent.name}`) => {
      const maybeRecord =
        payloadValue && typeof payloadValue === "object"
          ? (payloadValue as { channelId?: unknown })
          : undefined;
      const payloadChannelId =
        typeof maybeRecord?.channelId === "string" && maybeRecord.channelId
          ? maybeRecord.channelId
          : undefined;
      await emitEvent({
        type,
        payload: payloadValue,
        source,
        ...(payloadChannelId ? { channelId: payloadChannelId } : {}),
      });
    };
    const executeCtx: ExecuteContext = {
      agent,
      triggerEvent: event,
      channelId,
      extraAllowedRoots,
      injectionEnv,
      apiFetch,
      emitEvent,
      emitAudit,
      listEventTypes: (input) => {
        const source = input?.source?.trim();
        const typePrefix = input?.typePrefix?.trim();
        return eventTypes.filter((eventType) => {
          if (source && eventType.source !== source) return false;
          if (typePrefix && !eventType.type.startsWith(typePrefix)) return false;
          return true;
        });
      },
    };

    await runRlmEvent({
      agent,
      event,
      channelId,
      systemPrompt,
      baseMessages,
      executeCtx,
      apiFetch,
      emitEvent,
    });
    process.send?.({ type: "runEventResult", id, ok: true });
  } catch (error) {
    process.send?.({
      type: "runEventResult",
      id,
      ok: false,
      error: String(error),
    });
  }
});

process.on("uncaughtException", (error) => {
  console.error("rlm child uncaught exception", error);
});

process.on("unhandledRejection", (error) => {
  console.error("rlm child unhandled rejection", error);
});

