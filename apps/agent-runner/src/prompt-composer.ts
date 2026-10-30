import type {
  LlmImagePart,
  LlmMessage,
  LlmMessageContent,
  LlmTextPart,
} from "@orgops/llm";
import { resolveReplyContract } from "@orgops/schemas";
import {
  isWorkspaceAttachment,
  readMessageAttachments,
  saveAttachmentToWorkspace,
} from "./attachments";
import { buildPromptEventRecord } from "./prompt-event-compact";
import type { Agent, Event } from "./types";

const DEFAULT_MAX_HISTORY_EVENTS = 120;
const DEFAULT_MAX_HISTORY_CHARS = 120_000;
const MAX_HISTORY_IMAGES_PER_EVENT = 3;
const HISTORY_WINDOW_SHARE = 0.5;
const CHARS_PER_TOKEN = 4;
const MIN_HISTORY_CHARS = 8_000;
const MAX_HISTORY_IMAGE_BYTES = 5 * 1024 * 1024;

function readPositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const HISTORY_MAX_EVENTS = readPositiveIntEnv(
  process.env.ORGOPS_HISTORY_MAX_EVENTS,
  DEFAULT_MAX_HISTORY_EVENTS,
);
const HISTORY_MAX_CHARS = readPositiveIntEnv(
  process.env.ORGOPS_HISTORY_MAX_CHARS,
  DEFAULT_MAX_HISTORY_CHARS,
);

type EventAttachment = {
  fileId: string;
  mime?: string;
};

type AttachmentImageData = {
  bytes: Uint8Array;
  mimeType?: string;
};

type ApiFetchFn = (path: string, init?: RequestInit) => Promise<Response>;

/** Chat messages from anyone else (humans or other agents) are conversation turns, not instructions. */
function isUserMessageEvent(agent: Agent, event: Event): boolean {
  if (event.type !== "message.created") return false;
  const source = String(event.source ?? "").toLowerCase();
  return !source.startsWith("system:") && source !== `agent:${agent.name}`.toLowerCase();
}

function isOwnMessageEvent(agent: Agent, event: Event): boolean {
  return event.type === "message.created" && event.source === `agent:${agent.name}`;
}

function ownMessageContent(agent: Agent, event: Event): string {
  const text = (event.payload as { text?: unknown } | undefined)?.text;
  if (resolveReplyContract(agent.modelId, agent.modelCapabilities) === "plain-text" && typeof text === "string") {
    return text;
  }
  return JSON.stringify(buildPromptEventRecord(event), null, 2);
}

function extractImageAttachments(event: Event): EventAttachment[] {
  const payload =
    event.payload && typeof event.payload === "object"
      ? (event.payload as { attachments?: unknown })
      : undefined;
  const attachments = payload?.attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const entry = item as { fileId?: unknown; mime?: unknown };
      if (typeof entry.fileId !== "string" || entry.fileId.trim().length === 0) {
        return null;
      }
      const mime = typeof entry.mime === "string" ? entry.mime.trim() : "";
      return {
        fileId: entry.fileId.trim(),
        ...(mime ? { mime } : {}),
      };
    })
    .filter((item): item is EventAttachment => Boolean(item))
    .filter((item) => (item.mime ?? "").toLowerCase().startsWith("image/"));
}

async function fetchAttachmentImageData(
  apiFetchFn: ApiFetchFn,
  fileId: string,
  mimeHint?: string,
): Promise<AttachmentImageData | null> {
  const response = await apiFetchFn(`/api/files/${encodeURIComponent(fileId)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_HISTORY_IMAGE_BYTES) {
    return null;
  }
  const headerMime = response.headers.get("content-type")?.split(";")[0]?.trim();
  const resolvedMime = (headerMime || mimeHint || "").toLowerCase();
  if (!resolvedMime.startsWith("image/")) return null;
  return {
    bytes,
    mimeType: resolvedMime,
  };
}

async function withWorkspaceAttachmentPaths(
  agent: Agent,
  event: Event,
  apiFetchFn: ApiFetchFn,
): Promise<Event> {
  const payload = event.payload as { attachments?: unknown } | undefined;
  if (!payload || !Array.isArray(payload.attachments)) return event;
  const attachments = readMessageAttachments(payload).filter(isWorkspaceAttachment);
  if (attachments.length === 0) return event;
  const localPaths = new Map<string, string>();
  await Promise.all(
    attachments.map(async (attachment) => {
      const saved = await saveAttachmentToWorkspace(apiFetchFn, agent, attachment).catch(() => null);
      if (saved) localPaths.set(attachment.fileId, saved.localPath);
    }),
  );
  if (localPaths.size === 0) return event;
  return {
    ...event,
    payload: {
      ...payload,
      attachments: payload.attachments.map((entry) => {
        const fileId = (entry as { fileId?: unknown } | null)?.fileId;
        const localPath = typeof fileId === "string" ? localPaths.get(fileId.trim()) : undefined;
        return localPath ? { ...(entry as object), localPath } : entry;
      }),
    },
  };
}

export function contentCharLength(content: LlmMessageContent): number {
  if (typeof content === "string") return content.length;
  return content.reduce((sum, part) => {
    if (part.type === "text") return sum + part.text.length;
    if (part.type === "image") {
      const bytes =
        part.image instanceof Uint8Array
          ? part.image.byteLength
          : String(part.image).length;
      return sum + Math.min(bytes, 10_000);
    }
    if (part.type === "tool-call") {
      return sum + part.toolName.length + part.toolCallId.length + 32;
    }
    if (part.type === "tool-result") {
      return sum + part.toolName.length + part.toolCallId.length + 48;
    }
    return sum;
  }, 0);
}

export function contentForTelemetry(content: LlmMessageContent): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "tool-call") {
        return `[tool-call ${part.toolName} id=${part.toolCallId}]`;
      }
      if (part.type === "tool-result") {
        return `[tool-result ${part.toolName} id=${part.toolCallId}]`;
      }
      if (part.type !== "image") {
        return `[${part.type}]`;
      }
      const bytes =
        part.image instanceof Uint8Array
          ? part.image.byteLength
          : String(part.image).length;
      return `[image attachment mime=${part.mediaType ?? "unknown"} bytes=${bytes}]`;
    })
    .join("\n");
}

export function estimateTokensForText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateTokensForContent(content: LlmMessageContent): number {
  if (typeof content === "string") return estimateTokensForText(content);
  return content.reduce((sum, part) => {
    if (part.type === "text") {
      return sum + estimateTokensForText(part.text);
    }
    if (part.type === "tool-call" || part.type === "tool-result") {
      return sum + 64;
    }
    return sum + 1024;
  }, 0);
}

export function estimateContextUsage(messages: LlmMessage[]) {
  return messages.reduce(
    (sum, message) => sum + estimateTokensForContent(message.content),
    0,
  );
}

export async function toHistoryMessage(
  agent: Agent,
  event: Event,
  options?: {
    apiFetch?: ApiFetchFn;
    attachmentCache?: Map<string, Promise<AttachmentImageData | null>>;
  },
): Promise<LlmMessage> {
  if (isOwnMessageEvent(agent, event)) return { role: "assistant", content: ownMessageContent(agent, event) };
  const role = isUserMessageEvent(agent, event) ? ("user" as const) : ("system" as const);
  if (role !== "user" || !options?.apiFetch) {
    return { role, content: JSON.stringify(buildPromptEventRecord(event), null, 2) };
  }
  const textContent = JSON.stringify(
    buildPromptEventRecord(await withWorkspaceAttachmentPaths(agent, event, options.apiFetch)),
    null,
    2,
  );
  const attachments = extractImageAttachments(event).slice(0, MAX_HISTORY_IMAGES_PER_EVENT);
  if (attachments.length === 0) return { role, content: textContent };
  const cache = options.attachmentCache;
  const parts: Array<LlmTextPart | LlmImagePart> = [{ type: "text", text: textContent }];
  for (const attachment of attachments) {
    let pending = cache?.get(attachment.fileId);
    if (!pending) {
      pending = fetchAttachmentImageData(
        options.apiFetch,
        attachment.fileId,
        attachment.mime,
      ).catch(() => null);
      cache?.set(attachment.fileId, pending);
    }
    const loaded = await pending;
    if (!loaded) continue;
    parts.push({
      type: "image",
      image: loaded.bytes,
      ...(loaded.mimeType ? { mediaType: loaded.mimeType } : {}),
    });
  }
  if (parts.length === 1) return { role, content: textContent };
  return { role, content: parts };
}

function buildHistoryTruncationMessage(input: {
  omittedCount: number;
  includedCount: number;
  maxEvents: number;
  maxChars: number;
  channelId?: string;
  oldestIncludedCreatedAt?: number;
}) {
  const before = input.oldestIncludedCreatedAt;
  return {
    role: "system" as const,
    content: JSON.stringify(
      {
        type: "system.history.truncated",
        omittedCount: input.omittedCount,
        includedCount: input.includedCount,
        reason: "history_budget_exceeded",
        limits: { maxEvents: input.maxEvents, maxChars: input.maxChars },
        ...(before !== undefined ? { omittedBefore: before } : {}),
        howToReadOmitted:
          before !== undefined && input.channelId
            ? `Older channel events were left out to fit your context window. If you need them, call events_channel_messages with { channelId: "${input.channelId}", before: ${before}, order: "desc" } (or events_search with the same before/order filters) and page further back using the oldest createdAt you receive.`
            : "Older channel events were left out to fit your context window; read them with events_channel_messages or events_search if you need them.",
      },
      null,
      2,
    ),
  };
}

function getToolEventName(event: Event): string | null {
  const payload =
    event.payload && typeof event.payload === "object"
      ? (event.payload as { tool?: unknown })
      : undefined;
  const tool = payload?.tool;
  return typeof tool === "string" && tool.trim().length > 0 ? tool : null;
}

function buildToolResultToStartIndexMap(channelEvents: Event[]) {
  const startsByKey = new Map<string, number[]>();
  const resultToStartIndex = new Map<number, number>();
  for (let index = 0; index < channelEvents.length; index += 1) {
    const event = channelEvents[index];
    const toolName = getToolEventName(event);
    if (!toolName) continue;
    const key = `${event.source}::${toolName}`;
    if (event.type === "tool.started") {
      const stack = startsByKey.get(key) ?? [];
      stack.push(index);
      startsByKey.set(key, stack);
      continue;
    }
    if (event.type !== "tool.executed" && event.type !== "tool.failed") continue;
    const stack = startsByKey.get(key);
    const startIndex = stack?.pop();
    if (startIndex !== undefined) resultToStartIndex.set(index, startIndex);
  }
  return resultToStartIndex;
}

/**
 * History gets what the model's window leaves after the system prompt and
 * memory, keeping half the window free for tool definitions, the tool loop,
 * and output. ORGOPS_HISTORY_MAX_CHARS stays the ceiling for large windows.
 */
export function computeHistoryBudgetChars(input: {
  contextWindowTokens: number;
  system: string;
  systemContextMessages?: string[];
}): number {
  const fixedTokens =
    estimateTokensForText(input.system) +
    (input.systemContextMessages ?? []).reduce(
      (sum, message) => sum + estimateTokensForText(message),
      0,
    );
  const historyTokens = Math.floor(input.contextWindowTokens * HISTORY_WINDOW_SHARE) - fixedTokens;
  return Math.max(MIN_HISTORY_CHARS, Math.min(HISTORY_MAX_CHARS, historyTokens * CHARS_PER_TOKEN));
}

export async function buildModelMessages(
  agent: Agent,
  system: string,
  channelEvents: Event[],
  options?: { systemContextMessages?: string[]; apiFetch?: ApiFetchFn; historyMaxChars?: number },
): Promise<LlmMessage[]> {
  const historyMaxChars = options?.historyMaxChars ?? HISTORY_MAX_CHARS;
  const orderedChannelEvents = channelEvents
    .slice()
    .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
  const attachmentCache = new Map<string, Promise<AttachmentImageData | null>>();
  const historyMessages = await Promise.all(
    orderedChannelEvents.map((channelEvent) =>
      toHistoryMessage(agent, channelEvent, {
        apiFetch: options?.apiFetch,
        attachmentCache,
      }),
    ),
  );
  const resultToStartIndex = buildToolResultToStartIndexMap(orderedChannelEvents);
  let keptStartIndex = historyMessages.length;
  let keptMessageCount = 0;
  let totalHistoryChars = 0;
  for (let index = historyMessages.length - 1; index >= 0; index -= 1) {
    const messageChars = contentCharLength(historyMessages[index]?.content ?? "");
    const exceedsMaxEvents = keptMessageCount + 1 > HISTORY_MAX_EVENTS;
    const exceedsMaxChars =
      keptMessageCount > 0 && totalHistoryChars + messageChars > historyMaxChars;
    if ((keptStartIndex < historyMessages.length && exceedsMaxChars) || exceedsMaxEvents) {
      break;
    }
    keptStartIndex = index;
    keptMessageCount += 1;
    totalHistoryChars += messageChars;
  }
  for (;;) {
    let advanced = false;
    for (let index = keptStartIndex; index < historyMessages.length; index += 1) {
      const startIndex = resultToStartIndex.get(index);
      if (startIndex !== undefined && startIndex < keptStartIndex) {
        keptStartIndex = index + 1;
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  const keptFromEnd = historyMessages.slice(keptStartIndex);
  const omittedCount = orderedChannelEvents.length - keptFromEnd.length;
  return [
    { role: "system" as const, content: system },
    ...((options?.systemContextMessages ?? [])
      .map((content) => content.trim())
      .filter((content) => content.length > 0)
      .map((content) => ({ role: "system" as const, content }))),
    ...(omittedCount > 0
      ? [
          buildHistoryTruncationMessage({
            omittedCount,
            includedCount: keptFromEnd.length,
            maxEvents: HISTORY_MAX_EVENTS,
            maxChars: historyMaxChars,
            channelId: orderedChannelEvents[0]?.channelId,
            oldestIncludedCreatedAt: orderedChannelEvents[keptStartIndex]?.createdAt,
          }),
        ]
      : []),
    ...keptFromEnd,
  ];
}
