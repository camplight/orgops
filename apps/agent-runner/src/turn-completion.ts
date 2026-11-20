import { z } from "zod";

export const MAX_TURN_COMPLETION_CONTINUATIONS = 3;
export const MAX_SCHEDULED_COMPLETION_ATTEMPTS = 3;
export const DEFAULT_COMPLETION_RETRY_SECONDS = 60;
export const MIN_COMPLETION_RETRY_SECONDS = 5;
export const MAX_COMPLETION_RETRY_SECONDS = 60 * 60;

const fallbackStatusSchema = z.enum([
  "WORK_FULLY_COMPLETE",
  "BLOCKED",
  "WAITING_USER",
  "CONTINUE",
  "RETRY_LATER",
]);

export type TurnCompletionStatus = z.infer<typeof fallbackStatusSchema>;
export type TurnCompletionOutcome = {
  status: TurnCompletionStatus;
  message?: string;
  event?: Record<string, unknown>;
  retryAfterSeconds?: number;
  source: "json" | "text";
};

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

export function completionFromJson(
  rawText: string,
): TurnCompletionOutcome | null {
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
  const {
    turnStatus: _turnStatus,
    retryAfterSeconds: _retry,
    ...event
  } = parsed;
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
  /(?:^|\n)ORGOPS_TURN_STATUS:\s*(WORK_FULLY_COMPLETE|BLOCKED|WAITING_USER|CONTINUE|RETRY_LATER)(?:\s+(\d+))?\s*$/i;

export function completionFromPlainText(
  rawText: string,
): TurnCompletionOutcome | null {
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
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return 0;
  const value = (payload as Record<string, unknown>).turnCompletionAttempt;
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}
