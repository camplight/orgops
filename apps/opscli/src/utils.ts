import { MAX_OUTPUT_CHARS } from "./config";

export function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`,
    truncated: true,
  };
}

export function mergeShellOutput(stdoutText: string, stderrText: string) {
  const stdoutChunk = stdoutText.trim();
  const stderrChunk = stderrText.trim();
  if (stdoutChunk && stderrChunk) {
    const separator = stdoutText.endsWith("\n") ? "" : "\n";
    return `${stdoutText}${separator}${stderrText}`;
  }
  return stdoutChunk ? stdoutText : stderrText;
}

export function summarizeToolResults(toolResults: unknown[] | undefined) {
  const results = Array.isArray(toolResults) ? toolResults : [];
  const total = results.length;
  if (total === 0) {
    return "No concrete action taken. Tell me what you want me to do.";
  }
  const failed = results.filter((result) => {
    if (!result || typeof result !== "object") return false;
    return "error" in (result as Record<string, unknown>);
  }).length;
  const succeeded = total - failed;
  if (failed > 0) {
    return `Completed ${total} tool action(s): ${succeeded} succeeded, ${failed} failed. Ask me to inspect failures.`;
  }
  return `Completed ${total} tool action(s) successfully.`;
}

export function toDisplayError(error: unknown) {
  return truncateText(String(error), MAX_OUTPUT_CHARS).text;
}
