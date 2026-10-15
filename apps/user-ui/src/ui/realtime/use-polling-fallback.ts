import { useEffect } from "react";

export function usePollingFallback(options: { enabled: boolean; poll: () => void }) {
  const { enabled, poll } = options;
  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(poll, 10000);
    return () => window.clearInterval(interval);
  }, [enabled]);
}
