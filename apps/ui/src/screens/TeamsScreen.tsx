import { useEffect, useMemo, useState } from "react";
import type { Agent, Team, TeamMember } from "../types";
import { Button, Card, Input, Select } from "../components/ui";

type TeamsScreenProps = {
  teams: Team[];
  agents: Agent[];
  onCreateTeam: (team: { name: string }) => Promise<string>;
  onRenameTeam: (teamId: string, name: string) => Promise<void>;
  onDeleteTeam: (teamId: string) => Promise<void>;
  onLoadMembers: (teamId: string) => Promise<TeamMember[]>;
  onAddMember: (teamId: string, memberType: string, memberId: string) => Promise<void>;
};

export function TeamsScreen({
  teams,
  agents,
  onCreateTeam,
  onRenameTeam,
  onDeleteTeam,
  onLoadMembers,
  onAddMember
}: TeamsScreenProps) {
  const [newTeamName, setNewTeamName] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [editedTeamName, setEditedTeamName] = useState("");
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [copiedTeamId, setCopiedTeamId] = useState(false);

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;
  const selectedTeamAgents = useMemo(
    () =>
      new Set(
        members
          .filter((member) => member.memberType === "AGENT")
          .map((member) => member.memberId)
      ),
    [members]
  );
  const availableAgents = useMemo(
    () => agents.filter((agent) => !selectedTeamAgents.has(agent.name)),
    [agents, selectedTeamAgents]
  );

  const handleCreateTeam = async () => {
    const name = newTeamName.trim();
    if (!name) return;
    const teamId = await onCreateTeam({ name });
    setNewTeamName("");
    setSelectedTeamId(teamId);
  };

  useEffect(() => {
    if (!selectedTeam) {
      setMembers([]);
      setSelectedAgentId("");
      return;
    }
    setEditedTeamName(selectedTeam.name);
  }, [selectedTeam]);

  useEffect(() => {
    if (!selectedTeamId) return;
    let active = true;
    setIsLoadingMembers(true);
    onLoadMembers(selectedTeamId)
      .then((list) => {
        if (!active) return;
        setMembers(list);
      })
      .finally(() => {
        if (!active) return;
        setIsLoadingMembers(false);
      });
    return () => {
      active = false;
    };
  }, [selectedTeamId, onLoadMembers]);

  useEffect(() => {
    if (!selectedAgentId && availableAgents.length > 0) {
      setSelectedAgentId(availableAgents[0].name);
      return;
    }
    const stillAvailable = availableAgents.some(
      (agent) => agent.name === selectedAgentId
    );
    if (!stillAvailable) {
      setSelectedAgentId(availableAgents[0]?.name ?? "");
    }
  }, [availableAgents, selectedAgentId]);

  const handleSaveTeamName = async () => {
    if (!selectedTeam) return;
    const name = editedTeamName.trim();
    if (!name || name === selectedTeam.name) return;
    await onRenameTeam(selectedTeam.id, name);
  };

  const handleAddAgentMember = async () => {
    if (!selectedTeam || !selectedAgentId) return;
    await onAddMember(selectedTeam.id, "AGENT", selectedAgentId);
    const list = await onLoadMembers(selectedTeam.id);
    setMembers(list);
  };

  const handleCopyTeamId = async () => {
    if (!selectedTeam) return;
    await navigator.clipboard.writeText(selectedTeam.id);
    setCopiedTeamId(true);
    setTimeout(() => setCopiedTeamId(false), 1200);
  };

  const handleDeleteTeam = async () => {
    if (!selectedTeam) return;
    const confirmed = window.confirm(
      `Delete team "${selectedTeam.name}"? This cannot be undone.`
    );
    if (!confirmed) return;
    await onDeleteTeam(selectedTeam.id);
    setSelectedTeamId("");
    setMembers([]);
    setEditedTeamName("");
  };

  return (
    <div className="space-y-6">
      <Card title="Team Management">
        <div className="space-y-2">
          <div className="text-sm text-slate-400">Create a team</div>
          <Input
            placeholder="Team name"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
          />
          <Button onClick={handleCreateTeam} disabled={!newTeamName.trim()}>
            Create Team
          </Button>
        </div>

        <div className="pt-2 space-y-2">
          <div className="text-sm text-slate-400">Or select a team</div>
          <Select
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
          >
            <option value="">Select a team</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {selectedTeam && (
        <Card title="Team Details">
          <div className="space-y-2">
            <div className="text-sm text-slate-400">Team name</div>
            <div className="flex gap-2">
              <Input
                value={editedTeamName}
                onChange={(e) => setEditedTeamName(e.target.value)}
              />
              <Button
                variant="secondary"
                onClick={handleSaveTeamName}
                disabled={!editedTeamName.trim() || editedTeamName.trim() === selectedTeam.name}
              >
                Save
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm text-slate-400">Team ID</div>
            <div className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
              <span>{selectedTeam.id}</span>
              <Button variant="secondary" onClick={handleCopyTeamId}>
                {copiedTeamId ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm text-slate-400">Delete team</div>
            <Button variant="secondary" onClick={handleDeleteTeam}>
              Delete Team
            </Button>
          </div>

          <div className="space-y-2">
            <div className="text-sm text-slate-400">Add team members (agents)</div>
            <div className="flex gap-2">
              <Select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                disabled={availableAgents.length === 0}
              >
                {availableAgents.length === 0 ? (
                  <option value="">All agents already added</option>
                ) : (
                  availableAgents.map((agent) => (
                    <option key={agent.name} value={agent.name}>
                      {agent.name}
                    </option>
                  ))
                )}
              </Select>
              <Button
                onClick={handleAddAgentMember}
                disabled={availableAgents.length === 0 || !selectedAgentId}
              >
                Add Member
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm text-slate-400">Team members</div>
            {isLoadingMembers ? (
              <div className="text-sm text-slate-500">Loading members...</div>
            ) : members.length === 0 ? (
              <div className="text-sm text-slate-500">No members yet.</div>
            ) : (
              <div className="space-y-2 text-sm">
                {members.map((member) => (
                  <div
                    key={`${member.memberType}:${member.memberId}`}
                    className="rounded border border-slate-800 px-3 py-2 text-slate-300"
                  >
                    {member.memberId}
                    <span className="ml-2 text-xs uppercase text-slate-500">
                      {member.memberType}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
