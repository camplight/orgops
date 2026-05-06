import type { LlmMessage } from "@orgops/llm";

export type ShellResult = {
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type SessionMemory = {
  summary: string;
  history: LlmMessage[];
};

export type AgentRuntimeState = {
  requestedExit: boolean;
  exitCode: number;
};

export type ModelProvider = "openai" | "anthropic" | "openrouter";

export type CliOptions = {
  goal: string | null;
  help: boolean;
};

export class TaskInterruptedError extends Error {
  constructor(message = "Task interrupted by user.") {
    super(message);
    this.name = "TaskInterruptedError";
  }
}
