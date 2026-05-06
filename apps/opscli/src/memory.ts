import type { LlmMessage } from "@orgops/llm";
import {
  MAX_CONTEXT_CHARS,
  MAX_OUTPUT_CHARS,
  MAX_SUMMARY_CHARS,
  MIN_RECENT_MESSAGES,
  SUMMARY_CHUNK_MESSAGES,
} from "./config";
import type { SessionMemory } from "./types";
import { truncateText } from "./utils";

function messageContentToText(content: LlmMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? part.text : "[image]")).join("\n");
}

function estimateMessageChars(messages: LlmMessage[]) {
  return messages.reduce((acc, message) => acc + messageContentToText(message.content).length, 0);
}

function summarizeMessages(messages: LlmMessage[]) {
  return messages
    .map((message, index) => {
      const oneLine = messageContentToText(message.content).replace(/\s+/g, " ").trim();
      const clipped = truncateText(oneLine, 240).text.replace(/\n/g, " ");
      return `${index + 1}. ${message.role}: ${clipped}`;
    })
    .join("\n");
}

function appendToSummary(previousSummary: string, addition: string) {
  const merged = previousSummary ? `${previousSummary}\n${addition}` : addition;
  if (merged.length <= MAX_SUMMARY_CHARS) return merged;
  return merged.slice(merged.length - MAX_SUMMARY_CHARS);
}

function enforceMemoryBudget(memory: SessionMemory) {
  while (
    estimateMessageChars(memory.history) + memory.summary.length > MAX_CONTEXT_CHARS &&
    memory.history.length > MIN_RECENT_MESSAGES
  ) {
    const removableCount = Math.max(
      1,
      Math.min(SUMMARY_CHUNK_MESSAGES, memory.history.length - MIN_RECENT_MESSAGES)
    );
    const removed = memory.history.splice(0, removableCount);
    memory.summary = appendToSummary(memory.summary, summarizeMessages(removed));
  }
}

export function appendHistoryMessage(memory: SessionMemory, message: LlmMessage) {
  const clipped = truncateText(messageContentToText(message.content), MAX_OUTPUT_CHARS);
  memory.history.push({ role: message.role, content: clipped.text });
  enforceMemoryBudget(memory);
}
