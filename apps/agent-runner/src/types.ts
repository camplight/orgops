export type Agent = {
  id?: string;
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
  emitAuditEvents?: boolean;
  memoryContextMode?:
    | "PER_CHANNEL_CROSS_CHANNEL"
    | "FULL_CHANNEL_EVENTS"
    | "OFF";
  mode?: "CLASSIC" | "RLM_REPL";
  modelId: string;
  desiredState: string;
  runtimeState: string;
  assignedRunnerId?: string | null;
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
