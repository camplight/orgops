import { useEffect, useMemo, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EventRow } from "../types";
import { Button, Card, SelectAutocomplete, Textarea } from "../components/ui";
import { formatTimestamp } from "../utils/formatTimestamp";

type ChatScreenProps = {
  targetOptions: {
    id: string;
    label: string;
    meta?: string;
  }[];
  activeTargetId: string | null;
  events: EventRow[];
  messageText: string;
  onSelectTarget: (id: string) => void;
  onMessageTextChange: (value: string) => void;
  onSendMessage: () => Promise<void>;
};

export function ChatScreen({
  targetOptions,
  activeTargetId,
  events,
  messageText,
  onSelectTarget,
  onMessageTextChange,
  onSendMessage
}: ChatScreenProps) {
  const messageEvents = useMemo(
    () =>
      events
        .filter((event) => event.type === "message.created")
        .sort((left, right) => {
          const leftTs = left.createdAt ?? 0;
          const rightTs = right.createdAt ?? 0;
          if (leftTs !== rightTs) return leftTs - rightTs;
          return left.id.localeCompare(right.id);
        }),
    [events]
  );
  const activeTarget = targetOptions.find((target) => target.id === activeTargetId) ?? null;
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const lastMessageId = messageEvents[messageEvents.length - 1]?.id ?? null;

  useEffect(() => {
    if (!activeTargetId || !messagesContainerRef.current) {
      return;
    }

    messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
  }, [activeTargetId, lastMessageId, messageEvents.length]);

  return (
    <div className="space-y-6">
      <Card title="Destination">
        <div className="space-y-2">
          <div className="text-slate-400 text-sm">
            Select a channel or pick an agent to open a direct channel.
          </div>
          <SelectAutocomplete
            value={activeTargetId}
            options={targetOptions}
            placeholder="Search agent or channel..."
            onChange={onSelectTarget}
          />
        </div>
      </Card>

      <Card title={activeTarget ? `Chat: ${activeTarget.label}` : "Chat"}>
        {!activeTarget && (
          <div className="text-slate-500 text-sm">
            Select where to send your message.
          </div>
        )}

        {activeTarget && (
          <div className="space-y-4">
            <div ref={messagesContainerRef} className="space-y-2 text-sm max-h-96 overflow-auto">
              {messageEvents.map((event) => (
                <div key={event.id} className="border-b border-slate-800 pb-2">
                  <div className="text-slate-300">
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                        a: ({ children, ...props }) => (
                          <a
                            {...props}
                            className="text-sky-400 underline hover:text-sky-300"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {children}
                          </a>
                        ),
                        pre: ({ children }) => (
                          <pre className="mb-2 overflow-x-auto rounded bg-slate-900 p-2 text-slate-100 last:mb-0">
                            {children}
                          </pre>
                        ),
                        code: ({ children, ...props }) => (
                          <code
                            {...props}
                            className="rounded bg-slate-800 px-1 py-0.5 text-slate-100"
                          >
                            {children}
                          </code>
                        ),
                        ul: ({ children }) => (
                          <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
                        ),
                        blockquote: ({ children }) => (
                          <blockquote className="mb-2 border-l-2 border-slate-600 pl-3 text-slate-400 last:mb-0">
                            {children}
                          </blockquote>
                        )
                      }}
                    >
                      {(event.payload as { text?: string })?.text ?? ""}
                    </Markdown>
                  </div>
                  <div className="text-slate-500 text-xs">
                    {event.source} • {formatTimestamp(event.createdAt)}
                  </div>
                </div>
              ))}
              {messageEvents.length === 0 && (
                <div className="text-slate-500">No messages yet.</div>
              )}
            </div>

            <div className="space-y-2">
              <Textarea
                rows={3}
                placeholder="Send a message..."
                value={messageText}
                onChange={(e) => onMessageTextChange(e.target.value)}
              />
              <Button onClick={onSendMessage}>Send message</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
