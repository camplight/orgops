import { useRef } from "react";

export function useMessagesScroll(options: {
  hasNewMessagesBelow: boolean;
  setHasNewMessagesBelow: (value: boolean) => void;
}) {
  const { hasNewMessagesBelow, setHasNewMessagesBelow } = options;
  const messagesPanelRef = useRef<HTMLElement | null>(null);

  function scrollMessagesToBottom(behavior: ScrollBehavior = "smooth") {
    window.requestAnimationFrame(() => {
      const panel = messagesPanelRef.current;
      if (!panel) return;
      panel.scrollTo({ top: panel.scrollHeight, behavior });
    });
  }

  function isMessagesPanelNearBottom() {
    const panel = messagesPanelRef.current;
    if (!panel) return true;
    return panel.scrollHeight - panel.scrollTop - panel.clientHeight < 80;
  }

  function handleMessagesScroll() {
    if (hasNewMessagesBelow && isMessagesPanelNearBottom()) {
      setHasNewMessagesBelow(false);
    }
  }

  return { messagesPanelRef, scrollMessagesToBottom, isMessagesPanelNearBottom, handleMessagesScroll };
}
