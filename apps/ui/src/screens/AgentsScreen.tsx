import { useEffect, useMemo, useState } from "react";
import type { Agent, SkillMeta } from "../types";
import { Button, Card, Input, Textarea } from "../components/ui";

type AgentForm = {
  name: string;
  modelId: string;
  workspacePath: string;
  soulContents: string;
  enabledSkills: string[];
};

const DEFAULT_AGENT_FORM: AgentForm = {
  name: "",
  modelId: "openai:gpt-4o-mini",
  workspacePath: ".orgops-data/workspaces/default",
  soulContents: "",
  enabledSkills: []
};

type AgentsScreenProps = {
  agents: Agent[];
  skills: SkillMeta[];
  onCreateAgent: (agent: AgentForm) => Promise<void>;
  onUpdateAgent: (name: string, agent: Omit<AgentForm, "name">) => Promise<void>;
  onStartAgent: (name: string) => void;
  onStopAgent: (name: string) => void;
  onCleanupAgentWorkspace: (name: string) => Promise<void>;
};

export function AgentsScreen({
  agents,
  skills,
  onCreateAgent,
  onUpdateAgent,
  onStartAgent,
  onStopAgent,
  onCleanupAgentWorkspace
}: AgentsScreenProps) {
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<AgentForm>(DEFAULT_AGENT_FORM);
  const [isFormDirty, setIsFormDirty] = useState(false);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.name === selectedAgentName) ?? null,
    [agents, selectedAgentName]
  );

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
      soulContents: selectedAgent.soulContents ?? "",
      enabledSkills: selectedAgent.enabledSkills ?? []
    });
  }, [isCreating, selectedAgent, isFormDirty]);

  const handleNewAgent = () => {
    setSelectedAgentName(null);
    setIsCreating(true);
    setForm(DEFAULT_AGENT_FORM);
    setIsFormDirty(false);
  };

  const handleSelectAgent = (name: string) => {
    setSelectedAgentName(name);
    setIsCreating(false);
    setIsFormDirty(false);
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.modelId.trim() || !form.workspacePath.trim()) {
      return;
    }
    if (isCreating) {
      await onCreateAgent({
        ...form,
        name: form.name.trim(),
        modelId: form.modelId.trim(),
        workspacePath: form.workspacePath.trim(),
        soulContents: form.soulContents
      });
      setIsCreating(false);
      setSelectedAgentName(form.name.trim());
      setIsFormDirty(false);
      return;
    }
    if (!selectedAgent) return;
    await onUpdateAgent(selectedAgent.name, {
      modelId: form.modelId.trim(),
      workspacePath: form.workspacePath.trim(),
      soulContents: form.soulContents,
      enabledSkills: form.enabledSkills
    });
    setIsFormDirty(false);
  };

  const toggleSkill = (skillName: string) => {
    setIsFormDirty(true);
    setForm((prev) => {
      const exists = prev.enabledSkills.includes(skillName);
      if (exists) {
        return {
          ...prev,
          enabledSkills: prev.enabledSkills.filter((name) => name !== skillName)
        };
      }
      return { ...prev, enabledSkills: [...prev.enabledSkills, skillName] };
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card title="Agents">
        <div className="space-y-3">
          <Button className="w-full" onClick={handleNewAgent}>
            Create Agent
          </Button>
          <div className="space-y-2 text-sm">
            {agents.length === 0 && (
              <div className="text-slate-500">No agents yet.</div>
            )}
            {agents.map((agent) => (
              <button
                key={agent.name}
                className={`w-full rounded border px-3 py-2 text-left transition ${
                  selectedAgentName === agent.name && !isCreating
                    ? "border-blue-500 bg-slate-800"
                    : "border-slate-800 bg-slate-950 hover:bg-slate-900"
                }`}
                onClick={() => handleSelectAgent(agent.name)}
              >
                <div className="text-slate-200">{agent.name}</div>
                <div className="text-xs text-slate-500">{agent.runtimeState}</div>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card title={isCreating ? "Create Agent Details" : "Agent Details"}>
        {!isCreating && !selectedAgent ? (
          <div className="text-sm text-slate-500">
            Select an existing agent or create a new one.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="text-sm text-slate-400">Name</div>
              <Input
                value={form.name}
                disabled={!isCreating}
                onChange={(e) => {
                  setIsFormDirty(true);
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
                  setForm((prev) => ({ ...prev, workspacePath: e.target.value }));
                }}
                placeholder=".orgops-data/workspaces/agent-name"
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm text-slate-400">Enabled skills</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {skills.map((skill) => (
                  <label
                    key={skill.path}
                    className="flex items-start gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-2 text-sm text-slate-300"
                  >
                    <input
                      type="checkbox"
                      checked={form.enabledSkills.includes(skill.name)}
                      onChange={() => toggleSkill(skill.name)}
                      className="mt-0.5"
                    />
                    <span className="leading-tight">
                      <span className="block text-slate-200">{skill.name}</span>
                      <span className="text-xs text-slate-500">{skill.description}</span>
                    </span>
                  </label>
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
                  setForm((prev) => ({ ...prev, soulContents: e.target.value }));
                }}
                placeholder="System-level guidance and behavior instructions."
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleSubmit}
                disabled={
                  !form.name.trim() || !form.modelId.trim() || !form.workspacePath.trim()
                }
              >
                {isCreating ? "Create Agent" : "Save Details"}
              </Button>
              {!isCreating && selectedAgent && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => onStartAgent(selectedAgent.name)}
                  >
                    Start
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => onStopAgent(selectedAgent.name)}
                  >
                    Stop
                  </Button>
                  <Button
                    variant="secondary"
                    className="bg-amber-900 hover:bg-amber-800 text-amber-100"
                    onClick={async () => {
                      const confirmed = confirm(
                        `Clean workspace for ${selectedAgent.name}? This deletes all files in ${form.workspacePath}.`
                      );
                      if (!confirmed) return;
                      await onCleanupAgentWorkspace(selectedAgent.name);
                    }}
                  >
                    Clean Workspace
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
