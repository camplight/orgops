import {
  useEffect,
  type ChangeEvent,
  type ClipboardEvent,
  type Dispatch,
  type FormEvent,
  type RefObject,
  type SetStateAction
} from "react";
import type { Channel, UploadedAttachment } from "../../types";
import type { PendingAttachment } from "../messaging/use-pending-attachments";
import { ComposerTextarea } from "./composer-textarea";
import { ComposerActions } from "./composer-actions";
import { ComposerAttachments } from "./composer-attachments";

type ComposerProps = {
  textareaRef: RefObject<HTMLTextAreaElement>;
  fileInputRef: RefObject<HTMLInputElement>;
  isConversationEmpty: boolean;
  activeChannelId: string | null;
  activeChannel: Channel | null;
  activeChannelCanPost: boolean;
  username: string;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  sending: boolean;
  offlineAgentNames: string[];
  pendingAttachments: PendingAttachment[];
  setPendingAttachments: Dispatch<SetStateAction<PendingAttachment[]>>;
  readyAttachments: UploadedAttachment[];
  uploadingAttachmentCount: number;
  hasAttachmentErrors: boolean;
  uploadFiles: (files: File[]) => void;
  handlePickFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function Composer({
  textareaRef: composerTextareaRef,
  fileInputRef,
  isConversationEmpty,
  activeChannelId,
  activeChannel,
  activeChannelCanPost,
  username,
  draft,
  setDraft,
  sending,
  offlineAgentNames,
  pendingAttachments,
  setPendingAttachments,
  readyAttachments,
  uploadingAttachmentCount,
  hasAttachmentErrors,
  uploadFiles,
  handlePickFiles,
  handleSubmit
}: ComposerProps) {
  function resizeComposerTextarea(textarea?: HTMLTextAreaElement | null) {
    const target = textarea ?? composerTextareaRef.current;
    if (!target) return;
    const viewportMax = isConversationEmpty
      ? Math.max(56, Math.floor(window.innerHeight / 8))
      : Math.max(120, Math.floor(window.innerHeight / 3));
    const minHeight = isConversationEmpty ? 34 : 56;
    target.style.maxHeight = `${viewportMax}px`;
    target.style.height = "auto";
    const nextHeight = Math.min(target.scrollHeight, viewportMax);
    target.style.height = `${Math.max(minHeight, nextHeight)}px`;
    target.style.overflowY = target.scrollHeight > viewportMax ? "auto" : "hidden";
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
  }, [draft, isConversationEmpty, activeChannelId]);

  useEffect(() => {
    function handleWindowResize() {
      resizeComposerTextarea();
    }
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  return (
    <form className={`composer${isConversationEmpty ? " composer-compact" : ""}`} onSubmit={handleSubmit}>
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
            <ComposerAttachments
              attachments={pendingAttachments}
              onRemove={(localId) =>
                setPendingAttachments((current) =>
                  current.filter((item) => item.localId !== localId)
                )
              }
            />
          ) : null}
          <ComposerTextarea
            textareaRef={composerTextareaRef}
            value={draft}
            activeChannel={activeChannel}
            activeChannelCanPost={activeChannelCanPost}
            sending={sending}
            isConversationEmpty={isConversationEmpty}
            username={username}
            onChange={(event) => {
              setDraft(event.target.value);
              resizeComposerTextarea(event.currentTarget);
            }}
            onPaste={handleComposerPaste}
          />
          <ComposerActions
            canAttach={
              !(!activeChannel || Boolean(activeChannel.archivedAt) || !activeChannelCanPost || sending)
            }
            canSend={
              !(
                !activeChannel ||
                Boolean(activeChannel.archivedAt) ||
                !activeChannelCanPost ||
                sending ||
                uploadingAttachmentCount > 0 ||
                (!draft.trim() && readyAttachments.length === 0)
              )
            }
            sending={sending}
            uploadingAttachmentCount={uploadingAttachmentCount}
            onAttachClick={() => fileInputRef.current?.click()}
          />
          {hasAttachmentErrors ? (
            <p className="composer-attachment-error">
              One or more attachments failed to upload. Remove them or retry.
            </p>
          ) : null}
    </form>
  );
}
