import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Agent, Event } from "./types";
import {
  asRecord,
  buildWrapperMessage,
  buildWrapperSessionId,
  normalizeWrappedConfig,
  readString,
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
  const eventsWithAttachmentPaths = await hydrateAttachmentPaths(
    ctx,
    agent,
    channelId,
    events,
  );
  const message = buildWrapperMessage(eventsWithAttachmentPaths);
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
      events: eventsWithAttachmentPaths,
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

function extFromMime(mime: string | undefined): string {
  if (!mime) return "";
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "application/pdf") return ".pdf";
  return "";
}

function sanitizeAttachmentName(name: string | undefined, fileId: string): string {
  const fallback = `attachment-${fileId}`;
  const base = basename(name ?? fallback).replace(/[^a-zA-Z0-9._-]/g, "-");
  return base || fallback;
}

async function hydrateAttachmentPaths(
  ctx: WrapperRuntimeContext,
  agent: Agent,
  channelId: string,
  events: Event[],
): Promise<Event[]> {
  if (!ctx.api.apiFetch) return events;
  const out: Event[] = [];
  for (const event of events) {
    const payload = asRecord(event.payload);
    const attachmentsRaw = Array.isArray(payload.attachments)
      ? payload.attachments
      : null;
    if (!attachmentsRaw || attachmentsRaw.length === 0) {
      out.push(event);
      continue;
    }
    const hydratedAttachments: unknown[] = [];
    for (const entry of attachmentsRaw) {
      const record = asRecord(entry);
      const fileId = readString(record.fileId);
      const existingTempPath = readString(record.tempPath);
      if (!fileId || existingTempPath) {
        hydratedAttachments.push(entry);
        continue;
      }
      const name = readString(record.name);
      const mime = readString(record.mime);
      const extension = extname(name ?? "") || extFromMime(mime);
      const fileBaseName = sanitizeAttachmentName(name, fileId);
      const fileName =
        extension && !fileBaseName.endsWith(extension)
          ? `${fileBaseName}${extension}`
          : fileBaseName;
      const attachmentDir = join(
        agent.workspacePath,
        ".orgops-wrapped-attachments",
        channelId,
        event.id,
      );
      const localPath = join(attachmentDir, fileName);
      try {
        const response = await ctx.api.apiFetch(`/api/files/${encodeURIComponent(fileId)}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        mkdirSync(attachmentDir, { recursive: true });
        writeFileSync(localPath, bytes);
        hydratedAttachments.push({
          ...record,
          tempPath: localPath,
          downloadedByRunner: true,
        });
      } catch (error) {
        hydratedAttachments.push({
          ...record,
          attachmentError:
            error instanceof Error ? error.message : String(error),
        });
      }
    }
    out.push({
      ...event,
      payload: {
        ...payload,
        attachments: hydratedAttachments,
      },
    });
  }
  return out;
}
