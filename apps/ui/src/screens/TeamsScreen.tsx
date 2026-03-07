import { useEffect, useMemo, useRef, useState } from "react";
import type { Agent, Human, Team, TeamMember } from "../types";
import { Button, Card, Input, Select } from "../components/ui";

type TeamsScreenProps = {
  teams: Team[];
  agents: Agent[];
  humans: Human[];
  onCreateTeam: (team: { name: string }) => Promise<string>;
  onRenameTeam: (teamId: string, name: string) => Promise<void>;
  onDeleteTeam: (teamId: string) => Promise<void>;
  onLoadMembers: (teamId: string) => Promise<TeamMember[]>;
  onAddMember: (teamId: string, memberType: string, memberId: string) => Promise<void>;
  onRemoveMember: (teamId: string, memberType: string, memberId: string) => Promise<void>;
};

export function TeamsScreen({
  teams,
  agents,
  humans,
  onCreateTeam,
  onRenameTeam,
  onDeleteTeam,
  onLoadMembers,
  onAddMember,
  onRemoveMember
}: TeamsScreenProps) {
  const [newTeamName, setNewTeamName] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedMemberType, setSelectedMemberType] = useState<"AGENT" | "HUMAN">("AGENT");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [editedTeamName, setEditedTeamName] = useState("");
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [copiedTeamId, setCopiedTeamId] = useState(false);
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [removingMemberKey, setRemovingMemberKey] = useState<string | null>(null);
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeamSnapshot, setSelectedTeamSnapshot] = useState<Team | null>(null);
  const loadMembersRef = useRef(onLoadMembers);

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;
  const isDetailsOpen = selectedTeamId !== null;
  const teamDetails = selectedTeam ?? selectedTeamSnapshot;
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
  const selectedTeamHumans = useMemo(
    () =>
      new Set(
        members
          .filter((member) => member.memberType === "HUMAN")
          .map((member) => member.memberId)
      ),
    [members]
  );
  const availableHumans = useMemo(
    () => humans.filter((human) => !selectedTeamHumans.has(human.username)),
    [humans, selectedTeamHumans]
  );
  const availableMemberOptions = selectedMemberType === "AGENT" ? availableAgents : availableHumans;
  const noMembersMessage =
    selectedMemberType === "AGENT" ? "All agents already added" : "All humans already added";

  const handleCreateTeam = async () => {
    setError(null);
    const name = newTeamName.trim();
    if (!name) {
      setError("Team name is required.");
      return;
    }
    const teamId = await onCreateTeam({ name });
    setNewTeamName("");
    setSelectedTeamId(teamId);
    setCreateDrawerOpen(false);
  };

  useEffect(() => {
    if (!selectedTeamId) {
      setSelectedTeamSnapshot(null);
      return;
    }
    if (selectedTeam) {
      setSelectedTeamSnapshot(selectedTeam);
    }
  }, [selectedTeam, selectedTeamId]);

  useEffect(() => {
    if (!selectedTeam) {
      setMembers([]);
      setSelectedMemberId("");
      return;
    }
    setEditedTeamName(selectedTeam.name);
  }, [selectedTeam]);

  useEffect(() => {
    loadMembersRef.current = onLoadMembers;
  }, [onLoadMembers]);

  useEffect(() => {
    if (!selectedTeamId) return;
    let active = true;
    setIsLoadingMembers(true);
    setError(null);
    loadMembersRef.current(selectedTeamId)
      .then((list) => {
        if (!active) return;
        setMembers(list);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        const message =
          loadError instanceof Error ? loadError.message : "Failed to load team members.";
        setError(message);
      })
      .finally(() => {
        if (!active) return;
        setIsLoadingMembers(false);
      });
    return () => {
      active = false;
    };
  }, [selectedTeamId]);

  useEffect(() => {
    if (!selectedMemberId) {
      const firstId =
        selectedMemberType === "AGENT"
          ? availableAgents[0]?.name ?? ""
          : availableHumans[0]?.username ?? "";
      if (firstId) {
        setSelectedMemberId(firstId);
      }
      return;
    }
    const stillAvailable =
      selectedMemberType === "AGENT"
        ? availableAgents.some((agent) => agent.name === selectedMemberId)
        : availableHumans.some((human) => human.username === selectedMemberId);
    if (!stillAvailable) {
      const fallbackId =
        selectedMemberType === "AGENT"
          ? availableAgents[0]?.name ?? ""
          : availableHumans[0]?.username ?? "";
      setSelectedMemberId(fallbackId);
    }
  }, [
    availableAgents,
    availableHumans,
    selectedMemberId,
    selectedMemberType
  ]);

  const handleSaveTeamName = async () => {
    setError(null);
    if (!selectedTeam) return;
    const name = editedTeamName.trim();
    if (!name || name === selectedTeam.name) return;
    setRenaming(true);
    try {
      await onRenameTeam(selectedTeam.id, name);
    } catch (renameError) {
      const message =
        renameError instanceof Error ? renameError.message : "Failed to rename team.";
      setError(message);
    } finally {
      setRenaming(false);
    }
  };

  const handleAddTeamMember = async () => {
    setError(null);
    if (!selectedTeam || !selectedMemberId) return;
    setAddingMember(true);
    try {
      await onAddMember(selectedTeam.id, selectedMemberType, selectedMemberId);
      const list = await loadMembersRef.current(selectedTeam.id);
      setMembers(list);
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : "Failed to add team member.";
      setError(message);
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveTeamMember = async (memberType: string, memberId: string) => {
    setError(null);
    if (!selectedTeam) return;
    const memberKey = `${memberType}:${memberId}`;
    setRemovingMemberKey(memberKey);
    try {
      await onRemoveMember(selectedTeam.id, memberType, memberId);
      const list = await loadMembersRef.current(selectedTeam.id);
      setMembers(list);
    } catch (removeError) {
      const message =
        removeError instanceof Error ? removeError.message : "Failed to remove team member.";
      setError(message);
    } finally {
      setRemovingMemberKey(null);
    }
  };

  const handleCopyTeamId = async () => {
    if (!selectedTeam) return;
    await navigator.clipboard.writeText(selectedTeam.id);
    setCopiedTeamId(true);
    setTimeout(() => setCopiedTeamId(false), 1200);
  };

  const handleDeleteTeam = async () => {
    setError(null);
    if (!selectedTeam) return;
    const confirmed = window.confirm(
      `Delete team "${selectedTeam.name}"? This cannot be undone.`
    );
    if (!confirmed) return;
    setDeletingTeamId(selectedTeam.id);
    try {
      await onDeleteTeam(selectedTeam.id);
      setSelectedTeamId(null);
      setMembers([]);
      setEditedTeamName("");
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "Failed to delete team.";
      setError(message);
    } finally {
      setDeletingTeamId(null);
    }
  };

  const handleSelectTeam = (teamId: string) => {
    setError(null);
    setSelectedTeamId(teamId);
  };

  return (
    <div className="space-y-4">
      <Card title={`Teams (${teams.length})`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">Click a team row to open details.</div>
          <Button onClick={() => setCreateDrawerOpen(true)}>New team</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-300">
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Description</th>
                <th className="px-2 py-2">ID</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr
                  key={team.id}
                  className={`cursor-pointer border-b border-slate-900 align-top hover:bg-slate-900/40 ${
                    selectedTeamId === team.id ? "bg-slate-900/70" : ""
                  }`}
                  onClick={() => handleSelectTeam(team.id)}
                >
                  <td className="whitespace-nowrap px-2 py-2 text-slate-200">{team.name}</td>
                  <td className="max-w-[520px] px-2 py-2 text-slate-400">
                    {team.description || "No description"}
                  </td>
                  <td className="max-w-[320px] truncate px-2 py-2 text-xs text-slate-500">
                    {team.id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {teams.length === 0 && (
            <div className="py-8 text-center text-slate-500">No teams found.</div>
          )}
        </div>
      </Card>

      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity lg:left-56 ${
          createDrawerOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setCreateDrawerOpen(false)}
      />
      <aside
        className={`fixed bottom-0 right-0 top-0 z-50 w-full max-w-md border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-300 ${
          createDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!createDrawerOpen}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-100">Create Team</h3>
            <Button
              type="button"
              variant="secondary"
              className="px-2 py-1 text-xs"
              onClick={() => setCreateDrawerOpen(false)}
            >
              Close
            </Button>
          </div>
          <div className="space-y-3 px-4 py-4">
            <Input
              placeholder="Team name"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
            />
            {error && <div className="text-sm text-rose-400">{error}</div>}
          </div>
          <div className="mt-auto border-t border-slate-800 px-4 py-3">
            <Button onClick={handleCreateTeam}>Create</Button>
          </div>
        </div>
      </aside>

      <div
        className={`pointer-events-none fixed inset-0 z-50 flex justify-end lg:left-56 ${
          isDetailsOpen ? "" : "invisible"
        }`}
      >
        <div
          className={`pointer-events-auto flex h-full w-full max-w-3xl flex-col border-l border-slate-800 bg-slate-950/95 shadow-2xl transition-transform duration-300 ${
            isDetailsOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                {teamDetails ? teamDetails.name : "No team selected"}
              </h3>
              <p className="text-sm text-slate-500">
                {teamDetails
                  ? teamDetails.description || "No description"
                  : "Select a team to view details."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs text-rose-300 hover:text-rose-200"
                onClick={handleDeleteTeam}
                disabled={!teamDetails || deletingTeamId === teamDetails.id}
              >
                Delete Team
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={() => setSelectedTeamId(null)}
              >
                Close
              </Button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 overflow-auto px-4 py-4 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-2 rounded border border-slate-800 bg-slate-950 p-3">
                <div className="text-sm text-slate-300">Team name</div>
                <div className="flex gap-2">
                  <Input
                    value={editedTeamName}
                    onChange={(e) => setEditedTeamName(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    onClick={handleSaveTeamName}
                    disabled={
                      renaming ||
                      !editedTeamName.trim() ||
                      editedTeamName.trim() === teamDetails?.name
                    }
                  >
                    Save
                  </Button>
                </div>
              </div>

              <div className="space-y-2 rounded border border-slate-800 bg-slate-950 p-3">
                <div className="text-sm text-slate-300">Team ID</div>
                <div className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                  <span className="truncate pr-2">{teamDetails?.id}</span>
                  <Button variant="secondary" onClick={handleCopyTeamId} disabled={!teamDetails}>
                    {copiedTeamId ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2 rounded border border-slate-800 bg-slate-950 p-3">
                <div className="text-sm text-slate-300">Add team members</div>
                <div className="flex gap-2">
                  <Select
                    value={selectedMemberType}
                    onChange={(e) => setSelectedMemberType(e.target.value as "AGENT" | "HUMAN")}
                    disabled={addingMember}
                  >
                    <option value="AGENT">Agent</option>
                    <option value="HUMAN">Human</option>
                  </Select>
                  <Select
                    value={selectedMemberId}
                    onChange={(e) => setSelectedMemberId(e.target.value)}
                    disabled={availableMemberOptions.length === 0 || addingMember}
                  >
                    {availableMemberOptions.length === 0 ? (
                      <option value="">{noMembersMessage}</option>
                    ) : (
                      <>
                        {selectedMemberType === "AGENT"
                          ? availableAgents.map((agent) => (
                              <option key={agent.name} value={agent.name}>
                                {agent.name}
                              </option>
                            ))
                          : availableHumans.map((human) => (
                              <option key={human.id} value={human.username}>
                                {human.username}
                              </option>
                            ))}
                      </>
                    )}
                  </Select>
                  <Button
                    onClick={handleAddTeamMember}
                    disabled={availableMemberOptions.length === 0 || !selectedMemberId || addingMember}
                  >
                    Add Member
                  </Button>
                </div>
              </div>

              <div className="space-y-2 rounded border border-slate-800 bg-slate-950 p-3">
                <div className="text-sm text-slate-300">Team members</div>
                {isLoadingMembers ? (
                  <div className="text-sm text-slate-500">Loading members...</div>
                ) : members.length === 0 ? (
                  <div className="text-sm text-slate-500">No members yet.</div>
                ) : (
                  <div className="space-y-2 text-sm">
                    {members.map((member) => (
                      <div
                        key={`${member.memberType}:${member.memberId}`}
                        className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 text-slate-300"
                      >
                        <div>
                          {member.memberId}
                          <span className="ml-2 text-xs uppercase text-slate-500">
                            {member.memberType}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="rounded px-2 text-rose-300 hover:bg-slate-800 hover:text-rose-200 disabled:opacity-50"
                          onClick={() =>
                            handleRemoveTeamMember(member.memberType, member.memberId)
                          }
                          disabled={
                            removingMemberKey ===
                            `${member.memberType}:${member.memberId}`
                          }
                          aria-label={`Remove ${member.memberId} from team`}
                          title={`Remove ${member.memberId}`}
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {error && isDetailsOpen ? (
            <div className="shrink-0 border-t border-slate-800 px-4 py-2 text-sm text-rose-400">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      {isDetailsOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:left-56"
          onClick={() => setSelectedTeamId(null)}
        />
      )}

      {error && !isDetailsOpen && !createDrawerOpen ? (
        <div className="text-sm text-rose-400">{error}</div>
      ) : null}
    </div>
  );
}
