import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  WORKSPACE_ATTACHMENTS_DIR,
  isWorkspaceAttachment,
  readMessageAttachments,
  saveAttachmentToWorkspace,
} from "./attachments";
import type { Agent } from "./types";

describe("workspace attachments", () => {
  it("saves an attachment once into the agent workspace", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "orgops-attachments-"));
    const agent = { name: "a", workspacePath } as Agent;
    const apiFetch = vi.fn(async () => new Response(new Uint8Array([37, 80, 68, 70])));
    const attachment = { fileId: "file-1", name: "../report v1.pdf", mime: "application/pdf" };

    const first = await saveAttachmentToWorkspace(apiFetch, agent, attachment);
    const second = await saveAttachmentToWorkspace(apiFetch, agent, attachment);

    expect(first?.localPath).toBe(join(workspacePath, WORKSPACE_ATTACHMENTS_DIR, "file-1", "report-v1.pdf"));
    expect(readFileSync(first!.localPath, "utf8")).toBe("%PDF");
    expect(second?.localPath).toBe(first?.localPath);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/api/files/file-1");
  });

  it("skips voice-note audio and malformed entries", () => {
    const attachments = readMessageAttachments({
      attachments: [
        { fileId: "voice-1", kind: "voice", mime: "audio/webm" },
        { fileId: "img-1", mime: "image/png", name: "a.png" },
        { name: "missing id" },
      ],
    });
    expect(attachments.filter(isWorkspaceAttachment)).toEqual([
      { fileId: "img-1", mime: "image/png", name: "a.png" },
    ]);
  });
});
