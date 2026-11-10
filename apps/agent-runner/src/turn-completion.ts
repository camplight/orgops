import type { GenerateResult, LlmTool } from "@orgops/llm";
import { z } from "zod";

export const TURN_FINISH_TOOL_NAME = "turn_finish";
export const MAX_TURN_COMPLETION_CONTINUATIONS = 3;
export const MAX_SCHEDULED_COMPLETION_ATTEMPTS = 3;
export const DEFAULT_COMPLETION_RETRY_SECONDS = 60;
export const MIN_COMPLETION_RETRY_SECONDS = 5;
export const MAX_COMPLETION_RETRY_SECONDS = 60 * 60;

const terminalStatusSchema = z.enum([
  "DONE",
  "BLOCKED",
  "WAITING_USER",
  "RETRY_LATER",
]);
const fallbackStatusSchema = z.enum([
  "DONE",
  "BLOCKED",
  "WAITING_USER",
  "CONTINUE",
  "RETRY_LATER",
]);

const eventDraftSchema = z
  .object({
    type: z.string().min(1),
    payload: z.unknown().optional(),
    channelId: z.string().min(1).optional(),
    parentEventId: z.string().min(1).optional(),
    deliverAt: z.number().finite().optional(),
    idempotencyKey: z.string().min(1).optional(),
  })
  .passthrough();

export const turnFinishInputSchema = z
  .object({
    status: terminalStatusSchema,
    message: z.string().min(1).optional(),
    event: eventDraftSchema.optional(),
    retryAfterSeconds: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.message && value.event) {
      ctx.addIssue({
        code: "custom",
        message: "Provide either message or event, not both.",
      });
    }
    if (value.status !== "RETRY_LATER" && !value.message && !value.event) {
      ctx.addIssue({
        code: "custom",
        message: `${value.status} requires a user-facing message or event.`,
      });
    }
    if (value.status !== "RETRY_LATER" && value.retryAfterSeconds !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "retryAfterSeconds is only valid with RETRY_LATER.",
      });
    }
  });

export type TurnCompletionStatus = z.infer<typeof fallbackStatusSchema>;
export type TurnCompletionOutcome = {
  status: TurnCompletionStatus;
  message?: string;
  event?: Record<string, unknown>;
  retryAfterSeconds?: number;
  source: "tool" | "json" | "text";
};

export const turnFinishTool: LlmTool = {
  description: [
    "End the current turn with an explicit outcome.",
    "Call only after the requested work is done, blocked, waiting on the user, or must retry later.",
    "Do not call this merely to promise future work; keep using normal tools instead.",
    "Use message for a normal chat reply or event for a non-message event.",
    "RETRY_LATER schedules a bounded internal continuation and may include a progress message.",
  ].join(" "),
  inputSchema: turnFinishInputSchema,
  // Deliberately no execute: both AI SDK and realtime generation stop on this
  // call so the runner can validate and commit the outcome atomically.
};

function parseToolInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function completionFromToolCalls(
  result: Pick<GenerateResult, "toolCalls">,
): TurnCompletionOutcome | null {
  const calls = result.toolCalls ?? [];
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index] as Record<string, unknown>;
    if (call.toolName !== TURN_FINISH_TOOL_NAME) continue;
    const parsed = turnFinishInputSchema.safeParse(
      parseToolInput(call.input ?? call.args ?? call.arguments),
    );
    if (!parsed.success) return null;
    return {
      ...parsed.data,
      event: parsed.data.event as Record<string, unknown> | undefined,
      source: "tool",
    };
  }
  return null;
}

export function calledTurnFinish(result: Pick<GenerateResult, "toolCalls">): boolean {
  return (result.toolCalls ?? []).some(
    (call) =>
      (call as { toolName?: unknown }).toolName === TURN_FINISH_TOOL_NAME,
  );
}

function parseJsonObject(rawText: string): Record<string, unknown> | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!fenced?.[1]) return null;
    try {
      const parsed = JSON.parse(fenced[1]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

export function completionFromJson(rawText: string): TurnCompletionOutcome | null {
  const parsed = parseJsonObject(rawText);
  if (!parsed) return null;
  const statusResult = fallbackStatusSchema.safeParse(parsed.turnStatus);
  if (!statusResult.success) return null;
  const retryAfterSeconds =
    typeof parsed.retryAfterSeconds === "number" &&
    Number.isFinite(parsed.retryAfterSeconds) &&
    parsed.retryAfterSeconds > 0
      ? Math.floor(parsed.retryAfterSeconds)
      : undefined;
  const { turnStatus: _turnStatus, retryAfterSeconds: _retry, ...event } = parsed;
  return {
    status: statusResult.data,
    ...(typeof parsed.message === "string" && parsed.message.trim()
      ? { message: parsed.message.trim() }
      : {}),
    ...(typeof event.type === "string" && event.type.trim() ? { event } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    source: "json",
  };
}

const TEXT_STATUS_PATTERN =
  /(?:^|\n)ORGOPS_TURN_STATUS:\s*(DONE|BLOCKED|WAITING_USER|CONTINUE|RETRY_LATER)(?:\s+(\d+))?\s*$/i;

export function completionFromPlainText(rawText: string): TurnCompletionOutcome | null {
  const match = rawText.trim().match(TEXT_STATUS_PATTERN);
  if (!match) return null;
  const statusResult = fallbackStatusSchema.safeParse(match[1]?.toUpperCase());
  if (!statusResult.success) return null;
  const message = rawText.trim().slice(0, match.index).trim();
  const retryAfterSeconds = match[2] ? Number(match[2]) : undefined;
  return {
    status: statusResult.data,
    ...(message ? { message } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    source: "text",
  };
}

export function clampCompletionRetrySeconds(value: number | undefined): number {
  const resolved =
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : DEFAULT_COMPLETION_RETRY_SECONDS;
  return Math.min(
    MAX_COMPLETION_RETRY_SECONDS,
    Math.max(MIN_COMPLETION_RETRY_SECONDS, resolved),
  );
}

export function scheduledCompletionAttempt(payload: unknown): number {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return 0;
  const value = (payload as Record<string, unknown>).turnCompletionAttempt;
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}
