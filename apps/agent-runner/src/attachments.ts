import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Agent } from "./types";

export const WORKSPACE_ATTACHMENTS_DIR = ".orgops-attachments";
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

type ApiFetchFn = (path: string, init?: RequestInit) => Promise<Response>;

export type MessageAttachment = {
  fileId: string;
  name?: string;
  mime?: string;
  size?: number;
  kind?: string;
};

export type SavedAttachment = MessageAttachment & { localPath: string };

export function readMessageAttachments(payload: unknown): MessageAttachment[] {
  const attachments =
    payload && typeof payload === "object" ? (payload as { attachments?: unknown }).attachments : undefined;
  if (!Array.isArray(attachments)) return [];
  const out: MessageAttachment[] = [];
  for (const item of attachments) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const fileId = typeof entry.fileId === "string" ? entry.fileId.trim() : "";
    if (!fileId) continue;
    out.push({
      fileId,
      ...(typeof entry.name === "string" && entry.name.trim() ? { name: entry.name.trim() } : {}),
      ...(typeof entry.mime === "string" && entry.mime.trim() ? { mime: entry.mime.trim() } : {}),
      ...(typeof entry.size === "number" ? { size: entry.size } : {}),
      ...(typeof entry.kind === "string" ? { kind: entry.kind } : {}),
    });
  }
  return out;
}

/** Voice-note audio is already represented by its transcript. */
export function isWorkspaceAttachment(attachment: MessageAttachment) {
  return attachment.kind !== "voice";
}

export function attachmentLocalPath(agent: Agent, attachment: MessageAttachment) {
  const safeId = attachment.fileId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const name = basename(attachment.name ?? "").replace(/[^a-zA-Z0-9._-]/g, "-") || `attachment-${safeId}`;
  return join(resolve(agent.workspacePath), WORKSPACE_ATTACHMENTS_DIR, safeId, name);
}

/**
 * Downloads a channel attachment into the agent workspace so filesystem and
 * shell tools can open it. Idempotent per fileId; returns null when unavailable.
 */
export async function saveAttachmentToWorkspace(
  apiFetch: ApiFetchFn,
  agent: Agent,
  attachment: MessageAttachment,
): Promise<{ localPath: string; bytes: Uint8Array } | null> {
  if (attachment.size !== undefined && attachment.size > MAX_ATTACHMENT_BYTES) return null;
  const localPath = attachmentLocalPath(agent, attachment);
  if (existsSync(localPath)) {
    return { localPath, bytes: new Uint8Array(readFileSync(localPath)) };
  }
  const response = await apiFetch(`/api/files/${encodeURIComponent(attachment.fileId)}`);
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) return null;
  mkdirSync(join(localPath, ".."), { recursive: true });
  writeFileSync(localPath, bytes);
  return { localPath, bytes };
}
