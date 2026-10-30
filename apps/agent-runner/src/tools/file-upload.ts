import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { basename, extname } from "node:path";
import { resolveAgentPath } from "./path-access";
import type { ExecuteContext } from "./types";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const mimeTypes: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown",
  ".json": "application/json", ".csv": "text/csv",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".opus": "audio/ogg",
  ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac", ".webm": "audio/webm",
};

export async function uploadWorkspaceFile(ctx: ExecuteContext, inputPath: string) {
  const allowed = ctx.extraAllowedRoots ?? [];
  const path = resolveAgentPath(ctx.agent, inputPath, allowed);
  // Check the resolved target too: a workspace symlink must not publish other files.
  const target = resolveAgentPath(ctx.agent, await realpath(path), allowed);
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes: Uint8Array;
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error("Only regular files can be uploaded");
    if (stat.size > MAX_UPLOAD_BYTES) throw new Error("File exceeds the 20 MiB upload limit");
    const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_UPLOAD_BYTES + 1));
    let count = 0;
    while (count < buffer.length) {
      const read = await file.read(buffer, count, buffer.length - count, null);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    if (count > stat.size) throw new Error("File changed while reading; retry after writing finishes");
    bytes = new Uint8Array(buffer.subarray(0, count));
  } finally {
    await file.close();
  }
  const name = basename(path);
  const mime = mimeTypes[extname(name).toLowerCase()] ?? "application/octet-stream";
  const body = new FormData();
  body.append("file", new Blob([bytes], { type: mime }), name);
  const response = await ctx.apiFetch("/api/files", { method: "POST", body });
  if (!response.ok) throw new Error(`File upload failed (${response.status})`);
  const result = await response.json() as { id?: unknown };
  if (typeof result.id !== "string" || !result.id) throw new Error("Upload returned no file ID");
  return {
    attachment: { fileId: result.id, name, mime, size: bytes.byteLength },
    url: `/api/files/${encodeURIComponent(result.id)}`,
    instructions: "Include attachment in the attachments array of your message.created payload to share it in the conversation. Uploading alone does not post a message.",
  };
}
