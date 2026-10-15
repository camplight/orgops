import { useEffect, useState } from "react";

export function useShareLink(options: {
  activeChannelId: string | null;
  copyShareLink: (input: { channelId: string }) => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const { activeChannelId, copyShareLink, setError } = options;
  const [shareLinkCopied, setShareLinkCopied] = useState(false);

  useEffect(() => {
    setShareLinkCopied(false);
  }, [activeChannelId]);

  async function handleCopyShareLink() {
    if (!activeChannelId) return;
    try {
      await copyShareLink({ channelId: activeChannelId });
      setShareLinkCopied(true);
      window.setTimeout(() => setShareLinkCopied(false), 2000);
    } catch {
      setError("Unable to copy link. Please copy it from the address bar.");
    }
  }

  return { shareLinkCopied, handleCopyShareLink };
}
