import type { Agent, Event } from "./types";
import {
  buildWrapperMessage,
  buildWrapperSessionId,
  normalizeWrappedConfig,
} from "./wrapper-harness/config";
import { emitWrapperEvent } from "./wrapper-harness/events";
import { getWrapperHarness } from "./wrapper-harness/registry";
import {
  parseWrappedRuntimeOutput,
  stopAllWrappedSidecars,
  stopWrappedAgentSidecars,
} from "./wrapper-harness/command";
import type { WrapperRuntimeContext } from "./wrapper-harness/types";

const setupCache = new Map<string, Promise<void>>();

export { parseWrappedRuntimeOutput };

function clearWrappedSetupCache(agentName: string) {
  for (const key of setupCache.keys()) {
    if (key.startsWith(`${agentName}:`)) setupCache.delete(key);
  }
}

export async function stopWrappedAgentRuntime(agentName: string) {
  clearWrappedSetupCache(agentName);
  return stopWrappedAgentSidecars(agentName);
}

export async function stopAllWrappedRuntimes() {
  setupCache.clear();
  return stopAllWrappedSidecars();
}

export async function ensureWrappedAgentReady(
  ctx: WrapperRuntimeContext,
  agent: Agent,
) {
  const config = normalizeWrappedConfig(agent);
  const harness = getWrapperHarness(config);
  const cacheKey = `${agent.name}:${JSON.stringify(agent.wrappedConfig ?? {})}`;
  const existing = setupCache.get(cacheKey);
  if (existing) return existing;
  const pending = (async () => {
    await emitWrapperEvent(ctx, agent, "wrapper.lifecycle.started", {
      kind: config.kind,
      harness: harness.name,
      text: `Wrapped runtime lifecycle started for ${agent.name}.`,
    });
    await harness.ensureReady({ ctx, agent, config });
  })();
  pending.catch(() => {
    setupCache.delete(cacheKey);
  });
  setupCache.set(cacheKey, pending);
  return pending;
}

export async function runWrappedAgentTurn(
  ctx: WrapperRuntimeContext,
  agent: Agent,
  events: Event[],
) {
  const triggerEvent = events[events.length - 1];
  const channelId = triggerEvent?.channelId;
  if (!triggerEvent || !channelId) return;
  const config = normalizeWrappedConfig(agent);
  const harness = getWrapperHarness(config);
  await ensureWrappedAgentReady(ctx, agent);
  const message = buildWrapperMessage(events);
  const sessionId = buildWrapperSessionId(agent, channelId, config.sessionScope);
  await emitWrapperEvent(ctx, agent, "wrapper.turn.started", {
    kind: config.kind,
    harness: harness.name,
    sessionId,
    triggerEventId: triggerEvent.id,
  }, channelId);
  let result;
  try {
    result = await harness.runTurn({
      ctx,
      agent,
      config,
      events,
      triggerEvent,
      channelId,
      message,
      sessionId,
    });
  } catch (error) {
    const detail = error as { exitCode?: unknown; stdout?: unknown; stderr?: unknown };
    await emitWrapperEvent(ctx, agent, "wrapper.turn.failed", {
      kind: config.kind,
      harness: harness.name,
      sessionId,
      exitCode: detail.exitCode,
      stderr: typeof detail.stderr === "string" ? detail.stderr.slice(-4000) : undefined,
      stdout: typeof detail.stdout === "string" ? detail.stdout.slice(-4000) : undefined,
      error: error instanceof Error ? error.message : String(error),
      triggerEventId: triggerEvent.id,
    }, channelId);
    throw error;
  }
  const text = result.text?.trim() ?? "";
  if (text) {
    await ctx.api.emitEvent({
      type: "message.created",
      source: `agent:${agent.name}`,
      channelId,
      parentEventId: triggerEvent.id,
      payload: { text },
    });
  }
  await emitWrapperEvent(ctx, agent, "wrapper.turn.completed", {
    kind: config.kind,
    harness: harness.name,
    sessionId,
    triggerEventId: triggerEvent.id,
    emittedMessage: Boolean(text),
  }, channelId);
}
