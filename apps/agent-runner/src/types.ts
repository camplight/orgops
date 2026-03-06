export type Agent = {
  name: string;
  systemInstructions: string;
  soulPath: string;
  soulContents?: string;
  enabledSkills?: string[];
  workspacePath: string;
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
