export type Agent = {
  name: string;
  systemInstructions: string;
  soulPath: string;
  soulContents?: string;
  enabledSkills?: string[];
  alwaysPreloadedSkills?: string[];
  workspacePath: string;
  allowOutsideWorkspace?: boolean;
  llmCallTimeoutMs?: number | null;
  classicMaxModelSteps?: number | null;
  contextSessionGapMs?: number | null;
  memoryContextMode?:
    | "PER_CHANNEL_CROSS_CHANNEL"
    | "FULL_CHANNEL_EVENTS"
    | "OFF";
  mode?: "CLASSIC" | "RLM_REPL";
  modelId: string;
  desiredState: string;
  runtimeState: string;
};

export type Event = {
  id: string;
  type: string;
  payload: any;
  source: string;
  channelId?: string;
  parentEventId?: string;
  createdAt?: number;
};
