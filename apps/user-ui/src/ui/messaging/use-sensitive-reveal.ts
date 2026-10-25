import { useState } from "react";

export function useSensitiveReveal(options: {
  revealSensitive: (input: { eventId: string; password: string }) => Promise<string>;
}) {
  const { revealSensitive } = options;
  const [sensitiveRevealPasswords, setSensitiveRevealPasswords] = useState<Record<string, string>>({});
  const [revealedSensitiveByEvent, setRevealedSensitiveByEvent] = useState<Record<string, string>>({});
  const [revealingSensitiveEventId, setRevealingSensitiveEventId] = useState<string | null>(null);
  const [sensitiveRevealErrors, setSensitiveRevealErrors] = useState<Record<string, string>>({});

  async function handleRevealSensitive(eventId: string) {
    const password = sensitiveRevealPasswords[eventId] ?? "";
    if (!password) {
      setSensitiveRevealErrors((current) => ({ ...current, [eventId]: "Enter your password to reveal." }));
      return;
    }
    setRevealingSensitiveEventId(eventId);
    setSensitiveRevealErrors((current) => ({ ...current, [eventId]: "" }));
    try {
      const text = await revealSensitive({ eventId, password });
      if (!text) {
        setSensitiveRevealErrors((current) => ({ ...current, [eventId]: "No sensitive content was returned." }));
        return;
      }
      setRevealedSensitiveByEvent((current) => ({ ...current, [eventId]: text }));
      setSensitiveRevealPasswords((current) => ({ ...current, [eventId]: "" }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unable to reveal sensitive content";
      setSensitiveRevealErrors((current) => ({ ...current, [eventId]: detail || "Unable to reveal sensitive content" }));
    } finally {
      setRevealingSensitiveEventId((current) => (current === eventId ? null : current));
    }
  }

  function handleHideSensitive(eventId: string) {
    setRevealedSensitiveByEvent((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, eventId)) return current;
      const next = { ...current };
      delete next[eventId];
      return next;
    });
  }

  function handleSensitivePasswordChange(eventId: string, value: string) {
    setSensitiveRevealPasswords((current) => ({
      ...current,
      [eventId]: value
    }));
    setSensitiveRevealErrors((current) => ({ ...current, [eventId]: "" }));
  }

  return {
    sensitiveRevealPasswords,
    revealedSensitiveByEvent,
    revealingSensitiveEventId,
    sensitiveRevealErrors,
    handleRevealSensitive,
    handleHideSensitive,
    handleSensitivePasswordChange
  };
}
