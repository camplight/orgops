import { useEffect, useState, type FormEvent } from "react";
import type { ChannelShare } from "../../types";

export function useShares(options: {
  activeChannelId: string | null;
  addShare: (input: {
    channelId: string;
    viewerType: "HUMAN" | "AGENT";
    viewerId: string;
  }) => Promise<void>;
  removeShare: (input: {
    channelId: string;
    viewerType: string;
    viewerId: string;
  }) => Promise<void>;
  refreshChannels: (nextActiveChannelId?: string | null) => Promise<unknown>;
  setError: (message: string | null) => void;
}) {
  const { activeChannelId, addShare, removeShare, refreshChannels, setError } = options;
  const [shareKind, setShareKind] = useState<"HUMAN" | "AGENT">("HUMAN");
  const [shareValue, setShareValue] = useState("");
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [shareRemovingKey, setShareRemovingKey] = useState<string | null>(null);

  useEffect(() => {
    setShareValue("");
    setShareRemovingKey(null);
    setShareSubmitting(false);
  }, [activeChannelId]);

  async function handleAddShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeChannelId || !shareValue.trim()) return;
    setShareSubmitting(true);
    setError(null);
    try {
      await addShare({
        channelId: activeChannelId,
        viewerType: shareKind,
        viewerId: shareValue
      });
      await refreshChannels(activeChannelId);
      setShareValue("");
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : "Unable to share channel");
    } finally {
      setShareSubmitting(false);
    }
  }

  async function handleRemoveShare(share: ChannelShare) {
    if (!activeChannelId) return;
    const shareKey = `${share.viewerType}:${share.viewerId}`;
    setShareRemovingKey(shareKey);
    setError(null);
    try {
      await removeShare({
        channelId: activeChannelId,
        viewerType: share.viewerType,
        viewerId: share.viewerId
      });
      await refreshChannels(activeChannelId);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove shared viewer");
    } finally {
      setShareRemovingKey(null);
    }
  }

  return {
    shareKind,
    shareValue,
    shareSubmitting,
    shareRemovingKey,
    setShareKind,
    setShareValue,
    handleAddShare,
    handleRemoveShare
  };
}
