import { useState, type ChangeEvent } from "react";
import type { UploadedAttachment } from "../../types";

export type PendingAttachment = {
  localId: string;
  name: string;
  mime: string;
  size: number;
  status: "uploading" | "ready" | "error";
  uploaded?: UploadedAttachment;
  error?: string;
};

export function usePendingAttachments(options: {
  uploadAttachment: (input: { file: File; localId: string }) => Promise<UploadedAttachment>;
  createLocalAttachmentId: () => string;
}) {
  const { uploadAttachment, createLocalAttachmentId } = options;
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);

  async function uploadSingleFile(file: File) {
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
      const uploaded = await uploadAttachment({ file, localId });
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
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Upload failed";
      setPendingAttachments((current) =>
        current.map((item) =>
          item.localId === localId ? { ...item, status: "error", error: message } : item
        )
      );
    }
  }

  function uploadFiles(files: File[]) {
    for (const file of files) {
      void uploadSingleFile(file);
    }
  }

  function handlePickFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    uploadFiles(files);
    event.currentTarget.value = "";
  }

  return { pendingAttachments, setPendingAttachments, uploadFiles, handlePickFiles };
}
