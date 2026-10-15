import type { EventRow } from "../../types";

export function isTraceEvent(event: EventRow) {
  return (
    event.type === "agent.turn.started" ||
    event.type === "agent.turn.phase" ||
    event.type === "agent.turn.completed" ||
    event.type === "agent.turn.failed" ||
    event.type === "wrapper.turn.started" ||
    event.type === "wrapper.turn.completed" ||
    event.type === "wrapper.turn.failed" ||
    event.type === "process.started" ||
    event.type === "process.output" ||
    event.type === "process.exited" ||
    event.type === "tool.started" ||
    event.type === "tool.executed" ||
    event.type === "tool.failed" ||
    event.type === "telemetry.context.window.updated"
  );
}

function shortJson(value: unknown) {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function traceTitle(event: EventRow) {
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
  if (event.type.startsWith("process.")) {
    if (event.type === "process.started") return "Wrapped process started";
    if (event.type === "process.exited") {
      const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : null;
      return exitCode === null ? "Wrapped process exited" : `Wrapped process exited (${exitCode})`;
    }
    if (event.type === "process.output") {
      const stream = typeof payload.stream === "string" ? payload.stream : "STDOUT";
      const seq = typeof payload.seq === "number" ? payload.seq : null;
      return seq === null ? `Wrapped output (${stream})` : `Wrapped output #${seq} (${stream})`;
    }
  }
  if (event.type.startsWith("wrapper.turn.")) {
    if (event.type === "wrapper.turn.started") return "Wrapped turn started";
    if (event.type === "wrapper.turn.completed") return "Wrapped turn completed";
    if (event.type === "wrapper.turn.failed") return "Wrapped turn failed";
  }
  if (event.type.startsWith("tool.")) {
    const toolName = typeof payload.tool === "string" ? payload.tool : "tool";
    const action = event.type === "tool.started" ? "started" : event.type === "tool.executed" ? "completed" : "failed";
    return `${toolName} ${action}`;
  }
  if (event.type === "agent.turn.started") return "Agent is thinking";
  if (event.type === "agent.turn.completed") return "Agent finished turn";
  if (event.type === "agent.turn.failed") return "Agent turn failed";
  if (event.type === "agent.turn.phase") {
    const phase = typeof payload.phase === "string" ? payload.phase : "progress";
    return `Agent phase: ${phase}`;
  }
  if (event.type === "telemetry.context.window.updated") {
    const used = typeof payload.estimatedUsedTokens === "number" ? payload.estimatedUsedTokens : null;
    const total = typeof payload.contextWindowTokens === "number" ? payload.contextWindowTokens : null;
    return used !== null && total !== null ? `Context usage: ${used}/${total} tokens` : "Context usage updated";
  }
  return event.type.replaceAll(".", " ");
}

export function traceDetail(event: EventRow) {
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
  if (event.type === "process.output") {
    const text = typeof payload.text === "string" ? payload.text : "";
    return text || shortJson(event.payload);
  }
  if (event.type === "process.exited") {
    const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : null;
    return exitCode === null ? shortJson(event.payload) : `exitCode: ${exitCode}`;
  }
  if (event.type.startsWith("tool.")) {
    const args = shortJson(payload.args);
    const output = shortJson(payload.output);
    const error = typeof payload.error === "string" ? payload.error : "";
    return [args ? `args: ${args}` : "", output ? `output: ${output}` : "", error ? `error: ${error}` : ""]
      .filter(Boolean)
      .join("\n");
  }
  return shortJson(event.payload);
}

export function turnFailureText(event: EventRow) {
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
  const error = typeof payload.error === "string" ? payload.error.trim() : "";
  return error || event.lastError?.trim() || "Agent turn failed.";
}

// Raw failure text comes from provider SDKs and external CLIs we don't control,
// so rules match loose keywords. Order matters: the first matching rule wins.
const TURN_FAILURE_RULES: Array<{ pattern: RegExp; title: string; message: string }> = [
  {
    pattern: /api[ _-]?key|authenticat|unauthori[sz]ed|\b40[13]\b/i,
    title: "Authentication failed",
    message: "The agent could not connect to its AI service because access is not configured. Contact your administrator."
  },
  {
    pattern: /invalid modelid|unsupported provider|nosuchmodel|model\b.*\b(does not exist|not found)|unsupported wrapped harness|missing wrappedconfig/i,
    title: "Invalid configuration",
    message: "The agent is not set up correctly and cannot respond. Contact your administrator."
  },
  {
    pattern: /\b429\b|rate limit|quota|insufficient|credit balance/i,
    title: "Usage limit reached",
    message:
      "The agent's AI service has reached its usage limit. Try again later. If the problem persists, contact your administrator."
  },
  {
    pattern: /\b(500|502|503|504|529)\b|overloaded|service unavailable|econnrefused|enotfound|fetch failed|cannot connect|retryerror/i,
    title: "Service unavailable",
    message: "The agent's AI service is temporarily unavailable. Try again in a few minutes."
  },
  {
    pattern: /timed out|timeout/i,
    title: "Request timed out",
    message: "The agent took too long to respond. Try again or simplify your request."
  },
  {
    pattern: /wrapped (runtime|setup)|source (checkout|update) failed|terminated unexpectedly/i,
    title: "Runtime error",
    message: "The agent's runtime stopped with an error. Contact your administrator."
  }
];

export function classifyTurnFailure(rawText: string) {
  const rule = TURN_FAILURE_RULES.find((candidate) => candidate.pattern.test(rawText));
  return {
    title: rule?.title ?? "Unexpected error",
    message:
      rule?.message ??
      "The agent could not complete your request. Try again. If the problem persists, contact your administrator."
  };
}

export function traceChipCode(event: EventRow) {
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
  if (event.type === "agent.turn.started") return "T";
  if (event.type === "agent.turn.completed") return "D";
  if (event.type === "agent.turn.failed") return "F";
  if (event.type.startsWith("wrapper.turn.")) {
    if (event.type === "wrapper.turn.started") return "W";
    if (event.type === "wrapper.turn.completed") return "D";
    return "F";
  }
  if (event.type.startsWith("process.")) {
    if (event.type === "process.started") return "P";
    if (event.type === "process.output") {
      const stream = typeof payload.stream === "string" ? payload.stream : "";
      return stream === "STDERR" ? "!" : "O";
    }
    return "X";
  }
  if (event.type === "agent.turn.phase") {
    const phase = typeof payload.phase === "string" ? payload.phase : "phase";
    return phase.slice(0, 1).toUpperCase() || "P";
  }
  if (event.type === "telemetry.context.window.updated") return "C";
  if (event.type.startsWith("tool.")) {
    if (event.type === "tool.started") return "R";
    if (event.type === "tool.executed") return "E";
    return "F";
  }
  return "?";
}

export function traceChipTone(event: EventRow) {
  if (
    event.type === "tool.failed" ||
    event.type === "agent.turn.failed" ||
    event.type === "wrapper.turn.failed"
  ) {
    return "danger";
  }
  if (event.type === "process.exited") {
    const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
    const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : null;
    return exitCode === 0 ? "success" : "danger";
  }
  if (
    event.type === "tool.executed" ||
    event.type === "agent.turn.completed" ||
    event.type === "wrapper.turn.completed"
  ) {
    return "success";
  }
  if (event.type === "telemetry.context.window.updated") return "muted";
  return "neutral";
}
