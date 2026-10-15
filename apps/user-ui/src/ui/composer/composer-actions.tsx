type ComposerActionsProps = {
  canAttach: boolean;
  canSend: boolean;
  sending: boolean;
  uploadingAttachmentCount: number;
  onAttachClick: () => void;
};

export function ComposerActions({
  canAttach,
  canSend,
  sending,
  uploadingAttachmentCount,
  onAttachClick
}: ComposerActionsProps) {
  return (
    <div className="composer-actions">
      <button
        type="button"
        className="composer-secondary"
        disabled={!canAttach}
        onClick={onAttachClick}
      >
        Attach files
      </button>
      <button disabled={!canSend}>
        {uploadingAttachmentCount > 0
          ? `Uploading ${uploadingAttachmentCount}...`
          : sending
            ? "Sending..."
            : "Send"}
      </button>
    </div>
  );
}
