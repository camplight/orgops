import { formatAttachmentSize } from "../../domain/messaging/attachments";

type ComposerAttachment = {
  localId: string;
  name: string;
  size: number;
  status: "uploading" | "ready" | "error";
  error?: string;
};

type ComposerAttachmentsProps = {
  attachments: ComposerAttachment[];
  onRemove: (localId: string) => void;
};

export function ComposerAttachments({ attachments, onRemove }: ComposerAttachmentsProps) {
  return (
    <div className="composer-attachments">
      {attachments.map((attachment) => (
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
            onClick={() => onRemove(attachment.localId)}
          >
            Remove
          </button>
        </article>
      ))}
    </div>
  );
}
