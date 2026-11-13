import { generate } from "@orgops/llm";
import { recordLlmUsage } from "./billing";
import type { Agent, Event } from "./types";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Share of the history budget kept as raw messages after compaction. */
const KEEP_SHARE = 0.5;
/** The compact endpoint accepts 24,000 characters; prompts show at most 16,000. */
const SUMMARY_MAX_CHARS = 16_000;
const CHUNK_MAX_CHARS = 60_000;
const CHUNK_MAX_EVENTS = 120;
const SUMMARY_MAX_OUTPUT_TOKENS = 4_000;

/**
 * Command output (`process.*`) is raw tool data whose conclusions are already in the agent's
 * replies, so it is dropped rather than summarized.
 */
function worthSummarizing(event: Event): boolean {
  return !event.type.startsWith("process.");
}

export type HistoryCompactionPlan = {
  /** Oldest events, summarized and dropped from the prompt. */
  older: Event[];
  /** Newest events, kept verbatim. */
  kept: Event[];
};

/**
 * Decides whether a FULL_CHANNEL_EVENTS_AUTO_COMPACT history would be cut by the prompt budget, and if so
 * where to split it. The kept part fills about half of the budget, so the next turns have room
 * to grow before the history needs another summary. Events that share the split timestamp move
 * into the summarized part, because the boundary cutoff is a timestamp.
 */
export function planHistoryCompaction(input: {
  events: Event[];
  sizes: number[];
  maxChars: number;
  maxEvents: number;
}): HistoryCompactionPlan | null {
  const { events, sizes } = input;
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (events.length < 2 || (total <= input.maxChars && events.length <= input.maxEvents)) {
    return null;
  }
  const keepChars = Math.floor(input.maxChars * KEEP_SHARE);
  const keepEvents = Math.max(1, Math.floor(input.maxEvents * KEEP_SHARE));
  let start = events.length - 1;
  let keptChars = sizes[start] ?? 0;
  while (start > 0) {
    const next = sizes[start - 1] ?? 0;
    if (keptChars + next > keepChars || events.length - start + 1 > keepEvents) break;
    start -= 1;
    keptChars += next;
  }
  while (start < events.length && events[start]?.createdAt === events[start - 1]?.createdAt) {
    start += 1;
  }
  if (start <= 0 || start >= events.length) return null;
  return { older: events.slice(0, start), kept: events.slice(start) };
}

function promptRecord(event: Event) {
  return {
    id: event.id,
    createdAt: event.createdAt,
    type: event.type,
    source: event.source,
    payload: event.payload ?? {},
  };
}

function chunkForSummary(events: Event[]): Event[][] {
  const chunks: Event[][] = [];
  let current: Event[] = [];
  let chars = 0;
  for (const event of events) {
    const size = JSON.stringify(promptRecord(event)).length;
    if (current.length > 0 && (chars + size > CHUNK_MAX_CHARS || current.length >= CHUNK_MAX_EVENTS)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(event);
    chars += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function clamp(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= SUMMARY_MAX_CHARS ? trimmed : trimmed.slice(0, SUMMARY_MAX_CHARS);
}

/**
 * Summarizes the older part of a channel's history (merged with the previous compacted summary)
 * and records it as the agent's context boundary for the channel. Returns the summary, or null
 * when there is nothing worth summarizing or the boundary could not be recorded; the caller then
 * falls back to plain truncation. `abortSignal` stops the summary when the turn is cancelled.
 */
export async function compactChannelHistory(input: {
  agent: Agent;
  channelId: string;
  older: Event[];
  previousSummary?: string;
  env: Record<string, string>;
  apiFetch: ApiFetch;
  abortSignal?: AbortSignal;
}): Promise<{ summary: string; cutoffAt: number; cutoffEventId: string } | null> {
  const last = input.older[input.older.length - 1];
  if (!last || typeof last.createdAt !== "number") return null;
  const conversation = input.older.filter(worthSummarizing);
  if (conversation.length === 0) return null;
  let summary = clamp(input.previousSummary ?? "");
  for (const chunk of chunkForSummary(conversation)) {
    input.abortSignal?.throwIfAborted();
    const result = await generate(
      input.agent.modelId,
      [
        {
          role: "system",
          content:
            "You compress the earlier part of a chat so an assistant can continue it without the full transcript. Be factual and concise. Return plain text only.",
        },
        {
          role: "user",
          content: [
            `Update the summary of the earlier conversation in channel ${input.channelId} for agent ${input.agent.name}.`,
            "Keep what the assistant needs to continue: what people asked and what was answered,",
            "decisions, facts and numbers that were looked up, names, ids, links and file paths,",
            "and open questions or promised follow-ups. Drop small talk and superseded details.",
            `Stay under ${Math.floor(SUMMARY_MAX_CHARS * 0.75)} characters.`,
            "",
            summary ? `Summary so far:\n${summary}` : "Summary so far: <none>",
            "",
            "Messages to merge into it, oldest first:",
            JSON.stringify(chunk.map(promptRecord), null, 2),
          ].join("\n"),
        },
      ],
      {
        temperature: 0.2,
        maxTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        env: input.env,
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      },
    );
    await recordLlmUsage(input.apiFetch, {
      channelId: input.channelId,
      agentName: input.agent.name,
      modelId: input.agent.modelId,
      runtime: "memory",
      purpose: "context.auto_compact",
      usage: result.usage,
    });
    const next = clamp(result.text ?? "");
    if (next) summary = next;
  }
  if (!summary) return null;
  const response = await input.apiFetch(
    `/api/agents/${encodeURIComponent(input.agent.name)}/context/compact`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orgops-agent-name": input.agent.name,
      },
      body: JSON.stringify({
        channelId: input.channelId,
        summary,
        cutoffAt: last.createdAt,
        cutoffEventId: last.id,
        reason: "Chat history outgrew the context budget; earlier messages were summarized.",
        idempotencyKey: `context:auto-compact:${input.agent.name}:${input.channelId}:${last.id}`,
      }),
    },
  );
  if (!response.ok) return null;
  return { summary, cutoffAt: last.createdAt, cutoffEventId: last.id };
}
