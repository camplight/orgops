import type { Event } from "../types";
import type { ConfirmationOutcome } from "./types";

const MESSAGE_CREATED_EVENT_TYPE = "message.created";
const HUMAN_SOURCE_PREFIX = "human:";
const AGENT_SOURCE_PREFIX = "agent:";
const AFFIRMATIVE_CONFIRMATION_PHRASE = "looks right";
const CORRECTIVE_REPLY_PHRASE = "not quite";

/**
 * Pure logic (per brief.md "Architecture Style" / design/wave-decisions.md "Constraints
 * Established": pure logic modules must not perform I/O directly). Mirrors
 * intent-watchdog.ts's ingestIntentEvents pattern: takes an explicit event batch, returns a
 * derived outcome — no direct event-bus subscription. Watches the ticket-scoped channel for the
 * submitter's confirm/correct response to the posted restatement (US-04 AC2/AC3). A correction
 * re-triggers the Restatement Composer rather than starting a run; nothing is persisted to
 * `nwave_runs` until an explicit CONFIRMED outcome is observed (per brief.md "Data Model"'s
 * `restatement_text` note).
 */
export function evaluateConfirmationResponse(input: {
  ticketRef: string;
  channelId: string;
  events: Event[];
}): ConfirmationOutcome {
  const submitterReply = findLatestSubmitterReply(input.events, input.channelId);
  if (!submitterReply) {
    return { kind: "PENDING" };
  }

  const replyText = extractMessageText(submitterReply);

  if (isCorrectiveReply(replyText)) {
    return { kind: "CORRECTED", ticketRef: input.ticketRef, correctionNote: replyText };
  }

  if (!isAffirmativeConfirmation(replyText)) {
    return { kind: "PENDING" };
  }

  const postedRestatement = findLatestPostedRestatement(input.events, input.channelId);
  return {
    kind: "CONFIRMED",
    ticketRef: input.ticketRef,
    confirmedRestatementText: postedRestatement ? extractMessageText(postedRestatement) : "",
  };
}

function isMessageInChannel(event: Event, channelId: string): boolean {
  return event.type === MESSAGE_CREATED_EVENT_TYPE && event.channelId === channelId;
}

function isSubmitterReply(event: Event, channelId: string): boolean {
  return isMessageInChannel(event, channelId) && event.source.startsWith(HUMAN_SOURCE_PREFIX);
}

function isPostedRestatement(event: Event, channelId: string): boolean {
  return isMessageInChannel(event, channelId) && event.source.startsWith(AGENT_SOURCE_PREFIX);
}

function extractMessageText(event: Event): string {
  const payload = event.payload;
  const hasTextField = payload !== null && typeof payload === "object" && "text" in payload;
  if (!hasTextField) return "";
  const text = (payload as { text?: unknown }).text;
  return typeof text === "string" ? text.trim() : "";
}

function sortByOccurrence(events: Event[]): Event[] {
  return [...events].sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
}

function findLatestSubmitterReply(events: Event[], channelId: string): Event | undefined {
  return sortByOccurrence(events)
    .filter((event) => isSubmitterReply(event, channelId))
    .at(-1);
}

function findLatestPostedRestatement(events: Event[], channelId: string): Event | undefined {
  return sortByOccurrence(events)
    .filter((event) => isPostedRestatement(event, channelId))
    .at(-1);
}

function isAffirmativeConfirmation(messageText: string): boolean {
  return messageText.toLowerCase() === AFFIRMATIVE_CONFIRMATION_PHRASE;
}

function isCorrectiveReply(messageText: string): boolean {
  return messageText.toLowerCase().startsWith(CORRECTIVE_REPLY_PHRASE);
}
