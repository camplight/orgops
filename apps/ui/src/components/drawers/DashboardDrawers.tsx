import type {
  Agent,
  AgentWorkspaceFileResponse,
  AgentWorkspaceListResponse,
  Channel,
  EventRow,
  EventTypeInfo,
  ProcessOutputRow,
  ProcessRow,
  RunnerNode,
  SkillMeta
} from "../../types";
import { AgentsScreen, EventsScreen, ProcessesScreen } from "../../screens";

type EventFilters = {
  agentName: string;
  channelId: string;
  type: string;
  source: string;
  status: string;
  auditOnly: boolean;
  excludeAuditMemory: boolean;
  excludeAuditSecret: boolean;
  scheduledOnly: boolean;
};

type AgentForm = {
  name: string;
  modelId: string;
  mode: "CLASSIC" | "RLM_REPL";
  memoryContextMode: "PER_CHANNEL_CROSS_CHANNEL" | "FULL_CHANNEL_EVENTS" | "OFF";
  emitAuditEvents: boolean;
  llmCallTimeoutMs: string;
  contextSessionGapMs: string;
  workspacePath: string;
  allowOutsideWorkspace: boolean;
  assignedRunnerId: string;
  soulContents: string;
  enabledSkills: string[];
  alwaysPreloadedSkills: string[];
};

type DashboardDrawersProps = {
  agents: Agent[];
  runners: RunnerNode[];
  skills: SkillMeta[];
  events: EventRow[];
  channels: Channel[];
  eventTypes: EventTypeInfo[];
  processes: ProcessRow[];
  processOutput: Record<string, ProcessOutputRow[]>;
  activeProcessId: string | null;
  focusAgentName: string | null;
  focusEventId: string | null;
  eventFilters: EventFilters;
  onFocusAgentApplied: () => void;
  onFocusEventApplied: () => void;
  onSelectProcess: (id: string | null) => void;
  onCreateAgent: (agent: AgentForm) => Promise<void>;
  onUpdateAgent: (name: string, agent: Omit<AgentForm, "name">) => Promise<void>;
  onStartAgent: (name: string) => Promise<void>;
  onStopAgent: (name: string) => Promise<void>;
  onCleanupAgentWorkspace: (name: string) => Promise<void>;
  loadAgentCrossMemory: (
    name: string
  ) => Promise<{ recent: string; full: string; updatedAtRecent?: number; updatedAtFull?: number }>;
  loadAgentEvents: (name: string) => Promise<EventRow[]>;
  loadAgentWorkspace: (
    name: string,
    path?: string
  ) => Promise<AgentWorkspaceListResponse>;
  loadAgentWorkspaceFile: (
    name: string,
    path: string
  ) => Promise<AgentWorkspaceFileResponse>;
  loadAgentSystemPrompt: (
    name: string
  ) => Promise<{
    found: boolean;
    promptText?: string;
    error?: string;
    createdAt?: number;
    channelId?: string | null;
    modelId?: string | null;
    triggerEventId?: string | null;
  }>;
  onDownloadAgentWorkspaceFile: (name: string, path: string) => void;
  onApplyEventFilters: (filters?: EventFilters) => void;
  onClearEvents: () => Promise<void>;
  onEmitEvent: (rawJson: string) => Promise<void>;
  onRefreshEventTypes: () => Promise<void> | void;
  onUpdateScheduledEvent: (
    eventId: string,
    input: { deliverAt: number; payload?: unknown }
  ) => Promise<void>;
  onDeleteScheduledEvent: (eventId: string) => Promise<void>;
  onRefreshProcesses: () => void;
  onClearExitedProcesses: () => Promise<void>;
  onClearAllProcesses: () => Promise<void>;
  onExitProcess: (id: string) => Promise<void>;
};

export function DashboardDrawers({
  agents,
  runners,
  skills,
  events,
  channels,
  eventTypes,
  processes,
  processOutput,
  activeProcessId,
  focusAgentName,
  focusEventId,
  eventFilters,
  onFocusAgentApplied,
  onFocusEventApplied,
  onSelectProcess,
  onCreateAgent,
  onUpdateAgent,
  onStartAgent,
  onStopAgent,
  onCleanupAgentWorkspace,
  loadAgentCrossMemory,
  loadAgentEvents,
  loadAgentWorkspace,
  loadAgentWorkspaceFile,
  loadAgentSystemPrompt,
  onDownloadAgentWorkspaceFile,
  onApplyEventFilters,
  onClearEvents,
  onEmitEvent,
  onRefreshEventTypes,
  onUpdateScheduledEvent,
  onDeleteScheduledEvent,
  onRefreshProcesses,
  onClearExitedProcesses,
  onClearAllProcesses,
  onExitProcess
}: DashboardDrawersProps) {
  return (
    <>
      <AgentsScreen
        drawerOnly
        agents={agents}
        runners={runners}
        skills={skills}
        onCreateAgent={onCreateAgent}
        onUpdateAgent={onUpdateAgent}
        onStartAgent={onStartAgent}
        onStopAgent={onStopAgent}
        onCleanupAgentWorkspace={onCleanupAgentWorkspace}
        loadAgentCrossMemory={loadAgentCrossMemory}
        loadAgentEvents={loadAgentEvents}
        loadAgentWorkspace={loadAgentWorkspace}
        loadAgentWorkspaceFile={loadAgentWorkspaceFile}
        loadAgentSystemPrompt={loadAgentSystemPrompt}
        onDownloadAgentWorkspaceFile={onDownloadAgentWorkspaceFile}
        focusAgentName={focusAgentName}
        onFocusAgentApplied={onFocusAgentApplied}
      />
      <EventsScreen
        drawerOnly
        events={events}
        channels={channels}
        eventTypes={eventTypes}
        filters={eventFilters}
        onFiltersChange={() => undefined}
        onApplyFilters={onApplyEventFilters}
        onClearEvents={onClearEvents}
        onEmitEvent={onEmitEvent}
        onRefreshEventTypes={onRefreshEventTypes}
        onUpdateScheduledEvent={onUpdateScheduledEvent}
        onDeleteScheduledEvent={onDeleteScheduledEvent}
        focusEventId={focusEventId}
        onFocusEventApplied={onFocusEventApplied}
      />
      <ProcessesScreen
        drawerOnly
        processes={processes}
        processOutput={processOutput}
        activeProcessId={activeProcessId}
        onSelectProcess={onSelectProcess}
        onRefresh={onRefreshProcesses}
        onClearExited={onClearExitedProcesses}
        onClearAll={onClearAllProcesses}
        onExitProcess={onExitProcess}
      />
    </>
  );
}
