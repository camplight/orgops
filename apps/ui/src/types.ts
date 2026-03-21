export type Agent = {
  id?: string;
  name: string;
  runtimeState: string;
  desiredState: string;
  modelId?: string;
  systemInstructions?: string;
  soulPath?: string;
  soulContents?: string;
  enabledSkills?: string[];
  alwaysPreloadedSkills?: string[];
  workspacePath?: string;
  allowOutsideWorkspace?: boolean;
  mode?: "CLASSIC" | "RLM_REPL";
};

export type AgentWorkspaceEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
  extension?: string;
  size?: number | null;
  modifiedAt?: number | null;
  isTextFile?: boolean;
};

export type AgentWorkspaceListResponse = {
  workspacePath: string;
  path: string;
  entries: AgentWorkspaceEntry[];
};

export type AgentWorkspaceFileResponse = {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
  content: string;
};

export type EventRow = {
  id: string;
  type: string;
  source: string;
  createdAt?: number;
  deliverAt?: number;
  channelId?: string;
  payload?: unknown;
  status?: string;
  failCount?: number;
  lastError?: string;
};

export type SkillMeta = {
  name: string;
  description: string;
  license?: string;
  path: string;
};

export type EventTypeInfo = {
  type: string;
  description: string;
  source: string;
  payloadExample?: unknown;
};

export type Conversation = {
  id: string;
  kind: string;
  human_id: string;
  agent_name?: string;
  channel_id?: string;
  title?: string;
};

export type Thread = {
  id: string;
  conversation_id: string;
  title?: string;
};

export type Channel = {
  id: string;
  name: string;
  description?: string;
  kind?: string;
  directParticipantKey?: string;
  participants?: ChannelParticipant[];
};

export type ChannelParticipant = {
  subscriberType: string;
  subscriberId: string;
};

export type Team = {
  id: string;
  name: string;
  description?: string;
};

export type Human = {
  id: string;
  username: string;
  mustChangePassword: boolean;
  createdAt: number;
  updatedAt: number;
};

export type AuthMe = {
  id?: string | null;
  username?: string | null;
  mustChangePassword?: boolean;
};

export type TeamMember = {
  memberType: string;
  memberId: string;
};

export type ProcessRow = {
  id: string;
  agent_name: string;
  channel_id?: string;
  cmd: string;
  cwd?: string;
  pid?: number;
  state: string;
  exit_code?: number;
  started_at: number;
  ended_at?: number;
  output_count?: number;
  last_output_at?: number;
};

export type ProcessOutputRow = {
  id?: string;
  process_id?: string;
  seq: number;
  stream: "STDOUT" | "STDERR" | string;
  text: string;
  ts?: number;
};

export type SecretRow = {
  id: string;
  name: string;
  scope_type: string;
  scope_id?: string;
  created_at: number;
};

export type Screen =
  | "dashboard"
  | "agents"
  | "teams"
  | "channels"
  | "chat"
  | "events"
  | "processes"
  | "skills"
  | "secrets"
  | "humans"
  | "profile";
