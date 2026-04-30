import type {
  LlmImagePart,
  LlmMessage,
  LlmMessageContent,
  LlmTextPart,
} from "@orgops/llm";
import { buildPromptEventRecord } from "./prompt-event-compact";
import type { Agent, Event } from "./types";

const DEFAULT_MAX_HISTORY_EVENTS = 120;
const DEFAULT_MAX_HISTORY_CHARS = 120_000;
const MAX_HISTORY_IMAGES_PER_EVENT = 3;
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
    return sum;
  }, 0);
}

export function contentForTelemetry(content: LlmMessageContent): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (part.type === "text") return part.text;
      const bytes =
        part.image instanceof Uint8Array
          ? part.image.byteLength
          : String(part.image).length;
      return `[image attachment mime=${part.mimeType ?? "unknown"} bytes=${bytes}]`;
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
  const role =
    event.source === `agent:${agent.name}`
      ? ("assistant" as const)
      : ("user" as const);
  const baseRecord = buildPromptEventRecord(event);
  const textContent = JSON.stringify(baseRecord, null, 2);
  if (role !== "user" || !options?.apiFetch) {
    return { role, content: textContent };
  }
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
      ...(loaded.mimeType ? { mimeType: loaded.mimeType } : {}),
    });
  }
  if (parts.length === 1) return { role, content: textContent };
  return { role, content: parts };
}

function buildHistoryTruncationMessage(
  omittedCount: number,
  includedCount: number,
  maxEvents: number,
  maxChars: number,
) {
  return {
    role: "user" as const,
    content: JSON.stringify(
      {
        type: "system.history.truncated",
        omittedCount,
        includedCount,
        reason: "history_budget_exceeded",
        limits: { maxEvents, maxChars },
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

export async function buildModelMessages(
  agent: Agent,
  system: string,
  channelEvents: Event[],
  options?: { systemContextMessages?: string[]; apiFetch?: ApiFetchFn },
): Promise<LlmMessage[]> {
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
      keptMessageCount > 0 && totalHistoryChars + messageChars > HISTORY_MAX_CHARS;
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
          buildHistoryTruncationMessage(
            omittedCount,
            keptFromEnd.length,
            HISTORY_MAX_EVENTS,
            HISTORY_MAX_CHARS,
          ),
        ]
      : []),
    ...keptFromEnd,
  ];
}

export function selectRecentDeltaEventsForPrompt(agent: Agent, events: Event[]): Event[] {
  const ownSource = `agent:${agent.name}`;
  let latestUserLikeEventId: string | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.source !== ownSource) {
      latestUserLikeEventId = event?.id;
      break;
    }
  }
  if (!latestUserLikeEventId) return events;
  return events.filter((event) => event.id !== latestUserLikeEventId);
}
