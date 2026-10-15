import { useEffect, useState } from "react";
import { channelLabel } from "../../domain/conversations/channel-rules";
import type { Channel } from "../../types";

export function useChannelManagement(options: {
  activeChannel: Channel | null;
  activeChannelId: string | null;
  username: string;
  updateChannelSettings: (input: {
    channel: Channel;
    visibilityDraft: "PUBLIC" | "PRIVATE";
    archiveDraft: boolean;
  }) => Promise<{ archivedNow: boolean }>;
  deleteChannel: (input: { channelId: string }) => Promise<void>;
  confirm: (message: string) => boolean;
  refreshChannels: (nextActiveChannelId?: string | null) => Promise<unknown>;
  setError: (message: string | null) => void;
  setLoading: (loading: boolean) => void;
  setShowArchivedChannels: (show: boolean) => void;
  setShowChannelManageDialog: (show: boolean) => void;
}) {
  const {
    activeChannel,
    activeChannelId,
    username,
    updateChannelSettings,
    deleteChannel,
    confirm,
    refreshChannels,
    setError,
    setLoading,
    setShowArchivedChannels,
    setShowChannelManageDialog
  } = options;
  const [channelVisibilityDraft, setChannelVisibilityDraft] = useState<"PUBLIC" | "PRIVATE">("PRIVATE");
  const [updatingChannelVisibility, setUpdatingChannelVisibility] = useState(false);
  const [archiveDraft, setArchiveDraft] = useState(false);

  useEffect(() => {
    if (!activeChannel) return;
    setChannelVisibilityDraft(activeChannel.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE");
    setArchiveDraft(Boolean(activeChannel.archivedAt));
  }, [activeChannel?.id, activeChannel?.visibility, activeChannel?.archivedAt]);

  async function handleDeleteChannel(channel: Channel) {
    if (!confirm(`Permanently delete ${channelLabel(channel, username)}?`)) return;
    setError(null);
    setLoading(true);
    try {
      await deleteChannel({ channelId: channel.id });
      await refreshChannels(activeChannelId === channel.id ? null : undefined);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete channel");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveChannelSettings() {
    if (!activeChannel) return;
    setUpdatingChannelVisibility(true);
    setError(null);
    try {
      const { archivedNow } = await updateChannelSettings({
        channel: activeChannel,
        visibilityDraft: channelVisibilityDraft,
        archiveDraft
      });
      if (archivedNow) setShowArchivedChannels(true);
      await refreshChannels(activeChannel.id);
      setShowChannelManageDialog(false);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update channel settings");
    } finally {
      setUpdatingChannelVisibility(false);
    }
  }

  return {
    channelVisibilityDraft,
    archiveDraft,
    updatingChannelVisibility,
    setChannelVisibilityDraft,
    setArchiveDraft,
    handleDeleteChannel,
    handleSaveChannelSettings
  };
}
