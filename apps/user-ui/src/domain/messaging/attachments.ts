export type MessageAttachment = {
  fileId: string;
  name: string;
  mime?: string;
  size?: number;
};

export function parseMessageAttachments(payload: unknown): MessageAttachment[] {
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
    attachments.push({ fileId, name, mime, size });
  }
  return attachments;
}

export function formatAttachmentSize(size?: number) {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return null;
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}
