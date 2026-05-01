import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type AnchorHTMLAttributes,
  type ClipboardEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EventRow } from "../types";
import { apiFetch, apiJson, getApiHeaders } from "../api";
import { Button, Card, SelectAutocomplete, Textarea } from "../components/ui";
import { formatTimestamp } from "../utils/formatTimestamp";

type ChatScreenProps = {
  targetOptions: {
    id: string;
    label: string;
    meta?: string;
    participantsText?: string;
    agentNames?: string[];
  }[];
  activeChannelId: string | null;
  activeTargetId: string | null;
  events: EventRow[];
  messageText: string;
  onSelectTarget: (id: string) => void;
  onMessageTextChange: (value: string) => void;
  onSendMessage: (input?: {
    attachments?: {
      fileId: string;
      name: string;
      mime: string;
      size: number;
      tempPath: string;
      sha256?: string;
    }[];
  }) => Promise<void>;
  onClearMessages: () => Promise<void>;
};

const CHAT_WINDOW_SIZE = 250;

const MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => (
    <p className="mb-2 leading-relaxed last:mb-0">{children}</p>
  ),
  a: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      {...props}
      className="text-sky-400 underline hover:text-sky-300"
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-100 last:mb-0">
      {children}
    </pre>
  ),
  code: ({ children, ...props }: HTMLAttributes<HTMLElement>) => (
    <code
      {...props}
      className="rounded bg-slate-800/90 px-1 py-0.5 text-slate-100"
    >
      {children}
    </code>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="mb-2 border-l-2 border-slate-600 pl-3 text-slate-400 last:mb-0">
      {children}
    </blockquote>
  )
};

function getAgentNameFromSource(source: string | undefined) {
  if (!source?.startsWith("agent:")) return null;
  return source.slice("agent:".length).trim() || null;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toSentenceCase(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function humanizeEventType(type: string) {
  return type
    .split(".")
    .map((part) => part.replace(/[_-]+/g, " "))
    .join(" ");
}

function getMessageRole(event: EventRow): "human" | "agent" | "system" {
  if (event.source.startsWith("human:")) return "human";
  if (event.source.startsWith("agent:")) return "agent";
  return "system";
}

function getPayloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getAgentTurnFailedMessage(event: EventRow): string {
  const payload = asObject(event.payload);
  return (
    getPayloadString(payload, "error") ??
    (typeof event.lastError === "string" && event.lastError.trim() ? event.lastError.trim() : null) ??
    "Agent turn failed."
  );
}

function getAgentNameForStatusEvent(event: EventRow): string | null {
  const fromSource = getAgentNameFromSource(event.source);
  if (fromSource) return fromSource;
  const payload = asObject(event.payload);
  const fromPayload = getPayloadString(payload, "agentName") ?? getPayloadString(payload, "targetAgentName");
  return fromPayload;
}

function compactInlineText(value: string, maxChars = 96): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function payloadSnippet(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      const compact = compactInlineText(value);
      if (compact) return compact;
    }
  }
  return null;
}

function toInlineAgentDetail(event: EventRow): string | null {
  const payload = asObject(event.payload);
  if (event.type === "process.started") {
    return payloadSnippet(payload, ["cmd"]);
  }
  if (event.type === "process.output") {
    return payloadSnippet(payload, ["text"]);
  }
  if (event.type === "tool.started") {
    const args = asObject(payload.args);
    const commandLike =
      payloadSnippet(args, ["cmd", "command", "path", "query", "pattern"]) ??
      payloadSnippet(payload, ["tool"]);
    return commandLike ? compactInlineText(commandLike) : null;
  }
  if (event.type === "tool.executed") {
    const output = asObject(payload.output);
    return (
      payloadSnippet(output, ["stdout", "stderr", "text", "error"]) ??
      payloadSnippet(payload, ["tool"])
    );
  }
  if (event.type === "agent.turn.phase") {
    return payloadSnippet(payload, ["phase"]);
  }
  return (
    payloadSnippet(payload, ["status", "message", "phase", "tool"]) ??
    (event.type.startsWith("audit.") ? null : compactInlineText(humanizeEventType(event.type), 64))
  );
}

function toInlineAgentStatus(event: EventRow): string {
  const payload = asObject(event.payload);
  if (event.type === "agent.turn.started") return "working";
  if (event.type === "agent.turn.completed") return "completed";
  if (event.type === "agent.turn.failed") return "failed";
  if (event.type === "agent.turn.phase") {
    const phase = getPayloadString(payload, "phase");
    if (phase) return phase.toLowerCase();
  }
  if (event.type === "tool.started") {
    const toolName = getPayloadString(payload, "tool");
    return toolName ? `using ${toolName.replace(/[_-]+/g, " ")}` : "using a tool";
  }
  if (event.type === "tool.executed") {
    const toolName = getPayloadString(payload, "tool");
    return toolName ? `finished ${toolName.replace(/[_-]+/g, " ")}` : "finished a tool";
  }
  if (event.type === "tool.failed") {
    const toolName = getPayloadString(payload, "tool");
    return toolName ? `${toolName.replace(/[_-]+/g, " ")} failed` : "tool failed";
  }
  if (event.type === "process.output") return "running process";
  if (event.type === "process.exited") return "process exited";
  const tool =
    typeof payload.tool === "string"
      ? payload.tool
      : typeof payload.toolName === "string"
        ? payload.toolName
        : null;
  if (tool) {
    return `using ${tool.replace(/[_-]+/g, " ")}`;
  }

  if (typeof payload.status === "string" && payload.status.trim()) {
    return payload.status.trim().toLowerCase();
  }

  if (typeof payload.phase === "string" && payload.phase.trim()) {
    return payload.phase.trim().toLowerCase();
  }

  if (event.type === "message.created") return "writing";
  return `processing ${humanizeEventType(event.type)}`;
}

type AgentContextUsage = {
  agentName: string;
  usedTokens: number;
  availableTokens: number;
  contextWindowTokens: number;
  utilizationPct: number;
  updatedAt: number;
};

type MemoryRecord = {
  summaryText: string;
  windowStartAt?: number;
  lastProcessedAt: number;
  updatedAt: number;
};

type AgentMemory = {
  agentName: string;
  channelRecent: MemoryRecord | null;
  channelFull: MemoryRecord | null;
  error?: string;
};

type UploadedAttachment = {
  localId: string;
  fileId: string;
  name: string;
  mime: string;
  size: number;
  tempPath: string;
  sha256?: string;
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
  name: string;
  tempPath: string;
};

type TypingIndicator = {
  agentName: string;
  status: string;
  at: number;
  eventType: string;
  detail: string | null;
};

function summarizeMemoryTitle(record: MemoryRecord | null, fallback: string): string {
  if (!record || !record.summaryText.trim()) return fallback;
  return record.summaryText;
}

function getRecordMeta(record: MemoryRecord | null): string {
  if (!record) return "No record yet";
  const updated = formatTimestamp(record.updatedAt);
  const processed = formatTimestamp(record.lastProcessedAt);
  return `Updated: ${updated} | Last processed: ${processed}`;
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
  return payloadRecord.attachments
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const tempPath = typeof record.tempPath === "string" ? record.tempPath.trim() : "";
      if (!name || !tempPath) return null;
      return { name, tempPath };
    })
    .filter((entry): entry is MessageAttachment => Boolean(entry));
}

function parseAgentContextUsage(event: EventRow): AgentContextUsage | null {
  if (event.type !== "telemetry.context.window.updated") return null;
  const payload = asObject(event.payload);
  const agentNameRaw = payload.agentName;
  const agentName =
    typeof agentNameRaw === "string" && agentNameRaw.trim().length > 0
      ? agentNameRaw.trim()
      : getAgentNameForStatusEvent(event);
  if (!agentName) return null;
  const usedTokens =
    typeof payload.estimatedUsedTokens === "number" && Number.isFinite(payload.estimatedUsedTokens)
      ? Math.max(0, Math.floor(payload.estimatedUsedTokens))
      : 0;
  const availableTokens =
    typeof payload.estimatedAvailableTokens === "number" &&
    Number.isFinite(payload.estimatedAvailableTokens)
      ? Math.max(0, Math.floor(payload.estimatedAvailableTokens))
      : 0;
  const contextWindowTokens =
    typeof payload.contextWindowTokens === "number" && Number.isFinite(payload.contextWindowTokens)
      ? Math.max(1, Math.floor(payload.contextWindowTokens))
      : usedTokens + availableTokens;
  const computedPct = contextWindowTokens > 0 ? (usedTokens / contextWindowTokens) * 100 : 0;
  const utilizationPct =
    typeof payload.utilizationPct === "number" && Number.isFinite(payload.utilizationPct)
      ? Math.max(0, Math.min(100, payload.utilizationPct))
      : Math.max(0, Math.min(100, computedPct));
  return {
    agentName,
    usedTokens,
    availableTokens,
    contextWindowTokens,
    utilizationPct,
    updatedAt: event.createdAt ?? 0,
  };
}

function ContextRing({
  usedPct,
  size = 36,
  stroke = 4,
  showLabel = true
}: {
  usedPct: number;
  size?: number;
  stroke?: number;
  showLabel?: boolean;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, usedPct));
  const dashOffset = circumference - (clamped / 100) * circumference;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="rgb(51 65 85)"
        strokeWidth={stroke}
        fill="transparent"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={clamped >= 90 ? "rgb(248 113 113)" : clamped >= 75 ? "rgb(250 204 21)" : "rgb(56 189 248)"}
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="transparent"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {showLabel ? (
        <text
          x="50%"
          y="50%"
          dominantBaseline="middle"
          textAnchor="middle"
          className="fill-slate-200 text-[9px] font-medium"
        >
          {Math.round(clamped)}%
        </text>
      ) : null}
    </svg>
  );
}

function hasSelectionInside(container: HTMLElement | null) {
  if (!container) return false;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  return Boolean(
    (anchorNode && container.contains(anchorNode)) || (focusNode && container.contains(focusNode))
  );
}

const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={MARKDOWN_COMPONENTS}
    >
      {text}
    </Markdown>
  );
});

type SecretInputSpec = {
  packageValue: string;
  keyValue: string;
  label: string;
  submitLabel: string;
  description: string | null;
  placeholder: string;
};

function readSecretInputAttribute(node: Element, name: string, fallback: string, maxLength = 160): string {
  const value = node.getAttribute(name);
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

function isSecretIdentifier(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,160}$/.test(value);
}

function parseSecretInputSpec(messageText: string): SecretInputSpec | null {
  const trimmed = messageText.trim();
  if (!trimmed.startsWith("<") || !trimmed.endsWith(">")) return null;
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(trimmed, "text/html");
  const children = Array.from(doc.body.children);
  if (children.length !== 1) return null;
  const node = children[0];
  if (node.tagName.toLowerCase() !== "orgops-secret-input") return null;
  if (node.children.length > 0) return null;
  if ((node.textContent ?? "").trim().length > 0) return null;
  const packageValue = readSecretInputAttribute(node, "package", "");
  const keyValue = readSecretInputAttribute(node, "key", "");
  if (packageValue && !isSecretIdentifier(packageValue)) return null;
  if (keyValue && !isSecretIdentifier(keyValue)) return null;
  return {
    packageValue,
    keyValue,
    label: readSecretInputAttribute(node, "label", "Set a secret"),
    submitLabel: readSecretInputAttribute(node, "submit-label", "Save secret", 48),
    description: node.getAttribute("description")?.trim().slice(0, 280) || null,
    placeholder: readSecretInputAttribute(node, "placeholder", "Enter secret value", 120)
  };
}

function SecretInputCard({ spec }: { spec: SecretInputSpec }) {
  const [packageValue, setPackageValue] = useState(spec.packageValue);
  const [keyValue, setKeyValue] = useState(spec.keyValue);
  const [secretValue, setSecretValue] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const submit = async () => {
    const packageName = packageValue.trim();
    const keyName = keyValue.trim();
    if (!packageName || !keyName || !secretValue) {
      setStatus("error");
      setErrorMessage("Package, key, and secret value are required.");
      return;
    }
    if (!isSecretIdentifier(packageName) || !isSecretIdentifier(keyName)) {
      setStatus("error");
      setErrorMessage("Package and key may only contain letters, numbers, dot, underscore, and hyphen.");
      return;
    }

    setStatus("saving");
    setErrorMessage("");
    try {
      await apiFetch("/api/secrets", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          package: packageName,
          key: keyName,
          value: secretValue
        })
      });
      setSecretValue("");
      setStatus("saved");
    } catch {
      setStatus("error");
      setErrorMessage("Unable to save secret right now.");
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-fuchsia-800/70 bg-fuchsia-950/20 p-3">
      <div className="text-xs uppercase tracking-wide text-fuchsia-300">Secure secret input</div>
      <div className="text-sm font-medium text-fuchsia-100">{spec.label}</div>
      {spec.description ? <div className="text-xs text-fuchsia-200/90">{spec.description}</div> : null}
      <div className="grid gap-2 md:grid-cols-2">
        <label className="space-y-1 text-xs text-slate-300">
          <div className="text-slate-400">Package</div>
          <input
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            value={packageValue}
            onChange={(event) => setPackageValue(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="space-y-1 text-xs text-slate-300">
          <div className="text-slate-400">Key</div>
          <input
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            value={keyValue}
            onChange={(event) => setKeyValue(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>
      <label className="space-y-1 text-xs text-slate-300">
        <div className="text-slate-400">Secret value</div>
        <input
          type="password"
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          value={secretValue}
          onChange={(event) => setSecretValue(event.target.value)}
          placeholder={spec.placeholder}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void submit()}
          disabled={status === "saving"}
        >
          {status === "saving" ? "Saving..." : spec.submitLabel}
        </Button>
        {status === "saved" ? <span className="text-xs text-emerald-300">Secret saved.</span> : null}
        {status === "error" ? <span className="text-xs text-rose-300">{errorMessage}</span> : null}
      </div>
    </div>
  );
}

export function ChatScreen({
  targetOptions,
  activeChannelId,
  activeTargetId,
  events,
  messageText,
  onSelectTarget,
  onMessageTextChange,
  onSendMessage,
  onClearMessages
}: ChatScreenProps) {
  const chatLines = useMemo(
    () =>
      events
        .filter((event) => event.type === "message.created" || event.type === "agent.turn.failed")
        .sort((left, right) => {
          const leftTs = left.createdAt ?? 0;
          const rightTs = right.createdAt ?? 0;
          if (leftTs !== rightTs) return leftTs - rightTs;
          return left.id.localeCompare(right.id);
        }),
    [events]
  );
  const activeTarget = targetOptions.find((target) => target.id === activeTargetId) ?? null;
  const activeAgentNames = useMemo(() => {
    if (!activeTargetId) return [];
    if (activeTargetId.startsWith("agent:")) {
      const agentName = activeTargetId.slice("agent:".length).trim();
      return agentName ? [agentName] : [];
    }
    const fromTarget = activeTarget?.agentNames ?? [];
    return [...new Set(fromTarget.filter((name) => Boolean(name?.trim())))];
  }, [activeTarget, activeTargetId]);
  const activeChannelParticipants =
    activeTargetId?.startsWith("channel:") ? activeTarget?.participantsText : undefined;
  const typingIndicators = useMemo(() => {
    const ordered = events
      .slice()
      .sort((left, right) => {
        const leftTs = left.createdAt ?? 0;
        const rightTs = right.createdAt ?? 0;
        if (leftTs !== rightTs) return leftTs - rightTs;
        return left.id.localeCompare(right.id);
      });
    const activeByAgent = new Map<
      string,
      TypingIndicator & {
        openTurns: number;
      }
    >();
    for (const event of ordered) {
      const agentName = getAgentNameForStatusEvent(event);
      if (!agentName) continue;
      const ts = event.createdAt ?? 0;
      if (event.type === "agent.turn.started") {
        const existing = activeByAgent.get(agentName);
        activeByAgent.set(agentName, {
          agentName,
          status: "working",
          at: ts,
          eventType: event.type,
          detail: null,
          openTurns: (existing?.openTurns ?? 0) + 1
        });
        continue;
      }
      if (event.type === "agent.turn.completed" || event.type === "agent.turn.failed") {
        const existing = activeByAgent.get(agentName);
        if (!existing) continue;
        if (existing.openTurns <= 1) {
          activeByAgent.delete(agentName);
        } else {
          activeByAgent.set(agentName, { ...existing, openTurns: existing.openTurns - 1, at: ts });
        }
        continue;
      }
      const existing = activeByAgent.get(agentName);
      if (!existing || existing.openTurns <= 0) continue;
      const status = toInlineAgentStatus(event);
      activeByAgent.set(agentName, {
        ...existing,
        status,
        at: ts,
        eventType: event.type,
        detail: toInlineAgentDetail(event)
      });
    }

    return [...activeByAgent.values()]
      .sort((left, right) => right.at - left.at)
      .map(({ openTurns: _openTurns, ...indicator }) => indicator);
  }, [events]);
  const contextUsageByAgent = useMemo(() => {
    const latestByAgent = new Map<string, AgentContextUsage>();
    const ordered = events
      .slice()
      .sort((left, right) => {
        const leftTs = left.createdAt ?? 0;
        const rightTs = right.createdAt ?? 0;
        if (leftTs !== rightTs) return leftTs - rightTs;
        return left.id.localeCompare(right.id);
      });
    for (const event of ordered) {
      const usage = parseAgentContextUsage(event);
      if (!usage) continue;
      const existing = latestByAgent.get(usage.agentName);
      if (!existing || usage.updatedAt >= existing.updatedAt) {
        latestByAgent.set(usage.agentName, usage);
      }
    }
    return [...latestByAgent.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }, [events]);
  const visibleContextUsageByAgent = useMemo(() => {
    if (activeAgentNames.length === 0) return contextUsageByAgent;
    const activeNames = new Set(activeAgentNames);
    return contextUsageByAgent.filter((usage) => activeNames.has(usage.agentName));
  }, [activeAgentNames, contextUsageByAgent]);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const isPinnedToBottomRef = useRef(true);
  const [memoryDrawerOpen, setMemoryDrawerOpen] = useState(false);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [agentMemories, setAgentMemories] = useState<AgentMemory[]>([]);
  const [memoryReloadToken, setMemoryReloadToken] = useState(0);
  const [visibleChatLineCount, setVisibleChatLineCount] = useState(CHAT_WINDOW_SIZE);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const memoryCacheRef = useRef<Map<string, AgentMemory[]>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const visibleChatLines = useMemo(() => {
    if (chatLines.length <= visibleChatLineCount) return chatLines;
    return chatLines.slice(chatLines.length - visibleChatLineCount);
  }, [chatLines, visibleChatLineCount]);
  const hiddenChatLineCount = chatLines.length - visibleChatLines.length;
  const lastVisibleChatLineId = visibleChatLines[visibleChatLines.length - 1]?.id ?? null;
  const uploadingAttachmentCount = pendingAttachments.filter((item) => item.status === "uploading").length;
  const readyAttachments = pendingAttachments
    .filter((item) => item.status === "ready" && item.uploaded)
    .map((item) => item.uploaded as UploadedAttachment);
  const hasAttachmentErrors = pendingAttachments.some((item) => item.status === "error");
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (uploadingAttachmentCount > 0) return;
    void handleSendWithAttachments();
  };
  const handleExportPdf = () => {
    window.print();
  };
  const handleSendWithAttachments = async () => {
    await onSendMessage({ attachments: readyAttachments });
    setPendingAttachments([]);
  };

  useEffect(() => {
    setVisibleChatLineCount(CHAT_WINDOW_SIZE);
    isPinnedToBottomRef.current = true;
    setPendingAttachments([]);
  }, [activeTargetId]);

  const uploadSingleFile = async (file: File) => {
    const localId = createLocalAttachmentId();
    const mime = file.type || "application/octet-stream";
    setPendingAttachments((prev) => [
      ...prev,
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
      const metaResponse = await apiJson<{
        id: string;
        storage_path: string;
        original_name?: string;
        mime?: string;
        size?: number;
        sha256?: string;
      }>(`/api/files/${encodeURIComponent(uploadPayload.id)}/meta`);
      const uploaded: UploadedAttachment = {
        localId,
        fileId: uploadPayload.id,
        name: metaResponse.original_name || file.name || "upload",
        mime: metaResponse.mime || mime,
        size: typeof metaResponse.size === "number" ? metaResponse.size : file.size,
        tempPath: metaResponse.storage_path,
        ...(typeof metaResponse.sha256 === "string" && metaResponse.sha256
          ? { sha256: metaResponse.sha256 }
          : {})
      };
      setPendingAttachments((prev) =>
        prev.map((entry) =>
          entry.localId === localId
            ? {
                ...entry,
                name: uploaded.name,
                mime: uploaded.mime,
                size: uploaded.size,
                status: "ready",
                uploaded,
                error: undefined
              }
            : entry
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setPendingAttachments((prev) =>
        prev.map((entry) =>
          entry.localId === localId ? { ...entry, status: "error", error: message } : entry
        )
      );
    }
  };

  const uploadFiles = (files: File[]) => {
    for (const file of files) {
      void uploadSingleFile(file);
    }
  };

  const handlePickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    uploadFiles(files);
    event.currentTarget.value = "";
  };

  const handleComposerPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
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
  };

  useEffect(() => {
    if (!activeTargetId || !messagesContainerRef.current) {
      return;
    }
    if (!isPinnedToBottomRef.current) return;
    if (hasSelectionInside(messagesContainerRef.current)) return;
    messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
  }, [activeTargetId, lastVisibleChatLineId, typingIndicators.length, visibleChatLines.length]);

  const memoryFetchKey = useMemo(() => {
    if (!activeChannelId || activeAgentNames.length === 0) return "";
    const names = [...activeAgentNames].sort((left, right) => left.localeCompare(right));
    return `${activeChannelId}::${names.join(",")}`;
  }, [activeAgentNames, activeChannelId]);
  const stableAgentNames = useMemo(() => {
    if (!memoryFetchKey.includes("::")) return [];
    const namesPart = memoryFetchKey.split("::")[1] ?? "";
    return namesPart.split(",").map((name) => name.trim()).filter(Boolean);
  }, [memoryFetchKey]);

  useEffect(() => {
    if (!memoryDrawerOpen || !memoryFetchKey || !activeChannelId || stableAgentNames.length === 0) {
      setAgentMemories([]);
      setMemoryLoading(false);
      return;
    }
    const cached = memoryCacheRef.current.get(memoryFetchKey);
    if (cached) {
      setAgentMemories(cached);
      setMemoryLoading(false);
      return;
    }
    let cancelled = false;
    setMemoryLoading(true);
    const load = async () => {
      const bundles = await Promise.all(
        stableAgentNames.map(async (agentName): Promise<AgentMemory> => {
          const channelParams = new URLSearchParams({
            agentName,
            channelId: activeChannelId
          });
          try {
            const [
              channelRecent,
              channelFull
            ] = await Promise.all([
              apiJson<{ record?: MemoryRecord | null }>(
                `/api/memory/channel/recent?${channelParams.toString()}`
              ),
              apiJson<{ record?: MemoryRecord | null }>(
                `/api/memory/channel/full?${channelParams.toString()}`
              )
            ]);
            return {
              agentName,
              channelRecent: channelRecent.record ?? null,
              channelFull: channelFull.record ?? null
            };
          } catch (error) {
            return {
              agentName,
              channelRecent: null,
              channelFull: null,
              error: error instanceof Error ? error.message : "Unable to load memory"
            };
          }
        })
      );
      if (cancelled) return;
      memoryCacheRef.current.set(memoryFetchKey, bundles);
      setAgentMemories(bundles);
      setMemoryLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [memoryDrawerOpen, activeChannelId, memoryFetchKey, memoryReloadToken, stableAgentNames]);

  return (
    <div className="space-y-6 chat-print-root">
      <div className="chat-print-hide">
        <Card title="Destination">
        <div className="space-y-2">
          <div className="text-slate-400 text-sm">
            Select a channel or pick an agent to open a direct channel.
          </div>
          <SelectAutocomplete
            value={activeTargetId}
            options={targetOptions}
            placeholder="Search agent or channel..."
            onChange={onSelectTarget}
          />
        </div>
      </Card>
      </div>

      <Card title="Messages">
        {!activeTarget && (
          <div className="text-slate-500 text-sm">
            Select where to send your message.
          </div>
        )}

        {activeTarget && (
          <div className="space-y-4">
            {activeChannelParticipants && (
              <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                <span className="text-slate-400">Participants:</span>{" "}
                {activeChannelParticipants}
              </div>
            )}
            <div
              ref={messagesContainerRef}
              className="max-h-[34rem] space-y-3 overflow-auto rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-sm chat-print-messages"
              onScroll={(event) => {
                const container = event.currentTarget;
                const distanceFromBottom =
                  container.scrollHeight - container.scrollTop - container.clientHeight;
                isPinnedToBottomRef.current = distanceFromBottom < 48;
              }}
            >
              {hiddenChatLineCount > 0 && (
                <div className="sticky top-0 z-10 flex justify-center bg-slate-950/85 py-1 backdrop-blur">
                  <Button
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() =>
                      setVisibleChatLineCount((count) => Math.min(chatLines.length, count + CHAT_WINDOW_SIZE))
                    }
                  >
                    Load older messages ({hiddenChatLineCount} hidden)
                  </Button>
                </div>
              )}
              {visibleChatLines.map((event) => {
                if (event.type === "agent.turn.failed") {
                  return (
                    <div key={event.id} className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-xs text-rose-300">
                        <span className="rounded bg-rose-900/50 px-1.5 py-0.5 text-[11px] text-rose-200">
                          {event.source}
                        </span>
                        <span>{formatTimestamp(event.createdAt)}</span>
                      </div>
                      <div className="mt-1 text-sm text-rose-200">{getAgentTurnFailedMessage(event)}</div>
                    </div>
                  );
                }

                const messageAttachments = parseMessageAttachments(event.payload);
                const role = getMessageRole(event);
                const messageText = (event.payload as { text?: string })?.text ?? "";
                const secretInputSpec = role === "agent" ? parseSecretInputSpec(messageText) : null;
                return (
                  <div
                    key={event.id}
                    className="space-y-1"
                  >
                    <div
                      className={`flex items-center gap-2 text-xs text-slate-400 ${
                        role === "human" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300">
                        {event.source}
                      </span>
                      <span>{formatTimestamp(event.createdAt)}</span>
                    </div>
                    <div
                      className={`flex ${role === "human" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl border px-3 py-2 shadow-sm ${
                          role === "human"
                            ? "border-sky-700/70 bg-sky-900/30"
                            : role === "agent"
                              ? "border-slate-700 bg-slate-900"
                              : "border-amber-700/50 bg-amber-950/30"
                        }`}
                      >
                        <div className="text-left text-slate-200">
                          {secretInputSpec ? (
                            <SecretInputCard spec={secretInputSpec} />
                          ) : (
                            <MessageMarkdown text={messageText} />
                          )}
                          {messageAttachments.length > 0 && (
                            <div className="mt-2 rounded border border-slate-700/60 bg-slate-950/60 p-2 text-xs text-slate-300">
                              <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
                                Attached files
                              </div>
                              <ul className="space-y-1">
                                {messageAttachments.map((attachment, index) => (
                                  <li key={`${event.id}-attachment-${index}`}>
                                    <span className="text-slate-200">{attachment.name}</span>
                                    <span className="mx-1 text-slate-500">{"->"}</span>
                                    <span className="font-mono text-[11px] text-slate-400">
                                      {attachment.tempPath}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {typingIndicators.map((indicator) => (
                <div
                  key={`indicator-${indicator.agentName}`}
                  className="rounded-lg border border-sky-800/70 bg-slate-900 px-3 py-2 text-sm text-slate-300 chat-print-hide"
                >
                  <div className="flex items-center gap-2">
                    <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400/50" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-400" />
                    </span>
                    <span className="font-medium text-slate-100">{indicator.agentName}</span>
                    <span>is {toSentenceCase(indicator.status)}...</span>
                    <span className="truncate rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {humanizeEventType(indicator.eventType)}
                    </span>
                  </div>
                  {indicator.detail ? (
                    <div className="mt-1 truncate pl-4 text-xs text-slate-400">{indicator.detail}</div>
                  ) : null}
                </div>
              ))}
              {visibleChatLines.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-4 py-8 text-center text-slate-500">
                  No messages yet. Send the first message to start the conversation.
                </div>
              )}
            </div>

            <div className="space-y-2 chat-print-hide">
              <Textarea
                rows={3}
                placeholder="Send a message... (Shift+Enter for new line, you can paste screenshots)"
                value={messageText}
                onChange={(e) => onMessageTextChange(e.target.value)}
                onKeyDown={handleComposerKeyDown}
                onPaste={handleComposerPaste}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handlePickFiles}
              />
              {pendingAttachments.length > 0 && (
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2 text-xs text-slate-300">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Attachments</div>
                  <div className="space-y-1">
                    {pendingAttachments.map((attachment) => (
                      <div
                        key={attachment.localId}
                        className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-900/80 px-2 py-1"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-slate-200">{attachment.name}</div>
                          <div className="truncate text-[11px] text-slate-500">
                            {attachment.status === "ready"
                              ? attachment.uploaded?.tempPath
                              : attachment.status === "uploading"
                                ? "Uploading..."
                                : attachment.error || "Upload failed"}
                          </div>
                        </div>
                        <Button
                          variant="secondary"
                          className="px-2 py-1 text-[11px]"
                          onClick={() =>
                            setPendingAttachments((prev) =>
                              prev.filter((entry) => entry.localId !== attachment.localId)
                            )
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Attach files
                  </Button>
                  <Button
                    onClick={() => void handleSendWithAttachments()}
                    disabled={uploadingAttachmentCount > 0}
                  >
                    {uploadingAttachmentCount > 0 ? `Uploading ${uploadingAttachmentCount}...` : "Send message"}
                  </Button>
                  <Button variant="secondary" onClick={handleExportPdf}>
                    Export PDF
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setMemoryDrawerOpen(true)}
                    disabled={!activeChannelId || activeAgentNames.length === 0}
                  >
                    View memory
                  </Button>
                  <Button
                    variant="secondary"
                    className="bg-rose-900 text-rose-100 hover:bg-rose-800"
                    onClick={async () => {
                      if (!confirm("Clear all messages in this channel? This cannot be undone.")) {
                        return;
                      }
                      await onClearMessages();
                    }}
                  >
                    Clear messages
                  </Button>
                </div>
                {hasAttachmentErrors && (
                  <div className="text-xs text-rose-300">
                    One or more attachments failed to upload. Remove them or retry.
                  </div>
                )}
                {visibleContextUsageByAgent.length > 0 && (
                  <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      Context
                    </span>
                    {visibleContextUsageByAgent.map((usage) => (
                      <div
                        key={`context-footer-${usage.agentName}`}
                        className="group relative flex items-center gap-1.5 rounded border border-slate-800 bg-slate-900/70 px-1.5 py-1"
                        tabIndex={0}
                      >
                        <ContextRing usedPct={usage.utilizationPct} size={18} stroke={2.5} showLabel={false} />
                        <span className="max-w-24 truncate text-[11px] font-medium text-slate-200">
                          {usage.agentName}
                        </span>
                        <span className="text-[10px] text-slate-400">{Math.round(usage.utilizationPct)}%</span>
                        <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-56 max-w-[calc(100vw-1rem)] translate-y-1 rounded-lg border border-slate-700 bg-slate-900/95 p-2.5 text-left opacity-0 shadow-xl transition-all duration-150 sm:w-60 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
                          <div className="mb-1.5 border-b border-slate-700 pb-1.5 text-xs font-semibold text-slate-100">
                            {usage.agentName}
                          </div>
                          <div className="space-y-1 text-[11px]">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">Utilization</span>
                              <span className="font-medium text-slate-200">
                                {Math.round(usage.utilizationPct)}%
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">Used</span>
                              <span className="font-medium text-slate-200">
                                {usage.usedTokens.toLocaleString()} tokens
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">Available</span>
                              <span className="font-medium text-slate-200">
                                {usage.availableTokens.toLocaleString()} tokens
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">Context window</span>
                              <span className="font-medium text-slate-200">
                                {usage.contextWindowTokens.toLocaleString()} tokens
                              </span>
                            </div>
                            <div className="mt-1 border-t border-slate-700 pt-1 text-[10px] text-slate-500">
                              Updated {usage.updatedAt ? formatTimestamp(usage.updatedAt) : "unknown"}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity lg:left-56 ${
          memoryDrawerOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setMemoryDrawerOpen(false)}
      />
      <aside
        className={`fixed bottom-0 right-0 top-0 z-50 w-full max-w-4xl border-l border-slate-800 bg-slate-950 shadow-2xl transition-transform duration-300 ${
          memoryDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!memoryDrawerOpen}
      >
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Agent Memory</h3>
              <p className="text-xs text-slate-500">
                Channel recent and channel full memory per agent.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={() => {
                  if (memoryFetchKey) {
                    memoryCacheRef.current.delete(memoryFetchKey);
                  }
                  setMemoryReloadToken((value) => value + 1);
                }}
                disabled={!memoryFetchKey}
              >
                Refresh
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={() => setMemoryDrawerOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
            {memoryLoading ? (
              <div className="rounded border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-400">
                Loading memory...
              </div>
            ) : activeAgentNames.length === 0 ? (
              <div className="rounded border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-400">
                No agent participants found for this chat.
              </div>
            ) : (
              <div className="space-y-4">
                {agentMemories.map((memory) => (
                  <div
                    key={`memory-${memory.agentName}`}
                    className="space-y-3 rounded border border-slate-800 bg-slate-900/50 p-3"
                  >
                    <div className="text-sm font-semibold text-slate-100">{memory.agentName}</div>
                    {memory.error ? (
                      <div className="rounded border border-rose-900/60 bg-rose-950/30 p-2 text-xs text-rose-200">
                        {memory.error}
                      </div>
                    ) : null}
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded border border-slate-800 bg-slate-950 p-3">
                        <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
                          Channel Recent
                        </div>
                        <div className="whitespace-pre-wrap text-sm text-slate-200">
                          {summarizeMemoryTitle(memory.channelRecent, "No recent channel memory yet.")}
                        </div>
                        <div className="mt-2 text-[11px] text-slate-500">
                          {getRecordMeta(memory.channelRecent)}
                        </div>
                      </div>
                      <div className="rounded border border-slate-800 bg-slate-950 p-3">
                        <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
                          Channel Full
                        </div>
                        <div className="whitespace-pre-wrap text-sm text-slate-200">
                          {summarizeMemoryTitle(memory.channelFull, "No full channel memory yet.")}
                        </div>
                        <div className="mt-2 text-[11px] text-slate-500">
                          {getRecordMeta(memory.channelFull)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
