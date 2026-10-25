import type { ComponentProps, RefObject, UIEventHandler } from "react";
import type { EventRow } from "../../types";
import { formatTime } from "../../domain/messaging/time-format";
import { Composer } from "../composer/composer";
import { MessageItem } from "../timeline/message-item";
import { TraceGroup } from "../timeline/trace-group";
import { TurnFailureItem } from "../timeline/turn-failure-item";

export type TimelineItem =
  | { kind: "message"; id: string; event: EventRow }
  | { kind: "trace-group"; id: string; traceEvents: EventRow[]; tone: "agent" | "system" };

type ChatStackProps = {
  messagesPanelRef: RefObject<HTMLElement>;
  handleMessagesScroll: UIEventHandler<HTMLElement>;
  isConversationEmpty: boolean;
  messagesLoading: boolean;
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  handleLoadOlderMessages: () => Promise<void> | void;
  timelineItems: TimelineItem[];
  activeChannelCanPost: boolean;
  activeChannel: ComponentProps<typeof Composer>["activeChannel"];
  activeChannelId: string | null;
  username: string;
  revealedSensitiveByEvent: Record<string, string>;
  sensitiveRevealErrors: Record<string, string>;
  sensitiveRevealPasswords: Record<string, string>;
  revealingSensitiveEventId: string | null;
  handleSensitivePasswordChange: (eventId: string, value: string) => void;
  handleRevealSensitive: (eventId: string) => Promise<void> | void;
  handleHideSensitive: (eventId: string) => void;
  expandedTraceEventId: string | null;
  setExpandedTraceEventId: (updater: (current: string | null) => string | null) => void;
  hasNewMessagesBelow: boolean;
  setHasNewMessagesBelow: (value: boolean) => void;
  scrollMessagesToBottom: () => void;
  composer: ComponentProps<typeof Composer>;
};

export function ChatStack({
  messagesPanelRef,
  handleMessagesScroll,
  isConversationEmpty,
  messagesLoading,
  hasOlderMessages,
  loadingOlderMessages,
  handleLoadOlderMessages,
  timelineItems,
  activeChannelCanPost,
  activeChannel,
  activeChannelId,
  username,
  revealedSensitiveByEvent,
  sensitiveRevealErrors,
  sensitiveRevealPasswords,
  revealingSensitiveEventId,
  handleSensitivePasswordChange,
  handleRevealSensitive,
  handleHideSensitive,
  expandedTraceEventId,
  setExpandedTraceEventId,
  hasNewMessagesBelow,
  setHasNewMessagesBelow,
  scrollMessagesToBottom,
  composer
}: ChatStackProps) {
  return (
    <section className="chat-stack">
      <section
        className={`messages-panel${isConversationEmpty ? " messages-panel-empty" : ""}`}
        ref={messagesPanelRef}
        onScroll={handleMessagesScroll}
      >
        {!messagesLoading && hasOlderMessages ? (
          <button
            className="load-older-button"
            disabled={loadingOlderMessages}
            onClick={() => void handleLoadOlderMessages()}
          >
            {loadingOlderMessages ? "Loading previous messages..." : "Load previous messages"}
          </button>
        ) : null}
        {messagesLoading ? (
          <div className="empty-state">
            <strong>Loading messages...</strong>
            <p>Fetching the latest channel activity.</p>
          </div>
        ) : timelineItems.length === 0 ? (
          <div className="empty-state">
            <strong>No messages yet</strong>
            <p>Send a short update or request to start the conversation.</p>
          </div>
        ) : (
          timelineItems.map((item) => {
            if (item.kind === "message" && item.event.type === "agent.turn.failed") {
              return (
                <TurnFailureItem
                  key={item.id}
                  event={item.event}
                  createdAtLabel={formatTime(item.event.createdAt)}
                />
              );
            }
            if (item.kind === "message") {
              const event = item.event;
              return (
                <MessageItem
                  key={item.id}
                  event={event}
                  canPost={activeChannelCanPost && !activeChannel?.archivedAt}
                  channelId={activeChannelId}
                  username={username}
                  revealedSensitive={revealedSensitiveByEvent[event.id] ?? ""}
                  revealError={sensitiveRevealErrors[event.id] ?? ""}
                  revealPassword={sensitiveRevealPasswords[event.id] ?? ""}
                  revealing={revealingSensitiveEventId === event.id}
                  onPasswordChange={(value) => handleSensitivePasswordChange(event.id, value)}
                  onReveal={() => void handleRevealSensitive(event.id)}
                  onHide={() => handleHideSensitive(event.id)}
                />
              );
            }
            return (
              <TraceGroup
                key={item.id}
                traceEvents={item.traceEvents}
                tone={item.tone}
                expandedTraceEventId={expandedTraceEventId}
                onToggleTraceEvent={(eventId) =>
                  setExpandedTraceEventId((current) => (current === eventId ? null : eventId))
                }
              />
            );
          })
        )}
      </section>

      {hasNewMessagesBelow ? (
        <button
          className="new-messages-button"
          onClick={() => {
            setHasNewMessagesBelow(false);
            scrollMessagesToBottom();
          }}
        >
          New messages below
        </button>
      ) : null}

      <Composer {...composer} />
    </section>
  );
}
