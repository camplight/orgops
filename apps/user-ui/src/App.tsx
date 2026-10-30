import {
  FormEvent,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { apiFetch, apiJson, getApiHeaders } from "./api";
import { wsUrl } from "./config";
import type { Agent, AuthMe, Channel, ChannelParticipant, ChannelShare, EventRow, Team } from "./types";
import { CommandPalette, type PaletteChannel } from "./CommandPalette";
import { JsonRenderBlock } from "./JsonRenderBlock";
import { OrgopsSecretInput } from "./OrgopsSecretInput";
import { hasJsonRenderBlock, splitJsonRenderMarkdown } from "./jsonRenderMarkdown";
import { hasSecretInputBlock, splitSecretInputMarkdown } from "./secretInputMarkdown";
import {
  createLevelMeter,
  pickVoiceMimeType,
  voiceFileExtension
} from "./voice-capture";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Room, RoomEvent, Track } from "livekit-client";

const MARKDOWN_HINT_RE =
  /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)|`{1,3}[^`]|(\*\*|__)[^*_]+(\*\*|__)|(\*|_)[^*_]+(\*|_)|\[[^\]]+\]\([^)]+\)|!\[[^\]]*\]\([^)]+\)|(^|\n)\|.+\|/m;
const URL_RE = /(https?:\/\/[^\s<]+)/i;

function formatTime(value?: number) {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return new Intl.DateTimeFormat(undefined, {
    ...(isToday
      ? {}
      : {
          day: "numeric",
          month: "short",
          ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" })
        }),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function messageText(event: EventRow) {
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  if (event.type === "agent.turn.failed") {
    const error = (payload as { error?: unknown }).error;
    return typeof error === "string" ? `Agent error: ${error}` : "Agent failed to respond.";
  }
  const text = (payload as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

type SensitiveMessagePayload = {
  ciphertextB64: string;
  hint?: string;
  requiresPassword: boolean;
};

function sensitiveMessagePayload(event: EventRow): SensitiveMessagePayload | null {
  if (event.type !== "message.created") return null;
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const sensitiveRaw = (payload as { sensitive?: unknown }).sensitive;
  if (!sensitiveRaw || typeof sensitiveRaw !== "object" || Array.isArray(sensitiveRaw)) return null;
  const ciphertextB64 = (sensitiveRaw as { ciphertextB64?: unknown }).ciphertextB64;
  if (typeof ciphertextB64 !== "string" || !ciphertextB64.trim()) return null;
  const hint = (sensitiveRaw as { hint?: unknown }).hint;
  const requiresPasswordRaw = (sensitiveRaw as { requiresPassword?: unknown }).requiresPassword;
  return {
    ciphertextB64: ciphertextB64.trim(),
    hint: typeof hint === "string" && hint.trim() ? hint.trim() : undefined,
    requiresPassword: requiresPasswordRaw !== false
  };
}

function isHiddenUiActionMessage(event: EventRow) {
  if (event.type !== "message.created") return false;
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const payloadRecord = payload as { eventType?: unknown; text?: unknown };
  if (payloadRecord.eventType === "ui.json-render.action") return true;
  const text = typeof payloadRecord.text === "string" ? payloadRecord.text.trim() : "";
  return text.toLowerCase().startsWith("json-render action:");
}

function shouldRenderMarkdown(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return hasJsonRenderBlock(trimmed) || hasSecretInputBlock(trimmed) || MARKDOWN_HINT_RE.test(trimmed) || URL_RE.test(trimmed);
}

function sourceLabel(source: string) {
  if (source.startsWith("human:")) return source.slice("human:".length) || "Human";
  if (source.startsWith("agent:")) return source.slice("agent:".length) || "Agent";
  return source || "System";
}

function messageRole(source: string) {
  if (source.startsWith("human:")) return "human";
  if (source.startsWith("agent:")) return "agent";
  return "system";
}

function messageDisplayTime(event: EventRow) {
  return event.deliverAt ?? event.createdAt;
}

const DIRECT_CHANNEL_KINDS = new Set(["HUMAN_AGENT_DM", "AGENT_AGENT_DM", "DIRECT_GROUP"]);
const CHANNEL_GROUPS = [
  { id: "direct", label: "Direct messages" },
  { id: "channels", label: "Channels" },
  { id: "shared", label: "Shared channels" }
] as const;
const PINNED_CHANNELS_STORAGE_KEY = "orgops.user-ui.pinnedChannels";
const RECENT_CHANNELS_STORAGE_KEY = "orgops.user-ui.recentChannels";
const RECENT_CHANNELS_LIMIT = 20;
const LAYOUT_STORAGE_KEY = "orgops.user-ui.layout";
const SIDEBAR_DEFAULT_WIDTH = 280;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 520;
const SIDEBAR_RAIL_WIDTH = 72;

type ChannelGroupId = (typeof CHANNEL_GROUPS)[number]["id"];

type UploadedAttachment = {
  localId: string;
  fileId: string;
  name: string;
  mime: string;
  size: number;
  sha256?: string;
  kind?: "voice";
  durationMs?: number;
};

type PendingAttachment = {
  localId: string;
  name: string;
  mime: string;
  size: number;
  status: "uploading" | "ready" | "error";
  uploaded?: UploadedAttachment;
  error?: string;
};

type MessageAttachment = {
  fileId: string;
  name: string;
  mime?: string;
  size?: number;
  kind?: string;
  durationMs?: number;
};

type MessageVoiceMeta = {
  mode: "message" | "live" | "realtime";
  status: "transcribed" | "empty" | "failed";
  durationMs?: number;
  transcribedBy?: string;
  error?: string;
  chunkEventId?: string;
};

type PendingVoiceNote = {
  localId: string;
  channelId: string;
  mode: "message" | "live";
  status: "uploading" | "transcribing" | "error";
  chunkEventId?: string;
  durationMs?: number;
  error?: string;
};

type VoicePresenceParticipant = {
  sessionId: string;
  participantId: string;
  muted: boolean;
  startedAt: number;
};

type VoiceConfig = {
  transcription: { enabled: boolean; modelId: string | null };
  realtime?: { enabled: boolean; provider: string; rooms?: { enabled: boolean; broker: string; url?: string | null } };
};

type RealtimeCallResponse = { sdp: string; callId: string; model: string; agentName: string };
type VoiceRoomJoinResponse =
  | { broker: "direct-openai-calls"; mode: "client-multiplex"; roomName: string; sessionId: string }
  | {
      broker: "livekit";
      mode: "sfu";
      url: string;
      roomName: string;
      identity: string;
      token: string;
      sessionId: string;
      expiresAt: number;
    };

type LiveVoiceActivity = "connecting" | "listening" | "you" | "thinking" | "agent" | "tool";
type LiveVoiceMode = "room" | "direct";

const VOICE_MIN_RECORDING_MS = 450;
const VOICE_MAX_RECORDING_MS = 120_000;
const VOICE_PENDING_TIMEOUT_MS = 45_000;
const VOICE_PRESENCE_STALE_MS = 12 * 60 * 60 * 1000;
const VOICE_ACTIVE_SPEAKER_WINDOW_MS = 4_000;

type WsServerEventMessage = {
  type: "event";
  topic: string;
  data: EventRow;
};

function normalizedSubscriberType(participant: ChannelParticipant) {
  return participant.subscriberType.trim().toUpperCase();
}

function isDirectChannel(channel?: Channel | null) {
  return Boolean(channel?.kind && DIRECT_CHANNEL_KINDS.has(channel.kind.toUpperCase()));
}

function isHumanAgentDirectChannel(channel?: Channel | null) {
  return channel?.kind?.toUpperCase() === "HUMAN_AGENT_DM";
}

function channelHasHumanParticipant(channel: Channel, humanId: string) {
  return (channel.participants ?? []).some(
    (participant) =>
      normalizedSubscriberType(participant) === "HUMAN" && participant.subscriberId === humanId
  );
}

function isLifecycleChannel(channel: Channel) {
  return channel.name.toLowerCase().startsWith("agent.lifecycle.");
}

function lifecycleAgentName(channel: Channel) {
  return channel.name.slice("agent.lifecycle.".length) || channel.name;
}

function channelGroupId(channel: Channel): ChannelGroupId {
  if (isDirectChannel(channel)) return "direct";
  return "channels";
}

function isTraceEvent(event: EventRow) {
  return (
    event.type === "agent.turn.started" ||
    event.type === "agent.turn.phase" ||
    event.type === "agent.turn.completed" ||
    event.type === "agent.turn.failed" ||
    event.type === "wrapper.turn.started" ||
    event.type === "wrapper.turn.completed" ||
    event.type === "wrapper.turn.failed" ||
    event.type === "process.started" ||
    event.type === "process.output" ||
    event.type === "process.exited" ||
    event.type === "tool.started" ||
    event.type === "tool.executed" ||
    event.type === "tool.failed" ||
    event.type === "telemetry.context.window.updated"
  );
}

function shortJson(value: unknown) {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function traceTitle(event: EventRow) {
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
  if (event.type.startsWith("process.")) {
    if (event.type === "process.started") return "Wrapped process started";
    if (event.type === "process.exited") {
      const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : null;
      return exitCode === null ? "Wrapped process exited" : `Wrapped process exited (${exitCode})`;
    }
    if (event.type === "process.output") {
      const stream = typeof payload.stream === "string" ? payload.stream : "STDOUT";
      const seq = typeof payload.seq === "number" ? payload.seq : null;
      return seq === null ? `Wrapped output (${stream})` : `Wrapped output #${seq} (${stream})`;
    }
  }
  if (event.type.startsWith("wrapper.turn.")) {
    if (event.type === "wrapper.turn.started") return "Wrapped turn started";
    if (event.type === "wrapper.turn.completed") return "Wrapped turn completed";
    if (event.type === "wrapper.turn.failed") return "Wrapped turn failed";
  }
  if (event.type.startsWith("tool.")) {
    const toolName = typeof payload.tool === "string" ? payload.tool : "tool";
    const action = event.type === "tool.started" ? "started" : event.type === "tool.executed" ? "completed" : "failed";
    return `${toolName} ${action}`;
  }
  if (event.type === "agent.turn.started") return "Agent is thinking";
  if (event.type === "agent.turn.completed") return "Agent finished turn";
  if (event.type === "agent.turn.failed") return "Agent turn failed";
  if (event.type === "agent.turn.phase") {
    const phase = typeof payload.phase === "string" ? payload.phase : "progress";
    return `Agent phase: ${phase}`;
  }
  if (event.type === "telemetry.context.window.updated") {
    const used = typeof payload.estimatedUsedTokens === "number" ? payload.estimatedUsedTokens : null;
    const total = typeof payload.contextWindowTokens === "number" ? payload.contextWindowTokens : null;
    return used !== null && total !== null ? `Context usage: ${used}/${total} tokens` : "Context usage updated";
  }
  return event.type.replaceAll(".", " ");
}

function traceDetail(event: EventRow) {
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
  if (event.type === "process.output") {
    const text = typeof payload.text === "string" ? payload.text : "";
    return text || shortJson(event.payload);
  }
  if (event.type === "process.exited") {
    const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : null;
    return exitCode === null ? shortJson(event.payload) : `exitCode: ${exitCode}`;
  }
  if (event.type.startsWith("tool.")) {
    const args = shortJson(payload.args);
    const output = shortJson(payload.output);
    const error = typeof payload.error === "string" ? payload.error : "";
    return [args ? `args: ${args}` : "", output ? `output: ${output}` : "", error ? `error: ${error}` : ""]
      .filter(Boolean)
      .join("\n");
  }
  return shortJson(event.payload);
}

function turnFailureText(event: EventRow) {
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
  const error = typeof payload.error === "string" ? payload.error.trim() : "";
  return error || event.lastError?.trim() || "Agent turn failed.";
}

// Raw failure text comes from provider SDKs and external CLIs we don't control,
// so rules match loose keywords. Order matters: the first matching rule wins.
const TURN_FAILURE_RULES: Array<{ pattern: RegExp; title: string; message: string }> = [
  {
    pattern: /api[ _-]?key|authenticat|unauthori[sz]ed|\b40[13]\b/i,
    title: "Authentication failed",
    message: "The agent could not connect to its AI service because access is not configured. Contact your administrator."
  },
  {
    pattern: /invalid modelid|unsupported provider|nosuchmodel|model\b.*\b(does not exist|not found)|unsupported wrapped harness|missing wrappedconfig/i,
    title: "Invalid configuration",
    message: "The agent is not set up correctly and cannot respond. Contact your administrator."
  },
  {
    pattern: /\b429\b|rate limit|quota|insufficient|credit balance/i,
    title: "Usage limit reached",
    message:
      "The agent's AI service has reached its usage limit. Try again later. If the problem persists, contact your administrator."
  },
  {
    pattern: /\b(500|502|503|504|529)\b|overloaded|service unavailable|econnrefused|enotfound|fetch failed|cannot connect|retryerror/i,
    title: "Service unavailable",
    message: "The agent's AI service is temporarily unavailable. Try again in a few minutes."
  },
  {
    pattern: /timed out|timeout/i,
    title: "Request timed out",
    message: "The agent took too long to respond. Try again or simplify your request."
  },
  {
    pattern: /wrapped (runtime|setup)|source (checkout|update) failed|terminated unexpectedly/i,
    title: "Runtime error",
    message: "The agent's runtime stopped with an error. Contact your administrator."
  }
];

function classifyTurnFailure(rawText: string) {
  const rule = TURN_FAILURE_RULES.find((candidate) => candidate.pattern.test(rawText));
  return {
    title: rule?.title ?? "Unexpected error",
    message:
      rule?.message ??
      "The agent could not complete your request. Try again. If the problem persists, contact your administrator."
  };
}

function traceChipCode(event: EventRow) {
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
  if (event.type === "agent.turn.started") return "T";
  if (event.type === "agent.turn.completed") return "D";
  if (event.type === "agent.turn.failed") return "F";
  if (event.type.startsWith("wrapper.turn.")) {
    if (event.type === "wrapper.turn.started") return "W";
    if (event.type === "wrapper.turn.completed") return "D";
    return "F";
  }
  if (event.type.startsWith("process.")) {
    if (event.type === "process.started") return "P";
    if (event.type === "process.output") {
      const stream = typeof payload.stream === "string" ? payload.stream : "";
      return stream === "STDERR" ? "!" : "O";
    }
    return "X";
  }
  if (event.type === "agent.turn.phase") {
    const phase = typeof payload.phase === "string" ? payload.phase : "phase";
    return phase.slice(0, 1).toUpperCase() || "P";
  }
  if (event.type === "telemetry.context.window.updated") return "C";
  if (event.type.startsWith("tool.")) {
    if (event.type === "tool.started") return "R";
    if (event.type === "tool.executed") return "E";
    return "F";
  }
  return "?";
}

function traceChipTone(event: EventRow) {
  if (
    event.type === "tool.failed" ||
    event.type === "agent.turn.failed" ||
    event.type === "wrapper.turn.failed"
  ) {
    return "danger";
  }
  if (event.type === "process.exited") {
    const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
    const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : null;
    return exitCode === 0 ? "success" : "danger";
  }
  if (
    event.type === "tool.executed" ||
    event.type === "agent.turn.completed" ||
    event.type === "wrapper.turn.completed"
  ) {
    return "success";
  }
  if (event.type === "telemetry.context.window.updated") return "muted";
  return "neutral";
}

function participantDisplayName(participant: ChannelParticipant, currentUsername?: string) {
  if (
    normalizedSubscriberType(participant) === "HUMAN" &&
    currentUsername &&
    participant.subscriberId === currentUsername
  ) {
    return "you";
  }
  return participant.subscriberId || participant.subscriberType || "participant";
}

function channelDisplayName(channel?: Channel | null, currentUsername?: string) {
  if (!channel) return "Select a channel";
  if (isLifecycleChannel(channel)) return lifecycleAgentName(channel);
  if (!isDirectChannel(channel)) return channel.name;

  const participants = channel.participants ?? [];
  const visibleParticipants = participants.filter(
    (participant) =>
      normalizedSubscriberType(participant) !== "HUMAN" || participant.subscriberId !== currentUsername
  );
  const names = (visibleParticipants.length > 0 ? visibleParticipants : participants).map((participant) =>
    participantDisplayName(participant, currentUsername)
  );

  if (channel.kind?.toUpperCase() === "HUMAN_AGENT_DM" && names[0]) return names[0];
  if (names.length > 0) return `Direct: ${names.join(", ")}`;
  return channel.name;
}

function channelLabel(channel?: Channel | null, currentUsername?: string) {
  if (!channel) return "Select a channel";
  return isDirectChannel(channel) || isLifecycleChannel(channel)
    ? channelDisplayName(channel, currentUsername)
    : `# ${channel.name}`;
}

function participantName(participant: ChannelParticipant) {
  return participant.subscriberId || participant.subscriberType || "Participant";
}

function participantType(participant: ChannelParticipant) {
  const type = normalizedSubscriberType(participant);
  if (type === "HUMAN") return "Human";
  if (type === "AGENT") return "Agent";
  if (type === "TEAM") return "Team";
  return participant.subscriberType || "Participant";
}

function shareTypeLabel(share: ChannelShare) {
  const type = share.viewerType.trim().toUpperCase();
  if (type === "HUMAN") return "Shared human viewer";
  if (type === "AGENT") return "Shared agent viewer";
  return "Shared viewer";
}

function channelHasHumanShare(channel: Channel, humanId: string) {
  return (channel.shares ?? []).some(
    (share) => share.viewerType.trim().toUpperCase() === "HUMAN" && share.viewerId === humanId
  );
}

function isSharedChannelForUser(channel: Channel, currentUsername: string) {
  return Boolean(currentUsername && channelHasHumanShare(channel, currentUsername));
}

function participantAgentStatus(participant: ChannelParticipant, agents: Agent[]) {
  if (normalizedSubscriberType(participant) !== "AGENT") return null;
  const agent = agents.find((candidate) => candidate.name === participant.subscriberId);
  return agent?.runtimeState === "RUNNING" ? "running" : "off";
}

const COMPOSER_MIN_HEIGHT = 56;
const COMPOSER_MAX_VIEWPORT_SHARE = 0.6;
const COMPOSER_HEIGHT_STORAGE_KEY = "orgops.user-ui.composerHeight";

function readStoredComposerHeight(): number | null {
  try {
    const stored = Number(window.localStorage.getItem(COMPOSER_HEIGHT_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= COMPOSER_MIN_HEIGHT ? stored : null;
  } catch {
    return null;
  }
}

function agentSupportsVoiceInput(agent?: Agent) {
  const capabilities = agent?.modelCapabilities;
  return Boolean(capabilities?.audioInput || capabilities?.realtimeAudioInput);
}

function agentSupportsRealtimeVoiceCall(agent?: Agent) {
  return Boolean(agent?.modelCapabilities?.realtimeAudioInput);
}

function agentSupportsDirectOpenAiCall(agent?: Agent) {
  return Boolean(agent?.modelCapabilities?.realtimeAudioInput && agent.modelId?.startsWith("openai:"));
}

function canManageUserChannel(channel: Channel | null, userId: string | null) {
  if (!channel || isLifecycleChannel(channel)) return false;
  if (typeof channel.canManage === "boolean") return channel.canManage;
  if (channel.visibility === "PRIVATE") return Boolean(userId && channel.ownerHumanId === userId);
  return true;
}

function channelHasTeamParticipant(channel: Channel, teamIds: Set<string>) {
  return (channel.participants ?? []).some(
    (participant) =>
      normalizedSubscriberType(participant) === "TEAM" && teamIds.has(participant.subscriberId)
  );
}

function channelVisibleToUserUi(
  channel: Channel,
  userId: string | null,
  username: string,
  viewerTeamIds: Set<string>
) {
  const isSharedToHuman = channelHasHumanShare(channel, username);
  if (isLifecycleChannel(channel)) return false;
  if (isHumanAgentDirectChannel(channel)) {
    return channelHasHumanParticipant(channel, username) || isSharedToHuman;
  }
  if (isDirectChannel(channel)) {
    return channelHasHumanParticipant(channel, username) || isSharedToHuman;
  }
  if (channel.visibility !== "PRIVATE") return true;
  if (Boolean(userId && channel.ownerHumanId === userId)) return true;
  if (channelHasHumanParticipant(channel, username)) return true;
  if (channelHasTeamParticipant(channel, viewerTeamIds)) return true;
  return isSharedToHuman;
}

function agentVisibleToUserUi(
  agent: Agent,
  visibleChannelAgentNames: Set<string>,
  userId: string | null
) {
  if (agent.visibility !== "PRIVATE") return true;
  if (Boolean(userId && agent.ownerHumanId === userId)) return true;
  return visibleChannelAgentNames.has(agent.name);
}

function readLinkedChannelId() {
  return new URL(window.location.href).searchParams.get("channel");
}

function slugifyChannelName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function channelSlug(channel?: Channel | null, currentUsername?: string) {
  if (!channel) return "";
  return slugifyChannelName(channelDisplayName(channel, currentUsername) || channel.name);
}

function readPendingShareToken() {
  const token = new URL(window.location.href).searchParams.get("share");
  return token?.trim() || null;
}

function updateChannelDeepLink(channelId: string | null, replace = false, channel?: Channel | null, currentUsername?: string) {
  const url = new URL(window.location.href);
  if (channelId) {
    url.searchParams.set("channel", channelId);
    const slug = channelSlug(channel, currentUsername);
    if (slug) url.searchParams.set("slug", slug);
    else url.searchParams.delete("slug");
  } else {
    url.searchParams.delete("channel");
    url.searchParams.delete("slug");
  }
  const method = replace ? "replaceState" : "pushState";
  window.history[method](null, "", url);
}

function consumeShareToken(channelId?: string | null) {
  const url = new URL(window.location.href);
  url.searchParams.delete("share");
  if (channelId) {
    url.searchParams.set("channel", channelId);
  }
  url.searchParams.delete("slug");
  window.history.replaceState(null, "", url);
}

function readPinnedChannelIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_CHANNELS_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function writePinnedChannelIds(channelIds: string[]) {
  try {
    localStorage.setItem(PINNED_CHANNELS_STORAGE_KEY, JSON.stringify(channelIds));
  } catch {
    // Pinning is a convenience; keep the UI responsive if local storage is unavailable.
  }
}

function readRecentChannelIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_CHANNELS_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function writeRecentChannelIds(channelIds: string[]) {
  try {
    localStorage.setItem(RECENT_CHANNELS_STORAGE_KEY, JSON.stringify(channelIds));
  } catch {
    // Recents only improve palette ranking; ignore storage failures.
  }
}

type LayoutPrefs = {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  activityPanelOpen: boolean;
};

function clampSidebarWidth(width: number) {
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

function readLayoutPrefs(): LayoutPrefs {
  const defaults: LayoutPrefs = {
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    sidebarCollapsed: false,
    activityPanelOpen: true
  };
  try {
    const parsed = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "{}") as Partial<LayoutPrefs>;
    return {
      sidebarWidth:
        typeof parsed.sidebarWidth === "number" ? clampSidebarWidth(parsed.sidebarWidth) : defaults.sidebarWidth,
      sidebarCollapsed:
        typeof parsed.sidebarCollapsed === "boolean" ? parsed.sidebarCollapsed : defaults.sidebarCollapsed,
      activityPanelOpen:
        typeof parsed.activityPanelOpen === "boolean" ? parsed.activityPanelOpen : defaults.activityPanelOpen
    };
  } catch {
    return defaults;
  }
}

function writeLayoutPrefs(prefs: LayoutPrefs) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Layout prefs are cosmetic; ignore storage failures.
  }
}

function channelInitials(label: string) {
  const words = label
    .replace(/^#\s*/, "")
    .replace(/^Direct:\s*/, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function VoiceIcon({ call = false }: { call?: boolean }) {
  return (
    <svg className="message-voice-icon" viewBox="0 0 16 16" aria-hidden="true">
      {call ? (
        <path
          d="M4.2 1.6 6 3.4a1 1 0 0 1 .1 1.3l-.9 1.2a7.6 7.6 0 0 0 4.9 4.9l1.2-.9a1 1 0 0 1 1.3.1l1.8 1.8a1 1 0 0 1 0 1.4l-1 1a2.4 2.4 0 0 1-2.4.6A12.4 12.4 0 0 1 1.2 5a2.4 2.4 0 0 1 .6-2.4l1-1a1 1 0 0 1 1.4 0z"
          fill="currentColor"
        />
      ) : (
        <path
          d="M8 1.5a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0V4A2.5 2.5 0 0 0 8 1.5zM3.8 7.4a.7.7 0 0 1 .7.7 3.5 3.5 0 0 0 7 0 .7.7 0 1 1 1.4 0 4.9 4.9 0 0 1-4.2 4.8v1.4a.7.7 0 1 1-1.4 0v-1.4a4.9 4.9 0 0 1-4.2-4.8.7.7 0 0 1 .7-.7z"
          fill="currentColor"
        />
      )}
    </svg>
  );
}

function ChannelGlyph({ channel, pinned }: { channel: Channel; pinned: boolean }) {
  if (pinned) {
    return (
      <svg className="channel-glyph channel-glyph-pinned" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M10.2 1.8a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4l-1.6 1.6-.9 3.3a1 1 0 0 1-1.7.4L8.2 9.3l-3.9 3.9a.7.7 0 0 1-1-1l3.9-3.9-1.8-1.8a1 1 0 0 1 .4-1.7l3.3-.9z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (isDirectChannel(channel) || isLifecycleChannel(channel)) {
    return <i className="channel-glyph channel-glyph-direct" aria-hidden="true" />;
  }
  return (
    <i className="channel-glyph" aria-hidden="true">
      #
    </i>
  );
}

function adaptiveMessageBatchSize() {
  const connection = (
    navigator as Navigator & {
      connection?: { downlink?: number; effectiveType?: string; saveData?: boolean };
    }
  ).connection;
  if (connection?.saveData) return 12;
  const effectiveType = connection?.effectiveType ?? "";
  if (effectiveType.includes("2g")) return 10;
  if (effectiveType.includes("3g")) return 20;
  if (typeof connection?.downlink === "number") {
    if (connection.downlink >= 10) return 50;
    if (connection.downlink >= 5) return 40;
  }
  return 30;
}

function mergeEventsChronologically(current: EventRow[], incoming: EventRow[]) {
  const byId = new Map<string, EventRow>();
  for (const event of current) byId.set(event.id, event);
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((left, right) => {
    const leftPrimary = left.deliverAt ?? left.createdAt ?? 0;
    const rightPrimary = right.deliverAt ?? right.createdAt ?? 0;
    if (leftPrimary !== rightPrimary) return leftPrimary - rightPrimary;
    const leftCreated = left.createdAt ?? 0;
    const rightCreated = right.createdAt ?? 0;
    if (leftCreated !== rightCreated) return leftCreated - rightCreated;
    return left.id.localeCompare(right.id);
  });
}

function createLocalAttachmentId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseMessageAttachments(payload: unknown): MessageAttachment[] {
  if (!payload || typeof payload !== "object") return [];
  const payloadRecord = payload as { attachments?: unknown };
  if (!Array.isArray(payloadRecord.attachments)) return [];
  const attachments: MessageAttachment[] = [];
  for (const entry of payloadRecord.attachments) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const fileId = typeof record.fileId === "string" ? record.fileId.trim() : "";
    if (!fileId) continue;
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : fileId;
    const mime = typeof record.mime === "string" && record.mime.trim() ? record.mime.trim() : undefined;
    const size = typeof record.size === "number" && Number.isFinite(record.size) ? Math.max(0, record.size) : undefined;
    const kind = typeof record.kind === "string" ? record.kind : undefined;
    const durationMs =
      typeof record.durationMs === "number" && Number.isFinite(record.durationMs) ? record.durationMs : undefined;
    attachments.push({ fileId, name, mime, size, kind, durationMs });
  }
  return attachments;
}

function messageVoiceMeta(payload: unknown): MessageVoiceMeta | null {
  if (!payload || typeof payload !== "object") return null;
  const voice = (payload as { voice?: unknown }).voice;
  if (!voice || typeof voice !== "object") return null;
  const record = voice as Record<string, unknown>;
  const status = record.status === "failed" || record.status === "empty" ? record.status : "transcribed";
  return {
    mode: record.mode === "live" || record.mode === "realtime" ? record.mode : "message",
    status,
    durationMs: typeof record.durationMs === "number" ? record.durationMs : undefined,
    transcribedBy: typeof record.transcribedBy === "string" ? record.transcribedBy : undefined,
    error: typeof record.error === "string" ? record.error : undefined,
    chunkEventId: typeof record.chunkEventId === "string" ? record.chunkEventId : undefined
  };
}

function formatVoiceDuration(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function sourceName(source?: string) {
  const value = String(source ?? "");
  const separator = value.indexOf(":");
  return separator >= 0 ? value.slice(separator + 1) : value;
}

function foldOpenVoiceRooms(voiceEvents: EventRow[]) {
  const rooms = new Map<string, { roomId: string; sessionId: string }>();
  for (const event of voiceEvents) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const roomId = typeof payload.roomId === "string" ? payload.roomId.trim() : "";
    if (!roomId) continue;
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
    if (event.type === "voice.room.started") {
      rooms.set(roomId, { roomId, sessionId });
    } else if (event.type === "voice.room.ended") {
      rooms.delete(roomId);
    }
  }
  return [...rooms.values()];
}

function foldVoicePresence(voiceEvents: EventRow[], now: number) {
  const sessions = new Map<string, VoicePresenceParticipant>();
  const sessionRooms = new Map<string, string>();
  let activeSpeaker: { speakerId: string; at: number } | null = null;
  for (const event of voiceEvents) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
    const roomId = typeof payload.roomId === "string" ? payload.roomId.trim() : "";
    if (event.type === "voice.room.started" && sessionId) {
      sessionRooms.set(sessionId, roomId);
      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
          sessionId,
          participantId: sourceName(event.source),
          muted: false,
          startedAt: event.createdAt ?? now
        });
      }
      continue;
    }
    if (event.type === "voice.room.ended") {
      if (sessionId) {
        sessions.delete(sessionId);
        sessionRooms.delete(sessionId);
      }
      if (roomId) {
        for (const [id, ownedRoomId] of sessionRooms) {
          if (ownedRoomId === roomId) {
            sessions.delete(id);
            sessionRooms.delete(id);
          }
        }
      }
      continue;
    }
    if (!sessionId) continue;
    if (event.type === "voice.session.started") {
      if (roomId) sessionRooms.set(sessionId, roomId);
      sessions.set(sessionId, {
        sessionId,
        participantId: sourceName(event.source),
        muted: false,
        startedAt: event.createdAt ?? now
      });
    } else if (event.type === "voice.session.ended") {
      sessions.delete(sessionId);
      sessionRooms.delete(sessionId);
    } else if (event.type === "voice.participant.muted") {
      const session = sessions.get(sessionId);
      if (session) session.muted = Boolean(payload.muted);
    } else if (event.type === "voice.active_speaker.changed" && typeof payload.speakerId === "string") {
      activeSpeaker = { speakerId: payload.speakerId, at: event.createdAt ?? now };
    }
  }
  const participants = [...sessions.values()].filter(
    (participant) => now - participant.startedAt < VOICE_PRESENCE_STALE_MS
  );
  return { participants, activeSpeaker };
}

function formatAttachmentSize(size?: number) {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return null;
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

export default function App() {
  const messagesPanelRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerUserHeightRef = useRef<number | null>(readStoredComposerHeight());
  const [composerResizing, setComposerResizing] = useState(false);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceStartedAtRef = useRef<number>(0);
  const voicePointerHeldRef = useRef(false);
  const voiceCancelledRef = useRef(false);
  const voiceMeterRef = useRef<{ stop: () => void } | null>(null);
  const voiceMaxTimerRef = useRef<number | null>(null);
  const voiceLevelRef = useRef<HTMLSpanElement | null>(null);
  const voiceElapsedRef = useRef<HTMLSpanElement | null>(null);
  const resolvedVoiceChunkIdsRef = useRef<Set<string>>(new Set());
  const messagesPinnedToBottomRef = useRef(true);
  const messagesAutoScrollUntilRef = useRef(0);
  const voicePlaybackQueueRef = useRef<string[]>([]);
  const voicePlaybackActiveRef = useRef<HTMLAudioElement | null>(null);
  const liveVoiceStreamRef = useRef<MediaStream | null>(null);
  const liveVoicePeerRefs = useRef<RTCPeerConnection[]>([]);
  const liveKitRoomRef = useRef<Room | null>(null);
  const liveKitAudioElementsRef = useRef<HTMLAudioElement[]>([]);
  const liveVoiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const liveVoiceRemoteStreamRef = useRef<MediaStream | null>(null);
  const liveVoiceMeterRef = useRef<{ stop: () => void } | null>(null);
  const liveVoiceCallsRef = useRef<Array<{ callId: string; agentName: string }>>([]);
  const liveVoiceSessionIdRef = useRef<string | null>(null);
  const liveVoiceRoomIdRef = useRef<string | null>(null);
  const liveVoiceModeRef = useRef<LiveVoiceMode | null>(null);
  const liveVoiceChannelIdRef = useRef<string | null>(null);
  const liveVoiceStartedAtRef = useRef(0);
  const liveVoiceSpeakerOnRef = useRef(true);
  const liveVoiceLevelRef = useRef<HTMLSpanElement | null>(null);
  const lastActiveSpeakerRef = useRef<string | null>(null);
  const draftRef = useRef("");
  const conversationNameInputRef = useRef<HTMLInputElement | null>(null);
  const agentSearchInputRef = useRef<HTMLInputElement | null>(null);
  const teamSearchInputRef = useRef<HTMLInputElement | null>(null);
  const activeChannelIdRef = useRef<string | null>(null);
  const channelEventsCacheRef = useRef<Record<string, EventRow[]>>({});
  const hasOlderMessagesByChannelRef = useRef<Record<string, boolean>>({});
  const lastSeenByChannelRef = useRef<Record<string, number>>({});
  const lastLoadedMessageAtByChannelRef = useRef<Record<string, number>>({});
  const lastLoadedTimelineAtByChannelRef = useRef<Record<string, number>>({});
  const channelsRef = useRef<Channel[]>([]);
  const usernameRef = useRef("");
  const userIdRef = useRef<string | null>(null);
  const viewerTeamIdsRef = useRef<Set<string>>(new Set());
  const seenWsEventIdsRef = useRef<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const wsSubscribedTopicsRef = useRef<Set<string>>(new Set());
  const wsReconnectTimerRef = useRef<number | null>(null);
  const wsShouldReconnectRef = useRef(true);
  const wsReconnectAttemptRef = useRef(0);
  const messageFetchSeqRef = useRef(0);
  const loadingChannelIdRef = useRef<string | null>(null);
  const forceScrollToBottomOnLoadRef = useRef(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [humans, setHumans] = useState<Array<{ username: string }>>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [collapsedChannelGroups, setCollapsedChannelGroups] = useState<Record<ChannelGroupId, boolean>>({
    channels: false,
    direct: false,
    shared: false
  });
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [recentChannelIds, setRecentChannelIds] = useState<string[]>(() => readRecentChannelIds());
  const [conversationName, setConversationName] = useState("");
  const [conversationDescription, setConversationDescription] = useState("");
  const [conversationVisibility, setConversationVisibility] = useState<"PUBLIC" | "PRIVATE">("PRIVATE");
  const [selectedConversationAgents, setSelectedConversationAgents] = useState<string[]>([]);
  const [agentSearchQuery, setAgentSearchQuery] = useState("");
  const [selectedConversationTeams, setSelectedConversationTeams] = useState<string[]>([]);
  const [teamSearchQuery, setTeamSearchQuery] = useState("");
  const [pinnedChannelIds, setPinnedChannelIds] = useState<string[]>(() => readPinnedChannelIds());
  const [layoutPrefs, setLayoutPrefs] = useState<LayoutPrefs>(() => readLayoutPrefs());
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const appShellRef = useRef<HTMLElement | null>(null);
  const [showArchivedChannels, setShowArchivedChannels] = useState(false);
  const [showConversationDialog, setShowConversationDialog] = useState(false);
  const [showParticipantsDialog, setShowParticipantsDialog] = useState(false);
  const [showChannelManageDialog, setShowChannelManageDialog] = useState(false);
  const [draftHasText, setDraftHasText] = useState(false);
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [loginUsername, setLoginUsername] = useState("admin");
  const [loginPassword, setLoginPassword] = useState("admin");
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participantKind, setParticipantKind] = useState<"HUMAN" | "AGENT" | "TEAM">("AGENT");
  const [participantValue, setParticipantValue] = useState("");
  const [participantSubmitting, setParticipantSubmitting] = useState(false);
  const [participantRemovingKey, setParticipantRemovingKey] = useState<string | null>(null);
  const [shareKind, setShareKind] = useState<"HUMAN" | "AGENT">("HUMAN");
  const [shareValue, setShareValue] = useState("");
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [shareRemovingKey, setShareRemovingKey] = useState<string | null>(null);
  const [channelVisibilityDraft, setChannelVisibilityDraft] = useState<"PUBLIC" | "PRIVATE">("PRIVATE");
  const [updatingChannelVisibility, setUpdatingChannelVisibility] = useState(false);
  const [archiveDraft, setArchiveDraft] = useState(false);
  const [expandedTraceEventId, setExpandedTraceEventId] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig | null>(null);
  const [pendingVoiceNotes, setPendingVoiceNotes] = useState<PendingVoiceNote[]>([]);
  const [voiceEvents, setVoiceEvents] = useState<EventRow[]>([]);
  const [liveVoiceSessionId, setLiveVoiceSessionId] = useState<string | null>(null);
  const [liveVoiceMuted, setLiveVoiceMuted] = useState(false);
  const [liveVoiceStarting, setLiveVoiceStarting] = useState(false);
  const [liveVoiceActivity, setLiveVoiceActivity] = useState<LiveVoiceActivity>("connecting");
  const [liveVoiceToolName, setLiveVoiceToolName] = useState<string | null>(null);
  const [liveVoiceAgentNames, setLiveVoiceAgentNames] = useState<string[]>([]);
  const [liveVoiceMode, setLiveVoiceMode] = useState<LiveVoiceMode | null>(null);
  const [directVoiceTargetAgent, setDirectVoiceTargetAgent] = useState<string | null>(null);
  const [directVoiceMenuOpen, setDirectVoiceMenuOpen] = useState(false);
  const directVoiceMenuRef = useRef<HTMLDivElement | null>(null);
  const voiceMenuRef = useRef<HTMLDivElement | null>(null);
  const [liveVoiceSpeakerOn, setLiveVoiceSpeakerOn] = useState(true);
  const [endedLiveVoiceSessionIds, setEndedLiveVoiceSessionIds] = useState<string[]>([]);
  const [voiceClock, setVoiceClock] = useState(() => Date.now());
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sensitiveRevealPasswords, setSensitiveRevealPasswords] = useState<Record<string, string>>({});
  const [revealedSensitiveByEvent, setRevealedSensitiveByEvent] = useState<Record<string, string>>({});
  const [revealingSensitiveEventId, setRevealingSensitiveEventId] = useState<string | null>(null);
  const [sensitiveRevealErrors, setSensitiveRevealErrors] = useState<Record<string, string>>({});

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [activeChannelId, channels]
  );

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const visibleTimelineEvents = useMemo(
    () =>
      events.filter(
        (event) => (event.type === "message.created" && !isHiddenUiActionMessage(event)) || isTraceEvent(event)
      ),
    [events]
  );

  const timelineItems = useMemo(() => {
    const items: Array<
      | { kind: "message"; id: string; event: EventRow }
      | { kind: "trace-group"; id: string; traceEvents: EventRow[]; tone: "agent" | "system" }
    > = [];
    let traceBuffer: EventRow[] = [];
    let groupCounter = 0;

    const flushTraceBuffer = () => {
      if (traceBuffer.length === 0) return;
      const tone: "agent" | "system" = traceBuffer.some(
        (entry) => entry.type === "tool.failed" || entry.type === "wrapper.turn.failed"
      )
        ? "system"
        : "agent";
      items.push({
        kind: "trace-group",
        id: `trace-group-${traceBuffer[0]?.id ?? groupCounter}`,
        traceEvents: traceBuffer,
        tone
      });
      traceBuffer = [];
      groupCounter += 1;
    };

    for (const event of visibleTimelineEvents) {
      if (event.type === "message.created" || event.type === "agent.turn.failed") {
        flushTraceBuffer();
        items.push({ kind: "message", id: event.id, event });
      } else {
        traceBuffer.push(event);
      }
    }
    flushTraceBuffer();
    return items;
  }, [visibleTimelineEvents]);
  const isConversationEmpty = !messagesLoading && timelineItems.length === 0;

  const offlineAgentNames = useMemo(
    () =>
      (activeChannel?.participants ?? [])
        .filter((participant) => participantAgentStatus(participant, agents) === "off")
        .map((participant) => participant.subscriberId),
    [activeChannel, agents]
  );

  const voiceCapableAgentNames = useMemo(
    () =>
      (activeChannel?.participants ?? [])
        .filter((participant) => normalizedSubscriberType(participant) === "AGENT")
        .map((participant) => agents.find((agent) => agent.name === participant.subscriberId))
        .filter((agent): agent is Agent => agentSupportsVoiceInput(agent))
        .map((agent) => agent.name),
    [activeChannel, agents]
  );
  const channelAgentNames = useMemo(
    () =>
      (activeChannel?.participants ?? [])
        .filter((participant) => normalizedSubscriberType(participant) === "AGENT")
        .map((participant) => participant.subscriberId),
    [activeChannel]
  );
  const transcriptionEnabled = Boolean(voiceConfig?.transcription.enabled);
  const canSendVoiceMessage = transcriptionEnabled;

  const realtimeVoiceCapableAgents = useMemo(
    () =>
      (activeChannel?.participants ?? [])
        .filter((participant) => normalizedSubscriberType(participant) === "AGENT")
        .map((participant) => agents.find((agent) => agent.name === participant.subscriberId))
        .filter((agent): agent is Agent => agentSupportsRealtimeVoiceCall(agent)),
    [activeChannel, agents]
  );
  const realtimeVoiceCapableAgentNames = realtimeVoiceCapableAgents
    .map((agent) => agent.name)
    .filter((name) => !offlineAgentNames.includes(name));
  const openaiRealtimeAgentNames = realtimeVoiceCapableAgents
    .filter((agent) => agentSupportsDirectOpenAiCall(agent) && !offlineAgentNames.includes(agent.name))
    .map((agent) => agent.name);
  const voiceRoomBroker = voiceConfig?.realtime?.rooms?.broker ?? "direct-openai-calls";
  const liveKitRoomsEnabled =
    voiceRoomBroker === "livekit" && Boolean(voiceConfig?.realtime?.rooms?.enabled);
  const realtimeDirectCallsEnabled =
    Boolean(voiceConfig?.realtime?.enabled) && typeof RTCPeerConnection !== "undefined";
  const realtimeRoomsEnabled =
    Boolean(voiceConfig?.realtime?.rooms?.enabled ?? voiceConfig?.realtime?.enabled) &&
    (liveKitRoomsEnabled || typeof RTCPeerConnection !== "undefined");
  const roomAgentNames = liveKitRoomsEnabled ? realtimeVoiceCapableAgentNames : openaiRealtimeAgentNames;
  const directAgentNames = liveKitRoomsEnabled ? realtimeVoiceCapableAgentNames : openaiRealtimeAgentNames;
  const canStartDirectVoice = realtimeDirectCallsEnabled && directAgentNames.length > 0;
  const canStartVoiceRoom = realtimeRoomsEnabled && roomAgentNames.length > 0;
  const canStartLiveVoice = canStartDirectVoice || canStartVoiceRoom;
  const directVoiceCallTarget =
    directVoiceTargetAgent && directAgentNames.includes(directVoiceTargetAgent)
      ? directVoiceTargetAgent
      : directAgentNames[0] ?? null;
  const liveVoiceAgentLabel =
    liveVoiceAgentNames.length === 0
      ? null
      : liveVoiceAgentNames.length === 1
        ? liveVoiceAgentNames[0]
        : `${liveVoiceAgentNames.length} agents`;
  const liveVoiceSessionLabel =
    liveVoiceMode === "direct"
      ? `Direct call with ${liveVoiceAgentLabel ?? "agent"}`
      : `Voice room with ${liveVoiceAgentLabel ?? "agents"}`;
  const voicePresence = useMemo(() => foldVoicePresence(voiceEvents, voiceClock), [voiceEvents, voiceClock]);
  const openVoiceRooms = useMemo(() => foldOpenVoiceRooms(voiceEvents), [voiceEvents]);
  const othersLiveInChannel = voicePresence.participants.filter(
    (participant) =>
      participant.sessionId !== liveVoiceSessionId && !endedLiveVoiceSessionIds.includes(participant.sessionId)
  );
  const canHangUpWithoutJoin = !liveVoiceSessionId && othersLiveInChannel.length > 0;
  const pendingVoiceForChannel = pendingVoiceNotes.filter((note) => note.channelId === activeChannelId);
  const pendingVoiceMessages = pendingVoiceForChannel.filter((note) => note.mode === "message");

  const agentIsThinking = useMemo(() => {
    let activeTurns = 0;
    for (const event of events) {
      if (event.type === "agent.turn.started") activeTurns += 1;
      if (event.type === "agent.turn.completed" || event.type === "agent.turn.failed") {
        activeTurns = Math.max(0, activeTurns - 1);
      }
    }
    return activeTurns > 0;
  }, [events]);

  const viewerTeamIds = useMemo(() => new Set(teams.map((team) => team.id)), [teams]);
  useEffect(() => {
    viewerTeamIdsRef.current = viewerTeamIds;
  }, [viewerTeamIds]);
  const visibleChannels = useMemo(
    () =>
      channels.filter((channel) =>
        channelVisibleToUserUi(channel, userId, username, viewerTeamIds)
      ),
    [channels, userId, username, viewerTeamIds]
  );
  const activeChannels = useMemo(
    () => visibleChannels.filter((channel) => !channel.archivedAt),
    [visibleChannels]
  );
  const archivedChannels = useMemo(
    () => visibleChannels.filter((channel) => Boolean(channel.archivedAt)),
    [visibleChannels]
  );
  const visibleChannelAgentNames = useMemo(() => {
    const names = new Set<string>();
    for (const channel of visibleChannels) {
      for (const participant of channel.participants ?? []) {
        if (normalizedSubscriberType(participant) === "AGENT" && participant.subscriberId) {
          names.add(participant.subscriberId);
        }
      }
    }
    return names;
  }, [visibleChannels]);
  const visibleAgents = useMemo(
    () => agents.filter((agent) => agentVisibleToUserUi(agent, visibleChannelAgentNames, userId)),
    [agents, visibleChannelAgentNames, userId]
  );

  const pinnedChannelIdSet = useMemo(() => new Set(pinnedChannelIds), [pinnedChannelIds]);
  const sortChannelsForDisplay = (items: Channel[]) =>
    [...items].sort((left, right) => {
      const leftPinned = pinnedChannelIdSet.has(left.id) ? 1 : 0;
      const rightPinned = pinnedChannelIdSet.has(right.id) ? 1 : 0;
      if (leftPinned !== rightPinned) return rightPinned - leftPinned;
      const leftUnread = unreadCounts[left.id] ? 1 : 0;
      const rightUnread = unreadCounts[right.id] ? 1 : 0;
      if (leftUnread !== rightUnread) return rightUnread - leftUnread;
      const leftName = channelDisplayName(left, username).toLowerCase();
      const rightName = channelDisplayName(right, username).toLowerCase();
      return leftName.localeCompare(rightName);
    });
  const groupedChannels = useMemo(
    () => {
      return CHANNEL_GROUPS.map((group) => ({
        ...group,
        channels: sortChannelsForDisplay(activeChannels.filter((channel) => {
          const shared = isSharedChannelForUser(channel, username);
          if (group.id === "shared") return shared;
          if (group.id === "direct") {
            if (shared || !username) return false;
            return (
              channelGroupId(channel) === "direct" &&
              isHumanAgentDirectChannel(channel) &&
              channelHasHumanParticipant(channel, username)
            );
          }
          if (shared) return false;
          return channelGroupId(channel) === "channels";
        }))
      })).filter((group) => group.channels.length > 0);
    },
    [activeChannels, pinnedChannelIdSet, unreadCounts, username]
  );

  const paletteChannels = useMemo<PaletteChannel[]>(
    () =>
      [...groupedChannels.flatMap((group) => group.channels), ...archivedChannels].map((channel) => {
        const direct = isDirectChannel(channel) || isLifecycleChannel(channel);
        return {
          id: channel.id,
          name: channelDisplayName(channel, username),
          kind: direct ? "direct" : "channel",
          description: direct ? null : channel.description,
          archived: Boolean(channel.archivedAt),
          pinned: pinnedChannelIdSet.has(channel.id),
          unread: unreadCounts[channel.id] ?? 0
        };
      }),
    [archivedChannels, groupedChannels, pinnedChannelIdSet, unreadCounts, username]
  );

  const uploadingAttachmentCount = pendingAttachments.filter((item) => item.status === "uploading").length;
  const readyAttachments = pendingAttachments
    .filter((item) => item.status === "ready" && item.uploaded)
    .map((item) => item.uploaded as UploadedAttachment);
  const hasAttachmentErrors = pendingAttachments.some((item) => item.status === "error");
  const activeChannelManageable = canManageUserChannel(activeChannel, userId);
  const activeChannelCanPost = activeChannel ? activeChannel.canPost !== false : false;
  const liveVoiceCallDisabled =
    !activeChannel ||
    Boolean(activeChannel.archivedAt) ||
    !activeChannelCanPost ||
    sending ||
    recordingVoice ||
    liveVoiceStarting;
  const hasVoiceControls =
    !liveVoiceSessionId &&
    (canStartVoiceRoom ||
      (canStartDirectVoice && Boolean(directVoiceCallTarget)) ||
      canSendVoiceMessage ||
      voiceCapableAgentNames.length > 0);
  const voiceControlCount =
    (canStartVoiceRoom && !liveVoiceSessionId ? 1 : 0) +
    (canStartDirectVoice && directVoiceCallTarget && !liveVoiceSessionId ? 1 : 0) +
    (!liveVoiceSessionId && (canSendVoiceMessage || voiceCapableAgentNames.length > 0) ? 1 : 0);
  const hasComposerActionMenu =
    hasVoiceControls ||
    Boolean(activeChannel && !activeChannel.archivedAt && activeChannelCanPost);
  const canStartConversation =
    Boolean(conversationName.trim()) || selectedConversationAgents.length === 1 || selectedConversationTeams.length > 0;
  const selectedConversationAgentRecords = useMemo(
    () =>
      selectedConversationAgents.map((agentName) => visibleAgents.find((agent) => agent.name === agentName) ?? { name: agentName }),
    [visibleAgents, selectedConversationAgents]
  );
  const selectedConversationTeamRecords = useMemo(
    () =>
      selectedConversationTeams.map((teamId) => teams.find((team) => team.id === teamId) ?? { id: teamId, name: teamId }),
    [teams, selectedConversationTeams]
  );
  const agentSuggestions = useMemo(() => {
    const query = agentSearchQuery.trim().toLowerCase();
    return visibleAgents
      .filter((agent) => !selectedConversationAgents.includes(agent.name))
      .filter((agent) => !query || agent.name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [agentSearchQuery, visibleAgents, selectedConversationAgents]);
  const isSearchingAgents = Boolean(agentSearchQuery.trim());
  const teamSuggestions = useMemo(() => {
    const query = teamSearchQuery.trim().toLowerCase();
    return teams
      .filter((team) => !selectedConversationTeams.includes(team.id))
      .filter((team) => !query || team.name.toLowerCase().includes(query) || team.id.toLowerCase().includes(query))
      .slice(0, 8);
  }, [teams, selectedConversationTeams, teamSearchQuery]);
  const isSearchingTeams = Boolean(teamSearchQuery.trim());

  useEffect(() => {
    if (!activeChannel) return;
    setChannelVisibilityDraft(activeChannel.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE");
    setArchiveDraft(Boolean(activeChannel.archivedAt));
  }, [activeChannel?.id, activeChannel?.visibility, activeChannel?.archivedAt]);

  async function handleRevealSensitive(eventId: string) {
    const password = sensitiveRevealPasswords[eventId] ?? "";
    if (!password) {
      setSensitiveRevealErrors((current) => ({ ...current, [eventId]: "Enter your password to reveal." }));
      return;
    }
    setRevealingSensitiveEventId(eventId);
    setSensitiveRevealErrors((current) => ({ ...current, [eventId]: "" }));
    try {
      const response = await apiJson<{ text?: string }>(`/api/events/${encodeURIComponent(eventId)}/reveal-sensitive`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ password })
      });
      const text = typeof response.text === "string" ? response.text : "";
      if (!text) {
        setSensitiveRevealErrors((current) => ({ ...current, [eventId]: "No sensitive content was returned." }));
        return;
      }
      setRevealedSensitiveByEvent((current) => ({ ...current, [eventId]: text }));
      setSensitiveRevealPasswords((current) => ({ ...current, [eventId]: "" }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unable to reveal sensitive content";
      setSensitiveRevealErrors((current) => ({ ...current, [eventId]: detail || "Unable to reveal sensitive content" }));
    } finally {
      setRevealingSensitiveEventId((current) => (current === eventId ? null : current));
    }
  }

  function handleHideSensitive(eventId: string) {
    setRevealedSensitiveByEvent((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, eventId)) return current;
      const next = { ...current };
      delete next[eventId];
      return next;
    });
  }

  function selectChannel(channelId: string | null, options?: { replace?: boolean; channels?: Channel[] }) {
    const nextChannels = options?.channels ?? channelsRef.current;
    const channel = channelId ? nextChannels.find((candidate) => candidate.id === channelId) ?? null : null;
    setActiveChannelId(channelId);
    setMobileSidebarOpen(false);
    updateChannelDeepLink(channelId, options?.replace, channel, usernameRef.current);
    if (channelId) {
      setRecentChannelIds((current) => {
        if (current[0] === channelId) return current;
        const next = [channelId, ...current.filter((id) => id !== channelId)].slice(0, RECENT_CHANNELS_LIMIT);
        writeRecentChannelIds(next);
        return next;
      });
    }
  }

  async function loadSession() {
    setAuthLoading(true);
    setError(null);
    try {
      const me = await apiJson<AuthMe>("/api/auth/me");
      const nextUsername = me.username ?? "";
      setUsername(nextUsername);
      setUserId(me.id ?? null);
      setLoginUsername(nextUsername || "admin");
      setAuthenticated(Boolean(nextUsername));
      setMustChangePassword(Boolean(me.mustChangePassword));
    } catch {
      setAuthenticated(false);
      setUsername("");
      setUserId(null);
      setMustChangePassword(false);
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadShell() {
    if (!authenticated) return;
    setError(null);
    setLoading(true);
    try {
      const pendingShareToken = readPendingShareToken();
      let claimedShareChannelId: string | null = null;
      if (pendingShareToken) {
        try {
          const claimed = await apiJson<{ ok?: boolean; channelId: string }>(
            `/api/channel-share-links/${encodeURIComponent(pendingShareToken)}/claim`,
            {
              method: "POST",
              headers: getApiHeaders()
            }
          );
          claimedShareChannelId = claimed.channelId;
          consumeShareToken(claimed.channelId);
        } catch (claimError) {
          consumeShareToken(readLinkedChannelId());
          setError(
            claimError instanceof Error
              ? claimError.message
              : "Unable to claim shared channel link"
          );
        }
      }
      const [nextChannels, nextAgents, nextHumans, nextTeams] = await Promise.all([
        apiJson<Channel[]>("/api/channels?includeArchived=1"),
        apiJson<Agent[]>("/api/agents"),
        apiJson<Array<{ username: string }>>("/api/humans").catch(() => []),
        apiJson<Team[]>("/api/teams/me").catch(() => [])
      ]);
      setChannels(nextChannels);
      setAgents(nextAgents);
      setHumans(nextHumans);
      setTeams(nextTeams);
      const nextViewerTeamIds = new Set(nextTeams.map((team) => team.id));
      const visibleChannels = nextChannels.filter((channel) =>
        channelVisibleToUserUi(channel, userId, username, nextViewerTeamIds)
      );
      const nextVisibleChannelAgentNames = new Set<string>();
      for (const channel of visibleChannels) {
        for (const participant of channel.participants ?? []) {
          if (normalizedSubscriberType(participant) === "AGENT" && participant.subscriberId) {
            nextVisibleChannelAgentNames.add(participant.subscriberId);
          }
        }
      }
      const nextVisibleAgents = nextAgents.filter((agent) =>
        agentVisibleToUserUi(agent, nextVisibleChannelAgentNames, userId)
      );
      setSelectedConversationAgents((current) =>
        current.filter((agentName) => nextVisibleAgents.some((agent) => agent.name === agentName))
      );
      const linkedChannelId = readLinkedChannelId();
      const preferredLinkedId = claimedShareChannelId ?? linkedChannelId;
      const linkedChannel = visibleChannels.find((channel) => channel.id === preferredLinkedId);
      const nextActiveChannelId =
        linkedChannel?.id ??
        (activeChannelId && visibleChannels.some((channel) => channel.id === activeChannelId && !channel.archivedAt)
          ? activeChannelId
          : visibleChannels.find((channel) => !channel.archivedAt)?.id ?? null);
      if (linkedChannel?.archivedAt) setShowArchivedChannels(true);
      selectChannel(nextActiveChannelId, { replace: true, channels: nextChannels });
      await loadMessageNotifications({ initialize: true });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load OrgOps");
    } finally {
      setLoading(false);
    }
  }

  function scrollMessagesToBottom(behavior: ScrollBehavior = "smooth") {
    messagesPinnedToBottomRef.current = true;
    messagesAutoScrollUntilRef.current = performance.now() + 800;
    window.requestAnimationFrame(() => {
      const panel = messagesPanelRef.current;
      if (!panel) return;
      panel.scrollTo({ top: panel.scrollHeight, behavior });
    });
  }

  function isMessagesPanelScrolledToBottom() {
    const panel = messagesPanelRef.current;
    if (!panel) return true;
    return panel.scrollHeight - panel.scrollTop - panel.clientHeight < 80;
  }

  /** Whether new messages should keep the panel at the bottom; only the user's own scrolling unpins it. */
  function isMessagesPanelNearBottom() {
    return messagesPinnedToBottomRef.current || isMessagesPanelScrolledToBottom();
  }

  function newestMessageTime(channelEvents: EventRow[]) {
    return channelEvents.reduce((newest, event) => {
      if (isHiddenUiActionMessage(event)) return newest;
      if (event.type !== "message.created" && event.type !== "agent.turn.failed") return newest;
      return Math.max(newest, event.createdAt ?? 0);
    }, 0);
  }

  function newestTimelineEventTime(channelEvents: EventRow[]) {
    return channelEvents.reduce((newest, event) => {
      if (isHiddenUiActionMessage(event)) return newest;
      if (event.type !== "message.created" && !isTraceEvent(event)) return newest;
      return Math.max(newest, event.createdAt ?? 0);
    }, 0);
  }

  function markChannelSeen(channelId: string, channelEvents: EventRow[]) {
    const newestMessageAt = newestMessageTime(channelEvents);
    if (newestMessageAt > 0) {
      lastSeenByChannelRef.current[channelId] = Math.max(
        lastSeenByChannelRef.current[channelId] ?? 0,
        newestMessageAt
      );
    }
    setUnreadCounts((current) => {
      if (!current[channelId]) return current;
      const next = { ...current };
      delete next[channelId];
      return next;
    });
  }

  function updateCachedChannelEvents(channelId: string, incomingEvents: EventRow[]) {
    const visibleEvents = incomingEvents.filter(
      (event) => (event.type === "message.created" && !isHiddenUiActionMessage(event)) || isTraceEvent(event)
    );
    if (visibleEvents.length === 0) return channelEventsCacheRef.current[channelId] ?? [];
    const nextEvents = mergeEventsChronologically(
      channelEventsCacheRef.current[channelId] ?? [],
      visibleEvents
    );
    channelEventsCacheRef.current[channelId] = nextEvents;
    return nextEvents;
  }

  function rememberWsEvent(eventId: string) {
    const seen = seenWsEventIdsRef.current;
    if (seen.has(eventId)) return false;
    seen.add(eventId);
    if (seen.size > 3000) {
      const first = seen.values().next();
      if (!first.done) seen.delete(first.value);
    }
    return true;
  }

  async function loadMessages(
    channelId: string,
    options?: { scrollToBottom?: boolean; showLoading?: boolean; scrollBehavior?: ScrollBehavior }
  ) {
    const fetchSeq = messageFetchSeqRef.current + 1;
    messageFetchSeqRef.current = fetchSeq;
    const limit = adaptiveMessageBatchSize();
    if (options?.showLoading) {
      loadingChannelIdRef.current = channelId;
      setMessagesLoading(true);
    }
    try {
      const [messageEvents, failureEvents, turnEvents, toolEvents, contextEvents, wrapperEvents, processEvents] =
        await Promise.all([
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&type=message.created&limit=${limit}&order=desc`
        ),
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&type=agent.turn.failed&limit=${limit}&order=desc`
        ),
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=agent.turn.&limit=${limit}&order=desc`
        ),
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=tool.&limit=${limit}&order=desc`
        ),
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&type=telemetry.context.window.updated&limit=${limit}&order=desc`
        ),
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=wrapper.turn.&limit=${limit}&order=desc`
        ),
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=process.&limit=${limit}&order=desc`
        )
      ]);
      if (fetchSeq !== messageFetchSeqRef.current || channelId !== activeChannelIdRef.current) {
        return;
      }
      const nextEvents = mergeEventsChronologically(
        mergeEventsChronologically(
          mergeEventsChronologically(
            mergeEventsChronologically(mergeEventsChronologically(messageEvents, failureEvents), turnEvents),
            mergeEventsChronologically(toolEvents, contextEvents)
          ),
          wrapperEvents
        ),
        processEvents
      ).reverse();
      const chronologicalEvents = [...nextEvents].reverse();
      const previousNewestMessageAt = lastLoadedMessageAtByChannelRef.current[channelId] ?? 0;
      const nextNewestMessageAt = newestMessageTime(nextEvents);
      const previousNewestTimelineAt = lastLoadedTimelineAtByChannelRef.current[channelId] ?? 0;
      const nextNewestTimelineAt = newestTimelineEventTime(nextEvents);
      const hasNewTimelineEvents =
        previousNewestTimelineAt > 0 && nextNewestTimelineAt > previousNewestTimelineAt;

      setEvents((current) =>
        options?.showLoading ? chronologicalEvents : mergeEventsChronologically(current, chronologicalEvents)
      );
      for (const loadedEvent of messageEvents) {
        const chunkEventId = messageVoiceMeta(loadedEvent.payload)?.chunkEventId;
        if (chunkEventId && !resolvedVoiceChunkIdsRef.current.has(chunkEventId)) {
          resolvePendingVoiceChunk(chunkEventId);
        }
      }
      channelEventsCacheRef.current[channelId] = options?.showLoading
        ? chronologicalEvents
        : mergeEventsChronologically(channelEventsCacheRef.current[channelId] ?? [], chronologicalEvents);
      if (options?.showLoading) {
        const hasOlder = messageEvents.length === limit;
        hasOlderMessagesByChannelRef.current[channelId] = hasOlder;
        setHasOlderMessages(hasOlder);
      }
      markChannelSeen(channelId, nextEvents);
      lastLoadedMessageAtByChannelRef.current[channelId] = Math.max(
        previousNewestMessageAt,
        nextNewestMessageAt
      );
      lastLoadedTimelineAtByChannelRef.current[channelId] = Math.max(
        previousNewestTimelineAt,
        nextNewestTimelineAt
      );
      if (options?.scrollToBottom) {
        forceScrollToBottomOnLoadRef.current = true;
        setHasNewMessagesBelow(false);
        scrollMessagesToBottom(options.scrollBehavior);
      }
      if (!options?.scrollToBottom && hasNewTimelineEvents && channelId === activeChannelIdRef.current) {
        if (isMessagesPanelNearBottom()) {
          setHasNewMessagesBelow(false);
          scrollMessagesToBottom();
        } else {
          setHasNewMessagesBelow(true);
        }
      }
    } catch (loadError) {
      if (fetchSeq === messageFetchSeqRef.current) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load messages");
      }
    } finally {
      if (
        loadingChannelIdRef.current === channelId &&
        fetchSeq === messageFetchSeqRef.current
      ) {
        loadingChannelIdRef.current = null;
        setMessagesLoading(false);
      }
    }
  }

  async function handleLoadOlderMessages() {
    if (!activeChannelId || events.length === 0 || loadingOlderMessages) return;
    const oldestEventAt = events[0]?.createdAt;
    if (!oldestEventAt) return;
    const channelId = activeChannelId;
    const limit = adaptiveMessageBatchSize();
    const panel = messagesPanelRef.current;
    const previousScrollHeight = panel?.scrollHeight ?? 0;

    setLoadingOlderMessages(true);
    setError(null);
    try {
      const [olderMessages, olderTurns, olderTools, olderWrappers, olderProcesses] = await Promise.all([
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&type=message.created&limit=${limit}&order=desc&before=${oldestEventAt}`
        ),
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=agent.turn.&limit=${limit}&order=desc&before=${oldestEventAt}`
        ),
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=tool.&limit=${limit}&order=desc&before=${oldestEventAt}`
        ),
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=wrapper.turn.&limit=${limit}&order=desc&before=${oldestEventAt}`
        ),
        apiJson<EventRow[]>(
          `/api/events?channelId=${encodeURIComponent(channelId)}&typePrefix=process.&limit=${limit}&order=desc&before=${oldestEventAt}`
        )
      ]);
      const olderEvents = mergeEventsChronologically(
        mergeEventsChronologically(
          mergeEventsChronologically(olderMessages, olderTurns),
          mergeEventsChronologically(olderTools, olderWrappers)
        ),
        olderProcesses
      );
      if (channelId !== activeChannelIdRef.current) return;
      const chronologicalOlderEvents = [...olderEvents].reverse();
      setEvents((current) => {
        const existingIds = new Set(current.map((event) => event.id));
        const nextEvents = [
          ...chronologicalOlderEvents.filter((event) => !existingIds.has(event.id)),
          ...current
        ];
        channelEventsCacheRef.current[channelId] = nextEvents;
        return nextEvents;
      });
      const hasOlder =
        olderMessages.length === limit ||
          olderTurns.length === limit ||
          olderTools.length === limit ||
          olderWrappers.length === limit ||
          olderProcesses.length === limit;
      hasOlderMessagesByChannelRef.current[channelId] = hasOlder;
      setHasOlderMessages(hasOlder);
      window.requestAnimationFrame(() => {
        const currentPanel = messagesPanelRef.current;
        if (!currentPanel) return;
        currentPanel.scrollTop += currentPanel.scrollHeight - previousScrollHeight;
      });
    } catch (olderError) {
      setError(olderError instanceof Error ? olderError.message : "Unable to load previous messages");
    } finally {
      setLoadingOlderMessages(false);
    }
  }

  async function loadMessageNotifications(options?: { initialize?: boolean }) {
    if (!authenticated) return;
    try {
      const nextEvents = await apiJson<EventRow[]>(
        "/api/events?type=message.created&limit=100&order=desc"
      );
      if (options?.initialize) {
        const nextSeen = { ...lastSeenByChannelRef.current };
        for (const event of nextEvents) {
          if (!event.channelId) continue;
          nextSeen[event.channelId] = Math.max(nextSeen[event.channelId] ?? 0, event.createdAt ?? 0);
        }
        lastSeenByChannelRef.current = nextSeen;
        setUnreadCounts({});
        return;
      }

      const activeId = activeChannelIdRef.current;
      const nextCounts: Record<string, number> = {};
      for (const event of nextEvents) {
        if (!event.channelId || event.channelId === activeId) continue;
        if (isHiddenUiActionMessage(event)) continue;
        const channel = channels.find((candidate) => candidate.id === event.channelId);
        if (channel?.archivedAt) continue;
        if ((event.createdAt ?? 0) > (lastSeenByChannelRef.current[event.channelId] ?? 0)) {
          nextCounts[event.channelId] = (nextCounts[event.channelId] ?? 0) + 1;
        }
      }
      setUnreadCounts(nextCounts);
    } catch {
      // Notification polling is best-effort; active channel loading reports visible errors.
    }
  }

  /** Live agent voice messages play one after another; history never autoplays. */
  function enqueueAgentVoicePlayback(event: EventRow) {
    if (!String(event.source ?? "").startsWith("agent:")) return;
    if (messageVoiceMeta(event.payload)?.mode === "realtime") return;
    const audioCount = parseMessageAttachments(event.payload).filter((attachment) =>
      attachment.mime?.startsWith("audio/")
    ).length;
    for (let index = 0; index < audioCount; index += 1) {
      voicePlaybackQueueRef.current.push(`${event.id}:${index}`);
    }
    if (audioCount > 0) playNextAgentVoice();
  }

  function playNextAgentVoice(lookupAttempt = 0) {
    if (voicePlaybackActiveRef.current) return;
    if (liveVoiceCallsRef.current.length > 0) {
      voicePlaybackQueueRef.current = [];
      return;
    }
    if (voiceRecorderRef.current) {
      window.setTimeout(() => playNextAgentVoice(), 500);
      return;
    }
    const key = voicePlaybackQueueRef.current[0];
    if (!key) return;
    const audio = document.querySelector<HTMLAudioElement>(`audio[data-voice-key="${CSS.escape(key)}"]`);
    if (!audio) {
      if (lookupAttempt < 20) {
        window.setTimeout(() => playNextAgentVoice(lookupAttempt + 1), 100);
      } else {
        voicePlaybackQueueRef.current.shift();
        playNextAgentVoice();
      }
      return;
    }
    voicePlaybackQueueRef.current.shift();
    voicePlaybackActiveRef.current = audio;
    const finish = (continueQueue: boolean) => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("pause", onPause);
      voicePlaybackActiveRef.current = null;
      if (continueQueue) playNextAgentVoice();
      else voicePlaybackQueueRef.current = [];
    };
    const onEnded = () => finish(true);
    // Pausing (by the user, or by the player leaving the page) stops the whole queue.
    const onPause = () => {
      if (!audio.ended) finish(false);
    };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("pause", onPause);
    audio.currentTime = 0;
    audio.play().catch(() => finish(false));
  }

  function handleIncomingRealtimeEvent(event: EventRow) {
    if (!event.id || !rememberWsEvent(event.id)) return;
    const eventChannelId = event.channelId;
    if (!eventChannelId) return;

    if (event.type === "message.created") {
      const voiceMeta = messageVoiceMeta(event.payload);
      if (voiceMeta?.chunkEventId) resolvePendingVoiceChunk(voiceMeta.chunkEventId);
    }
    if (event.type === "voice.realtime.call.ended") {
      const endedCallId = (event.payload as { callId?: unknown } | undefined)?.callId;
      if (
        endedCallId &&
        liveVoiceCallsRef.current.some((call) => call.callId === endedCallId) &&
        String(event.source ?? "").startsWith("agent:")
      ) {
        liveVoiceCallsRef.current = liveVoiceCallsRef.current.filter((call) => call.callId !== endedCallId);
        const remainingAgentNames = liveVoiceCallsRef.current.map((call) => call.agentName);
        setLiveVoiceAgentNames(remainingAgentNames);
        if (remainingAgentNames.length === 0) {
          void stopLiveVoice("agent_disconnected", { notifyAgent: false });
          setError(liveVoiceModeRef.current === "direct" ? "The direct voice call was disconnected." : "The voice room was disconnected.");
        } else {
          setVoiceHint("One agent left the voice room.");
        }
      }
    }
    if (event.type?.startsWith("voice.")) {
      if (event.type !== "voice.input.chunk" && eventChannelId === activeChannelIdRef.current) {
        setVoiceEvents((current) => mergeEventsChronologically(current, [event]));
      }
      return;
    }

    const cacheableRealtimeEvent =
      (event.type === "message.created" && !isHiddenUiActionMessage(event)) || isTraceEvent(event);
    if (cacheableRealtimeEvent) {
      updateCachedChannelEvents(eventChannelId, [event]);
    }

    const currentActiveId = activeChannelIdRef.current;
    if (eventChannelId === currentActiveId && (event.type === "message.created" || isTraceEvent(event))) {
      const hiddenUiAction = isHiddenUiActionMessage(event);
      const shouldAutoScroll = isMessagesPanelNearBottom();
      if (!hiddenUiAction) {
        setEvents((current) => mergeEventsChronologically(current, [event]));
        if (event.type === "message.created") enqueueAgentVoicePlayback(event);
      }
      if (event.type === "message.created" || event.type === "agent.turn.failed") {
        const eventCreatedAt = event.createdAt ?? 0;
        if (eventCreatedAt > 0) {
          lastSeenByChannelRef.current[eventChannelId] = Math.max(
            lastSeenByChannelRef.current[eventChannelId] ?? 0,
            eventCreatedAt
          );
          lastLoadedMessageAtByChannelRef.current[eventChannelId] = Math.max(
            lastLoadedMessageAtByChannelRef.current[eventChannelId] ?? 0,
            eventCreatedAt
          );
        }
      }
      const timelineCreatedAt = event.createdAt ?? 0;
      if (timelineCreatedAt > 0) {
        lastLoadedTimelineAtByChannelRef.current[eventChannelId] = Math.max(
          lastLoadedTimelineAtByChannelRef.current[eventChannelId] ?? 0,
          timelineCreatedAt
        );
      }
      setUnreadCounts((current) => {
        if (!current[eventChannelId]) return current;
        const next = { ...current };
        delete next[eventChannelId];
        return next;
      });
      if (hiddenUiAction) return;
      if (shouldAutoScroll) {
        setHasNewMessagesBelow(false);
        scrollMessagesToBottom();
      } else {
        setHasNewMessagesBelow(true);
      }
      return;
    }

    if (event.type !== "message.created") return;
    if (isHiddenUiActionMessage(event)) return;
    if (eventChannelId === currentActiveId) return;

    const channel = channelsRef.current.find((candidate) => candidate.id === eventChannelId);
    if (!channel || channel.archivedAt) return;
    if (
      !channelVisibleToUserUi(
        channel,
        userIdRef.current,
        usernameRef.current,
        viewerTeamIdsRef.current
      )
    ) {
      return;
    }
    const eventCreatedAt = event.createdAt ?? 0;
    if (eventCreatedAt <= (lastSeenByChannelRef.current[eventChannelId] ?? 0)) return;

    setUnreadCounts((current) => ({
      ...current,
      [eventChannelId]: (current[eventChannelId] ?? 0) + 1
    }));
  }

  useEffect(() => {
    document.title = "OrgOps User UI";
    void loadSession();
  }, []);

  useEffect(() => {
    const label = activeChannel ? channelLabel(activeChannel, username) : "";
    document.title = label ? `${label} - OrgOps` : "OrgOps User UI";
    if (activeChannelId) {
      updateChannelDeepLink(activeChannelId, true, activeChannel, username);
    }
  }, [activeChannel, activeChannelId, username]);

  useEffect(() => {
    if (!authenticated || mustChangePassword) return;
    void loadShell();
  }, [authenticated, mustChangePassword]);

  useEffect(() => {
    messageFetchSeqRef.current += 1;
    if (liveVoiceSessionIdRef.current && activeChannelIdRef.current !== activeChannelId) {
      void stopLiveVoice("channel_changed");
    }
    activeChannelIdRef.current = activeChannelId;
    forceScrollToBottomOnLoadRef.current = Boolean(activeChannelId);
    const cachedEvents = activeChannelId ? channelEventsCacheRef.current[activeChannelId] : undefined;
    loadingChannelIdRef.current = activeChannelId && !cachedEvents ? activeChannelId : null;
    setEvents(cachedEvents ?? []);
    setMessagesLoading(Boolean(activeChannelId && !cachedEvents));
    setLoadingOlderMessages(false);
    setHasOlderMessages(activeChannelId ? Boolean(hasOlderMessagesByChannelRef.current[activeChannelId]) : false);
    setHasNewMessagesBelow(false);
    setExpandedTraceEventId(null);
    setShowParticipantsDialog(false);
    setShowChannelManageDialog(false);
    setPendingAttachments([]);
    setShareValue("");
    setShareLinkCopied(false);
    setShareRemovingKey(null);
    setShareSubmitting(false);
  }, [activeChannelId]);

  useEffect(() => {
    const endLiveSessionOnExit = () => {
      const sessionId = liveVoiceSessionIdRef.current;
      const roomId = liveVoiceRoomIdRef.current;
      const channelId = liveVoiceChannelIdRef.current;
      if (!sessionId || !channelId) return;
      const source = `human:${usernameRef.current || "user"}`;
      const endedAt = Date.now();
      const beacons = [
        ...(roomId
          ? [
              {
                type: "voice.room.ended",
                payload: { roomId, sessionId, endedAt, reason: "page_closed" },
                source,
                channelId
              }
            ]
          : []),
        {
          type: "voice.session.ended",
          payload: { sessionId, endedAt, reason: "page_closed" },
          source,
          channelId
        },
        ...liveVoiceCallsRef.current.map((call) => ({
          type: "voice.realtime.call.ended",
          payload: {
            targetAgentName: call.agentName,
            callId: call.callId,
            ...(roomId ? { roomId } : {}),
            sessionId,
            endedAt,
            reason: "page_closed"
          },
          source,
          channelId
        }))
      ];
      for (const beacon of beacons) {
        void apiFetch("/api/events", {
          method: "POST",
          headers: getApiHeaders(),
          keepalive: true,
          body: JSON.stringify(beacon)
        }).catch(() => undefined);
      }
    };
    window.addEventListener("pagehide", endLiveSessionOnExit);
    return () => {
      window.removeEventListener("pagehide", endLiveSessionOnExit);
      endLiveSessionOnExit();
      closeLiveVoiceMedia();
      stopVoiceTracks();
    };
  }, []);

  useEffect(() => {
    if (!authenticated || mustChangePassword) return;
    let cancelled = false;
    apiJson<VoiceConfig>("/api/voice/config")
      .then((config) => {
        if (!cancelled) setVoiceConfig(config);
      })
      .catch(() => {
        if (!cancelled) setVoiceConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, mustChangePassword]);

  useEffect(() => {
    setVoiceEvents([]);
    setVoiceHint(null);
    if (!authenticated || !activeChannelId) return;
    let cancelled = false;
    const channelParam = encodeURIComponent(activeChannelId);
    Promise.all(
      [
        "voice.room.started",
        "voice.room.ended",
        "voice.session.started",
        "voice.session.ended",
        "voice.participant.muted",
        "voice.active_speaker.changed"
      ].map(
        (type) =>
          apiJson<EventRow[]>(`/api/events?channelId=${channelParam}&type=${type}&limit=50&order=desc`).catch(
            () => [] as EventRow[]
          )
      )
    ).then((groups) => {
      if (cancelled) return;
      const merged = groups.flat().sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
      setVoiceEvents((current) => mergeEventsChronologically(merged, current));
    });
    return () => {
      cancelled = true;
    };
  }, [authenticated, activeChannelId]);

  useEffect(() => {
    if (!directVoiceMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!directVoiceMenuRef.current?.contains(event.target as Node)) setDirectVoiceMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDirectVoiceMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [directVoiceMenuOpen]);

  useEffect(() => {
    if (!voiceMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!voiceMenuRef.current?.contains(event.target as Node)) setVoiceMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVoiceMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [voiceMenuOpen]);

  useEffect(() => {
    setDirectVoiceMenuOpen(false);
    setVoiceMenuOpen(false);
  }, [activeChannelId, liveVoiceSessionId]);

  useEffect(() => {
    if (!recordingVoice) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      stopVoiceRecording(true);
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [recordingVoice]);

  useEffect(() => {
    if (!voiceHint) return;
    const timer = window.setTimeout(() => setVoiceHint(null), 4000);
    return () => window.clearTimeout(timer);
  }, [voiceHint]);

  const voiceClockActive = Boolean(liveVoiceSessionId) || othersLiveInChannel.length > 0;
  useEffect(() => {
    if (!voiceClockActive) return;
    setVoiceClock(Date.now());
    const timer = window.setInterval(() => setVoiceClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [voiceClockActive]);

  useEffect(() => {
    if (!authenticated || mustChangePassword) return;
    if (!activeChannelId) {
      setEvents([]);
      return;
    }
    const cachedEvents = channelEventsCacheRef.current[activeChannelId];
    if (wsConnected && cachedEvents) {
      markChannelSeen(activeChannelId, cachedEvents);
      setEvents(cachedEvents);
      setHasOlderMessages(Boolean(hasOlderMessagesByChannelRef.current[activeChannelId]));
      setMessagesLoading(false);
      scrollMessagesToBottom("auto");
      return;
    }
    void loadMessages(activeChannelId, {
      scrollBehavior: "auto",
      scrollToBottom: true,
      showLoading: true
    });
  }, [activeChannelId, authenticated, mustChangePassword, wsConnected]);

  useEffect(() => {
    if (!activeChannelId || messagesLoading) return;
    if (!forceScrollToBottomOnLoadRef.current) return;
    forceScrollToBottomOnLoadRef.current = false;
    // Run after paint to handle initial DOM/layout settling on hard reload.
    window.requestAnimationFrame(() => {
      scrollMessagesToBottom("auto");
      window.requestAnimationFrame(() => {
        scrollMessagesToBottom("auto");
      });
    });
  }, [activeChannelId, messagesLoading, timelineItems.length]);

  useEffect(() => {
    if (!authenticated || mustChangePassword) return;
    void loadMessageNotifications();
  }, [authenticated, mustChangePassword, channels]);

  useEffect(() => {
    if (!authenticated || mustChangePassword) return;
    wsShouldReconnectRef.current = true;
    const url = wsUrl();

    const clearReconnectTimer = () => {
      if (wsReconnectTimerRef.current !== null) {
        window.clearTimeout(wsReconnectTimerRef.current);
        wsReconnectTimerRef.current = null;
      }
    };

    const subscribeTopic = (topic: string) => {
      if (!wsSubscribedTopicsRef.current.has(topic)) {
        wsSubscribedTopicsRef.current.add(topic);
      }
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "subscribe", topic }));
      }
    };

    const connect = () => {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        setWsConnected(true);
        wsReconnectAttemptRef.current = 0;
        for (const topic of wsSubscribedTopicsRef.current) {
          ws.send(JSON.stringify({ type: "subscribe", topic }));
        }
        const liveChannelId = activeChannelIdRef.current;
        if (liveChannelId) {
          void loadMessages(liveChannelId);
        }
        void loadMessageNotifications();
      };
      ws.onmessage = (raw) => {
        try {
          const parsed = JSON.parse(String(raw.data)) as WsServerEventMessage;
          if (parsed.type === "event" && parsed.data) {
            handleIncomingRealtimeEvent(parsed.data);
          }
        } catch {
          // Ignore malformed payloads from background topics.
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        setWsConnected(false);
        if (!wsShouldReconnectRef.current) return;
        const delay = Math.min(5000, 400 * 2 ** wsReconnectAttemptRef.current);
        wsReconnectAttemptRef.current += 1;
        clearReconnectTimer();
        wsReconnectTimerRef.current = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      wsShouldReconnectRef.current = false;
      clearReconnectTimer();
      wsRef.current?.close();
      wsRef.current = null;
      wsReconnectAttemptRef.current = 0;
      wsSubscribedTopicsRef.current.clear();
      setWsConnected(false);
    };
  }, [authenticated, mustChangePassword]);

  useEffect(() => {
    if (!authenticated || mustChangePassword) return;
    const desiredTopics = new Set<string>();
    for (const channel of visibleChannels) {
      desiredTopics.add(`channel:${channel.id}`);
    }
    const ws = wsRef.current;
    for (const topic of [...wsSubscribedTopicsRef.current]) {
      if (!desiredTopics.has(topic)) {
        wsSubscribedTopicsRef.current.delete(topic);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "unsubscribe", topic }));
        }
      }
    }
    for (const topic of desiredTopics) {
      if (!wsSubscribedTopicsRef.current.has(topic)) {
        wsSubscribedTopicsRef.current.add(topic);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "subscribe", topic }));
        }
      }
    }
  }, [authenticated, mustChangePassword, visibleChannels]);

  useEffect(() => {
    if (!authenticated || mustChangePassword || wsConnected) return;
    const interval = window.setInterval(() => {
      const liveChannelId = activeChannelIdRef.current;
      if (liveChannelId) void loadMessages(liveChannelId);
      void loadMessageNotifications();
    }, 10000);
    return () => window.clearInterval(interval);
  }, [authenticated, mustChangePassword, wsConnected]);

  useEffect(() => {
    if (!authenticated || mustChangePassword) return;
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setLayoutPrefs((current) => {
          const next = { ...current, sidebarCollapsed: !current.sidebarCollapsed };
          writeLayoutPrefs(next);
          return next;
        });
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowConversationDialog(false);
        setShowCommandPalette((current) => !current);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        composerTextareaRef.current?.focus();
      }
      if (event.key === "Escape") {
        setShowConversationDialog(false);
        setShowCommandPalette(false);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [authenticated, mustChangePassword]);

  useEffect(() => {
    if (!showConversationDialog) return;
    window.requestAnimationFrame(() => conversationNameInputRef.current?.focus());
  }, [showConversationDialog]);

  useEffect(() => {
    if (!authenticated || mustChangePassword) return;
    function handlePopState() {
      const linkedChannelId = readLinkedChannelId();
      const linkedChannel = channels.find(
        (channel) =>
          channel.id === linkedChannelId &&
          channelVisibleToUserUi(channel, userId, username, viewerTeamIds)
      );
      if (linkedChannel?.archivedAt) setShowArchivedChannels(true);
      setActiveChannelId(linkedChannel?.id ?? null);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [authenticated, channels, mustChangePassword, userId, username, viewerTeamIds]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setAuthLoading(true);
    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword
        })
      });
      setLoginPassword("");
      await loadSession();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Unable to sign in");
      setAuthenticated(false);
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setAuthenticated(false);
    setUsername("");
    setUserId(null);
    setMustChangePassword(false);
    setNewPassword("");
    setConfirmPassword("");
    setChannels([]);
    setAgents([]);
    setTeams([]);
    setEvents([]);
    setActiveChannelId(null);
    updateChannelDeepLink(null, true);
    setShowCommandPalette(false);
    setConversationName("");
    setConversationDescription("");
    setConversationVisibility("PRIVATE");
    setSelectedConversationAgents([]);
    setSelectedConversationTeams([]);
    setAgentSearchQuery("");
    setTeamSearchQuery("");
    setShowArchivedChannels(false);
    setShowConversationDialog(false);
    setUnreadCounts({});
    setHasNewMessagesBelow(false);
    setExpandedTraceEventId(null);
    lastSeenByChannelRef.current = {};
    lastLoadedMessageAtByChannelRef.current = {};
    lastLoadedTimelineAtByChannelRef.current = {};
  }

  async function handlePasswordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const nextPassword = newPassword.trim();
    if (nextPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (nextPassword !== confirmPassword.trim()) {
      setError("New password and confirmation do not match.");
      return;
    }

    setAuthLoading(true);
    try {
      await apiFetch("/api/auth/profile", {
        method: "PATCH",
        headers: getApiHeaders(),
        body: JSON.stringify({
          username: username || loginUsername.trim(),
          newPassword: nextPassword
        })
      });
      setNewPassword("");
      setConfirmPassword("");
      await loadSession();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update password");
    } finally {
      setAuthLoading(false);
    }
  }

  async function sendChannelMessage(text: string, attachments: UploadedAttachment[]) {
    if (!activeChannelId || activeChannel?.archivedAt || !activeChannelCanPost) return;
    setSending(true);
    setError(null);
    try {
      const readyVoiceAttachments = attachments.filter((attachment) => attachment.kind === "voice");
      const effectiveText =
        text.trim() ||
        (readyVoiceAttachments.length === attachments.length
          ? `Voice message${readyVoiceAttachments.length === 1 ? "" : "s"} attached.`
          : `Attached ${attachments.length} file${attachments.length === 1 ? "" : "s"} for reference.`);
      await apiFetch("/api/events", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          type: "message.created",
          payload: {
            text: effectiveText,
            ...(attachments.length > 0 ? { attachments } : {}),
            ...(readyVoiceAttachments.length > 0
              ? {
                  media: {
                    kind: "voice",
                    attachments: readyVoiceAttachments.map((attachment) => ({
                      fileId: attachment.fileId,
                      mime: attachment.mime,
                      durationMs: attachment.durationMs,
                    })),
                  },
                }
              : {})
          },
          source: `human:${username || "user"}`,
          channelId: activeChannelId
        })
      });
      draftRef.current = "";
      if (composerTextareaRef.current) {
        composerTextareaRef.current.value = "";
        resizeComposerTextarea(composerTextareaRef.current);
      }
      setDraftHasText(false);
      setPendingAttachments([]);
      setHasNewMessagesBelow(false);
      if (wsConnected) {
        scrollMessagesToBottom();
      } else {
        await loadMessages(activeChannelId, { scrollToBottom: true });
      }
      window.requestAnimationFrame(() => {
        scrollMessagesToBottom("auto");
        composerTextareaRef.current?.scrollIntoView({ block: "nearest" });
      });
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send message");
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploadingAttachmentCount > 0) return;
    const trimmedText = draftRef.current.trim();
    if (!trimmedText && readyAttachments.length === 0) return;
    await sendChannelMessage(trimmedText, readyAttachments);
  }

  function addConversationAgent(agentName: string) {
    setSelectedConversationAgents((current) =>
      current.includes(agentName) ? current : [...current, agentName]
    );
    setAgentSearchQuery("");
  }

  function removeConversationAgent(agentName: string) {
    setSelectedConversationAgents((current) => current.filter((name) => name !== agentName));
  }

  function addConversationTeam(teamId: string) {
    setSelectedConversationTeams((current) =>
      current.includes(teamId) ? current : [...current, teamId]
    );
    setTeamSearchQuery("");
    setConversationVisibility("PRIVATE");
  }

  function removeConversationTeam(teamId: string) {
    setSelectedConversationTeams((current) => current.filter((id) => id !== teamId));
  }

  function updateLayoutPrefs(patch: Partial<LayoutPrefs>) {
    setLayoutPrefs((current) => {
      const next = { ...current, ...patch };
      writeLayoutPrefs(next);
      return next;
    });
  }

  function handleSidebarResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const shell = appShellRef.current;
    handle.setPointerCapture(event.pointerId);
    setResizingSidebar(true);
    let width = layoutPrefs.sidebarCollapsed ? SIDEBAR_RAIL_WIDTH : layoutPrefs.sidebarWidth;

    const handleMove = (moveEvent: PointerEvent) => {
      width = moveEvent.clientX;
      const visibleWidth = width < SIDEBAR_MIN_WIDTH * 0.6 ? SIDEBAR_RAIL_WIDTH : clampSidebarWidth(width);
      shell?.style.setProperty("--sidebar-width", `${visibleWidth}px`);
    };
    const handleUp = () => {
      handle.removeEventListener("pointermove", handleMove);
      handle.removeEventListener("pointerup", handleUp);
      handle.removeEventListener("pointercancel", handleUp);
      shell?.style.removeProperty("--sidebar-width");
      setResizingSidebar(false);
      if (width < SIDEBAR_MIN_WIDTH * 0.6) {
        updateLayoutPrefs({ sidebarCollapsed: true });
      } else {
        updateLayoutPrefs({ sidebarCollapsed: false, sidebarWidth: clampSidebarWidth(width) });
      }
    };
    handle.addEventListener("pointermove", handleMove);
    handle.addEventListener("pointerup", handleUp);
    handle.addEventListener("pointercancel", handleUp);
  }

  function togglePinnedChannel(channelId: string) {
    setPinnedChannelIds((current) => {
      const next = current.includes(channelId)
        ? current.filter((id) => id !== channelId)
        : [channelId, ...current];
      writePinnedChannelIds(next);
      return next;
    });
  }

  async function refreshChannels(nextActiveChannelId?: string | null) {
    const nextChannels = await apiJson<Channel[]>("/api/channels?includeArchived=1");
    setChannels(nextChannels);
    const visibleChannels = nextChannels.filter((channel) =>
      channelVisibleToUserUi(channel, userId, username, viewerTeamIds)
    );
    const nextSelectedChannelId =
      nextActiveChannelId !== undefined
        ? nextActiveChannelId
        : activeChannelId &&
            visibleChannels.some((channel) => channel.id === activeChannelId && !channel.archivedAt)
          ? activeChannelId
          : visibleChannels.find((channel) => !channel.archivedAt)?.id ?? null;
    selectChannel(nextSelectedChannelId, { replace: true, channels: nextChannels });
    return nextChannels;
  }

  async function handleStartConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = conversationName.trim();
    const description = conversationDescription.trim();
    const selectedAgents = selectedConversationAgents.filter(Boolean);
    const selectedTeams = selectedConversationTeams.filter(Boolean);
    setError(null);

    if (!name && selectedAgents.length !== 1 && selectedTeams.length === 0) {
      setError("Choose one agent for a direct message, or add a channel name.");
      return;
    }
    if (!name && selectedTeams.length > 0) {
      setError("Add a channel name for team channels.");
      return;
    }

    setLoading(true);
    try {
      if (!name) {
        const direct = await apiJson<{ id: string }>("/api/channels/direct/human-agent", {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify({ agentName: selectedAgents[0] })
        });
        setCollapsedChannelGroups((current) => ({ ...current, direct: false }));
        await refreshChannels(direct.id);
      } else {
        const created = await apiJson<{ id: string }>("/api/channels", {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify({
            name,
            description: description || undefined,
            visibility: selectedTeams.length > 0 ? "PRIVATE" : conversationVisibility
          })
        });
        await Promise.all([
          username
            ? apiFetch(`/api/channels/${encodeURIComponent(created.id)}/subscribe`, {
                method: "POST",
                headers: getApiHeaders(),
                body: JSON.stringify({ subscriberType: "HUMAN", subscriberId: username })
              }).catch(() => undefined)
            : Promise.resolve(),
          ...selectedAgents.map((agentName) =>
            apiFetch(`/api/channels/${encodeURIComponent(created.id)}/subscribe`, {
              method: "POST",
              headers: getApiHeaders(),
              body: JSON.stringify({ subscriberType: "AGENT", subscriberId: agentName })
            })
          ),
          ...selectedTeams.map((teamId) =>
            apiFetch(`/api/channels/${encodeURIComponent(created.id)}/subscribe`, {
              method: "POST",
              headers: getApiHeaders(),
              body: JSON.stringify({ subscriberType: "TEAM", subscriberId: teamId })
            })
          )
        ]);
        setCollapsedChannelGroups((current) => ({ ...current, channels: false }));
        await refreshChannels(created.id);
      }
      setConversationName("");
      setConversationDescription("");
      setSelectedConversationAgents([]);
      setSelectedConversationTeams([]);
      setConversationVisibility("PRIVATE");
      setAgentSearchQuery("");
      setTeamSearchQuery("");
      setShowConversationDialog(false);
    } catch (conversationError) {
      setError(
        conversationError instanceof Error
          ? conversationError.message
          : "Unable to start conversation"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteChannel(channel: Channel) {
    if (!window.confirm(`Permanently delete ${channelLabel(channel, username)}?`)) return;
    setError(null);
    setLoading(true);
    try {
      await apiFetch(`/api/channels/${encodeURIComponent(channel.id)}`, { method: "DELETE" });
      await refreshChannels(activeChannelId === channel.id ? null : undefined);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete channel");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveChannelSettings() {
    if (!activeChannel) return;
    setUpdatingChannelVisibility(true);
    setError(null);
    try {
      const currentVisibility = activeChannel.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE";
      if (channelVisibilityDraft !== currentVisibility) {
        await apiFetch(`/api/channels/${encodeURIComponent(activeChannel.id)}`, {
          method: "PATCH",
          headers: getApiHeaders(),
          body: JSON.stringify({ visibility: channelVisibilityDraft })
        });
      }
      const currentlyArchived = Boolean(activeChannel.archivedAt);
      if (archiveDraft !== currentlyArchived) {
        await apiFetch(
          `/api/channels/${encodeURIComponent(activeChannel.id)}/${archiveDraft ? "archive" : "unarchive"}`,
          { method: "POST" }
        );
        if (archiveDraft) setShowArchivedChannels(true);
      }
      await refreshChannels(activeChannel.id);
      setShowChannelManageDialog(false);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update channel settings");
    } finally {
      setUpdatingChannelVisibility(false);
    }
  }

  async function handleAddParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeChannelId || !participantValue.trim()) return;
    setParticipantSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/channels/${encodeURIComponent(activeChannelId)}/subscribe`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          subscriberType: participantKind,
          subscriberId: participantValue.trim()
        })
      });
      await refreshChannels(activeChannelId);
      setParticipantValue("");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Unable to add participant");
    } finally {
      setParticipantSubmitting(false);
    }
  }

  async function handleRemoveParticipant(participant: ChannelParticipant) {
    if (!activeChannelId) return;
    const participantKey = `${participant.subscriberType}:${participant.subscriberId}`;
    setParticipantRemovingKey(participantKey);
    setError(null);
    try {
      await apiFetch(`/api/channels/${encodeURIComponent(activeChannelId)}/unsubscribe`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          subscriberType: participant.subscriberType,
          subscriberId: participant.subscriberId
        })
      });
      await refreshChannels(activeChannelId);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove participant");
    } finally {
      setParticipantRemovingKey(null);
    }
  }

  async function handleAddShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeChannelId || !shareValue.trim()) return;
    setShareSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/channels/${encodeURIComponent(activeChannelId)}/share`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          viewerType: shareKind,
          viewerId: shareValue.trim()
        })
      });
      await refreshChannels(activeChannelId);
      setShareValue("");
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : "Unable to share channel");
    } finally {
      setShareSubmitting(false);
    }
  }

  async function handleRemoveShare(share: ChannelShare) {
    if (!activeChannelId) return;
    const shareKey = `${share.viewerType}:${share.viewerId}`;
    setShareRemovingKey(shareKey);
    setError(null);
    try {
      await apiFetch(`/api/channels/${encodeURIComponent(activeChannelId)}/unshare`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          viewerType: share.viewerType,
          viewerId: share.viewerId
        })
      });
      await refreshChannels(activeChannelId);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove shared viewer");
    } finally {
      setShareRemovingKey(null);
    }
  }

  function handleMessagesScroll() {
    const atBottom = isMessagesPanelScrolledToBottom();
    // Smooth auto-scrolls pass through intermediate positions; those are not the user scrolling away.
    if (performance.now() >= messagesAutoScrollUntilRef.current) {
      messagesPinnedToBottomRef.current = atBottom;
    }
    if (hasNewMessagesBelow && atBottom) {
      setHasNewMessagesBelow(false);
    }
  }

  async function handleCopyShareLink() {
    if (!activeChannelId) return;
    try {
      const created = await apiJson<{ token: string; channelId: string }>(
        `/api/channels/${encodeURIComponent(activeChannelId)}/share-link`,
        {
          method: "POST",
          headers: getApiHeaders()
        }
      );
      const url = new URL(window.location.href);
      url.searchParams.set("share", created.token);
      url.searchParams.set("channel", created.channelId);
      const slug = channelSlug(activeChannel, username);
      if (slug) url.searchParams.set("slug", slug);
      const shareLink = url.toString();
      await navigator.clipboard.writeText(shareLink);
      setShareLinkCopied(true);
      window.setTimeout(() => setShareLinkCopied(false), 2000);
    } catch {
      setError("Unable to copy link. Please copy it from the address bar.");
    }
  }

  async function uploadSingleFile(
    file: File,
    options: { kind?: "voice"; durationMs?: number } = {},
  ): Promise<UploadedAttachment | null> {
    const localId = createLocalAttachmentId();
    const mime = file.type || "application/octet-stream";
    setPendingAttachments((current) => [
      ...current,
      {
        localId,
        name: file.name || "upload",
        mime,
        size: file.size,
        status: "uploading"
      }
    ]);
    try {
      const body = new FormData();
      body.append("file", file, file.name);
      const uploadResponse = await apiFetch("/api/files", { method: "POST", body });
      const uploadPayload = (await uploadResponse.json()) as { id: string };
      const meta = await apiJson<{
        id: string;
        original_name?: string;
        mime?: string;
        size?: number;
        sha256?: string;
      }>(`/api/files/${encodeURIComponent(uploadPayload.id)}/meta`);
      const uploaded: UploadedAttachment = {
        localId,
        fileId: uploadPayload.id,
        name: meta.original_name || file.name || "upload",
        mime: meta.mime || mime,
        size: typeof meta.size === "number" ? meta.size : file.size,
        ...(typeof meta.sha256 === "string" && meta.sha256 ? { sha256: meta.sha256 } : {}),
        ...(options.kind ? { kind: options.kind } : {}),
        ...(typeof options.durationMs === "number" ? { durationMs: options.durationMs } : {})
      };
      setPendingAttachments((current) =>
        current.map((item) =>
          item.localId === localId
            ? {
                ...item,
                name: uploaded.name,
                mime: uploaded.mime,
                size: uploaded.size,
                status: "ready",
                uploaded,
                error: undefined
              }
            : item
        )
      );
      return uploaded;
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Upload failed";
      setPendingAttachments((current) =>
        current.map((item) =>
          item.localId === localId ? { ...item, status: "error", error: message } : item
        )
      );
      return null;
    }
  }

  function uploadFiles(files: File[]) {
    for (const file of files) {
      void uploadSingleFile(file);
    }
  }

  function stopVoiceTracks() {
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
  }

  function micErrorMessage(error: unknown) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "Microphone access is blocked. Allow it in the browser's site settings and try again.";
    }
    if (name === "NotFoundError") return "No microphone was found on this device.";
    return error instanceof Error ? error.message : "Unable to access the microphone";
  }

  async function emitVoiceEvent(type: string, payload: Record<string, unknown>, channelIdOverride?: string) {
    const channelId = channelIdOverride || activeChannelIdRef.current || activeChannelId;
    if (!channelId) return null;
    return apiJson<EventRow>("/api/events", {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({
        type,
        payload,
        source: `human:${username || "user"}`,
        channelId,
      }),
    });
  }

  async function uploadVoiceBlob(blob: Blob, prefix: string) {
    const mime = blob.type || "audio/webm";
    const file = new File([blob], `${prefix}-${Date.now()}.${voiceFileExtension(mime)}`, { type: mime });
    const body = new FormData();
    body.append("file", file, file.name);
    const uploadResponse = await apiFetch("/api/files", { method: "POST", body });
    const uploadPayload = (await uploadResponse.json()) as { id: string };
    return { fileId: uploadPayload.id, name: file.name, mime, size: blob.size };
  }

  function updatePendingVoiceNote(localId: string, patch: Partial<PendingVoiceNote>) {
    setPendingVoiceNotes((current) =>
      current.map((note) => (note.localId === localId ? { ...note, ...patch } : note))
    );
  }

  function resolvePendingVoiceChunk(chunkEventId: string) {
    resolvedVoiceChunkIdsRef.current.add(chunkEventId);
    setPendingVoiceNotes((current) => current.filter((note) => note.chunkEventId !== chunkEventId));
  }

  async function publishVoiceChunk(
    blob: Blob,
    channelId: string,
    chunk: {
      mode: "message";
      startedAt: number;
      endedAt: number;
      durationMs: number;
    }
  ) {
    const localId = createLocalAttachmentId();
    setPendingVoiceNotes((current) => [
      ...current,
      { localId, channelId, mode: chunk.mode, status: "uploading", durationMs: chunk.durationMs }
    ]);
    try {
      const attachment = await uploadVoiceBlob(blob, "voice");
      updatePendingVoiceNote(localId, { status: "transcribing" });
      const speaker = username || "user";
      const created = await emitVoiceEvent(
        "voice.input.chunk",
        {
          ...chunk,
          speakerId: speaker,
          attachment,
          text: `${speaker} sent a voice message.`
        },
        channelId
      );
      const chunkEventId = created?.id;
      if (!chunkEventId || resolvedVoiceChunkIdsRef.current.has(chunkEventId)) {
        setPendingVoiceNotes((current) => current.filter((note) => note.localId !== localId));
        return;
      }
      updatePendingVoiceNote(localId, { chunkEventId });
      window.setTimeout(() => {
        setPendingVoiceNotes((current) => {
          if (!current.some((note) => note.localId === localId)) return current;
          void loadMessages(channelId);
          return current.filter((note) => note.localId !== localId);
        });
      }, VOICE_PENDING_TIMEOUT_MS);
    } catch (publishError) {
      updatePendingVoiceNote(localId, {
        status: "error",
        error: publishError instanceof Error ? publishError.message : "Unable to send voice"
      });
    }
  }

  function closeLiveVoiceMedia() {
    liveVoiceMeterRef.current?.stop();
    liveVoiceMeterRef.current = null;
    const peers = liveVoicePeerRefs.current;
    liveVoicePeerRefs.current = [];
    for (const peer of peers) {
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }
    const liveKitRoom = liveKitRoomRef.current;
    liveKitRoomRef.current = null;
    if (liveKitRoom) {
      liveKitRoom.removeAllListeners();
      liveKitRoom.disconnect();
    }
    for (const element of liveKitAudioElementsRef.current) {
      element.pause();
      element.srcObject = null;
      element.remove();
    }
    liveKitAudioElementsRef.current = [];
    const audio = liveVoiceAudioRef.current;
    liveVoiceAudioRef.current = null;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }
    liveVoiceRemoteStreamRef.current = null;
    liveVoiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveVoiceStreamRef.current = null;
  }

  function liveVoiceErrorMessage(error: unknown) {
    if (error instanceof DOMException) return micErrorMessage(error);
    const message = error instanceof Error ? error.message : String(error);
    try {
      const parsed = JSON.parse(message) as { error?: unknown };
      if (typeof parsed.error === "string") return parsed.error;
    } catch {
      // Not a JSON API error body.
    }
    return message || "Unable to start the voice room";
  }

  function handleRealtimeDataEvent(message: { type?: string; item?: { type?: string; name?: string }; error?: { message?: string } }) {
    switch (message.type) {
      case "input_audio_buffer.speech_started": {
        setLiveVoiceActivity("you");
        const speaker = usernameRef.current || "user";
        const sessionId = liveVoiceSessionIdRef.current;
        if (sessionId && lastActiveSpeakerRef.current !== speaker) {
          lastActiveSpeakerRef.current = speaker;
          void emitVoiceEvent(
            "voice.active_speaker.changed",
            { sessionId, streamId: sessionId, speakerId: speaker, text: `${speaker} is speaking.` },
            liveVoiceChannelIdRef.current ?? undefined
          ).catch(() => undefined);
        }
        return;
      }
      case "input_audio_buffer.speech_stopped":
        setLiveVoiceActivity("thinking");
        return;
      case "output_audio_buffer.started":
        lastActiveSpeakerRef.current = null;
        setLiveVoiceToolName(null);
        setLiveVoiceActivity("agent");
        return;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        setLiveVoiceActivity((current) => (current === "agent" ? "listening" : current));
        return;
      case "response.output_item.done":
        if (message.item?.type === "function_call") {
          setLiveVoiceToolName(message.item.name ?? null);
          setLiveVoiceActivity("tool");
        }
        return;
      case "error":
        if (message.error?.message) setError(`Voice call: ${message.error.message}`);
        return;
      default:
        return;
    }
  }

  async function connectLiveKitVoiceRoom(input: {
    channelId: string;
    sessionId: string;
    stream: MediaStream;
  }) {
    const join = await apiJson<VoiceRoomJoinResponse>("/api/voice/rooms/join", {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({ channelId: input.channelId, sessionId: input.sessionId })
    });
    if (join.broker !== "livekit") return null;
    const room = new Room();
    const attachRemoteAudio = (track: { kind: string; attach: () => HTMLMediaElement }) => {
      if (track.kind !== Track.Kind.Audio) return;
      const element = track.attach() as HTMLAudioElement;
      element.autoplay = true;
      element.muted = !liveVoiceSpeakerOnRef.current;
      element.style.display = "none";
      document.body.appendChild(element);
      liveKitAudioElementsRef.current = [...liveKitAudioElementsRef.current, element];
      void element.play().catch(() => undefined);
      setLiveVoiceActivity((current) => (current === "connecting" ? "listening" : current));
    };
    room.on(RoomEvent.TrackSubscribed, (track) => {
      attachRemoteAudio(track);
    });
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const identities = speakers.map((speaker) => speaker.identity);
      if (identities.some((identity) => identity.startsWith("agent:"))) {
        setLiveVoiceActivity("agent");
        return;
      }
      if (identities.some((identity) => identity.startsWith("human:"))) {
        setLiveVoiceActivity("you");
        return;
      }
      setLiveVoiceActivity((current) => (current === "connecting" ? "listening" : current === "you" || current === "agent" ? "listening" : current));
    });
    room.on(RoomEvent.Connected, () => {
      setLiveVoiceActivity((current) => (current === "connecting" ? "listening" : current));
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      for (const element of track.detach()) {
        element.pause();
        element.srcObject = null;
        element.remove();
        liveKitAudioElementsRef.current = liveKitAudioElementsRef.current.filter((candidate) => candidate !== element);
      }
    });
    await room.connect(join.url, join.token);
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        if (publication.track) attachRemoteAudio(publication.track);
      }
    }
    for (const track of input.stream.getAudioTracks()) {
      await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
    }
    liveKitRoomRef.current = room;
    return join;
  }

  async function startLiveVoice(mode: LiveVoiceMode) {
    if (
      liveVoiceSessionIdRef.current ||
      liveVoiceStarting ||
      (mode === "room" ? !canStartVoiceRoom : !canStartDirectVoice)
    ) {
      return;
    }
    voicePlaybackActiveRef.current?.pause();
    const channelId = activeChannelIdRef.current || activeChannelId;
    const agentNames =
      mode === "direct"
        ? directVoiceCallTarget
          ? [directVoiceCallTarget]
          : []
        : [...roomAgentNames];
    if (!channelId || agentNames.length === 0) return;
    if (mode === "direct" && (othersLiveInChannel.length > 0 || openVoiceRooms.length > 0)) {
      await endChannelVoicePresence("rejoined");
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      setError(`${mode === "room" ? "Voice rooms" : "Direct voice calls"} are not supported in this browser.`);
      return;
    }
    setLiveVoiceStarting(true);
    setLiveVoiceActivity("connecting");
    setLiveVoiceToolName(null);
    const sessionId = crypto.randomUUID();
    const usesLiveKit =
      liveKitRoomsEnabled &&
      (mode === "room" || !agentNames.every((name) => openaiRealtimeAgentNames.includes(name)));
    const existingRoom = mode === "room" ? openVoiceRooms[0] : null;
    const roomId = existingRoom?.roomId ?? (mode === "room" || usesLiveKit ? crypto.randomUUID() : null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      liveVoiceStreamRef.current = stream;
      const remoteStream = new MediaStream();
      liveVoiceRemoteStreamRef.current = remoteStream;
      const audio = new Audio();
      audio.autoplay = true;
      audio.muted = !liveVoiceSpeakerOnRef.current;
      audio.srcObject = remoteStream;
      liveVoiceAudioRef.current = audio;
      const liveKitJoin = usesLiveKit
        ? await connectLiveKitVoiceRoom({ channelId, sessionId, stream })
        : null;

      const calls: Array<{ callId: string; agentName: string }> = [];
      if (!usesLiveKit) {
        for (const agentName of agentNames) {
          const peer = new RTCPeerConnection();
          liveVoicePeerRefs.current = [...liveVoicePeerRefs.current, peer];
          peer.ontrack = (event) => {
            remoteStream.addTrack(event.track);
            void audio.play().catch(() => undefined);
          };
          peer.onconnectionstatechange = () => {
            if (!liveVoicePeerRefs.current.includes(peer)) return;
            if (liveVoicePeerRefs.current.some((candidate) => candidate.connectionState === "connected")) {
              setLiveVoiceActivity((current) => (current === "connecting" ? "listening" : current));
            }
            if (peer.connectionState === "failed") {
              setError(`${agentName}'s ${mode === "room" ? "voice room" : "direct voice"} connection failed.`);
            }
          };
          for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
          const events = peer.createDataChannel("oai-events");
          events.onmessage = (event) => {
            try {
              handleRealtimeDataEvent(JSON.parse(String(event.data)));
            } catch {
              // Ignore non-JSON frames.
            }
          };
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          const call = await apiJson<RealtimeCallResponse>("/api/voice/realtime/calls", {
            method: "POST",
            headers: getApiHeaders(),
            body: JSON.stringify({ channelId, agentName, sessionId, roomId: roomId ?? undefined, sdp: offer.sdp })
          });
          await peer.setRemoteDescription({ type: "answer", sdp: call.sdp });
          calls.push({ callId: call.callId, agentName: call.agentName });
        }
      }

      const now = Date.now();
      liveVoiceCallsRef.current = calls;
      liveVoiceSessionIdRef.current = sessionId;
      liveVoiceRoomIdRef.current = roomId;
      liveVoiceModeRef.current = mode;
      liveVoiceChannelIdRef.current = channelId;
      liveVoiceStartedAtRef.current = now;
      lastActiveSpeakerRef.current = null;
      liveVoiceMeterRef.current = createLevelMeter(stream, (level) =>
        liveVoiceLevelRef.current?.style.setProperty("--voice-level", level.toFixed(3))
      );
      setLiveVoiceSessionId(sessionId);
      setLiveVoiceAgentNames(usesLiveKit ? agentNames : calls.map((call) => call.agentName));
      setLiveVoiceMode(mode);
      setLiveVoiceMuted(false);
      setError(null);
      setVoiceHint(null);
      const speaker = username || "user";
      if (roomId && !existingRoom) {
        await emitVoiceEvent(
          "voice.room.started",
          {
            roomId,
            sessionId,
            broker: voiceConfig?.realtime?.rooms?.broker ?? "direct-openai-calls",
            agentNames,
            startedAt: now,
            ...(liveKitJoin ? { brokerRoomName: liveKitJoin.roomName } : {}),
            text: `${speaker} started a voice room with ${agentNames.join(", ")}.`
          },
          channelId
        ).catch(() => undefined);
      }
      await emitVoiceEvent(
        "voice.session.started",
        {
          sessionId,
          ...(roomId ? { roomId } : {}),
          startedAt: now,
          text:
            mode === "room"
              ? `${speaker} joined the voice room.`
              : `${speaker} started a direct voice call with ${agentNames[0] ?? "an agent"}.`
        },
        channelId
      ).catch(() => undefined);
    } catch (voiceError) {
      closeLiveVoiceMedia();
      liveVoiceCallsRef.current = [];
      liveVoiceSessionIdRef.current = null;
      liveVoiceRoomIdRef.current = null;
      liveVoiceModeRef.current = null;
      liveVoiceChannelIdRef.current = null;
      setLiveVoiceSessionId(null);
      setLiveVoiceAgentNames([]);
      setLiveVoiceMode(null);
      setError(liveVoiceErrorMessage(voiceError));
    } finally {
      setLiveVoiceStarting(false);
    }
  }

  async function setLiveVoiceMute(nextMuted: boolean) {
    const sessionId = liveVoiceSessionIdRef.current;
    if (!sessionId) return;
    for (const track of liveVoiceStreamRef.current?.getAudioTracks() ?? []) track.enabled = !nextMuted;
    setLiveVoiceMuted(nextMuted);
    if (nextMuted) setLiveVoiceActivity((current) => (current === "you" ? "listening" : current));
    const speaker = username || "user";
    await emitVoiceEvent(
      "voice.participant.muted",
      {
        sessionId,
        participantId: speaker,
        participantKind: "HUMAN",
        muted: nextMuted,
        text: `${speaker} ${nextMuted ? "muted" : "unmuted"} their microphone.`,
      },
      liveVoiceChannelIdRef.current ?? undefined
    ).catch(() => undefined);
  }

  function toggleLiveVoiceSpeaker() {
    const next = !liveVoiceSpeakerOnRef.current;
    liveVoiceSpeakerOnRef.current = next;
    setLiveVoiceSpeakerOn(next);
    if (liveVoiceAudioRef.current) liveVoiceAudioRef.current.muted = !next;
    for (const element of liveKitAudioElementsRef.current) element.muted = !next;
  }

  async function stopLiveVoice(reason = "left", options: { notifyAgent?: boolean } = {}) {
    const sessionId = liveVoiceSessionIdRef.current;
    const roomId = liveVoiceRoomIdRef.current;
    const mode = liveVoiceModeRef.current;
    const channelId = liveVoiceChannelIdRef.current;
    const calls = liveVoiceCallsRef.current;
    liveVoiceCallsRef.current = [];
    liveVoiceSessionIdRef.current = null;
    liveVoiceRoomIdRef.current = null;
    liveVoiceModeRef.current = null;
    liveVoiceChannelIdRef.current = null;
    closeLiveVoiceMedia();
    setLiveVoiceSessionId(null);
    setLiveVoiceAgentNames([]);
    setLiveVoiceMode(null);
    setLiveVoiceMuted(false);
    setLiveVoiceActivity("connecting");
    setLiveVoiceToolName(null);
    if (!sessionId || !channelId) return;
    setEndedLiveVoiceSessionIds((current) => [...current.slice(-20), sessionId]);
    const endedAt = Date.now();
    if (options.notifyAgent !== false) {
      await Promise.all(
        calls.map((call) =>
          emitVoiceEvent(
            "voice.realtime.call.ended",
            { targetAgentName: call.agentName, callId: call.callId, roomId: roomId ?? undefined, sessionId, endedAt, reason },
            channelId
          ).catch(() => undefined)
        )
      );
    }
    if (roomId) {
      await emitVoiceEvent(
        "voice.room.ended",
        { roomId, sessionId, endedAt, reason, text: `${username || "A human"} ended the voice room.` },
        channelId
      ).catch(() => undefined);
    }
    await emitVoiceEvent(
      "voice.session.ended",
      {
        sessionId,
        endedAt,
        reason,
        text:
          mode === "direct"
            ? `${username || "A human"} ended the direct voice call.`
            : `${username || "A human"} left the voice room.`
      },
      channelId
    ).catch(() => undefined);
  }

  async function endChannelVoicePresence(reason = "ended") {
    const channelId = activeChannelIdRef.current || activeChannelId;
    if (!channelId) return;
    const sessionIds = othersLiveInChannel.map((participant) => participant.sessionId);
    const rooms = openVoiceRooms;
    if (sessionIds.length === 0 && rooms.length === 0) return;
    setEndedLiveVoiceSessionIds((current) => [...current.slice(-20), ...sessionIds]);
    const endedAt = Date.now();
    const speaker = username || "A human";
    await Promise.all([
      ...sessionIds.map((sessionId) =>
        emitVoiceEvent(
          "voice.session.ended",
          {
            sessionId,
            endedAt,
            reason,
            text: `${speaker} ended a leftover voice session.`
          },
          channelId
        ).catch(() => undefined)
      ),
      ...rooms.map((room) =>
        emitVoiceEvent(
          "voice.room.ended",
          {
            roomId: room.roomId,
            sessionId: room.sessionId,
            endedAt,
            reason,
            text: `${speaker} ended the voice room.`
          },
          channelId
        ).catch(() => undefined)
      )
    ]);
  }

  function clearVoiceRecordingTimers() {
    voiceMeterRef.current?.stop();
    voiceMeterRef.current = null;
    if (voiceMaxTimerRef.current !== null) {
      window.clearTimeout(voiceMaxTimerRef.current);
      voiceMaxTimerRef.current = null;
    }
  }

  async function startVoiceRecording() {
    if (recordingVoice || !canSendVoiceMessage || liveVoiceSessionIdRef.current) return;
    voicePlaybackActiveRef.current?.pause();
    const channelId = activeChannelIdRef.current || activeChannelId;
    if (!channelId) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording is not supported in this browser.");
      return;
    }
    voicePointerHeldRef.current = true;
    voiceCancelledRef.current = false;
    setVoiceHint(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      if (!voicePointerHeldRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        setVoiceHint("Microphone ready. Press and hold the mic while you speak.");
        return;
      }
      const mimeType = pickVoiceMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      voiceChunksRef.current = [];
      voiceStartedAtRef.current = Date.now();
      if (voiceElapsedRef.current) voiceElapsedRef.current.textContent = "0:00";
      voiceStreamRef.current = stream;
      voiceRecorderRef.current = recorder;
      voiceMeterRef.current = createLevelMeter(stream, (level) => {
        voiceLevelRef.current?.style.setProperty("--voice-level", level.toFixed(3));
        if (voiceElapsedRef.current) {
          voiceElapsedRef.current.textContent = formatVoiceDuration(Date.now() - voiceStartedAtRef.current);
        }
      });
      voiceMaxTimerRef.current = window.setTimeout(() => stopVoiceRecording(), VOICE_MAX_RECORDING_MS);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const chunks = voiceChunksRef.current;
        const startedAt = voiceStartedAtRef.current;
        const endedAt = Date.now();
        const durationMs = Math.max(0, endedAt - startedAt);
        voiceChunksRef.current = [];
        voiceRecorderRef.current = null;
        clearVoiceRecordingTimers();
        stopVoiceTracks();
        setRecordingVoice(false);
        if (voiceCancelledRef.current) {
          setVoiceHint("Voice message discarded.");
          return;
        }
        if (durationMs < VOICE_MIN_RECORDING_MS) {
          setVoiceHint("Too short. Press and hold the mic while you speak.");
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size === 0) return;
        void publishVoiceChunk(blob, channelId, { mode: "message", startedAt, endedAt, durationMs });
      };
      recorder.start(250);
      setRecordingVoice(true);
      setError(null);
    } catch (recordError) {
      voicePointerHeldRef.current = false;
      clearVoiceRecordingTimers();
      stopVoiceTracks();
      setRecordingVoice(false);
      setError(micErrorMessage(recordError));
    }
  }

  function stopVoiceRecording(cancel = false) {
    voicePointerHeldRef.current = false;
    if (cancel) voiceCancelledRef.current = true;
    const recorder = voiceRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    clearVoiceRecordingTimers();
    stopVoiceTracks();
    setRecordingVoice(false);
  }

  function handlePickFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    uploadFiles(files);
    event.currentTarget.value = "";
  }

  function composerMaxHeight() {
    return isConversationEmpty
      ? Math.max(56, Math.floor(window.innerHeight / 8))
      : Math.max(COMPOSER_MIN_HEIGHT, Math.floor(window.innerHeight * COMPOSER_MAX_VIEWPORT_SHARE));
  }

  function resizeComposerTextarea(textarea?: HTMLTextAreaElement | null) {
    const target = textarea ?? composerTextareaRef.current;
    if (!target) return;
    const maxHeight = composerMaxHeight();
    target.style.maxHeight = "";
    target.style.minHeight = "";
    // Collapse to measure content; the textarea otherwise stretches to fill the composer row.
    target.style.height = "0px";
    const contentHeight = target.scrollHeight;
    target.style.height = "";
    const floor = isConversationEmpty ? 34 : Math.max(COMPOSER_MIN_HEIGHT, composerUserHeightRef.current ?? 0);
    target.style.minHeight = `${Math.min(maxHeight, Math.max(floor, contentHeight))}px`;
    target.style.maxHeight = `${maxHeight}px`;
    target.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }

  function setComposerUserHeight(height: number | null) {
    composerUserHeightRef.current =
      height === null ? null : Math.round(Math.min(composerMaxHeight(), Math.max(COMPOSER_MIN_HEIGHT, height)));
    try {
      if (composerUserHeightRef.current === null) window.localStorage.removeItem(COMPOSER_HEIGHT_STORAGE_KEY);
      else window.localStorage.setItem(COMPOSER_HEIGHT_STORAGE_KEY, String(composerUserHeightRef.current));
    } catch {
      // Storage can be unavailable (private mode); the height still applies for this session.
    }
    resizeComposerTextarea();
  }

  function startComposerResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const textarea = composerTextareaRef.current;
    if (!textarea) return;
    event.preventDefault();
    const handle = event.currentTarget;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already released; the drag simply ends on the next pointerup.
    }
    const startY = event.clientY;
    const startHeight = textarea.getBoundingClientRect().height;
    setComposerResizing(true);
    const onMove = (moveEvent: PointerEvent) => {
      setComposerUserHeight(startHeight + (startY - moveEvent.clientY));
    };
    const onEnd = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      setComposerResizing(false);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(event.clipboardData.items ?? []);
    const imageFiles = items
      .map((item) => {
        if (!item.type.startsWith("image/")) return null;
        return item.getAsFile();
      })
      .filter((file): file is File => Boolean(file));
    if (imageFiles.length === 0) return;
    event.preventDefault();
    const filesToUpload = imageFiles.map((image) => {
      const ext = image.type.includes("/") ? image.type.split("/")[1] : "png";
      const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "") || "png";
      const filename = `pasted-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.${safeExt}`;
      return new File([image], filename, { type: image.type || "image/png" });
    });
    uploadFiles(filesToUpload);
  }

  useEffect(() => {
    resizeComposerTextarea();
  }, [isConversationEmpty, activeChannelId]);

  useEffect(() => {
    function handleWindowResize() {
      resizeComposerTextarea();
    }
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  // The call bar and composer resizing shrink the panel without scrolling it; stay pinned to the newest message.
  useEffect(() => {
    const panel = messagesPanelRef.current;
    if (!panel || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (messagesPinnedToBottomRef.current) panel.scrollTop = panel.scrollHeight;
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [authenticated, activeChannelId]);

  const voiceControls = (
    <>
      {canStartVoiceRoom && !liveVoiceSessionId ? (
        <div className="composer-call">
          <button
            type="button"
            className="composer-secondary composer-live-voice"
            disabled={liveVoiceCallDisabled}
            title="Join a realtime channel voice room. Agent audio is mixed locally and transcribed into the channel."
            onClick={() => void startLiveVoice("room")}
          >
            {liveVoiceStarting ? "Connecting..." : `Join voice room (${roomAgentNames.length})`}
          </button>
        </div>
      ) : null}
      {canStartDirectVoice && directVoiceCallTarget && !liveVoiceSessionId ? (
        <div className="composer-call" ref={directVoiceMenuRef}>
          <button
            type="button"
            className="composer-secondary composer-live-voice"
            disabled={liveVoiceCallDisabled}
            title={`Start a direct realtime voice call with ${directVoiceCallTarget}.`}
            onClick={() => void startLiveVoice("direct")}
          >
            {liveVoiceStarting ? "Connecting..." : `Call ${directVoiceCallTarget}`}
          </button>
          {directAgentNames.length > 1 ? (
            <>
              <button
                type="button"
                className="composer-secondary composer-call-toggle"
                aria-label="Choose direct call agent"
                aria-haspopup="menu"
                aria-expanded={directVoiceMenuOpen}
                disabled={liveVoiceCallDisabled}
                onClick={() => setDirectVoiceMenuOpen((open) => !open)}
              >
                <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                  <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {directVoiceMenuOpen ? (
                <div className="composer-call-menu" role="menu" aria-label="Agent for direct call">
                  <p className="composer-call-menu-title">Direct call with</p>
                  {directAgentNames.map((name) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={name === directVoiceCallTarget}
                      className={`composer-call-option${name === directVoiceCallTarget ? " is-selected" : ""}`}
                      key={name}
                      onClick={() => {
                        setDirectVoiceTargetAgent(name);
                        setDirectVoiceMenuOpen(false);
                      }}
                    >
                      <span>{name}</span>
                      {name === directVoiceCallTarget ? <span aria-hidden="true">✓</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      {!liveVoiceSessionId && (canSendVoiceMessage || voiceCapableAgentNames.length > 0) ? (
        <button
          type="button"
          className={`composer-secondary composer-voice${recordingVoice ? " is-recording" : ""}`}
          aria-pressed={recordingVoice}
          disabled={
            !canSendVoiceMessage ||
            !activeChannel ||
            Boolean(activeChannel.archivedAt) ||
            !activeChannelCanPost ||
            sending ||
            Boolean(liveVoiceSessionId)
          }
          title={
            !canSendVoiceMessage
              ? "Voice messages need a transcription model. Set ORGOPS_TRANSCRIPTION_MODEL or add a Mistral/OpenAI API key."
              : "Hold to record (or hold Space). Release to send, Esc to cancel. Voice is transcribed for everyone in the channel."
          }
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Pointer already released; recording still stops on pointerup.
            }
            void startVoiceRecording();
          }}
          onPointerUp={(event) => {
            event.preventDefault();
            stopVoiceRecording();
          }}
          onPointerCancel={() => stopVoiceRecording(true)}
          onKeyDown={(event) => {
            if ((event.key === " " || event.key === "Enter") && !event.repeat) {
              event.preventDefault();
              void startVoiceRecording();
            }
          }}
          onKeyUp={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              stopVoiceRecording();
            }
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span className="composer-voice-state" aria-hidden={recordingVoice}>
            Hold to talk
          </span>
          <span className="composer-voice-state composer-voice-recording" aria-hidden={!recordingVoice}>
            <span className="voice-level" ref={voiceLevelRef} aria-hidden="true">
              <span />
            </span>
            <span ref={voiceElapsedRef}>0:00</span>
            <span>Release to send</span>
          </span>
        </button>
      ) : null}
    </>
  );

  if (authLoading && !authenticated) {
    return <main className="loading-screen">Loading OrgOps...</main>;
  }

  if (!authenticated) {
    return (
      <main className="login-screen">
        <section className="login-copy">
          <div className="brand-mark large">OO</div>
          <p>OrgOps User Workspace</p>
          <h1>Welcome back</h1>
          <span>Sign in to talk to your team and agents.</span>
        </section>

        <form className="login-card" onSubmit={handleLogin}>
          <div>
            <span>Sign in</span>
            <strong>OrgOps</strong>
          </div>
          {error ? <div className="notice error">{error}</div> : null}
          <label>
            Username
            <input
              value={loginUsername}
              onChange={(event) => setLoginUsername(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          <button disabled={!loginUsername.trim() || !loginPassword || authLoading}>
            {authLoading ? "Signing in..." : "Continue"}
          </button>
        </form>
      </main>
    );
  }

  if (mustChangePassword) {
    return (
      <main className="login-screen">
        <section className="login-copy">
          <div className="brand-mark large">OO</div>
          <p>OrgOps User Workspace</p>
          <h1>Set a new password</h1>
          <span>Finish first-time setup before opening your workspace.</span>
        </section>

        <form className="login-card" onSubmit={handlePasswordUpdate}>
          <div>
            <span>First login</span>
            <strong>{username || "OrgOps"}</strong>
          </div>
          <p className="login-hint">
            Your temporary password worked. Choose a new password with at least 8 characters.
          </p>
          {error ? <div className="notice error">{error}</div> : null}
          <label>
            New password
            <input
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm new password
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
            />
          </label>
          <button
            disabled={
              newPassword.trim().length < 8 ||
              newPassword.trim() !== confirmPassword.trim() ||
              authLoading
            }
          >
            {authLoading ? "Updating..." : "Update password"}
          </button>
          <button className="secondary-button" type="button" onClick={() => void handleLogout()}>
            Sign out
          </button>
        </form>
      </main>
    );
  }

  return (
    <main
      ref={appShellRef}
      className={[
        "app-shell",
        layoutPrefs.sidebarCollapsed ? "sidebar-collapsed" : "",
        layoutPrefs.activityPanelOpen ? "" : "activity-hidden",
        resizingSidebar ? "sidebar-resizing" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          "--sidebar-width": `${layoutPrefs.sidebarCollapsed ? SIDEBAR_RAIL_WIDTH : layoutPrefs.sidebarWidth}px`
        } as CSSProperties
      }
    >
      <aside className={`sidebar ${mobileSidebarOpen ? "sidebar-mobile-open" : ""}`}>
        <button
          type="button"
          className="sidebar-mobile-close"
          onClick={() => setMobileSidebarOpen(false)}
        >
          Close
        </button>
        <div className="brand">
          <div className="brand-mark">OO</div>
          <div>
            <strong>OrgOps</strong>
            <span>User workspace</span>
          </div>
          <button
            type="button"
            className="sidebar-collapse-button"
            aria-label={layoutPrefs.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={`${layoutPrefs.sidebarCollapsed ? "Expand" : "Collapse"} sidebar (Cmd+B)`}
            onClick={() => updateLayoutPrefs({ sidebarCollapsed: !layoutPrefs.sidebarCollapsed })}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6 3v10" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>

        <section className="sidebar-section">
          <button
            type="button"
            className="palette-trigger"
            aria-label="Jump to channel or start a conversation"
            title="Jump to… (Cmd+K)"
            onClick={() => {
              setMobileSidebarOpen(false);
              setShowCommandPalette(true);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>Jump to…</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="channel-list">
            {groupedChannels.map((group) => {
              const isCollapsed = collapsedChannelGroups[group.id];
              return (
                <section className="channel-group" key={group.id}>
                  <button
                    type="button"
                    className="channel-group-toggle"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsedChannelGroups((current) => ({
                        ...current,
                        [group.id]: !current[group.id]
                      }))
                    }
                  >
                    <span>{group.label}</span>
                    <em>{group.channels.length}</em>
                    <strong>{isCollapsed ? "+" : "-"}</strong>
                  </button>

                  {!isCollapsed ? (
                    <div className="channel-group-items">
                      {group.channels.map((channel) => {
                        const pinned = pinnedChannelIdSet.has(channel.id);
                        const label = channelLabel(channel, username);
                        const name = channelDisplayName(channel, username);
                        const unread = unreadCounts[channel.id];
                        return (
                          <div
                            className={[
                              "channel-list-row",
                              channel.id === activeChannelId ? "active" : "",
                              pinned ? "pinned" : "",
                              unread ? "unread" : ""
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            key={channel.id}
                          >
                            <button
                              className="channel-select-button"
                              onClick={() => selectChannel(channel.id)}
                              title={label}
                              type="button"
                            >
                              <span className="channel-rail-avatar" aria-hidden="true">
                                {channelInitials(name)}
                              </span>
                              <ChannelGlyph channel={channel} pinned={pinned} />
                              <span className="channel-name">{name}</span>
                              {unread ? <em>{unread}</em> : null}
                            </button>
                            <button
                              aria-label={pinned ? "Unpin channel" : "Pin channel"}
                              className="channel-pin-button"
                              onClick={() => togglePinnedChannel(channel.id)}
                              title={pinned ? "Unpin channel" : "Pin channel"}
                              type="button"
                            >
                              <svg viewBox="0 0 16 16" aria-hidden="true">
                                {pinned ? (
                                  <path d="M3 3l10 10M10.2 1.8l4 4-1.6 1.6-.9 3.3-5.4-5.4 3.3-.9zM6.3 9.7l-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                                ) : (
                                  <path d="M10.2 1.8l4 4-1.6 1.6-.9 3.3-5.4-5.4 3.3-.9zM6.3 9.7l-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                                )}
                              </svg>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
            {archivedChannels.length > 0 ? (
              <section className="channel-group">
                <button
                  type="button"
                  className="channel-group-toggle"
                  aria-expanded={showArchivedChannels}
                  onClick={() => setShowArchivedChannels((current) => !current)}
                >
                  <span>Archived</span>
                  <em>{archivedChannels.length}</em>
                  <strong>{showArchivedChannels ? "-" : "+"}</strong>
                </button>

                {showArchivedChannels ? (
                  <div className="channel-group-items archived-channel-items">
                    {archivedChannels.map((channel) => (
                      <div
                        className={`channel-list-row archived-channel-row${channel.id === activeChannelId ? " active" : ""}`}
                        key={channel.id}
                      >
                        <button
                          className="channel-select-button"
                          onClick={() => selectChannel(channel.id)}
                          title={channelLabel(channel, username)}
                          type="button"
                        >
                          <span className="channel-rail-avatar" aria-hidden="true">
                            {channelInitials(channelDisplayName(channel, username))}
                          </span>
                          <ChannelGlyph channel={channel} pinned={false} />
                          <span className="channel-name">{channelDisplayName(channel, username)}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        </section>

        <section className="sidebar-section start-conversation">
          <button
            className="new-conversation-button"
            onClick={() => setShowConversationDialog(true)}
            title="New conversation"
          >
            <i className="sidebar-rail-icon" aria-hidden="true">+</i>
            <span>New conversation</span>
          </button>
        </section>

        <section className="sidebar-section account-actions">
          <button
            className="logout-button"
            onClick={() => void handleLogout()}
            title={`Sign out${username ? ` (${username})` : ""}`}
          >
            <i className="sidebar-rail-icon" aria-hidden="true">
              {channelInitials(username || "?")}
            </i>
            <span>Sign out {username ? `(${username})` : ""}</span>
          </button>
        </section>
        <div
          className="sidebar-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Drag to resize, double-click to reset"
          onPointerDown={handleSidebarResizeStart}
          onDoubleClick={() =>
            updateLayoutPrefs({ sidebarCollapsed: false, sidebarWidth: SIDEBAR_DEFAULT_WIDTH })
          }
        />
      </aside>
      {mobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="sidebar-mobile-backdrop"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}

      <section className="workspace">
        <header className="workspace-header">
          <button
            type="button"
            className="sidebar-mobile-toggle"
            onClick={() => setMobileSidebarOpen(true)}
          >
            Menu
          </button>
          <div>
            <span>Workspace</span>
            <div className="workspace-title-row">
              <h1>{channelLabel(activeChannel, username)}</h1>
            </div>
            <p>
              {activeChannel?.archivedAt
                ? "Archived channel"
                : activeChannel && !activeChannelCanPost
                  ? "Read-only shared channel"
                : activeChannel?.description || "Talk to the team and agents in plain language."}
            </p>
          </div>
          <div className="channel-actions">
            {activeChannel && activeChannelManageable ? (
              <button type="button" onClick={() => setShowChannelManageDialog(true)}>
                Manage channel
              </button>
            ) : null}
            <button
              type="button"
              className={`activity-panel-toggle${layoutPrefs.activityPanelOpen ? " active" : ""}`}
              aria-label={layoutPrefs.activityPanelOpen ? "Hide details panel" : "Show details panel"}
              aria-pressed={layoutPrefs.activityPanelOpen}
              title={layoutPrefs.activityPanelOpen ? "Hide details" : "Show details"}
              onClick={() => updateLayoutPrefs({ activityPanelOpen: !layoutPrefs.activityPanelOpen })}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10 3v10" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          </div>
        </header>

        {error ? <div className="notice error">{error}</div> : null}
        {loading ? <div className="notice">Loading OrgOps...</div> : null}

        <section className="chat-stack">
          <section
            className={`messages-panel${isConversationEmpty ? " messages-panel-empty" : ""}`}
            ref={messagesPanelRef}
            onScroll={handleMessagesScroll}
          >
            {!messagesLoading && hasOlderMessages ? (
              <button
                className="load-older-button"
                disabled={loadingOlderMessages}
                onClick={() => void handleLoadOlderMessages()}
              >
                {loadingOlderMessages ? "Loading previous messages..." : "Load previous messages"}
              </button>
            ) : null}
            {messagesLoading ? (
              <div className="empty-state">
                <strong>Loading messages...</strong>
                <p>Fetching the latest channel activity.</p>
              </div>
            ) : timelineItems.length === 0 ? (
              <div className="empty-state">
                <strong>No messages yet</strong>
                <p>Send a short update or request to start the conversation.</p>
              </div>
            ) : (
              timelineItems.map((item) => {
                if (item.kind === "message" && item.event.type === "agent.turn.failed") {
                  const event = item.event;
                  const rawText = turnFailureText(event);
                  const failure = classifyTurnFailure(rawText);
                  return (
                    <article className="message message-error" key={item.id}>
                      <div className="message-meta">
                        <strong>System · {sourceLabel(event.source)}</strong>
                        <span>{formatTime(event.createdAt)}</span>
                      </div>
                      <h3 className="message-error-title">{failure.title}</h3>
                      <p>{failure.message}</p>
                      <details className="turn-failure-details">
                        <summary>Technical details</summary>
                        <pre>{rawText}</pre>
                      </details>
                    </article>
                  );
                }
                if (item.kind === "message") {
                  const event = item.event;
                  const role = messageRole(event.source);
                  const allAttachments = parseMessageAttachments(event.payload);
                  const audioAttachments = allAttachments.filter((attachment) =>
                    Boolean(attachment.mime?.startsWith("audio/"))
                  );
                  const attachments = allAttachments.filter(
                    (attachment) => !attachment.mime?.startsWith("audio/")
                  );
                  const voiceMeta = messageVoiceMeta(event.payload);
                  const voiceDuration = formatVoiceDuration(
                    voiceMeta?.durationMs ?? audioAttachments[0]?.durationMs
                  );
                  const text = messageText(event);
                  const postingAgentName = event.source.startsWith("agent:") ? sourceLabel(event.source) : "";
                  const markdown = shouldRenderMarkdown(text);
                  const sensitive = sensitiveMessagePayload(event);
                  const revealedSensitive = revealedSensitiveByEvent[event.id] ?? "";
                  const revealError = sensitiveRevealErrors[event.id] ?? "";
                  const revealPassword = sensitiveRevealPasswords[event.id] ?? "";
                  const revealing = revealingSensitiveEventId === event.id;
                  return (
                    <article className={`message message-${role}`} key={item.id}>
                      <div className="message-meta">
                        <strong>{sourceLabel(event.source)}</strong>
                        <span>{formatTime(messageDisplayTime(event))}</span>
                      </div>
                      {voiceMeta || audioAttachments.length > 0 ? (
                        <div className={`message-voice${voiceMeta?.status === "failed" ? " is-failed" : ""}`}>
                          <span className="message-voice-badge">
                            <VoiceIcon call={voiceMeta?.mode === "realtime"} />
                            {voiceMeta?.mode === "realtime"
                              ? "Voice call"
                              : voiceMeta?.mode === "live"
                                ? "Live voice"
                                : "Voice message"}
                            {voiceDuration ? ` · ${voiceDuration}` : ""}
                          </span>
                          {audioAttachments.map((attachment, index) => (
                            <audio
                              key={`${event.id}-audio-${index}`}
                              data-voice-key={`${event.id}:${index}`}
                              controls
                              preload="metadata"
                              src={`/api/files/${encodeURIComponent(attachment.fileId)}`}
                            />
                          ))}
                          {voiceMeta?.status === "failed" && voiceMeta.error ? (
                            <span className="message-voice-error">{voiceMeta.error}</span>
                          ) : null}
                        </div>
                      ) : null}
                      {markdown ? (
                        <div className="message-markdown">
                          {splitJsonRenderMarkdown(text).map((jsonPart, jsonIndex) =>
                            jsonPart.kind === "json-render" ? (
                              <JsonRenderBlock
                                agentName={postingAgentName}
                                canPost={activeChannelCanPost && !activeChannel?.archivedAt}
                                channelId={activeChannelId}
                                key={`${event.id}-json-render-${jsonIndex}`}
                                specText={jsonPart.specText}
                                username={username}
                              />
                            ) : (
                              splitSecretInputMarkdown(jsonPart.text).map((secretPart, secretIndex) =>
                                secretPart.kind === "secret-input" ? (
                                  <OrgopsSecretInput
                                    agentName={postingAgentName}
                                    key={`${event.id}-secret-input-${jsonIndex}-${secretIndex}`}
                                    spec={secretPart.spec}
                                  />
                                ) : (
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      a: ({ node: _node, ...props }) => (
                                        <a {...props} target="_blank" rel="noreferrer" />
                                      )
                                    }}
                                    key={`${event.id}-markdown-${jsonIndex}-${secretIndex}`}
                                  >
                                    {secretPart.text}
                                  </ReactMarkdown>
                                )
                              )
                            )
                          )}
                        </div>
                      ) : (
                        <p>{text}</p>
                      )}
                      {sensitive ? (
                        <section className="message-sensitive">
                          <div className="message-sensitive-head">
                            <strong>Sensitive content</strong>
                            <span>Protected</span>
                          </div>
                          {sensitive.hint ? <p>{sensitive.hint}</p> : null}
                          {revealedSensitive ? (
                            <div className="message-sensitive-revealed">
                              {shouldRenderMarkdown(revealedSensitive) ? (
                                <div className="message-markdown">
                                  {splitJsonRenderMarkdown(revealedSensitive).map((jsonPart, jsonIndex) =>
                                    jsonPart.kind === "json-render" ? (
                                      <JsonRenderBlock
                                        agentName={postingAgentName}
                                        canPost={activeChannelCanPost && !activeChannel?.archivedAt}
                                        channelId={activeChannelId}
                                        key={`${event.id}-sensitive-json-render-${jsonIndex}`}
                                        specText={jsonPart.specText}
                                        username={username}
                                      />
                                    ) : (
                                      splitSecretInputMarkdown(jsonPart.text).map((secretPart, secretIndex) =>
                                        secretPart.kind === "secret-input" ? (
                                          <OrgopsSecretInput
                                            agentName={postingAgentName}
                                            key={`${event.id}-sensitive-secret-input-${jsonIndex}-${secretIndex}`}
                                            spec={secretPart.spec}
                                          />
                                        ) : (
                                          <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                              a: ({ node: _node, ...props }) => (
                                                <a {...props} target="_blank" rel="noreferrer" />
                                              )
                                            }}
                                            key={`${event.id}-sensitive-markdown-${jsonIndex}-${secretIndex}`}
                                          >
                                            {secretPart.text}
                                          </ReactMarkdown>
                                        )
                                      )
                                    )
                                  )}
                                </div>
                              ) : (
                                <pre>{revealedSensitive}</pre>
                              )}
                              <button type="button" onClick={() => handleHideSensitive(event.id)}>
                                Hide sensitive content
                              </button>
                            </div>
                          ) : (
                            <div className="message-sensitive-controls">
                              <label>
                                <span>Password</span>
                                <input
                                  type="password"
                                  autoComplete="current-password"
                                  value={revealPassword}
                                  onChange={(changeEvent) =>
                                    {
                                      setSensitiveRevealPasswords((current) => ({
                                        ...current,
                                        [event.id]: changeEvent.target.value
                                      }));
                                      setSensitiveRevealErrors((current) => ({ ...current, [event.id]: "" }));
                                    }
                                  }
                                  placeholder="Enter your password"
                                />
                              </label>
                              <button
                                type="button"
                                disabled={revealing || !revealPassword}
                                onClick={() => void handleRevealSensitive(event.id)}
                              >
                                {revealing ? "Revealing..." : "Reveal sensitive content"}
                              </button>
                            </div>
                          )}
                          {revealError ? <p className="message-sensitive-error">{revealError}</p> : null}
                        </section>
                      ) : null}
                      {attachments.length > 0 ? (
                        <div className="message-attachments">
                          <strong>Attachments</strong>
                          <ul>
                            {attachments.map((attachment, index) => {
                              const sizeLabel = formatAttachmentSize(attachment.size);
                              const mimeLabel = attachment.mime ? attachment.mime : "";
                              return (
                                <li key={`${event.id}-attachment-${index}`}>
                                  <a href={`/api/files/${encodeURIComponent(attachment.fileId)}`} target="_blank" rel="noreferrer">
                                    {attachment.name}
                                  </a>
                                  {mimeLabel || sizeLabel ? (
                                    <span>
                                      {mimeLabel}
                                      {mimeLabel && sizeLabel ? " • " : ""}
                                      {sizeLabel || ""}
                                    </span>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                    </article>
                  );
                }
                const selectedEvent = item.traceEvents.find((event) => event.id === expandedTraceEventId) ?? null;
                return (
                  <article className={`trace-group trace-group-${item.tone}`} key={item.id}>
                    <div className="trace-chips" role="list" aria-label="Agent activity trace">
                      {item.traceEvents.map((event) => {
                        const selected = event.id === expandedTraceEventId;
                        const summary = traceTitle(event);
                        return (
                          <button
                            key={event.id}
                            className={`trace-chip trace-chip-${traceChipTone(event)} ${
                              selected ? "trace-chip-active" : ""
                            }`}
                            title={`${summary}${event.createdAt ? ` • ${formatTime(event.createdAt)}` : ""}`}
                            type="button"
                            onClick={() =>
                              setExpandedTraceEventId((current) => (current === event.id ? null : event.id))
                            }
                            aria-label={summary}
                          >
                            <span>{traceChipCode(event)}</span>
                          </button>
                        );
                      })}
                    </div>
                    {selectedEvent ? (
                      <div className="trace-detail-card">
                        <div className="trace-detail-meta">
                          <strong>{traceTitle(selectedEvent)}</strong>
                          <span>{formatTime(selectedEvent.createdAt)}</span>
                        </div>
                        {traceDetail(selectedEvent) ? (
                          <pre>{traceDetail(selectedEvent)}</pre>
                        ) : (
                          <p>No additional details.</p>
                        )}
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </section>

          {hasNewMessagesBelow ? (
            <button
              className="new-messages-button"
              onClick={() => {
                setHasNewMessagesBelow(false);
                scrollMessagesToBottom();
              }}
            >
              New messages below
            </button>
          ) : null}

          <form
            className={`composer${isConversationEmpty ? " composer-compact" : ""}${composerResizing ? " is-resizing" : ""}`}
            onSubmit={handleSubmit}
          >
          {!isConversationEmpty ? (
            <div
              className="composer-resize-handle"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize message box"
              tabIndex={0}
              title="Drag to resize. Double-click to reset."
              onPointerDown={startComposerResize}
              onDoubleClick={() => setComposerUserHeight(null)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                event.preventDefault();
                const current = composerTextareaRef.current?.getBoundingClientRect().height ?? COMPOSER_MIN_HEIGHT;
                setComposerUserHeight(current + (event.key === "ArrowUp" ? 24 : -24));
              }}
            />
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="composer-file-input"
            onChange={handlePickFiles}
          />
          {offlineAgentNames.length > 0 ? (
            <p className="composer-offline-hint">
              {offlineAgentNames.join(", ")} {offlineAgentNames.length === 1 ? "is" : "are"} off — will reply once
              started.
            </p>
          ) : null}
          {pendingAttachments.length > 0 ? (
            <div className="composer-attachments">
              {pendingAttachments.map((attachment) => (
                <article key={attachment.localId}>
                  <div>
                    <strong>{attachment.name}</strong>
                    <span>
                      {attachment.status === "ready"
                        ? `Ready${formatAttachmentSize(attachment.size) ? ` • ${formatAttachmentSize(attachment.size)}` : ""}`
                        : attachment.status === "uploading"
                          ? "Uploading..."
                          : attachment.error || "Upload failed"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="composer-attachment-remove"
                    onClick={() =>
                      setPendingAttachments((current) =>
                        current.filter((item) => item.localId !== attachment.localId)
                      )
                    }
                  >
                    Remove
                  </button>
                </article>
              ))}
            </div>
          ) : null}
          {liveVoiceSessionId || othersLiveInChannel.length > 0 ? (
            <section className={`live-voice-bar${liveVoiceSessionId ? " is-joined" : ""}`} aria-label="Voice call">
              <div className="live-voice-status">
                <span className="live-voice-dot" aria-hidden="true" />
                <strong>
                  {liveVoiceSessionId
                    ? `${liveVoiceSessionLabel} · ${formatVoiceDuration(voiceClock - liveVoiceStartedAtRef.current)}`
                    : "Voice in progress"}
                </strong>
                {liveVoiceSessionId ? (
                  <span
                    className={`live-voice-state live-voice-state-${liveVoiceMuted ? "muted" : liveVoiceActivity}`}
                    role="status"
                  >
                    {liveVoiceMuted && liveVoiceActivity !== "agent"
                      ? "Muted"
                      : liveVoiceActivity === "connecting"
                        ? "Connecting..."
                        : liveVoiceActivity === "you"
                          ? "You're speaking"
                          : liveVoiceActivity === "thinking"
                            ? "Thinking..."
                            : liveVoiceActivity === "agent"
                              ? `${liveVoiceAgentLabel ?? "Agent"} speaking`
                              : liveVoiceActivity === "tool"
                                ? `Running ${liveVoiceToolName ?? "a tool"}...`
                                : "Listening"}
                  </span>
                ) : null}
                {liveVoiceSessionId && !liveVoiceMuted ? (
                  <span className="voice-level" ref={liveVoiceLevelRef} aria-hidden="true">
                    <span />
                  </span>
                ) : null}
              </div>
              <ul className="live-voice-participants" aria-label="People in voice rooms">
                {liveVoiceSessionId ? (
                  <>
                    <li className={liveVoiceActivity === "you" && !liveVoiceMuted ? "is-speaking" : liveVoiceMuted ? "is-muted" : ""}>
                      You{liveVoiceMuted ? " · muted" : ""}
                    </li>
                    <li className={liveVoiceActivity === "agent" ? "is-speaking is-agent" : "is-agent"}>
                      {liveVoiceAgentLabel}
                    </li>
                  </>
                ) : null}
                {othersLiveInChannel.map((participant) => {
                  const speaking =
                    !participant.muted &&
                    voicePresence.activeSpeaker?.speakerId === participant.participantId &&
                    voiceClock - voicePresence.activeSpeaker.at < VOICE_ACTIVE_SPEAKER_WINDOW_MS;
                  return (
                    <li
                      key={participant.sessionId}
                      className={speaking ? "is-speaking" : participant.muted ? "is-muted" : ""}
                    >
                      {participant.participantId}
                      {participant.muted ? " · muted" : ""}
                    </li>
                  );
                })}
              </ul>
              <p className="live-voice-hint">
                {liveVoiceSessionId
                  ? liveVoiceMode === "direct"
                    ? `Direct realtime voice with ${liveVoiceAgentLabel ?? "the agent"}: interrupt any time. Both sides are transcribed into the channel.`
                    : `Realtime voice room with ${liveVoiceAgentLabel ?? "the agents"}: interrupt any time. The room is transcribed into the channel.`
                  : canStartVoiceRoom
                    ? "Others are in voice. Join the room below to talk with the channel's realtime agents."
                    : "Transcripts of the call appear in the channel."}
              </p>
              <div className="live-voice-controls">
                {liveVoiceSessionId ? (
                  <>
                    <button
                      type="button"
                      className={`composer-secondary${liveVoiceMuted ? " is-active" : ""}`}
                      aria-pressed={liveVoiceMuted}
                      onClick={() => void setLiveVoiceMute(!liveVoiceMuted)}
                    >
                      {liveVoiceMuted ? "Unmute" : "Mute"}
                    </button>
                    <button
                      type="button"
                      className={`composer-secondary${liveVoiceSpeakerOn ? "" : " is-active"}`}
                      aria-pressed={!liveVoiceSpeakerOn}
                      title="Silence agent audio on this device"
                      onClick={toggleLiveVoiceSpeaker}
                    >
                      {liveVoiceSpeakerOn ? "Speaker off" : "Speaker on"}
                    </button>
                    <button type="button" className="live-voice-leave" onClick={() => void stopLiveVoice()}>
                      Hang up
                    </button>
                  </>
                ) : canHangUpWithoutJoin ? (
                  <button
                    type="button"
                    className="live-voice-leave"
                    onClick={() => void endChannelVoicePresence("left")}
                  >
                    Hang up
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
          {pendingVoiceMessages.length > 0 || pendingVoiceForChannel.some((note) => note.status === "error") ? (
            <div className="voice-pending-list" role="status">
              {pendingVoiceForChannel
                .filter((note) => note.mode === "message" || note.status === "error")
                .map((note) => (
                  <article key={note.localId} className={`voice-pending voice-pending-${note.status}`}>
                    <VoiceIcon />
                    <span>
                      {note.status === "uploading"
                        ? "Uploading voice message"
                        : note.status === "transcribing"
                          ? "Transcribing voice message"
                          : note.error || "Voice message failed"}
                      {note.durationMs ? ` · ${formatVoiceDuration(note.durationMs)}` : ""}
                    </span>
                    {note.status === "error" ? (
                      <button
                        type="button"
                        className="composer-attachment-remove"
                        onClick={() =>
                          setPendingVoiceNotes((current) => current.filter((item) => item.localId !== note.localId))
                        }
                      >
                        Dismiss
                      </button>
                    ) : null}
                  </article>
                ))}
            </div>
          ) : null}
          {voiceHint ? (
            <p className="voice-hint" role="status">
              {voiceHint}
            </p>
          ) : null}
          <textarea
            ref={composerTextareaRef}
            onChange={(event) => {
              draftRef.current = event.target.value;
              const nextHasText = Boolean(event.target.value.trim());
              setDraftHasText((current) => (current === nextHasText ? current : nextHasText));
              resizeComposerTextarea(event.currentTarget);
            }}
            onPaste={handleComposerPaste}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={
              activeChannel?.archivedAt
                ? "Restore this channel to send messages"
                : activeChannel && !activeChannelCanPost
                  ? "This channel is shared with you as read-only"
                : activeChannel
                  ? isConversationEmpty
                    ? `Message ${channelLabel(activeChannel, username)} - Cmd+J focuses here`
                    : `Message ${channelLabel(activeChannel, username)} (Cmd+J focuses here, Enter to send, Shift+Enter for newline)`
                  : "Select a channel first"
            }
            disabled={!activeChannel || Boolean(activeChannel.archivedAt) || !activeChannelCanPost || sending}
            rows={isConversationEmpty ? 1 : 3}
          />
          <div className="composer-actions">
            <div className="composer-primary-actions">
              <button
                disabled={
                  !activeChannel ||
                  Boolean(activeChannel.archivedAt) ||
                  !activeChannelCanPost ||
                  sending ||
                  recordingVoice ||
                  uploadingAttachmentCount > 0 ||
                  (!draftHasText && readyAttachments.length === 0)
                }
              >
                {uploadingAttachmentCount > 0
                  ? `Uploading ${uploadingAttachmentCount}...`
                  : sending
                    ? "Sending..."
                    : "Send"}
              </button>
            </div>
            {hasComposerActionMenu ? (
              <div className="composer-action-menu" ref={voiceMenuRef}>
                <button
                  type="button"
                  className="composer-secondary composer-action-menu-button"
                  aria-label="Message actions"
                  aria-haspopup="menu"
                  aria-expanded={voiceMenuOpen}
                  aria-controls="composer-action-menu-items"
                  title="Message actions"
                  onClick={() => setVoiceMenuOpen((open) => !open)}
                >
                  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                    <path d="M6 2v8M2 6h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
                {voiceMenuOpen ? (
                  <div
                    id="composer-action-menu-items"
                    className="composer-action-menu-items"
                    role="menu"
                    aria-label="Message actions"
                  >
                    <button
                      type="button"
                      className="composer-secondary"
                      disabled={!activeChannel || Boolean(activeChannel.archivedAt) || !activeChannelCanPost || sending}
                      onClick={() => {
                        setVoiceMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                    >
                      Attach files
                    </button>
                    {hasVoiceControls ? voiceControls : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {hasAttachmentErrors ? (
            <p className="composer-attachment-error">
              One or more attachments failed to upload. Remove them or retry.
            </p>
          ) : null}
          </form>
        </section>
      </section>

      {layoutPrefs.activityPanelOpen ? (
      <aside className="activity-panel">
        <section className="participants-card">
          <div className="participants-header-row">
            <h2>Participants</h2>
          </div>
          <div className="participant-list">
            {activeChannel?.participants?.map((participant, index) => {
              const agentStatus = participantAgentStatus(participant, agents);
              return (
                <article key={`${participant.subscriberType}:${participant.subscriberId}:${index}`}>
                  <div className="participant-avatar">{participantName(participant).slice(0, 2)}</div>
                  <div>
                    <strong>
                      {agentStatus ? (
                        <i
                          className={`agent-status-dot agent-status-${agentStatus}`}
                          title={agentStatus === "running" ? "Agent running" : "Agent off"}
                        />
                      ) : null}
                      {participantName(participant)}
                    </strong>
                    <span>{participantType(participant)}</span>
                  </div>
                </article>
              );
            })}
            {!activeChannel?.participants?.length ? (
              <p>No participants listed for this channel.</p>
            ) : null}
          </div>
          <div className="shared-viewer-list">
            <h3>Shared viewers</h3>
            {activeChannel?.shares?.map((share, index) => (
              <article key={`${share.viewerType}:${share.viewerId}:${index}`}>
                <div className="participant-avatar">{share.viewerId.slice(0, 2) || "SV"}</div>
                <div>
                  <strong>{share.viewerId}</strong>
                  <span>{shareTypeLabel(share)}</span>
                </div>
              </article>
            ))}
            {!activeChannel?.shares?.length ? <p>No shared viewers.</p> : null}
          </div>
        </section>

        <section>
          <h2>Recent Activity</h2>
          {agentIsThinking ? <p className="thinking-indicator">Agent is thinking...</p> : null}
          <div className="activity-list">
            {events.slice(-6).reverse().map((event) => (
              <article key={event.id}>
                <strong>{sourceLabel(event.source)}</strong>
                <span>{event.type.replaceAll(".", " ")}</span>
              </article>
            ))}
            {events.length === 0 ? <p>No recent activity in this channel.</p> : null}
          </div>
        </section>
      </aside>
      ) : null}

      {showCommandPalette ? (
        <CommandPalette
          channels={paletteChannels}
          recentChannelIds={recentChannelIds}
          activeChannelId={activeChannelId}
          onClose={() => setShowCommandPalette(false)}
          onSelectChannel={(channelId) => {
            setShowCommandPalette(false);
            selectChannel(channelId);
          }}
          onNewConversation={(name) => {
            setShowCommandPalette(false);
            if (name) setConversationName(name);
            setShowConversationDialog(true);
          }}
        />
      ) : null}

      {showConversationDialog ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setShowConversationDialog(false)}>
          <section
            aria-modal="true"
            className="conversation-dialog"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>Start conversation</span>
                <h2>New conversation</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="dialog-close"
                onClick={() => setShowConversationDialog(false)}
              >
                Close
              </button>
            </header>
            <form
              className="conversation-form"
              onSubmit={handleStartConversation}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.requestSubmit();
                }
              }}
            >
              <label>
                <span>Channel name</span>
                <input
                  autoFocus
                  ref={conversationNameInputRef}
                  value={conversationName}
                  onChange={(event) => setConversationName(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.metaKey &&
                      !event.ctrlKey &&
                      conversationName.trim() &&
                      selectedConversationAgents.length === 0 &&
                      selectedConversationTeams.length === 0
                    ) {
                      event.preventDefault();
                      agentSearchInputRef.current?.focus();
                    }
                  }}
                  placeholder="Leave blank for a DM"
                />
              </label>
              <label>
                <span>Description</span>
                <input
                  value={conversationDescription}
                  onChange={(event) => setConversationDescription(event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label>
                <span>Visibility</span>
                <select
                  value={conversationVisibility}
                  onChange={(event) =>
                    setConversationVisibility(event.target.value === "PUBLIC" ? "PUBLIC" : "PRIVATE")
                  }
                >
                  <option value="PRIVATE">Private</option>
                  <option value="PUBLIC">Public</option>
                </select>
                {selectedConversationTeams.length > 0 ? (
                  <em className="field-hint">Team channels are created as private and shared with selected teams.</em>
                ) : null}
              </label>
              <div className="agent-combobox">
                <span>Agents</span>
                {selectedConversationAgentRecords.length > 0 ? (
                  <div className="selected-agent-chips">
                    {selectedConversationAgentRecords.map((agent) => (
                      <button
                        key={agent.name}
                        onClick={() => removeConversationAgent(agent.name)}
                        type="button"
                      >
                        {agent.name}
                        <span>Remove</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="agent-picker-hint">Select one agent for a DM, or many for a channel.</p>
                )}
                <div className="picker-anchor">
                  <label className="agent-search-field">
                    <span>Search agents</span>
                    <input
                      ref={agentSearchInputRef}
                      value={agentSearchQuery}
                      onChange={(event) => setAgentSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && agentSuggestions[0]) {
                          event.preventDefault();
                          addConversationAgent(agentSuggestions[0].name);
                        }
                      }}
                      placeholder="Type an agent name..."
                    />
                  </label>
                  {isSearchingAgents ? (
                    <div className="picker-results">
                      {agentSuggestions.length > 0 ? (
                        <div className="agent-suggestions">
                          {agentSuggestions.map((agent) => (
                            <button
                              key={agent.name}
                              onClick={() => addConversationAgent(agent.name)}
                              type="button"
                            >
                              <span>{agent.name}</span>
                              <em>{agent.runtimeState === "RUNNING" ? "Running" : "Off"}</em>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="agent-picker-hint">No matching agents.</p>
                      )}
                    </div>
                  ) : null}
                </div>
                {visibleAgents.length === 0 ? (
                  <p className="sidebar-note">No available agents.</p>
                ) : (
                  <span aria-hidden="true" className="picker-hint-placeholder" />
                )}
              </div>
              <div className="agent-combobox">
                <span>Teams</span>
                {selectedConversationTeamRecords.length > 0 ? (
                  <div className="selected-agent-chips">
                    {selectedConversationTeamRecords.map((team) => (
                      <button
                        key={team.id}
                        onClick={() => removeConversationTeam(team.id)}
                        type="button"
                      >
                        {team.name}
                        <span>Remove</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="agent-picker-hint">Add teams so all current team members can see and post in the private channel.</p>
                )}
                <div className="picker-anchor">
                  <label className="agent-search-field">
                    <span>Search teams</span>
                    <input
                      ref={teamSearchInputRef}
                      value={teamSearchQuery}
                      onChange={(event) => setTeamSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && teamSuggestions[0]) {
                          event.preventDefault();
                          addConversationTeam(teamSuggestions[0].id);
                        }
                      }}
                      placeholder="Type a team name..."
                    />
                  </label>
                  {isSearchingTeams ? (
                    <div className="picker-results">
                      {teamSuggestions.length > 0 ? (
                        <div className="agent-suggestions">
                          {teamSuggestions.map((team) => (
                            <button
                              key={team.id}
                              onClick={() => addConversationTeam(team.id)}
                              type="button"
                            >
                              <span>{team.name}</span>
                              <em>Team</em>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="agent-picker-hint">No matching teams.</p>
                      )}
                    </div>
                  ) : null}
                </div>
                {teams.length === 0 ? (
                  <p className="sidebar-note">You are not a member of any teams.</p>
                ) : (
                  <span aria-hidden="true" className="picker-hint-placeholder" />
                )}
              </div>
              <p className="dialog-shortcuts">
                Press Enter after a channel name to jump to agents, Enter in a search to add the first match, and Cmd+Enter to start.
              </p>
              <button disabled={loading || !canStartConversation}>Start</button>
            </form>
          </section>
        </div>
      ) : null}

      {showParticipantsDialog && activeChannel && activeChannelManageable ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={() => setShowParticipantsDialog(false)}
        >
          <section
            aria-modal="true"
            className="conversation-dialog participants-dialog"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>Channel controls</span>
                <h2>Manage participants</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="dialog-close"
                onClick={() => setShowParticipantsDialog(false)}
                type="button"
              >
                Close
              </button>
            </header>

            <form className="participant-form" onSubmit={handleAddParticipant}>
              <select
                value={participantKind}
                onChange={(event) => {
                  const value = event.target.value;
                  setParticipantKind(value === "HUMAN" || value === "TEAM" ? value : "AGENT");
                }}
                disabled={participantSubmitting}
              >
                <option value="AGENT">Agent</option>
                <option value="HUMAN">Human</option>
                <option value="TEAM">Team</option>
              </select>
              <input
                list={
                  participantKind === "AGENT"
                    ? "agent-participant-options"
                    : participantKind === "TEAM"
                      ? "team-participant-options"
                      : "human-participant-options"
                }
                placeholder={
                  participantKind === "AGENT"
                    ? "agent name"
                    : participantKind === "TEAM"
                      ? "team id"
                      : "username"
                }
                value={participantValue}
                onChange={(event) => setParticipantValue(event.target.value)}
                disabled={participantSubmitting}
              />
              <button type="submit" disabled={participantSubmitting || !participantValue.trim()}>
                {participantSubmitting ? "Adding..." : "Add"}
              </button>
              <datalist id="agent-participant-options">
                {visibleAgents.map((agent) => (
                  <option key={agent.name} value={agent.name} />
                ))}
              </datalist>
              <datalist id="human-participant-options">
                {humans.map((human) => (
                  <option key={human.username} value={human.username} />
                ))}
              </datalist>
              <datalist id="team-participant-options">
                {teams.map((team) => (
                  <option key={team.id} value={team.id} label={team.name} />
                ))}
              </datalist>
            </form>

            <div className="participants-dialog-list">
              {(activeChannel.participants ?? []).map((participant, index) => {
                const participantKey = `${participant.subscriberType}:${participant.subscriberId}`;
                return (
                  <article key={`${participant.subscriberType}:${participant.subscriberId}:${index}`}>
                    <div>
                      <strong>{participantName(participant)}</strong>
                      <span>{participantType(participant)}</span>
                    </div>
                    <button
                      className="participant-remove-button"
                      onClick={() => void handleRemoveParticipant(participant)}
                      disabled={participantRemovingKey === participantKey}
                      title={`Remove ${participantName(participant)}`}
                      type="button"
                    >
                      {participantRemovingKey === participantKey ? "Removing..." : "Remove"}
                    </button>
                  </article>
                );
              })}
              {(activeChannel.participants ?? []).length === 0 ? (
                <p>No participants yet.</p>
              ) : null}
            </div>

            <header>
              <div>
                <span>Read-only sharing</span>
                <h2>Shared viewers</h2>
              </div>
            </header>

            <form className="participant-form" onSubmit={handleAddShare}>
              <select
                value={shareKind}
                onChange={(event) => setShareKind(event.target.value === "AGENT" ? "AGENT" : "HUMAN")}
                disabled={shareSubmitting}
              >
                <option value="HUMAN">Human viewer</option>
                <option value="AGENT">Agent viewer</option>
              </select>
              <input
                list={shareKind === "AGENT" ? "agent-share-options" : "human-share-options"}
                placeholder={shareKind === "AGENT" ? "agent name" : "username"}
                value={shareValue}
                onChange={(event) => setShareValue(event.target.value)}
                disabled={shareSubmitting}
              />
              <button type="submit" disabled={shareSubmitting || !shareValue.trim()}>
                {shareSubmitting ? "Sharing..." : "Share"}
              </button>
              <datalist id="agent-share-options">
                {visibleAgents.map((agent) => (
                  <option key={agent.name} value={agent.name} />
                ))}
              </datalist>
              <datalist id="human-share-options">
                {humans.map((human) => (
                  <option key={human.username} value={human.username} />
                ))}
              </datalist>
            </form>

            <div className="participants-dialog-list">
              {(activeChannel.shares ?? []).map((share, index) => {
                const shareKey = `${share.viewerType}:${share.viewerId}`;
                return (
                  <article key={`${share.viewerType}:${share.viewerId}:${index}`}>
                    <div>
                      <strong>{share.viewerId}</strong>
                      <span>{shareTypeLabel(share)}</span>
                    </div>
                    <button
                      className="participant-remove-button"
                      onClick={() => void handleRemoveShare(share)}
                      disabled={shareRemovingKey === shareKey}
                      title={`Remove shared viewer ${share.viewerId}`}
                      type="button"
                    >
                      {shareRemovingKey === shareKey ? "Removing..." : "Remove"}
                    </button>
                  </article>
                );
              })}
              {(activeChannel.shares ?? []).length === 0 ? (
                <p>No shared viewers yet.</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {showChannelManageDialog && activeChannel && activeChannelManageable ? (
        <div
          className={`dialog-backdrop${showParticipantsDialog ? " dialog-backdrop-underlay" : ""}`}
          role="presentation"
          onMouseDown={() => setShowChannelManageDialog(false)}
        >
          <section
            aria-modal="true"
            className="conversation-dialog participants-dialog"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>Channel settings</span>
                <h2>Manage channel</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="dialog-close"
                onClick={() => setShowChannelManageDialog(false)}
                type="button"
              >
                Close
              </button>
            </header>

            <div className="channel-manage-grid">
              <label>
                <span>Visibility</span>
                <select
                  value={channelVisibilityDraft}
                  onChange={(event) =>
                    setChannelVisibilityDraft(event.target.value === "PUBLIC" ? "PUBLIC" : "PRIVATE")
                  }
                  disabled={updatingChannelVisibility}
                >
                  <option value="PRIVATE">Private</option>
                  <option value="PUBLIC">Public</option>
                </select>
              </label>

              <label className="archive-checkbox-row">
                <input
                  type="checkbox"
                  checked={archiveDraft}
                  onChange={(event) => setArchiveDraft(event.target.checked)}
                  disabled={updatingChannelVisibility}
                />
                <span>Archived</span>
              </label>
            </div>

            <div className="channel-manage-quick-actions">
              <button
                type="button"
                className="channel-manage-secondary-button"
                onClick={() => {
                  setShowParticipantsDialog(true);
                }}
                disabled={updatingChannelVisibility}
              >
                Manage participants
              </button>
              <button
                type="button"
                className="channel-manage-secondary-button"
                onClick={() => void handleCopyShareLink()}
                disabled={updatingChannelVisibility}
              >
                {shareLinkCopied ? "Link copied" : "Copy share link"}
              </button>
            </div>

            <button
              className="channel-manage-save-button"
              type="button"
              onClick={() => void handleSaveChannelSettings()}
              disabled={
                updatingChannelVisibility ||
                (channelVisibilityDraft === (activeChannel.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE") &&
                  archiveDraft === Boolean(activeChannel.archivedAt))
              }
            >
              {updatingChannelVisibility ? "Saving..." : "Save"}
            </button>

            <button
              className="channel-manage-delete-button"
              type="button"
              onClick={() => void handleDeleteChannel(activeChannel)}
              disabled={updatingChannelVisibility}
            >
              Delete channel
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
