import type { LlmTool } from "@orgops/llm";
import type { AgentRuntimeState } from "../types";

export type ToolContext = {
  requestPasswordInput: (promptText: string) => Promise<string>;
  forceExitProcess: (code: number) => never;
  abortSignal?: AbortSignal;
  runtime: AgentRuntimeState;
  reportProgress: (message: string) => void;
  appendLog: (message: string) => void;
};

export type NamedTool = [string, LlmTool];
