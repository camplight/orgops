import { useEffect, useMemo, useState } from "react";
import type {
  Agent,
  AgentWorkspaceFileResponse,
  AgentWorkspaceListResponse,
  EventRow,
  SkillMeta
} from "../types";
import { Button, Card, Input, Textarea } from "../components/ui";
import { formatTimestamp } from "../utils/formatTimestamp";

type AgentForm = {
  name: string;
  modelId: string;
  workspacePath: string;
  allowOutsideWorkspace: boolean;
  soulContents: string;
  enabledSkills: string[];
  alwaysPreloadedSkills: string[];
};

const DEFAULT_AGENT_FORM: AgentForm = {
  name: "",
  modelId: "openai:gpt-4o-mini",
  workspacePath: ".orgops-data/workspaces/default",
  allowOutsideWorkspace: false,
  soulContents: "",
  enabledSkills: [],
  alwaysPreloadedSkills: []
};

type AgentsScreenProps = {
  agents: Agent[];
  skills: SkillMeta[];
  onCreateAgent: (agent: AgentForm) => Promise<void>;
  onUpdateAgent: (name: string, agent: Omit<AgentForm, "name">) => Promise<void>;
  onStartAgent: (name: string) => Promise<void>;
  onStopAgent: (name: string) => Promise<void>;
  onCleanupAgentWorkspace: (name: string) => Promise<void>;
  loadAgentEvents: (name: string) => Promise<EventRow[]>;
  loadAgentWorkspace: (
    name: string,
    path?: string
  ) => Promise<AgentWorkspaceListResponse>;
  loadAgentWorkspaceFile: (
    name: string,
    path: string
  ) => Promise<AgentWorkspaceFileResponse>;
  onDownloadAgentWorkspaceFile: (name: string, path: string) => void;
};

export function AgentsScreen({
  agents,
  skills,
  onCreateAgent,
  onUpdateAgent,
  onStartAgent,
  onStopAgent,
  onCleanupAgentWorkspace,
  loadAgentEvents,
  loadAgentWorkspace,
  loadAgentWorkspaceFile,
  onDownloadAgentWorkspaceFile
}: AgentsScreenProps) {
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "events" | "workspace">(
    "details"
  );
  const [form, setForm] = useState<AgentForm>(DEFAULT_AGENT_FORM);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTogglingRuntime, setIsTogglingRuntime] = useState(false);
  const [agentEvents, setAgentEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [workspaceData, setWorkspaceData] = useState<AgentWorkspaceListResponse | null>(
    null
  );
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [fileLoadingPath, setFileLoadingPath] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<AgentWorkspaceFileResponse | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.name === selectedAgentName) ?? null,
    [agents, selectedAgentName]
  );
  const selectedEvent = useMemo(
    () => agentEvents.find((event) => event.id === selectedEventId) ?? null,
    [agentEvents, selectedEventId]
  );
  const drawerOpen = Boolean(selectedAgent || isCreating);
  const eventDetailsDrawerOpen = activeTab === "events" && Boolean(selectedEvent);
  const workspaceSegments =
    workspaceData && workspaceData.path !== "."
      ? workspaceData.path.split("/").filter(Boolean)
      : [];

  useEffect(() => {
    if (isCreating) return;
    if (!selectedAgent) return;
    if (isFormDirty) return;
    setForm({
      name: selectedAgent.name,
      modelId: selectedAgent.modelId ?? "openai:gpt-4o-mini",
      workspacePath:
        selectedAgent.workspacePath ??
        `.orgops-data/workspaces/${selectedAgent.name}`,
      allowOutsideWorkspace: Boolean(selectedAgent.allowOutsideWorkspace),
      soulContents: selectedAgent.soulContents ?? "",
      enabledSkills: selectedAgent.enabledSkills ?? [],
      alwaysPreloadedSkills: selectedAgent.alwaysPreloadedSkills ?? []
    });
  }, [isCreating, selectedAgent, isFormDirty]);

  useEffect(() => {
    if (!selectedAgent || isCreating) {
      setAgentEvents([]);
      setSelectedEventId(null);
      setWorkspaceData(null);
      setOpenFile(null);
      return;
    }
    setPanelError(null);
  }, [selectedAgent, isCreating]);

  const handleNewAgent = () => {
    setSelectedAgentName(null);
    setIsCreating(true);
    setActiveTab("details");
    setForm(DEFAULT_AGENT_FORM);
    setIsFormDirty(false);
    setSaveStatus(null);
    setPanelError(null);
    setSelectedEventId(null);
    setOpenFile(null);
  };

  const handleSelectAgent = (name: string) => {
    setSelectedAgentName(name);
    setIsCreating(false);
    setActiveTab("details");
    setIsFormDirty(false);
    setSaveStatus(null);
    setPanelError(null);
    setSelectedEventId(null);
    setOpenFile(null);
  };

  const closeDrawer = () => {
    setSelectedAgentName(null);
    setIsCreating(false);
    setSaveStatus(null);
    setPanelError(null);
    setSelectedEventId(null);
    setOpenFile(null);
  };

  const openEventsTab = async () => {
    if (!selectedAgent) return;
    setActiveTab("events");
    setPanelError(null);
    setEventsLoading(true);
    try {
      const data = await loadAgentEvents(selectedAgent.name);
      setAgentEvents(data);
      setSelectedEventId((prev) =>
        prev && data.some((event) => event.id === prev) ? prev : null
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load agent events.";
      setPanelError(message);
    } finally {
      setEventsLoading(false);
    }
  };

  const openWorkspacePath = async (path = ".") => {
    if (!selectedAgent) return;
    setActiveTab("workspace");
    setPanelError(null);
    setWorkspaceLoading(true);
    try {
      const data = await loadAgentWorkspace(selectedAgent.name, path);
      setWorkspaceData(data);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load workspace contents.";
      setPanelError(message);
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const handleOpenWorkspaceEntry = async (entry: AgentWorkspaceListResponse["entries"][number]) => {
    if (!selectedAgent) return;
    if (entry.kind === "directory") {
      await openWorkspacePath(entry.path);
      return;
    }
    if (!entry.isTextFile) {
      onDownloadAgentWorkspaceFile(selectedAgent.name, entry.path);
      return;
    }
    setPanelError(null);
    setFileLoadingPath(entry.path);
    try {
      const file = await loadAgentWorkspaceFile(selectedAgent.name, entry.path);
      setOpenFile(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load file.";
      setPanelError(message);
    } finally {
      setFileLoadingPath(null);
    }
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.modelId.trim() || !form.workspacePath.trim()) {
      return;
    }
    setIsSubmitting(true);
    setSaveStatus(null);
    try {
      if (isCreating) {
        const normalizedName = form.name.trim();
        await onCreateAgent({
          ...form,
          name: normalizedName,
          modelId: form.modelId.trim(),
          workspacePath: form.workspacePath.trim(),
          allowOutsideWorkspace: form.allowOutsideWorkspace,
          soulContents: form.soulContents,
          enabledSkills: form.enabledSkills,
          alwaysPreloadedSkills: form.alwaysPreloadedSkills
        });
        setIsCreating(false);
        setSelectedAgentName(normalizedName);
        setActiveTab("details");
        setIsFormDirty(false);
        setSaveStatus({
          kind: "success",
          message: `Agent "${normalizedName}" was saved successfully.`
        });
        return;
      }
      if (!selectedAgent) return;
      await onUpdateAgent(selectedAgent.name, {
        modelId: form.modelId.trim(),
        workspacePath: form.workspacePath.trim(),
        allowOutsideWorkspace: form.allowOutsideWorkspace,
        soulContents: form.soulContents,
        enabledSkills: form.enabledSkills,
        alwaysPreloadedSkills: form.alwaysPreloadedSkills
      });
      setIsFormDirty(false);
      setSaveStatus({
        kind: "success",
        message: `Agent "${selectedAgent.name}" was saved successfully.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save agent.";
      setSaveStatus({ kind: "error", message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleRuntime = async () => {
    if (!selectedAgent) return;
    const isRunning = selectedAgent.runtimeState === "RUNNING";
    setIsTogglingRuntime(true);
    setSaveStatus(null);
    try {
      if (isRunning) {
        await onStopAgent(selectedAgent.name);
      } else {
        await onStartAgent(selectedAgent.name);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update agent state.";
      setSaveStatus({ kind: "error", message });
    } finally {
      setIsTogglingRuntime(false);
    }
  };

  const toggleSkill = (skillName: string) => {
    setIsFormDirty(true);
    setSaveStatus(null);
    setForm((prev) => {
      const exists = prev.enabledSkills.includes(skillName);
      if (exists) {
        return {
          ...prev,
          enabledSkills: prev.enabledSkills.filter((name) => name !== skillName),
          alwaysPreloadedSkills: prev.alwaysPreloadedSkills.filter(
            (name) => name !== skillName
          )
        };
      }
      return { ...prev, enabledSkills: [...prev.enabledSkills, skillName] };
    });
  };

  const toggleAlwaysPreloadedSkill = (skillName: string) => {
    setIsFormDirty(true);
    setSaveStatus(null);
    setForm((prev) => {
      const isEnabled = prev.enabledSkills.includes(skillName);
      if (!isEnabled) {
        return {
          ...prev,
          enabledSkills: [...prev.enabledSkills, skillName],
          alwaysPreloadedSkills: [...prev.alwaysPreloadedSkills, skillName]
        };
      }
      const exists = prev.alwaysPreloadedSkills.includes(skillName);
      if (exists) {
        return {
          ...prev,
          alwaysPreloadedSkills: prev.alwaysPreloadedSkills.filter(
            (name) => name !== skillName
          )
        };
      }
      return {
        ...prev,
        alwaysPreloadedSkills: [...prev.alwaysPreloadedSkills, skillName]
      };
    });
  };

  return (
    <div className="space-y-4">
      <Card title={`Agents (${agents.length})`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            Click an agent row to open details, events, and workspace.
          </div>
          <Button onClick={handleNewAgent}>New agent</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-300">
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Runtime</th>
                <th className="px-2 py-2">Desired</th>
                <th className="px-2 py-2">Model</th>
                <th className="px-2 py-2">Workspace</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr
                  key={agent.name}
                  className={`cursor-pointer border-b border-slate-900 align-top hover:bg-slate-900/40 ${
                    selectedAgentName === agent.name && !isCreating ? "bg-slate-900/70" : ""
                  }`}
                  onClick={() => handleSelectAgent(agent.name)}
                >
                  <td className="whitespace-nowrap px-2 py-2 text-slate-200">{agent.name}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-slate-300">
                    {agent.runtimeState}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-slate-400">
                    {agent.desiredState}
                  </td>
                  <td className="max-w-[220px] truncate px-2 py-2 text-slate-400">
                    {agent.modelId ?? "-"}
                  </td>
                  <td className="max-w-[420px] truncate px-2 py-2 text-slate-500">
                    {agent.workspacePath ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {agents.length === 0 && (
            <div className="py-8 text-center text-slate-500">No agents found.</div>
          )}
        </div>
      </Card>

      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity lg:left-56 ${
          drawerOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={closeDrawer}
      />

      <aside
        className={`fixed bottom-0 right-0 top-0 z-50 w-full max-w-4xl border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-300 ${
          drawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!drawerOpen}
      >
        <div className="relative flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                {isCreating
                  ? "Create Agent"
                  : selectedAgent
                    ? `Agent: ${selectedAgent.name}`
                    : "Agent"}
              </h3>
              <p className="text-xs text-slate-500">
                {isCreating
                  ? "Set up a new agent."
                  : selectedAgent
                    ? `${selectedAgent.runtimeState} | ${selectedAgent.modelId ?? "No model"}`
                    : "Select an agent row."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={closeDrawer}
              >
                Close
              </Button>
            </div>
          </div>

          <div className="flex shrink-0 gap-2 border-b border-slate-800 px-4 py-3">
            <Button
              variant={activeTab === "details" ? "primary" : "secondary"}
              className="px-3 py-1 text-xs"
              onClick={() => setActiveTab("details")}
            >
              Details
            </Button>
            <Button
              variant={activeTab === "events" ? "primary" : "secondary"}
              className="px-3 py-1 text-xs"
              onClick={openEventsTab}
              disabled={!selectedAgent}
            >
              Events
            </Button>
            <Button
              variant={activeTab === "workspace" ? "primary" : "secondary"}
              className="px-3 py-1 text-xs"
              onClick={() => openWorkspacePath(".")}
              disabled={!selectedAgent}
            >
              Workspace
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
            {activeTab === "details" && (
              <div className="space-y-4">
                {!isCreating && !selectedAgent ? (
                  <div className="text-sm text-slate-500">
                    Select an existing agent or create a new one.
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <div className="text-sm text-slate-400">Name</div>
                      <Input
                        value={form.name}
                        disabled={!isCreating}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          setForm((prev) => ({ ...prev, name: e.target.value }));
                        }}
                        placeholder="Agent name"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-slate-400">Model</div>
                      <Input
                        value={form.modelId}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          setForm((prev) => ({ ...prev, modelId: e.target.value }));
                        }}
                        placeholder="openai:gpt-4o-mini"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-slate-400">Workspace directory</div>
                      <Input
                        value={form.workspacePath}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          setForm((prev) => ({ ...prev, workspacePath: e.target.value }));
                        }}
                        placeholder=".orgops-data/workspaces/agent-name"
                      />
                    </div>
                    <label className="flex items-center gap-2 rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={form.allowOutsideWorkspace}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          setForm((prev) => ({
                            ...prev,
                            allowOutsideWorkspace: e.target.checked
                          }));
                        }}
                      />
                      <span>Allow access outside workspace (full host filesystem)</span>
                    </label>
                    <div className="space-y-2">
                      <div className="text-sm text-slate-400">Enabled skills</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {skills.map((skill) => (
                          <div
                            key={skill.path}
                            className="flex items-start gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-2 text-sm text-slate-300"
                          >
                            <div className="space-y-2">
                              <div className="leading-tight">
                                <span className="block text-slate-200">{skill.name}</span>
                                <span className="text-xs text-slate-500">{skill.description}</span>
                              </div>
                              <label className="flex items-center gap-2 text-xs text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={form.enabledSkills.includes(skill.name)}
                                  onChange={() => toggleSkill(skill.name)}
                                  className="mt-0.5"
                                />
                                <span>Enabled</span>
                              </label>
                              <label className="flex items-center gap-2 text-xs text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={form.alwaysPreloadedSkills.includes(skill.name)}
                                  onChange={() => toggleAlwaysPreloadedSkill(skill.name)}
                                  className="mt-0.5"
                                />
                                <span>Always pre-load into context</span>
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-slate-400">SOUL contents</div>
                      <Textarea
                        rows={12}
                        value={form.soulContents}
                        onChange={(e) => {
                          setIsFormDirty(true);
                          setSaveStatus(null);
                          setForm((prev) => ({ ...prev, soulContents: e.target.value }));
                        }}
                        placeholder="System-level guidance and behavior instructions."
                      />
                    </div>
                    {isFormDirty && (
                      <div className="text-sm text-amber-300">Unsaved changes.</div>
                    )}
                    {saveStatus && (
                      <div
                        className={`text-sm ${
                          saveStatus.kind === "success" ? "text-emerald-300" : "text-rose-400"
                        }`}
                      >
                        {saveStatus.message}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={handleSubmit}
                        disabled={
                          isSubmitting ||
                          (!isCreating && !isFormDirty) ||
                          !form.name.trim() ||
                          !form.modelId.trim() ||
                          !form.workspacePath.trim()
                        }
                      >
                        {isSubmitting
                          ? isCreating
                            ? "Creating..."
                            : "Saving..."
                          : isCreating
                            ? "Create Agent"
                            : "Save Details"}
                      </Button>
                      {!isCreating && selectedAgent && (
                        <>
                          <Button
                            variant="secondary"
                            onClick={handleToggleRuntime}
                            disabled={isTogglingRuntime}
                          >
                            {isTogglingRuntime
                              ? selectedAgent.runtimeState === "RUNNING"
                                ? "Stopping..."
                                : "Starting..."
                              : selectedAgent.runtimeState === "RUNNING"
                                ? "Stop"
                                : "Start"}
                          </Button>
                          <Button
                            variant="secondary"
                            className="bg-amber-900 text-amber-100 hover:bg-amber-800"
                            onClick={async () => {
                              const confirmed = confirm(
                                `Clean workspace for ${selectedAgent.name}? This deletes all files in ${form.workspacePath}.`
                              );
                              if (!confirmed) return;
                              await onCleanupAgentWorkspace(selectedAgent.name);
                              await openWorkspacePath(".");
                            }}
                          >
                            Clean Workspace
                          </Button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === "events" && (
              <div className="space-y-2 rounded border border-slate-800 bg-slate-950 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm text-slate-300">Agent Events</h3>
                  <Button
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={openEventsTab}
                    disabled={!selectedAgent || eventsLoading}
                  >
                    Refresh
                  </Button>
                </div>
                <div className="max-h-full space-y-2 overflow-auto pr-1 text-sm">
                  {eventsLoading && (
                    <div className="text-sm text-slate-500">Loading events...</div>
                  )}
                  {!eventsLoading &&
                    agentEvents.map((event) => (
                      <button
                        type="button"
                        key={event.id}
                        className={`w-full rounded border-b border-slate-800 px-2 py-2 text-left hover:bg-slate-900/40 ${
                          selectedEventId === event.id ? "bg-slate-900/70" : ""
                        }`}
                        onClick={() => setSelectedEventId(event.id)}
                      >
                        <div className="text-slate-300">{event.type}</div>
                        <div className="text-xs text-slate-500">
                          {event.source} | {formatTimestamp(event.createdAt)}
                        </div>
                      </button>
                    ))}
                  {!eventsLoading && agentEvents.length === 0 && (
                    <div className="text-sm text-slate-500">No events found for this agent.</div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "workspace" && (
              <div className="space-y-3 rounded border border-slate-800 bg-slate-950 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Button
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() => openWorkspacePath(".")}
                    disabled={!selectedAgent || workspaceLoading}
                  >
                    Root
                  </Button>
                  {workspaceSegments.map((segment, index) => {
                    const path = workspaceSegments.slice(0, index + 1).join("/");
                    return (
                      <Button
                        key={path}
                        variant="secondary"
                        className="px-2 py-1 text-xs"
                        onClick={() => openWorkspacePath(path)}
                        disabled={!selectedAgent || workspaceLoading}
                      >
                        {segment}
                      </Button>
                    );
                  })}
                </div>

                {workspaceLoading && (
                  <div className="text-sm text-slate-500">Loading workspace...</div>
                )}

                {!workspaceLoading && workspaceData && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 text-left text-slate-300">
                          <th className="px-2 py-2">Name</th>
                          <th className="px-2 py-2">Kind</th>
                          <th className="px-2 py-2">Size</th>
                          <th className="px-2 py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workspaceData.entries.map((entry) => (
                          <tr
                            key={entry.path}
                            className="cursor-pointer border-b border-slate-900 hover:bg-slate-900/40"
                            onClick={() => handleOpenWorkspaceEntry(entry)}
                          >
                            <td className="px-2 py-2 text-slate-200">{entry.name}</td>
                            <td className="px-2 py-2 text-slate-400">{entry.kind}</td>
                            <td className="whitespace-nowrap px-2 py-2 text-slate-500">
                              {entry.kind === "file" ? (entry.size ?? "-") : "-"}
                            </td>
                            <td className="px-2 py-2 text-slate-300">
                              {entry.kind === "directory"
                                ? "Open"
                                : entry.isTextFile
                                  ? fileLoadingPath === entry.path
                                    ? "Opening..."
                                    : "Preview"
                                  : "Download"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {workspaceData.entries.length === 0 && (
                      <div className="py-6 text-center text-sm text-slate-500">
                        This folder is empty.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {panelError && (
              <div className="rounded border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
                {panelError}
              </div>
            )}
          </div>

          <div
            className={`absolute inset-0 z-10 flex justify-end bg-black/30 transition-opacity ${
              eventDetailsDrawerOpen
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0"
            }`}
            onClick={() => setSelectedEventId(null)}
          >
            <div
              className={`pointer-events-auto flex h-full w-full max-w-2xl flex-col border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-300 ${
                eventDetailsDrawerOpen ? "translate-x-0" : "translate-x-full"
              }`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-100">Event Details</h4>
                  <p className="text-xs text-slate-500">
                    {selectedEvent ? selectedEvent.id : "No event selected"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="px-2 py-1 text-xs"
                  onClick={() => setSelectedEventId(null)}
                >
                  Back
                </Button>
              </div>

              {selectedEvent ? (
                <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4 text-sm">
                  <div className="rounded border border-slate-800 bg-slate-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Type</div>
                    <div className="mt-1 text-slate-200">{selectedEvent.type}</div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Source</div>
                    <div className="mt-1 break-all text-slate-200">{selectedEvent.source}</div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Created</div>
                    <div className="mt-1 text-slate-200">
                      {formatTimestamp(selectedEvent.createdAt)}
                    </div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Status</div>
                    <div className="mt-1 text-slate-200">{selectedEvent.status ?? "N/A"}</div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Channel ID</div>
                    <div className="mt-1 break-all text-slate-200">
                      {selectedEvent.channelId ?? "N/A"}
                    </div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Deliver At
                    </div>
                    <div className="mt-1 text-slate-200">
                      {selectedEvent.deliverAt ? formatTimestamp(selectedEvent.deliverAt) : "N/A"}
                    </div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Payload</div>
                    <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-900 p-2 text-xs text-slate-300">
                      {JSON.stringify(selectedEvent.payload ?? {}, null, 2)}
                    </pre>
                  </div>
                  {selectedEvent.lastError ? (
                    <div className="rounded border border-rose-900/60 bg-rose-950/20 p-3">
                      <div className="text-xs uppercase tracking-wide text-rose-400">
                        Last Error
                      </div>
                      <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-900 p-2 text-xs text-rose-300">
                        {selectedEvent.lastError}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </aside>

      <aside
        className={`fixed bottom-0 left-0 top-0 z-[60] w-full max-w-3xl border-r border-slate-700 bg-slate-950 shadow-2xl transition-transform duration-300 ${
          openFile ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!openFile}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">{openFile?.name}</h3>
              <p className="text-xs text-slate-500">{openFile?.path}</p>
            </div>
            <Button
              variant="secondary"
              className="px-2 py-1 text-xs"
              onClick={() => setOpenFile(null)}
            >
              Back
            </Button>
          </div>
          <div className="border-b border-slate-800 px-4 py-2 text-xs text-slate-500">
            {openFile ? `${openFile.size} bytes | ${formatTimestamp(openFile.modifiedAt)}` : ""}
          </div>
          <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs text-slate-200">
            {openFile?.content}
          </pre>
        </div>
      </aside>
    </div>
  );
}
