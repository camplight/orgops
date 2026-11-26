import { useEffect, useMemo, useState } from "react";
import { apiFetch, getApiHeaders } from "../api";
import { Button, Card, Input, Label, Select, Textarea } from "../components/ui";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { Agent, Channel } from "../types";
import { formatTimestamp } from "../utils/formatTimestamp";

type ScheduleStatus = "ACTIVE" | "PAUSED";
type MisfirePolicy = "FIRE_ONCE" | "SKIP" | "CATCH_UP";

type Schedule = {
  id: string;
  name?: string;
  channelId: string;
  targetAgentName: string;
  cronExpression: string;
  timezone: string;
  text: string;
  payload: Record<string, unknown>;
  status: ScheduleStatus;
  misfirePolicy: MisfirePolicy;
  nextFireAt: number;
  lastOccurrenceAt?: number;
  lastError?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
};

type SchedulesScreenProps = {
  agents: Agent[];
  channels: Channel[];
};

const MISFIRE_POLICIES: MisfirePolicy[] = ["FIRE_ONCE", "SKIP", "CATCH_UP"];

function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Request failed";
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    // The API sometimes returns a plain-text body.
  }
  return error.message || "Request failed";
}

function channelLabel(channel: Channel) {
  return channel.name?.trim() ? `${channel.name} (${channel.id})` : channel.id;
}

function scheduleTitle(schedule: Schedule) {
  return schedule.name?.trim() || schedule.cronExpression;
}

export function SchedulesScreen({ agents, channels }: SchedulesScreenProps) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeScheduleId, setActiveScheduleId] = useState<string | null>(null);
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [name, setName] = useState("");
  const [channelId, setChannelId] = useState("");
  const [targetAgentName, setTargetAgentName] = useState("");
  const [cronExpression, setCronExpression] = useState("0 * * * *");
  const [timezone, setTimezone] = useState("UTC");
  const [misfirePolicy, setMisfirePolicy] = useState<MisfirePolicy>("FIRE_ONCE");
  const [text, setText] = useState("");
  const [payloadText, setPayloadText] = useState("");

  const channelById = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel])),
    [channels],
  );
  const agentOptions = useMemo(() => {
    const channel = channelById.get(channelId);
    const participantNames = new Set(
      (channel?.participants ?? [])
        .filter((participant) => participant.subscriberType === "AGENT")
        .map((participant) => participant.subscriberId),
    );
    return agents
      .map((agent) => agent.name)
      .filter((agentName) => participantNames.has(agentName))
      .sort((left, right) => left.localeCompare(right));
  }, [agents, channelById, channelId]);
  const selectedSchedule = schedules.find((schedule) => schedule.id === activeScheduleId) ?? null;

  async function loadSchedules() {
    const rows = await apiFetch("/api/schedules").then(
      (response) => response.json() as Promise<Schedule[]>,
    );
    setSchedules(
      [...rows].sort((left, right) => (left.nextFireAt ?? 0) - (right.nextFireAt ?? 0)),
    );
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadSchedules()
      .catch((loadError) => {
        if (!cancelled) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!channelId && channels[0]) setChannelId(channels[0].id);
  }, [channelId, channels]);

  useEffect(() => {
    if (targetAgentName && agentOptions.includes(targetAgentName)) return;
    setTargetAgentName(agentOptions[0] ?? "");
  }, [agentOptions, targetAgentName]);

  useEscapeKey(createDrawerOpen || Boolean(selectedSchedule), () => {
    if (selectedSchedule) {
      setActiveScheduleId(null);
      return;
    }
    if (createDrawerOpen) setCreateDrawerOpen(false);
  });

  const openCreateDrawer = () => {
    setActiveScheduleId(null);
    setError(null);
    setCreateDrawerOpen(true);
  };

  const openScheduleDrawer = (scheduleId: string) => {
    setCreateDrawerOpen(false);
    setError(null);
    setActiveScheduleId(scheduleId);
  };

  async function createSchedule() {
    setError(null);
    const trimmedText = text.trim();
    if (!channelId || !targetAgentName || !cronExpression.trim() || !trimmedText) {
      setError("Channel, agent, cron expression, and message are required.");
      return;
    }
    let payload: Record<string, unknown> | undefined;
    const rawPayload = payloadText.trim();
    if (rawPayload) {
      try {
        const parsed = JSON.parse(rawPayload) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setError("Payload must be a JSON object.");
          return;
        }
        payload = parsed as Record<string, unknown>;
      } catch {
        setError("Payload is not valid JSON.");
        return;
      }
    }
    setSaving(true);
    try {
      const response = await apiFetch("/api/schedules", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          ...(name.trim() ? { name: name.trim() } : {}),
          channelId,
          targetAgentName,
          cronExpression: cronExpression.trim(),
          timezone: timezone.trim() || "UTC",
          text: trimmedText,
          misfirePolicy,
          ...(payload ? { payload } : {}),
        }),
      });
      const created = (await response.json()) as Schedule;
      setName("");
      setText("");
      setPayloadText("");
      setCreateDrawerOpen(false);
      await loadSchedules();
      if (created?.id) setActiveScheduleId(created.id);
    } catch (createError) {
      setError(errorMessage(createError));
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(schedule: Schedule, status: ScheduleStatus) {
    setError(null);
    setBusyId(schedule.id);
    try {
      await apiFetch(`/api/schedules/${encodeURIComponent(schedule.id)}`, {
        method: "PATCH",
        headers: getApiHeaders(),
        body: JSON.stringify({ status, version: schedule.version }),
      });
      await loadSchedules();
    } catch (updateError) {
      setError(errorMessage(updateError));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteSchedule(schedule: Schedule) {
    const label = scheduleTitle(schedule);
    if (!window.confirm(`Delete schedule "${label}"?`)) return;
    setError(null);
    setBusyId(schedule.id);
    try {
      await apiFetch(`/api/schedules/${encodeURIComponent(schedule.id)}`, {
        method: "DELETE",
      });
      if (activeScheduleId === schedule.id) setActiveScheduleId(null);
      await loadSchedules();
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setBusyId(null);
    }
  }

  const selectedChannel = selectedSchedule
    ? channelById.get(selectedSchedule.channelId)
    : undefined;
  const selectedPayload =
    selectedSchedule && Object.keys(selectedSchedule.payload ?? {}).length > 0
      ? JSON.stringify(selectedSchedule.payload, null, 2)
      : "";

  return (
    <div className="space-y-4">
      <Card title={`Schedules (${schedules.length})`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            Click a schedule to open details. Each fire posts an{" "}
            <code>agent.scheduled.trigger</code>.
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                void loadSchedules().catch((loadError) => setError(errorMessage(loadError)))
              }
            >
              Refresh
            </Button>
            <Button onClick={openCreateDrawer}>New schedule</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-300">
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Agent</th>
                <th className="px-2 py-2">Channel</th>
                <th className="px-2 py-2">Cron</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Next fire</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((schedule) => {
                const channel = channelById.get(schedule.channelId);
                return (
                  <tr
                    key={schedule.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${scheduleTitle(schedule)}`}
                    className={`cursor-pointer border-b border-slate-900 align-top hover:bg-slate-900/40 ${
                      activeScheduleId === schedule.id ? "bg-slate-900/70" : ""
                    }`}
                    onClick={() => openScheduleDrawer(schedule.id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openScheduleDrawer(schedule.id);
                    }}
                  >
                    <td className="whitespace-nowrap px-2 py-2 text-slate-200">
                      {scheduleTitle(schedule)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-300">
                      {schedule.targetAgentName}
                    </td>
                    <td className="max-w-[240px] truncate px-2 py-2 text-slate-400">
                      {channel?.name?.trim() || schedule.channelId}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-xs text-slate-400">
                      {schedule.cronExpression}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          schedule.status === "ACTIVE"
                            ? "bg-emerald-900/40 text-emerald-300"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {schedule.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-500">
                      {formatTimestamp(schedule.nextFireAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loading ? (
            <div className="py-8 text-center text-slate-500">Loading schedules...</div>
          ) : null}
          {!loading && schedules.length === 0 ? (
            <div className="py-8 text-center text-slate-500">No recurring schedules yet.</div>
          ) : null}
        </div>
      </Card>

      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity lg:left-56 ${
          createDrawerOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setCreateDrawerOpen(false)}
      />
      <aside
        className={`fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-md flex-col border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-300 ${
          createDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!createDrawerOpen}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-100">New schedule</h3>
          <Button
            type="button"
            variant="secondary"
            className="px-2 py-1 text-xs"
            onClick={() => setCreateDrawerOpen(false)}
          >
            Close
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4">
          <div className="text-sm text-slate-400">
            Recurring cron trigger for one agent in one channel.
          </div>
          <Label>
            Name
            <Input
              className="mt-1"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Hourly digest"
            />
          </Label>
          <Label>
            Channel
            <Select
              className="mt-1"
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
            >
              {channels.length === 0 ? <option value="">No channels</option> : null}
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channelLabel(channel)}
                </option>
              ))}
            </Select>
          </Label>
          <Label>
            Agent
            <Select
              className="mt-1"
              value={targetAgentName}
              onChange={(event) => setTargetAgentName(event.target.value)}
              disabled={agentOptions.length === 0}
            >
              {agentOptions.length === 0 ? (
                <option value="">No agent participants</option>
              ) : (
                agentOptions.map((agentName) => (
                  <option key={agentName} value={agentName}>
                    {agentName}
                  </option>
                ))
              )}
            </Select>
          </Label>
          <Label>
            Cron
            <Input
              className="mt-1 font-mono"
              value={cronExpression}
              onChange={(event) => setCronExpression(event.target.value)}
              placeholder="0 * * * *"
            />
          </Label>
          <Label>
            Timezone
            <Input
              className="mt-1"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="UTC"
            />
          </Label>
          <Label>
            Missed runs
            <Select
              className="mt-1"
              value={misfirePolicy}
              onChange={(event) => setMisfirePolicy(event.target.value as MisfirePolicy)}
            >
              {MISFIRE_POLICIES.map((policy) => (
                <option key={policy} value={policy}>
                  {policy}
                </option>
              ))}
            </Select>
          </Label>
          <Label>
            Message
            <Textarea
              className="mt-1"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              placeholder="Check the inbox and post a summary."
            />
          </Label>
          <Label>
            Extra payload JSON
            <Textarea
              className="mt-1 font-mono"
              value={payloadText}
              onChange={(event) => setPayloadText(event.target.value)}
              rows={3}
              placeholder='{"source":"crm"}'
            />
          </Label>
          {error && createDrawerOpen ? <div className="text-sm text-rose-400">{error}</div> : null}
        </div>
        <div className="border-t border-slate-800 px-4 py-3">
          <Button
            onClick={() => void createSchedule()}
            disabled={saving || agentOptions.length === 0}
          >
            {saving ? "Saving..." : "Create"}
          </Button>
        </div>
      </aside>

      <div
        className={`pointer-events-none fixed inset-0 z-50 flex justify-end lg:left-56 ${
          selectedSchedule ? "" : "invisible"
        }`}
      >
        <div
          className={`pointer-events-auto flex h-full w-full max-w-2xl flex-col border-l border-slate-800 bg-slate-950/95 shadow-2xl transition-transform duration-300 ${
            selectedSchedule ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                {selectedSchedule ? scheduleTitle(selectedSchedule) : "No schedule selected"}
              </h3>
              <p className="text-sm text-slate-500">
                {selectedSchedule
                  ? `${selectedSchedule.targetAgentName} · ${selectedSchedule.status}`
                  : "Select a schedule to view details."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs"
                disabled={!selectedSchedule || busyId === selectedSchedule.id}
                onClick={() =>
                  selectedSchedule &&
                  void setStatus(
                    selectedSchedule,
                    selectedSchedule.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
                  )
                }
              >
                {selectedSchedule?.status === "ACTIVE" ? "Pause" : "Resume"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs text-rose-300 hover:text-rose-200"
                disabled={!selectedSchedule || busyId === selectedSchedule.id}
                onClick={() => selectedSchedule && void deleteSchedule(selectedSchedule)}
              >
                Delete
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={() => setActiveScheduleId(null)}
              >
                Close
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4 text-sm text-slate-300">
            {selectedSchedule ? (
              <div className="space-y-3 rounded border border-slate-800 bg-slate-950 p-3">
                <div>
                  <span className="text-slate-500">Cron:</span>{" "}
                  <span className="font-mono">{selectedSchedule.cronExpression}</span>
                </div>
                <div>
                  <span className="text-slate-500">Timezone:</span> {selectedSchedule.timezone}
                </div>
                <div>
                  <span className="text-slate-500">Missed runs:</span>{" "}
                  {selectedSchedule.misfirePolicy}
                </div>
                <div className="break-all">
                  <span className="text-slate-500">Channel:</span>{" "}
                  {selectedChannel ? channelLabel(selectedChannel) : selectedSchedule.channelId}
                </div>
                <div>
                  <span className="text-slate-500">Agent:</span> {selectedSchedule.targetAgentName}
                </div>
                <div>
                  <span className="text-slate-500">Next fire:</span>{" "}
                  {formatTimestamp(selectedSchedule.nextFireAt)}
                </div>
                <div>
                  <span className="text-slate-500">Last fire:</span>{" "}
                  {typeof selectedSchedule.lastOccurrenceAt === "number"
                    ? formatTimestamp(selectedSchedule.lastOccurrenceAt)
                    : "Never"}
                </div>
                <div>
                  <span className="text-slate-500">Message:</span>
                  <p className="mt-1 whitespace-pre-wrap text-slate-200">{selectedSchedule.text}</p>
                </div>
                {selectedPayload ? (
                  <div>
                    <span className="text-slate-500">Payload:</span>
                    <pre className="mt-1 overflow-auto rounded bg-slate-900 p-2 font-mono text-xs text-slate-300">
                      {selectedPayload}
                    </pre>
                  </div>
                ) : null}
                {selectedSchedule.lastError ? (
                  <div className="text-rose-400">
                    <span className="text-slate-500">Last error:</span> {selectedSchedule.lastError}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-slate-500">Select a schedule to view details.</div>
            )}
          </div>
          {error && selectedSchedule ? (
            <div className="shrink-0 border-t border-slate-800 px-4 py-2 text-sm text-rose-400">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      {selectedSchedule ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:left-56"
          onClick={() => setActiveScheduleId(null)}
        />
      ) : null}
      {error && !selectedSchedule && !createDrawerOpen ? (
        <div className="text-sm text-rose-400">{error}</div>
      ) : null}
    </div>
  );
}
