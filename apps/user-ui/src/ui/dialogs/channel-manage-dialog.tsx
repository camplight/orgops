import type { Channel } from "../../types";

type ChannelManageDialogProps = {
  channel: Channel;
  underlay: boolean;
  visibilityDraft: "PUBLIC" | "PRIVATE";
  archiveDraft: boolean;
  updating: boolean;
  shareLinkCopied: boolean;
  onClose: () => void;
  onVisibilityDraftChange: (value: "PUBLIC" | "PRIVATE") => void;
  onArchiveDraftChange: (value: boolean) => void;
  onManageParticipants: () => void;
  onCopyShareLink: () => void;
  onSave: () => void;
  onDelete: (channel: Channel) => void;
};

export function ChannelManageDialog({
  channel,
  underlay,
  visibilityDraft,
  archiveDraft,
  updating,
  shareLinkCopied,
  onClose,
  onVisibilityDraftChange,
  onArchiveDraftChange,
  onManageParticipants,
  onCopyShareLink,
  onSave,
  onDelete
}: ChannelManageDialogProps) {
  return (
    <div
      className={`dialog-backdrop${underlay ? " dialog-backdrop-underlay" : ""}`}
      role="presentation"
      onMouseDown={onClose}
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
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>

        <div className="channel-manage-grid">
          <label>
            <span>Visibility</span>
            <select
              value={visibilityDraft}
              onChange={(event) =>
                onVisibilityDraftChange(event.target.value === "PUBLIC" ? "PUBLIC" : "PRIVATE")
              }
              disabled={updating}
            >
              <option value="PRIVATE">Private</option>
              <option value="PUBLIC">Public</option>
            </select>
          </label>

          <label className="archive-checkbox-row">
            <input
              type="checkbox"
              checked={archiveDraft}
              onChange={(event) => onArchiveDraftChange(event.target.checked)}
              disabled={updating}
            />
            <span>Archived</span>
          </label>
        </div>

        <div className="channel-manage-quick-actions">
          <button
            type="button"
            className="channel-manage-secondary-button"
            onClick={onManageParticipants}
            disabled={updating}
          >
            Manage participants
          </button>
          <button
            type="button"
            className="channel-manage-secondary-button"
            onClick={onCopyShareLink}
            disabled={updating}
          >
            {shareLinkCopied ? "Link copied" : "Copy share link"}
          </button>
        </div>

        <button
          className="channel-manage-save-button"
          type="button"
          onClick={onSave}
          disabled={
            updating ||
            (visibilityDraft === (channel.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE") &&
              archiveDraft === Boolean(channel.archivedAt))
          }
        >
          {updating ? "Saving..." : "Save"}
        </button>

        <button
          className="channel-manage-delete-button"
          type="button"
          onClick={() => onDelete(channel)}
          disabled={updating}
        >
          Delete channel
        </button>
      </section>
    </div>
  );
}
