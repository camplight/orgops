import { formatAttachmentSize, type MessageAttachment } from "../../domain/messaging/attachments";

type MessageAttachmentsProps = {
  eventId: string;
  attachments: MessageAttachment[];
};

export function MessageAttachments({ eventId, attachments }: MessageAttachmentsProps) {
  return (
    <div className="message-attachments">
      <strong>Attachments</strong>
      <ul>
        {attachments.map((attachment, index) => {
          const sizeLabel = formatAttachmentSize(attachment.size);
          const mimeLabel = attachment.mime ? attachment.mime : "";
          return (
            <li key={`${eventId}-attachment-${index}`}>
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
  );
}
